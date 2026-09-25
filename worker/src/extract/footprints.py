"""GeoAI building-footprint extraction from drone imagery, ORI and DSM/DTM rasters.

Three interchangeable detectors produce a building mask; everything after that is shared:

  ndsm       normalised DSM (DSM − DTM) above a height threshold. A single-band DSM gets its
             DTM estimated with a grey-scale morphological opening (a progressive-morphological
             ground filter); a 2-band raster is read as band 1 = DSM, band 2 = DTM.
  model      an ONNX semantic-segmentation model (FOOTPRINT_MODEL_PATH; input 1×3×T×T float,
             output 1×1×T×T or 1×2×T×T building probability) run tile-by-tile on CPU.
  classical  RGB fallback: suppress vegetation (excess-green) and shadow, Otsu on brightness,
             morphological clean-up — used when neither elevation nor a model is available.

mask → connected components → polygons (raster CRS) → simplify → regularise (min rotated
rectangle for near-rectangular roofs) → WGS84 → `ai_extracted` data source + source_features.
"""
import json
import math
import os
from datetime import datetime, timezone

import numpy as np

from db import cursor, get_data_source, insert_source_features
from queue_client import enqueue
from r2 import download

MAX_PIXELS = 4096            # analysis resolution cap (longest side)
DEFAULTS = {"min_height_m": 2.5, "min_area_sqm": 20.0, "simplify_m": 0.5, "ground_window_m": 30.0,
            "prob_threshold": 0.5}


# ── masks (pure numpy / cv2 — unit-tested) ──────────────────────────────────
def estimate_dtm(dsm, pixel_m, window_m=30.0):
    """Ground surface from a DSM by grey-scale opening with a window larger than any building."""
    import cv2
    k = max(3, int(round(window_m / max(pixel_m, 1e-6))) | 1)
    k = min(k, 255)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    filled = np.where(np.isfinite(dsm), dsm, np.nanmin(dsm)).astype(np.float32)
    return cv2.morphologyEx(filled, cv2.MORPH_OPEN, kernel)


def ndsm_mask(dsm, dtm, min_height_m):
    ndsm = np.asarray(dsm, float) - np.asarray(dtm, float)
    ndsm[~np.isfinite(ndsm)] = 0
    return ndsm > min_height_m, ndsm


def classical_mask(rgb):
    """Vegetation- and shadow-suppressed bright-surface mask from an RGB image (uint8)."""
    import cv2
    rgb = np.asarray(rgb)
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    exg = 2 * g - r - b                                   # excess-green vegetation index
    gray = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)
    _, bright = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    veg = exg > 20
    shadow = gray < np.percentile(gray, 10)
    return (bright > 0) & ~veg & ~shadow


def clean_mask(mask, pixel_m):
    import cv2
    k = max(3, int(round(1.5 / max(pixel_m, 1e-6))) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (min(k, 15), min(k, 15)))
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_OPEN, kernel)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    return m.astype(bool)


def model_probability(rgb, model_path, tile=512, overlap=64):
    """Tile an RGB image through an ONNX segmentation model; returns an H×W probability map."""
    import onnxruntime as ort
    sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    h, w = rgb.shape[:2]
    prob = np.zeros((h, w), np.float32)
    hits = np.zeros((h, w), np.float32)
    step = tile - overlap
    img = rgb.astype(np.float32) / 255.0
    for y0 in range(0, max(h - overlap, 1), step):
        for x0 in range(0, max(w - overlap, 1), step):
            y1, x1 = min(y0 + tile, h), min(x0 + tile, w)
            patch = np.zeros((tile, tile, 3), np.float32)
            patch[: y1 - y0, : x1 - x0] = img[y0:y1, x0:x1, :3]
            out = sess.run(None, {name: np.moveaxis(patch, -1, 0)[None]})[0][0]
            p = out[-1] if out.shape[0] > 1 else out[0]
            if p.min() < 0 or p.max() > 1:                  # logits → probability
                p = 1 / (1 + np.exp(-p))
            prob[y0:y1, x0:x1] += p[: y1 - y0, : x1 - x0]
            hits[y0:y1, x0:x1] += 1
    return prob / np.maximum(hits, 1)


# ── vectorisation (pure — unit-tested) ─────────────────────────────────────
def regularize(poly, threshold=0.85):
    """Replace a near-rectangular footprint by its minimum rotated rectangle (clean roof outline)."""
    if poly.is_empty or poly.area == 0:
        return poly
    mrr = poly.minimum_rotated_rectangle
    return mrr if poly.area / mrr.area >= threshold else poly


def polygonize(mask, transform, values=None, min_area_px=1, simplify=0.0):
    """Connected components of `mask` → [(shapely polygon in raster CRS, stats)].
    stats: area_px, mean/max of `values` inside the component (heights or probabilities)."""
    import cv2
    from rasterio.features import shapes
    from shapely.geometry import shape as to_shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    out = []
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area_px]
    if not keep:
        return out
    lab = labels.astype(np.int32)
    for geom, label in shapes(lab, mask=np.isin(lab, keep), transform=transform):
        label = int(label)
        poly = to_shape(geom)
        if simplify:
            poly = poly.simplify(simplify, preserve_topology=True)
        poly = regularize(poly.buffer(0))
        st = {"area_px": int(stats[label, cv2.CC_STAT_AREA])}
        if values is not None:
            v = values[lab == label]
            st["mean"] = float(np.mean(v)); st["max"] = float(np.max(v))
        out.append((poly, st))
    return out


def feature_confidence(method, stats, min_height_m=2.5):
    """0–1 confidence per extracted footprint."""
    if method == "ndsm":
        h = stats.get("mean", min_height_m)
        return round(float(min(0.98, 0.55 + 0.45 * (1 - math.exp(-(h - min_height_m) / 3)))), 3)
    if method == "model":
        return round(float(stats.get("mean", 0.5)), 3)
    return 0.5


# ── job ─────────────────────────────────────────────────────────────────────
def _pixel_size_m(ds_crs, transform, lat):
    res = abs(transform.a)
    if ds_crs and ds_crs.is_geographic:
        return res * 111320 * math.cos(math.radians(lat))
    return res


def _read(path):
    """Read a raster at ≤ MAX_PIXELS, returning (array bands×H×W, transform, crs)."""
    import rasterio
    from rasterio.enums import Resampling
    with rasterio.open(path) as ds:
        scale = min(1.0, MAX_PIXELS / max(ds.width, ds.height))
        h, w = max(1, int(ds.height * scale)), max(1, int(ds.width * scale))
        arr = ds.read(out_shape=(ds.count, h, w), resampling=Resampling.average, masked=True)
        transform = ds.transform * ds.transform.scale(ds.width / w, ds.height / h)
        arr = arr.filled(np.nan).astype(np.float32) if np.ma.isMaskedArray(arr) else arr.astype(np.float32)
        return arr, transform, ds.crs


def _to_uint8_rgb(arr):
    rgb = np.moveaxis(arr[:3], 0, -1)
    lo, hi = np.nanpercentile(rgb, (2, 98))
    return np.clip((rgb - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)


def _resolve_method(requested, src_type, bands):
    if requested != "auto":
        return requested
    if src_type == "dsm_dtm" or bands == 1:
        return "ndsm"
    if os.environ.get("FOOTPRINT_MODEL_PATH") and os.path.exists(os.environ["FOOTPRINT_MODEL_PATH"]):
        return "model"
    return "classical"


def run_extraction(path, src_type, method="auto", params=None):
    """Pure-ish core (no DB): raster file → (method_used, [(wgs84 polygon, props)], metrics)."""
    from pyproj import Geod, Transformer
    from shapely.ops import transform as shp_transform
    p = {**DEFAULTS, **(params or {})}
    arr, transform, crs = _read(path)
    if crs is None:
        raise ValueError("raster has no CRS — georeference it first")
    method_used = _resolve_method(method, src_type, arr.shape[0])
    center_lat = (transform * (arr.shape[2] / 2, arr.shape[1] / 2))[1]
    if crs.is_projected:
        center_lat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True).transform(
            *(transform * (arr.shape[2] / 2, arr.shape[1] / 2)))[1]
    px_m = _pixel_size_m(crs, transform, center_lat)

    values = None
    if method_used == "ndsm":
        dsm = arr[0]
        dtm = arr[1] if arr.shape[0] >= 2 else estimate_dtm(dsm, px_m, p["ground_window_m"])
        mask, values = ndsm_mask(dsm, dtm, p["min_height_m"])
    elif method_used == "model":
        model_path = os.environ.get("FOOTPRINT_MODEL_PATH")
        if not model_path or not os.path.exists(model_path):
            raise ValueError("method 'model' needs FOOTPRINT_MODEL_PATH pointing to an ONNX model")
        values = model_probability(_to_uint8_rgb(arr), model_path)
        mask = values >= p["prob_threshold"]
    elif method_used == "classical":
        if arr.shape[0] < 3:
            raise ValueError("classical extraction needs an RGB raster")
        mask = classical_mask(_to_uint8_rgb(arr))
    else:
        raise ValueError(f"unknown method {method_used}")

    mask = clean_mask(mask, px_m)
    min_area_px = max(1, int(p["min_area_sqm"] / (px_m * px_m)))
    simplify = p["simplify_m"] if crs.is_projected else p["simplify_m"] / 111320
    polys = polygonize(mask, transform, values, min_area_px, simplify)

    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    geod = Geod(ellps="WGS84")
    feats, heights, confs, areas = [], [], [], []
    for poly, st in polys:
        g = shp_transform(to_wgs.transform, poly) if not crs.to_epsg() == 4326 else poly
        area = abs(geod.geometry_area_perimeter(g)[0])
        if area < p["min_area_sqm"]:
            continue
        conf = feature_confidence(method_used, st, p["min_height_m"])
        props = {"area_sqm": round(area, 1), "confidence": conf, "method": method_used}
        if method_used == "ndsm":
            props["height_m"] = round(st.get("mean", 0), 2)
            heights.append(props["height_m"])
        feats.append((g, props)); confs.append(conf); areas.append(area)
    metrics = {
        "feature_count": len(feats),
        "mean_confidence": round(float(np.mean(confs)), 3) if confs else None,
        "mean_height_m": round(float(np.mean(heights)), 2) if heights else None,
        "total_area_sqm": round(float(np.sum(areas)), 1) if areas else 0,
        "area_histogram": np.histogram(areas, bins=[0, 50, 100, 200, 400, 1e9])[0].tolist() if areas else [],
        "pixel_size_m": round(px_m, 3),
    }
    return method_used, feats, metrics


def extract_features(job):
    """job: {runId, sourceId, wardId, method?, params?}"""
    from shapely.geometry import mapping
    run_id, src = job["runId"], get_data_source(job["sourceId"])
    with cursor() as cur:
        cur.execute("SELECT method, params FROM extraction_runs WHERE id=%s", (run_id,))
        run = cur.fetchone() or {}
        cur.execute("UPDATE extraction_runs SET status='running' WHERE id=%s", (run_id,))
    path = download(src["r2_key"])
    try:
        method_used, feats, metrics = run_extraction(path, src["type"], run.get("method") or job.get("method", "auto"),
                                                     run.get("params") or job.get("params"))
        with cursor() as cur:
            cur.execute(
                """INSERT INTO data_sources (type, ward_id, r2_key, original_name, crs, captured_at, status, metadata)
                   VALUES ('ai_extracted', %s, %s, %s, 'EPSG:4326', %s, 'ready', %s) RETURNING id""",
                (src["ward_id"], f"derived/extraction/{run_id}.geojson",
                 f"ai_footprints_{method_used}_{(src['original_name'] or 'raster').rsplit('.', 1)[0]}.geojson",
                 src["captured_at"] or datetime.now(timezone.utc),
                 json.dumps({"fields": ["area_sqm", "confidence", "method"] + (["height_m"] if method_used == "ndsm" else []),
                             "feature_count": len(feats), "parent_source_id": str(src["id"]),
                             "extraction_run_id": run_id, "method": method_used})))
            new_id = cur.fetchone()["id"]
        insert_source_features(new_id, [(mapping(g), props, False) for g, props in feats])
        with cursor() as cur:
            cur.execute("""UPDATE extraction_runs SET status='done', method_used=%s, result_source_id=%s,
                                  feature_count=%s, metrics=%s, finished_at=now() WHERE id=%s""",
                        (method_used, new_id, len(feats), json.dumps(metrics), run_id))
        if src["ward_id"]:
            enqueue("FIX_TOPOLOGY", sourceId=str(new_id), wardId=src["ward_id"], autoFix=False)
            enqueue("HARMONIZE_WARD", wardId=src["ward_id"])
        print(f"[extract] {src['id']} via {method_used}: {len(feats)} footprints -> source {new_id}")
        return {"method": method_used, "features": len(feats), "result_source_id": str(new_id)}
    except Exception as e:  # noqa: BLE001
        with cursor() as cur:
            cur.execute("UPDATE extraction_runs SET status='failed', error=%s, finished_at=now() WHERE id=%s", (str(e), run_id))
        raise
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
