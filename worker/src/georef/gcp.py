"""Geo-referencing engine: ground control points → affine / 2nd-order polynomial transform.

A scanned cadastral sheet (PNG/JPG/PDF) or a raster without a CRS is parked in `needs_georef`
with a preview image. An officer pairs preview pixels with map coordinates; the API previews the
fit (residuals / RMSE) and then queues GEOREFERENCE, which writes a proper GeoTIFF and re-runs
ingestion on it.
"""
import os
import tempfile

import numpy as np

from db import cursor, get_data_source, set_status, update_source_metadata
from queue_client import enqueue
from r2 import download, upload

PREVIEW_MAX = 1600
MIN_GCPS = {"affine": 3, "poly2": 6}


# ── pure maths (unit-tested) ────────────────────────────────────────────────
def _design(px, py, kind):
    px, py = np.asarray(px, float), np.asarray(py, float)
    one = np.ones_like(px)
    if kind == "affine":
        return np.column_stack([one, px, py])
    if kind == "poly2":
        return np.column_stack([one, px, py, px * px, px * py, py * py])
    raise ValueError(f"unknown transform '{kind}'")


def solve_transform(gcps, kind="affine"):
    """gcps: [{px, py, x, y}] (pixel → target CRS). Least-squares fit; returns coefficients for x
    and y, per-point residuals (target units) and RMSE."""
    if len(gcps) < MIN_GCPS[kind]:
        raise ValueError(f"{kind} needs at least {MIN_GCPS[kind]} control points (got {len(gcps)})")
    px = [g["px"] for g in gcps]; py = [g["py"] for g in gcps]
    x = np.array([g["x"] for g in gcps], float); y = np.array([g["y"] for g in gcps], float)
    A = _design(px, py, kind)
    cx, *_ = np.linalg.lstsq(A, x, rcond=None)
    cy, *_ = np.linalg.lstsq(A, y, rcond=None)
    rx = A @ cx - x; ry = A @ cy - y
    residuals = np.sqrt(rx ** 2 + ry ** 2)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    return {"kind": kind, "cx": cx.tolist(), "cy": cy.tolist(),
            "residuals": residuals.tolist(), "rmse": rmse}


def apply_transform(sol, px, py):
    A = _design([px], [py], sol["kind"])
    return float((A @ np.array(sol["cx"]))[0]), float((A @ np.array(sol["cy"]))[0])


# ── raster helpers ──────────────────────────────────────────────────────────
def _load_image(path):
    """First page of a PDF, or an image / GeoTIFF, as an H×W×C uint8 array."""
    import cv2
    low = path.lower()
    if low.endswith(".pdf"):
        from pdf2image import convert_from_path
        page = convert_from_path(path, dpi=150, first_page=1, last_page=1)[0]
        return np.array(page.convert("RGB"))
    if low.endswith((".tif", ".tiff")):
        import rasterio
        with rasterio.open(path) as ds:
            arr = ds.read(indexes=list(range(1, min(ds.count, 3) + 1)))
        arr = np.moveaxis(arr, 0, -1)
        if arr.dtype != np.uint8:
            lo, hi = np.nanpercentile(arr, (2, 98))
            arr = np.clip((arr - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
        return arr if arr.shape[-1] != 1 else arr[..., 0]
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def make_preview(path):
    """Downsampled PNG for the GCP picker + the original pixel size (GCPs are sent in original pixels)."""
    import cv2
    img = _load_image(path)
    h, w = img.shape[:2]
    scale = min(1.0, PREVIEW_MAX / max(h, w))
    prev = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
    fd, out = tempfile.mkstemp(suffix=".png"); os.close(fd)
    cv2.imwrite(out, cv2.cvtColor(prev, cv2.COLOR_RGB2BGR) if prev.ndim == 3 else prev)
    return out, {"image_width": w, "image_height": h,
                 "preview_width": prev.shape[1], "preview_height": prev.shape[0]}


def _write_geotiff(img, gcps, kind, crs, sol):
    import rasterio
    from rasterio.control import GroundControlPoint
    from rasterio.transform import Affine
    from rasterio.warp import calculate_default_transform, reproject, Resampling
    bands = img[..., None] if img.ndim == 2 else img
    count = bands.shape[-1]
    h, w = bands.shape[:2]
    fd, out = tempfile.mkstemp(suffix=".tif"); os.close(fd)
    if kind == "affine":
        c0, c1, c2 = sol["cx"]; d0, d1, d2 = sol["cy"]
        transform = Affine(c1, c2, c0, d1, d2, d0)          # x = c0 + c1·px + c2·py
        with rasterio.open(out, "w", driver="GTiff", width=w, height=h, count=count, dtype="uint8",
                           crs=crs, transform=transform, compress="deflate") as dst:
            dst.write(np.moveaxis(bands, -1, 0))
        return out
    # Polynomial: warp through GDAL's GCP transformer onto a regular grid.
    gcp_objs = [GroundControlPoint(row=g["py"], col=g["px"], x=g["x"], y=g["y"]) for g in gcps]
    dst_transform, dw, dh = calculate_default_transform(crs, crs, w, h, gcps=gcp_objs)
    with rasterio.open(out, "w", driver="GTiff", width=dw, height=dh, count=count, dtype="uint8",
                       crs=crs, transform=dst_transform, compress="deflate") as dst:
        for i in range(count):
            dest = np.zeros((dh, dw), np.uint8)
            reproject(bands[..., i], dest, gcps=gcp_objs, src_crs=crs, dst_transform=dst_transform,
                      dst_crs=crs, resampling=Resampling.bilinear)
            dst.write(dest, i + 1)
    return out


def georeference(job):
    """job: {sourceId, gcps: [{px, py, x, y}], kind: affine|poly2, crs: EPSG:xxxx}"""
    src = get_data_source(job["sourceId"])
    gcps, kind, crs = job["gcps"], job.get("kind", "affine"), job.get("crs", "EPSG:4326")
    sol = solve_transform(gcps, kind)
    path = download(src["r2_key"])
    try:
        img = _load_image(path)
        out = _write_geotiff(img, gcps, kind, crs, sol)
        key = f"sources/georef/{src['id']}.tif"
        upload(out, key, "image/tiff")
        with cursor() as cur:
            cur.execute("UPDATE data_sources SET r2_key=%s, crs=%s, status='processing' WHERE id=%s",
                        (key, crs, src["id"]))
        update_source_metadata(src["id"], {"georef": {"kind": kind, "crs": crs, "gcp_count": len(gcps),
                                                       "rmse": sol["rmse"], "original_key": src["r2_key"]}})
        enqueue("NORMALIZE_SOURCE", sourceId=str(src["id"]), r2Key=key, type=src["type"], wardId=src["ward_id"])
        print(f"[georef] {src['id']} {kind} with {len(gcps)} GCPs, RMSE {sol['rmse']:.3g} -> {key}")
        return {"rmse": sol["rmse"], "kind": kind, "key": key}
    except Exception as e:  # noqa: BLE001
        set_status(src["id"], "needs_georef", f"georeferencing failed: {e}")
        raise
