import csv
import json
import os
import tempfile
import zipfile
import rasterio, shapefile, gpxpy
from shapely.geometry import shape, mapping, box, Point
from db import cursor, get_data_source, insert_source_features, set_status, update_source_metadata
from r2 import download, upload
from queue_client import enqueue
from spatial.geo_transform import reproject_to_wgs84, detect_crs
from spatial.topology import validate_and_fix

RASTER_EXT = (".tif", ".tiff", ".png", ".jpg", ".jpeg", ".pdf")
IMAGERY = ("drone_imagery", "ori", "dsm_dtm")
POLYGON_TYPES = ("cadastral", "municipal_gis", "building_footprint")
LON_COLS = ("lon", "lng", "longitude", "x")
LAT_COLS = ("lat", "latitude", "y")


def geotiff_adapter(path):
    with rasterio.open(path) as ds:
        b = ds.bounds
        yield {"geometry": box(b.left, b.bottom, b.right, b.top),
               "properties": {"bands": ds.count, "res": ds.res, "dtype": ds.dtypes[0]}}, str(ds.crs)

def _shapefile_records(shp_path):
    """Records of a shapefile; the CRS comes from its .prj (WKT) when present."""
    prj = os.path.splitext(shp_path)[0] + ".prj"
    crs = open(prj).read().strip() if os.path.exists(prj) else None
    with shapefile.Reader(shp_path) as r:              # closed before a zip's temp dir is removed
        names = [f[0] for f in r.fields[1:]]
        for sr in r.iterShapeRecords():
            yield {"geometry": shape(sr.shape.__geo_interface__), "properties": dict(zip(names, sr.record))}, crs

def _zipped_shapefile(path):
    """Department data usually arrives as a zipped shapefile (.shp + .dbf + .shx + .prj)."""
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        shps = sorted(os.path.join(d, f) for d, _, fs in os.walk(tmp) for f in fs if f.lower().endswith(".shp"))
        if not shps:
            raise ValueError("zip contains no .shp file")
        if len(shps) > 1:
            raise ValueError(f"zip contains {len(shps)} shapefiles; upload one layer per file")
        yield from _shapefile_records(shps[0])

def vector_adapter(path):
    p = path.lower()
    if p.endswith(".zip"):
        yield from _zipped_shapefile(path)
    elif p.endswith(".shp"):
        yield from _shapefile_records(path)
    else:                                           # GeoJSON
        gj = json.load(open(path))
        for feat in gj.get("features", [gj]):
            yield {"geometry": shape(feat["geometry"]), "properties": feat.get("properties", {})}, \
                  (gj.get("crs", {}).get("properties", {}).get("name"))

def _coord_columns(fieldnames):
    lower = {f.lower().strip(): f for f in fieldnames or []}
    lon = next((lower[c] for c in LON_COLS if c in lower), None)
    lat = next((lower[c] for c in LAT_COLS if c in lower), None)
    if not (lon and lat):
        raise ValueError(f"CSV needs coordinate columns (lon/lng/longitude/x and lat/latitude/y); found {fieldnames}")
    return lon, lat

def point_adapter(path):
    if path.lower().endswith(".gpx"):
        g = gpxpy.parse(open(path))
        for wpt in g.waypoints:
            yield {"geometry": Point(wpt.longitude, wpt.latitude),
                   "properties": {"name": wpt.name, "ele": wpt.elevation, "description": wpt.description,
                                  "time": wpt.time.isoformat() if wpt.time else None}}, "EPSG:4326"
    else:                                           # CSV: coordinate columns + attributes
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = csv.DictReader(f)
            lon, lat = _coord_columns(rows.fieldnames)
            for row in rows:
                try:
                    pt = Point(float(row[lon]), float(row[lat]))
                except (TypeError, ValueError):
                    continue                        # rows without usable coordinates are skipped
                # WGS84 unless the upload declared another CRS (e.g. UTM x/y), which takes precedence.
                yield {"geometry": pt, "properties": {k: v for k, v in row.items() if k not in (lon, lat)}}, "EPSG:4326"

ADAPTERS = {
    "drone_imagery": geotiff_adapter, "ori": geotiff_adapter, "dsm_dtm": geotiff_adapter,
    "cadastral": vector_adapter, "revenue": point_adapter, "municipal_gis": vector_adapter,
    "utility": vector_adapter, "building_footprint": vector_adapter, "ai_extracted": vector_adapter,
    "ground_truth": point_adapter, "gnss_cors": point_adapter,
}


def pick_adapter(path, source_type):
    """The file's format decides first (a revenue GeoJSON or a cadastral CSV both work); the source
    type is only the fallback for unknown extensions."""
    p = path.lower()
    if p.endswith(RASTER_EXT):
        return geotiff_adapter
    if p.endswith((".csv", ".gpx")):
        return point_adapter
    if p.endswith((".geojson", ".json", ".zip", ".shp")):
        return vector_adapter
    return ADAPTERS[source_type]


def _raster_crs(path):
    if path.lower().endswith((".tif", ".tiff")):
        try:
            with rasterio.open(path) as ds:
                return str(ds.crs) if ds.crs else None
        except Exception:  # noqa: BLE001
            return None
    return None                                     # PNG / JPG / PDF scans carry no CRS


def _await_georeferencing(src, path):
    """Scans / rasters with no CRS: publish a preview so an officer can place ground control points."""
    from georef.gcp import make_preview
    preview_path, meta = make_preview(path)
    key = f"previews/{src['id']}.png"
    upload(preview_path, key, "image/png")
    update_source_metadata(src["id"], {"preview_key": key, **meta})
    set_status(src["id"], "needs_georef")
    print(f"[normalize] {src['id']} has no CRS -> needs_georef (preview {meta['preview_width']}x{meta['preview_height']})")
    return {"status": "needs_georef"}


def _chain(src):
    """ETL automation: every processed source triggers the next pipeline stage."""
    ward = src["ward_id"]
    if src["type"] in IMAGERY:
        with cursor() as cur:
            cur.execute("""INSERT INTO extraction_runs (ward_id, source_id, method) VALUES (%s, %s, 'auto')
                           RETURNING id""", (ward, src["id"]))
            run_id = str(cur.fetchone()["id"])
        enqueue("EXTRACT_FEATURES", runId=run_id, sourceId=str(src["id"]), wardId=ward)
    elif src["type"] in POLYGON_TYPES:
        enqueue("FIX_TOPOLOGY", sourceId=str(src["id"]), wardId=ward, autoFix=False)
    if ward and src["type"] not in IMAGERY:
        enqueue("HARMONIZE_WARD", wardId=ward)


def normalize_source(job):
    src = get_data_source(job["sourceId"])
    key = job.get("r2Key") or src["r2_key"]
    path = download(key)
    try:
        is_raster = path.lower().endswith(RASTER_EXT)
        if is_raster and not (src["crs"] or _raster_crs(path)):
            return _await_georeferencing(src, path)
        adapter = pick_adapter(path, src["type"])
        count = 0
        repaired = 0
        field_names = set()
        rows = []
        file_crs = None
        for rec, embedded_crs in adapter(path):
            crs = src["crs"] or embedded_crs or file_crs or (file_crs := detect_crs(path))
            if not crs:
                raise ValueError("no CRS: declare one on upload")   # .shp without .prj
            geom = reproject_to_wgs84(rec["geometry"], crs)          # coordinate transformation
            if geom.is_empty:
                continue
            geom, was_invalid = validate_and_fix(geom)               # single-geometry repair
            repaired += int(was_invalid)
            props = rec["properties"] or {}
            field_names.update(props.keys())
            rows.append((mapping(geom), props, was_invalid))
            count += 1
        if not count:
            raise ValueError("the file contains no features with geometry")
        # One transaction for the whole file: a failed attempt leaves nothing behind for the retry.
        insert_source_features(src["id"], rows)
        # Attribute mapping needs the schema of structured sources — record it.
        update_source_metadata(src["id"], {"fields": sorted(field_names), "feature_count": count,
                                           "repaired_geometries": repaired,
                                           "source_crs": src["crs"] or "embedded"})
        set_status(src["id"], "ready")
        print(f"[normalize] {src['id']} -> {count} features, {len(field_names)} fields, {repaired} repaired")
        _chain(src)
        return {"features": count, "fields": len(field_names), "repaired": repaired}
    except Exception as e:                                           # noqa: BLE001
        set_status(src["id"], "failed", str(e)); raise
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
