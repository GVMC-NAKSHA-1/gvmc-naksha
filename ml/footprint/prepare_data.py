"""Imagery + building labels → 512×512 training tiles (PNG image + 0/255 mask).

Labels can be vectors (GeoJSON / GPKG / zipped shapefile — e.g. the NAKSHA building_footprint layer,
Microsoft Building Footprints — or a Google Open Buildings CSV with a WKT `geometry` column) or a
ready raster mask (Inria Aerial: gt/*.tif, 255 = building).

Tiles are cut at one or more ground sample distances (--gsd): the worker analyses rasters at ≤ 4096
px on the longest side, so the model sees different resolutions and must be trained across them.
The train/val/test split is by spatial block (default 8×8 tiles), never by random tile: adjacent
tiles share buildings and would leak into the test set.

  python prepare_data.py --image ori_ward12.tif --labels buildings.geojson --out tiles --gsd 0.3 0.5
  python prepare_data.py --image inria/images/austin1.tif --mask inria/gt/austin1.tif --out tiles
"""
import argparse
import hashlib
import os

import numpy as np

TILE = 512


def _split(key, val=0.1, test=0.1):
    h = int(hashlib.md5(key.encode()).hexdigest(), 16) % 1000 / 1000
    return "test" if h < test else "val" if h < test + val else "train"


def _read_labels(path, crs, bounds, min_conf):
    import geopandas as gpd
    from shapely import wkt
    from shapely.geometry import box
    if path.lower().endswith(".csv") or path.lower().endswith(".csv.gz"):
        import pandas as pd
        df = pd.read_csv(path)
        if "confidence" in df and min_conf:
            df = df[df["confidence"] >= min_conf]                  # Open Buildings: drop weak detections
        gdf = gpd.GeoDataFrame(df, geometry=df["geometry"].map(wkt.loads), crs="EPSG:4326")
    else:
        gdf = gpd.read_file(path)
    gdf = gdf.to_crs(crs)
    return gdf[gdf.intersects(box(*bounds))].geometry


def _resampled(ds, gsd):
    """Read RGB (+ target transform) at the requested ground sample distance in metres."""
    from rasterio.enums import Resampling
    px = abs(ds.transform.a)
    if ds.crs.is_geographic:
        lat = (ds.bounds.top + ds.bounds.bottom) / 2
        px *= 111320 * np.cos(np.radians(lat))
    scale = px / gsd if gsd else 1.0
    h, w = max(1, int(ds.height * scale)), max(1, int(ds.width * scale))
    arr = ds.read([1, 2, 3], out_shape=(3, h, w), resampling=Resampling.average, masked=True)
    transform = ds.transform * ds.transform.scale(ds.width / w, ds.height / h)
    return arr, transform, (h, w)


def _to_uint8(arr):
    """Same stretch as the worker (_to_uint8_rgb): 2–98 percentile → 0–255."""
    rgb = np.moveaxis(arr.astype(np.float32).filled(np.nan), 0, -1)
    lo, hi = np.nanpercentile(rgb, (2, 98))
    return np.nan_to_num(np.clip((rgb - lo) / max(hi - lo, 1e-6) * 255, 0, 255)).astype(np.uint8)


def process(image, labels, mask_path, out, gsds, block, min_conf, max_nodata):
    import cv2
    import rasterio
    from rasterio.features import rasterize
    name = os.path.splitext(os.path.basename(image))[0]
    counts = {"train": 0, "val": 0, "test": 0}
    with rasterio.open(image) as ds:
        for gsd in gsds:
            arr, transform, (h, w) = _resampled(ds, gsd)
            rgb, nodata = _to_uint8(arr), np.ma.getmaskarray(arr).any(axis=0)
            if mask_path:
                from rasterio.enums import Resampling
                with rasterio.open(mask_path) as ms:
                    mask = ms.read(1, out_shape=(h, w), resampling=Resampling.nearest) > 127
            else:
                geoms = _read_labels(labels, ds.crs, ds.bounds, min_conf)
                mask = rasterize(((g, 1) for g in geoms if not g.is_empty), out_shape=(h, w),
                                 transform=transform, fill=0, dtype="uint8").astype(bool)
            for ty in range(0, h - TILE + 1, TILE):
                for tx in range(0, w - TILE + 1, TILE):
                    if nodata[ty:ty + TILE, tx:tx + TILE].mean() > max_nodata:
                        continue
                    split = _split(f"{name}:{ty // TILE // block}:{tx // TILE // block}")
                    stem = f"{name}_g{gsd or 'native'}_{ty}_{tx}"
                    for sub, data in (("images", cv2.cvtColor(rgb[ty:ty + TILE, tx:tx + TILE], cv2.COLOR_RGB2BGR)),
                                      ("masks", mask[ty:ty + TILE, tx:tx + TILE].astype(np.uint8) * 255)):
                        os.makedirs(os.path.join(out, split, sub), exist_ok=True)
                        cv2.imwrite(os.path.join(out, split, sub, stem + ".png"), data)
                    counts[split] += 1
    return counts


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image", nargs="+", required=True, help="RGB GeoTIFF(s): drone ORI, aerial, Inria image")
    lab = ap.add_mutually_exclusive_group(required=True)
    lab.add_argument("--labels", help="building polygons (GeoJSON/GPKG/SHP/Open Buildings CSV) for all images")
    lab.add_argument("--mask", nargs="+", help="raster masks, one per --image (Inria gt/*.tif)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--gsd", type=float, nargs="*", default=[0.3, 0.5],
                    help="ground sample distances in metres to tile at (0 = native)")
    ap.add_argument("--block", type=int, default=8, help="tiles per split block side")
    ap.add_argument("--min-confidence", type=float, default=0.75, help="Open Buildings confidence cut-off")
    ap.add_argument("--max-nodata", type=float, default=0.2)
    a = ap.parse_args()
    if a.mask and len(a.mask) != len(a.image):
        ap.error("--mask needs one file per --image")
    total = {"train": 0, "val": 0, "test": 0}
    for i, img in enumerate(a.image):
        c = process(img, a.labels, a.mask[i] if a.mask else None, a.out, [g or None for g in a.gsd],
                    a.block, a.min_confidence, a.max_nodata)
        print(img, c)
        total = {k: total[k] + c[k] for k in total}
    print("tiles:", total)
