"""Downloads (cached under DATA_CACHE): OpenStreetMap via Overpass, building footprints, Copernicus DEM.

Standard library HTTP only, so the tools run on the worker image with no extra packages.
Building footprints come from Microsoft's Global ML Building Footprints by default — one 12 MB
tile covers all of Visakhapatnam. Overture (Google + Microsoft + OSM merged, better coverage) is
available with NAKSHA_BUILDINGS=overture but needs `pip install duckdb` and a fast connection:
the query reads metadata from every global file.
"""
import gzip
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from .common import GVMC_BBOX, cache

UA = "naksha-geointegrate-open-pack/1.0 (data/README.md)"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
OVERTURE_RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.0")
MS_INDEX = "https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv"
DEM_TILE = "Copernicus_DSM_COG_10_N17_00_E083_00_DEM"          # covers the whole GVMC bbox
ROADS = "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$"


def _get(url, data=None, timeout=600):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _download(url, fp):
    if os.path.exists(fp):
        return fp
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=900) as r, open(fp + ".part", "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    os.replace(fp + ".part", fp)
    return fp


def _overpass(query, label):
    fp = cache("osm", f"{label}.json")
    if os.path.exists(fp):
        return json.load(open(fp, encoding="utf-8"))
    last = None
    for attempt in range(6):
        try:
            raw = _get(OVERPASS[attempt % len(OVERPASS)], urllib.parse.urlencode({"data": query}).encode(), timeout=900)
            data = json.loads(raw)
            with open(fp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            print(f"[fetch] osm {label}: {len(data['elements'])} elements ({len(raw) >> 10} KB)", flush=True)
            return data
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            last = e
            time.sleep(15 * (attempt + 1))                   # Overpass asks clients to back off
    raise RuntimeError(f"Overpass failed for {label}: {last}")


def _tiles(bbox, n):
    w, s, e, nn = bbox
    dx, dy = (e - w) / n, (nn - s) / n
    for i in range(n):
        for j in range(n):
            yield i * n + j, (s + j * dy, w + i * dx, s + (j + 1) * dy, w + (i + 1) * dx)   # Overpass order: S,W,N,E


def osm():
    w, s, e, n = GVMC_BBOX
    bb = f"{s},{w},{n},{e}"
    out = {
        "mandals": _overpass(f'[out:json][timeout:300];rel["boundary"="administrative"]["admin_level"="6"]({bb});out geom;',
                             "mandals"),
        "places": _overpass(f'[out:json][timeout:200];node["place"~"^(suburb|neighbourhood|quarter|village|town|hamlet)$"]({bb});out;',
                            "places"),
        "utilities": _overpass(
            f'[out:json][timeout:300];(way["power"~"^(line|minor_line|cable)$"]({bb});'
            f'way["man_made"="pipeline"]({bb});way["waterway"~"^(drain|canal|ditch)$"]({bb}););out geom;', "utilities"),
        "roads": [],
    }
    for k, tb in _tiles(GVMC_BBOX, 3):                       # vehicular roads only, in 9 tiles
        out["roads"].append(_overpass(
            f'[out:json][timeout:600][maxsize:536870912];way["highway"~"{ROADS}"]({tb[0]},{tb[1]},{tb[2]},{tb[3]});out geom;',
            f"roads_{k}"))
    return out


# ── building footprints ──────────────────────────────────────────────────────
def _quadkey(lon, lat, z=9):
    import math
    n = 2 ** z
    tx = int((lon + 180) / 360 * n)
    s = math.sin(math.radians(lat))
    ty = int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)
    return "".join(str(((tx >> (i - 1)) & 1) + 2 * ((ty >> (i - 1)) & 1)) for i in range(z, 0, -1))


def _microsoft():
    w, s, e, n = GVMC_BBOX
    keys = {_quadkey(x, y) for x in (w, (w + e) / 2, e) for y in (s, (s + n) / 2, n)}
    index = _download(MS_INDEX, cache("microsoft", "dataset-links.csv"))
    import csv
    urls = [r["Url"] for r in csv.DictReader(open(index, encoding="utf-8")) if r["Location"] == "India" and r["QuadKey"] in keys]
    paths = []
    for u in urls:
        fp = cache("microsoft", u.rsplit("quadkey=", 1)[1].replace("/", "_"))
        t = time.time()
        _download(u, fp)
        print(f"[fetch] microsoft footprints {os.path.basename(fp)} ({os.path.getsize(fp) >> 20} MB, {time.time() - t:.0f}s)", flush=True)
        paths.append(fp)
    return paths


def _overture():
    fp = cache("overture", f"buildings_{OVERTURE_RELEASE}.parquet")
    if os.path.exists(fp):
        return [fp]
    import duckdb
    w, s, e, n = GVMC_BBOX
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';"
                "SET http_retries=8; SET http_retry_wait_ms=1000; SET threads=4;")
    con.execute(f"""
        COPY (
          SELECT sources[1].dataset AS dataset, ST_AsWKB(geometry) AS wkb
          FROM read_parquet('s3://overturemaps-us-west-2/release/{OVERTURE_RELEASE}/theme=buildings/type=building/*',
                            hive_partitioning=1)
          WHERE bbox.xmin > {w} AND bbox.xmax < {e} AND bbox.ymin > {s} AND bbox.ymax < {n}
        ) TO '{fp}.part' (FORMAT PARQUET)""")
    os.replace(fp + ".part", fp)
    return [fp]


def buildings():
    """Paths of the cached footprint files (Microsoft GeoJSONL .gz, or an Overture parquet)."""
    return _overture() if os.environ.get("NAKSHA_BUILDINGS") == "overture" else _microsoft()


def read_buildings(paths):
    """→ (list of shapely geometries WGS84, list of source names), clipped to the GVMC bbox."""
    from shapely.geometry import shape
    w, s, e, n = GVMC_BBOX
    geoms, srcs = [], []
    for fp in paths:
        if fp.endswith(".parquet"):
            import duckdb
            import shapely
            for wkb, ds in duckdb.connect().execute(f"SELECT wkb, dataset FROM '{fp}'").fetchall():
                geoms.append(shapely.from_wkb(bytes(wkb)))
                srcs.append(ds or "Overture")
            continue
        with gzip.open(fp, "rt", encoding="utf-8") as f:
            for line in f:
                ft = json.loads(line)
                c = ft["geometry"]["coordinates"][0][0]
                if w <= c[0] <= e and s <= c[1] <= n:
                    geoms.append(shape(ft["geometry"]))
                    srcs.append("Microsoft ML Buildings")
    return geoms, srcs


# ── terrain ──────────────────────────────────────────────────────────────────
def dem():
    """Copernicus GLO-30 read as a window over GVMC from the cloud-optimised GeoTIFF, at its first
    overview (~60 m): terrain for the synthetic DSM/DTM, a few MB instead of the whole tile."""
    fp = cache("dem", "copernicus_gvmc.tif")
    if os.path.exists(fp):
        return [fp]
    import rasterio
    from rasterio.windows import from_bounds
    url = f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{DEM_TILE}/{DEM_TILE}.tif"
    w, s, e, n = GVMC_BBOX
    t = time.time()
    with rasterio.Env(GDAL_HTTP_USERAGENT=UA, GDAL_HTTP_MAX_RETRY="5", GDAL_HTTP_RETRY_DELAY="5"):
        with rasterio.open(url, overview_level=0) as src:
            win = from_bounds(w - 0.02, s - 0.02, e + 0.02, n + 0.02, src.transform).round_offsets().round_lengths()
            data = src.read(1, window=win)
            prof = {**src.profile, "driver": "GTiff", "width": win.width, "height": win.height,
                    "transform": src.window_transform(win), "compress": "deflate", "tiled": False}
            prof.pop("blockxsize", None)
            prof.pop("blockysize", None)
    with rasterio.open(fp + ".part.tif", "w", **prof) as dst:
        dst.write(data, 1)
    os.replace(fp + ".part.tif", fp)
    print(f"[fetch] dem window {data.shape} in {time.time() - t:.0f}s", flush=True)
    return [fp]


def all_sources():
    dem()
    osm()
    buildings()
