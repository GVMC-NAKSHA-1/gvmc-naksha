"""Per-ward layers of the open-data pack. All geometry work is in UTM 44N metres.

Real inputs: Overture building footprints, OSM roads / utilities / localities, Copernicus terrain.
Everything else is generated to be consistent with them and flagged synthetic. The injected defects
and changes are written to answers.json so the platform's detection can be scored against them.
"""
import csv
import math
import os
import zipfile

import numpy as np
import rasterio
import shapefile
import shapely
from rasterio import features
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject
from shapely import affinity
from shapely.geometry import LineString, MultiPoint, Point, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from .common import DATASET, UTM, esri_wkt, initials_variant, path, person, rng, to_utm, to_wgs, write_geojson, write_json

ROAD_WIDTH = {"motorway": 24, "trunk": 20, "primary": 16, "secondary": 12, "tertiary": 9, "unclassified": 7,
              "residential": 7, "living_street": 5, "service": 5, "track": 4, "pedestrian": 4}
LAND_USE = (("residential", 0.70), ("commercial", 0.12), ("mixed_use", 0.09), ("industrial", 0.04), ("institutional", 0.05))
LAND_CLASS = ("Dry", "Wet", "Assessed Waste Dry", "Inam", "Government")
SQYD = 1.19599                                   # square metres → square yards
KALIANPUR_UTM44 = "EPSG:24344"                   # legacy Survey of India datum, used by some wards' cadastre
DATES = {"cadastral": "2019-06-01", "revenue": "2021-01-15", "revenue_scan": "2020-07-10", "building_footprint": "2023-03-15",
         "utility": "2022-08-01", "municipal_gis": "2024-04-01", "gnss_cors": "2024-10-10", "dsm_dtm": "2025-11-20",
         "ground_truth": "2025-12-05"}


# ── helpers ──────────────────────────────────────────────────────────────────
def _polys(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon" and not p.is_empty]


def _choice_weighted(r, table):
    names, w = zip(*table)
    return names[r.choice(len(names), p=np.array(w) / sum(w))]


def floors_for(area, r):
    if area > 1500:
        return int(r.integers(3, 9))
    if area > 400:
        return int(r.integers(2, 6))
    if area > 120:
        return int(r.integers(1, 4))
    return int(r.integers(1, 3))


# ── inputs clipped to one ward ───────────────────────────────────────────────
def ward_buildings(ward_utm, geoms_utm, sources, tree):
    """[(polygon, footprint source)] of buildings whose centroid lies in the ward."""
    out = []
    for i in tree.query(ward_utm, predicate="intersects"):
        g = geoms_utm[i]
        if g.area >= 12 and ward_utm.contains(g.centroid):
            poly = max(_polys(shapely.make_valid(g)), key=lambda q: q.area, default=None)
            if poly is not None:
                out.append((poly, sources[i] or "Overture"))
    return out


def ward_roads(ward_utm, roads):
    out = []
    for g, hw in roads:
        if g.intersects(ward_utm):
            out.append((g.intersection(ward_utm.buffer(30)), hw))
    return out


# ── 2023 survey footprints and the 2025 epoch ────────────────────────────────
def survey_2023(ward_id, blds, r):
    feats = []
    for n, (g, source) in enumerate(blds, start=1):
        fl = floors_for(g.area, r)
        feats.append({"geom": g, "id": f"W{ward_id}-B{n:05d}", "floors": fl, "source": source,
                      "height_m": round(fl * 3.1 + r.normal(0.3, 0.2), 1),
                      "use": _choice_weighted(r, LAND_USE)})
    return feats


def epoch_2025(ward_id, b2023, blocks, r):
    """Current buildings for the DSM, and the ground truth of what changed."""
    current, truth = [], []
    for b in b2023:
        u = r.random()
        if u < 0.02:
            truth.append({"change": "demolished", "bldg_id": b["id"]})
            continue
        g, h = b["geom"], b["height_m"]
        if u < 0.05:                                   # extension on one side
            minx, _, maxx, _ = g.bounds
            g = max(_polys(shapely.make_valid(unary_union([g, affinity.translate(g, xoff=(maxx - minx) * r.uniform(0.25, 0.45))]))),
                    key=lambda q: q.area)
            truth.append({"change": "extension", "bldg_id": b["id"]})
        elif u < 0.07:                                 # one or two floors added
            h = round(h + 3.1 * int(r.integers(1, 3)), 1)
            truth.append({"change": "vertical_extension", "bldg_id": b["id"]})
        current.append({"geom": g, "height_m": h})
    occupied = unary_union([b["geom"].buffer(3) for b in current]) if current else Polygon()
    want = max(1, int(0.03 * len(b2023)))
    tries = 0
    while want and tries < want * 60 and blocks:
        tries += 1
        blk = blocks[int(r.integers(len(blocks)))]
        minx, miny, maxx, maxy = blk.bounds
        p = Point(r.uniform(minx, maxx), r.uniform(miny, maxy))
        w, d = r.uniform(8, 18), r.uniform(8, 16)
        g = affinity.rotate(box(p.x - w / 2, p.y - d / 2, p.x + w / 2, p.y + d / 2), r.uniform(0, 90))
        if blk.contains(g) and not g.intersects(occupied):
            h = round(3.1 * int(r.integers(1, 4)) + 0.3, 1)
            current.append({"geom": g, "height_m": h})
            occupied = occupied.union(g.buffer(3))
            truth.append({"change": "new_structure", "centroid": [round(c, 2) for c in to_wgs(g.centroid).coords[0]]})
            want -= 1
    return current, truth


# ── cadastral fabric ─────────────────────────────────────────────────────────
def blocks_from_roads(ward_utm, roads):
    widths = [g.buffer(ROAD_WIDTH.get(hw, 4) / 2, cap_style="flat") for g, hw in roads if not g.is_empty]
    road_area = unary_union(widths) if widths else Polygon()
    return [b for b in _polys(ward_utm.difference(road_area)) if b.area >= 200]


def _vacant_plots(leftover, r, plot=500.0):
    """Split unclaimed land inside a block into ~500 m² plots; very large tracts stay whole."""
    out = []
    for piece in _polys(leftover):
        if piece.area < 150:
            continue
        if piece.area > 20000:
            out.append((piece, "open_space"))
            continue
        side = math.sqrt(plot)
        minx, miny, maxx, maxy = piece.bounds
        for x in np.arange(minx, maxx, side * 1.2):
            for y in np.arange(miny, maxy, side / 1.2):
                cell = box(x, y, x + side * 1.2, y + side / 1.2).intersection(piece)
                for c in _polys(cell):
                    if c.area >= 120:
                        out.append((c, "vacant"))
    return out


def parcels_for_blocks(blocks, b2023, r):
    """Voronoi split of each block around its buildings; oversized cells are trimmed to the
    building's plot, and the rest of the block becomes vacant plots."""
    tree = shapely.STRtree([b["geom"] for b in b2023]) if b2023 else None
    parcels = []
    for blk in blocks:
        idx = tree.query(blk, predicate="intersects") if tree else []
        members = [b2023[i] for i in idx if blk.contains(b2023[i]["geom"].centroid)]
        taken = []
        if members:
            pts = MultiPoint([m["geom"].centroid for m in members])
            cells = list(shapely.voronoi_polygons(pts, extend_to=blk).geoms) if len(members) > 1 else [blk]
            cell_tree = shapely.STRtree(cells)
            for m in members:
                hit = cell_tree.query(m["geom"].centroid, predicate="within")
                cell = (cells[hit[0]] if len(hit) else blk).intersection(blk)
                plot = m["geom"].minimum_rotated_rectangle.buffer(r.uniform(4, 9), join_style="mitre")
                if cell.area > max(1500.0, 4 * m["geom"].area):
                    cell = cell.intersection(plot)
                part = next((p for p in _polys(cell) if p.contains(m["geom"].centroid)), None) or max(_polys(cell), key=lambda p: p.area, default=None)
                if part is not None and part.area >= 40:
                    parcels.append({"geom": part, "clean": part, "building": m})
                    taken.append(part)
        leftover = blk.difference(unary_union(taken)) if taken else blk
        for g, use in _vacant_plots(leftover, r):
            parcels.append({"geom": g, "clean": g, "building": None, "use": use})
    return parcels


def inject_defects(parcels, r):
    """~3 % of parcels get the defects Topology QA must find; the truth goes to answers.json."""
    truth = []
    n = len(parcels)
    picks = r.permutation(n)
    k = max(1, n // 100)
    def pid(i):
        return parcels[i]["attrs"]["parcel_id"]

    def shrink(i, m, kind):
        g = max(_polys(parcels[i]["geom"].buffer(-m, join_style="mitre")), key=lambda q: q.area, default=None)
        if g is not None and g.area > 20:
            parcels[i]["geom"] = g
            truth.append({"defect": kind, "parcel_id": pid(i)})

    for i in picks[:k]:                                          # overlaps: parcel pushed 1.2 m outwards
        parcels[i]["geom"] = parcels[i]["geom"].buffer(1.2, join_style="mitre")
        truth.append({"defect": "overlap", "parcel_id": pid(i)})
    for i in picks[k:2 * k]:                                     # slivers: shrunk 0.35 m (strip < 0.5 m)
        shrink(i, 0.35, "sliver")
    for i in picks[2 * k:2 * k + k // 2 + 1]:                    # gaps: shrunk 0.7 m (0.5–1 m strip)
        shrink(i, 0.7, "gap")
    for i in picks[2 * k + k // 2 + 1:2 * k + k]:                # duplicate vertices
        g = parcels[i]["geom"]
        if g.geom_type == "Polygon":
            c = list(g.exterior.coords)
            c.insert(1, c[1])
            parcels[i]["geom"] = Polygon(c, [list(h.coords) for h in g.interiors])
            truth.append({"defect": "duplicate_vertex", "parcel_id": pid(i)})
    for i in picks[3 * k:3 * k + max(1, k // 5)]:                # bow-tie (self-intersection)
        g = parcels[i]["geom"]
        if g.geom_type == "Polygon" and len(g.exterior.coords) >= 5:
            c = list(g.exterior.coords)[:-1]
            c[0], c[1] = c[1], c[0]
            parcels[i]["geom"] = Polygon(c + [c[0]])
            truth.append({"defect": "self_intersection", "parcel_id": pid(i)})
    return truth


def cadastral_attributes(ward_id, parcels, r):
    block_no = 100
    for n, p in enumerate(parcels, start=1):
        if n % 12 == 1:
            block_no += 1
        b = p["building"]
        use = p.get("use") or (b and b["use"]) or "vacant"
        p["attrs"] = {"parcel_id": f"W{ward_id}-P{n:05d}", "survey_no": f"{block_no}/{(n - 1) % 12 + 1}",
                      "owner_name": "Government of Andhra Pradesh" if use == "open_space" else person(r),
                      "area_sqm": round(p["clean"].area * r.uniform(0.98, 1.02), 1), "land_use": use,
                      "registered_on": f"{int(r.integers(1985, 2019))}-{int(r.integers(1, 13)):02d}-{int(r.integers(1, 29)):02d}"}


# ── writers per layer ────────────────────────────────────────────────────────
def write_cadastral(d, ward_id, parcels, legacy):
    feats = [(p["geom"], p["attrs"]) for p in parcels]
    if legacy:                                                    # legacy Survey of India datum
        from pyproj import Transformer
        t = Transformer.from_crs(UTM, KALIANPUR_UTM44, always_xy=True).transform
        feats = [(shapely.ops.transform(t, g), a) for g, a in feats]
        return write_geojson(os.path.join(d, "cadastral.geojson"), feats, crs=KALIANPUR_UTM44, nd=2), KALIANPUR_UTM44
    return write_geojson(os.path.join(d, "cadastral.geojson"), [(to_wgs(g), a) for g, a in feats]), "EPSG:4326"


def write_municipal(d, ward_id, parcels, r):
    """Property-tax GIS as a zipped shapefile in UTM: re-digitised outlines, other field names."""
    base = os.path.join(d, "municipal_gis")
    rate = {"residential": 2.4, "commercial": 6.5, "mixed_use": 4.2, "industrial": 5.0, "institutional": 1.5}
    with shapefile.Writer(base, shapeType=shapefile.POLYGON) as w:
        for f, spec in (("assess_no", ("C", 24)), ("owner", ("C", 60)), ("survey_no", ("C", 12)), ("usage", ("C", 20)),
                        ("floors", ("N", 3, 0)), ("plinth_sy", ("N", 12, 1)), ("annual_tax", ("N", 12, 0))):
            w.field(f, *spec)
        n = 0
        for p in parcels:
            b = p["building"]
            if not b or r.random() > 0.92:                        # ~8 % of built parcels not yet assessed
                continue
            n += 1
            ang = r.uniform(0, 2 * math.pi)
            dist = r.uniform(0.5, 1.5)
            g = affinity.translate(p["clean"], dist * math.cos(ang), dist * math.sin(ang)).simplify(0.3)
            owner = p["attrs"]["owner_name"]
            u = r.random()
            owner = person(r) if u < 0.03 else initials_variant(owner, r) if u < 0.11 else owner
            survey = p["attrs"]["survey_no"] if r.random() > 0.03 else f"{int(r.integers(90, 400))}/{int(r.integers(1, 12))}"
            plinth = b["geom"].area * b["floors"]
            for poly in _polys(shapely.make_valid(g))[:1]:
                w.poly([list(orient(poly, sign=-1.0).exterior.coords)])     # shapefile outer rings are clockwise
                w.record(f"GVMC/{int(ward_id):03d}/{n:06d}", owner, survey, b["use"].replace("_", " ").title(),
                         b["floors"], round(plinth * SQYD, 1), round(plinth * rate.get(b["use"], 2.4)))
    with open(base + ".prj", "w") as f:
        f.write(esri_wkt(UTM))
    zp = base + ".zip"
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
        for ext in ("shp", "shx", "dbf", "prj"):
            z.write(f"{base}.{ext}", f"municipal_gis_ward{ward_id}.{ext}")
            os.remove(f"{base}.{ext}")
    return zp


def write_revenue(d, ward_id, parcels, r):
    """Webland-style revenue extract: one row per parcel, point at the parcel."""
    fp = os.path.join(d, "revenue.csv")
    with open(fp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["khata_no", "survey_no", "owner_name", "pattadar_father", "extent_sqyd", "land_class", "lon", "lat"])
        for p in parcels:
            if p["attrs"]["land_use"] == "open_space" or r.random() > 0.95:
                continue
            a = p["attrs"]
            owner = a["owner_name"] if r.random() > 0.05 else person(r)
            extent = p["clean"].area * SQYD * (r.uniform(0.7, 0.9) if r.random() < 0.05 else r.uniform(0.99, 1.01))
            survey = a["survey_no"] if r.random() > 0.02 else f"{int(r.integers(90, 400))}/{int(r.integers(1, 12))}"
            lon, lat = to_wgs(p["clean"].representative_point()).coords[0]
            w.writerow([f"{int(r.integers(1000, 99999))}/{'ABCD'[int(r.integers(4))]}", survey, owner,
                        f"S/o {person(r).split()[0]}", round(extent, 1),
                        "Government" if a["land_use"] == "institutional" else LAND_CLASS[int(r.integers(4))],
                        round(lon, 7), round(lat, 7)])
    return fp


def write_revenue_scan(d, ward_id, parcels, r):
    """One scanned revenue record (1-B / adangal extract) per ward, read back by the OCR stage."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
    p = next((p for p in parcels if p["attrs"]["land_use"] != "open_space"), parcels[0])
    a = p["attrs"]
    img = Image.new("L", (1240, 1000), 248)
    dr = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
    except OSError:
        try:
            font = ImageFont.load_default(size=32)       # Pillow ≥ 10.1 bundles a scalable font
        except TypeError:
            font = ImageFont.load_default()
    lines = ["GOVERNMENT OF ANDHRA PRADESH - REVENUE DEPARTMENT", f"1-B Record of Rights - GVMC Ward {ward_id}",
             f"Khata No: {int(r.integers(1000, 99999))}/{'ABCD'[int(r.integers(4))]}",
             f"Owner: {a['owner_name']}", f"Survey No: {a['survey_no']}", f"Extent: {round(p['clean'].area)} sq m",
             "Village: Visakhapatnam Urban"]
    for i, ln in enumerate(lines):
        dr.text((70, 70 + i * 115), ln, fill=int(r.integers(10, 40)), font=font)
    img = img.rotate(float(r.uniform(-1.2, 1.2)), fillcolor=248).filter(ImageFilter.GaussianBlur(0.6))
    noise = (np.asarray(img, dtype=np.int16) + r.normal(0, 6, (1000, 1240))).clip(0, 255).astype(np.uint8)
    fp = os.path.join(d, "revenue_scan.pdf")
    Image.fromarray(noise).convert("RGB").save(fp, resolution=150)
    return fp


def write_buildings(d, b2023, r):
    feats = [(to_wgs(b["geom"]), {"bldg_id": b["id"], "floors": b["floors"], "height_m": b["height_m"], "use": b["use"],
                                   "footprint_source": b["source"]}) for b in b2023]
    return write_geojson(os.path.join(d, "building_footprint.geojson"), feats)


def write_utilities(d, ward_id, ward_utm, utilities, roads, r):
    feats = []
    for g, tags in utilities:
        g2 = g.intersection(ward_utm)
        if g2.is_empty or g2.length < 5:
            continue
        kind = tags.get("power") and "power_line" or tags.get("man_made") and "pipeline" or tags.get("waterway", "drain")
        feats.append((to_wgs(g2), {"utility_type": kind, "operator": tags.get("operator"), "voltage": tags.get("voltage"),
                                   "osm_id": tags.get("_id"), "data_source": "OpenStreetMap", "synthetic": False}))
    mains = [g for g, hw in roads if hw in ("residential", "tertiary", "secondary", "unclassified") and not g.is_empty]
    for n, g in enumerate(mains[:600], start=1):                  # water mains along streets, 2 m off the centre line
        off = g.offset_curve(2.0) if g.geom_type == "LineString" else g
        off = off.intersection(ward_utm)
        if off.is_empty or off.length < 10:
            continue
        feats.append((to_wgs(off), {"utility_type": "water_main", "asset_id": f"WS-{ward_id}-{n:05d}",
                                    "dia_mm": int(r.choice([100, 150, 200, 250, 300])), "material": str(r.choice(["DI", "PVC", "HDPE", "CI"])),
                                    "laid_year": int(r.integers(1990, 2022)), "operator": "GVMC Water Supply",
                                    "data_source": "generated along OSM streets", "synthetic": True}))
    return write_geojson(os.path.join(d, "utility.geojson"), feats)


def write_ground_truth(d, ward_id, current, change_truth, r):
    import gpxpy.gpx
    gpx = gpxpy.gpx.GPX()
    sample = [c for c in current if r.random() < 0.02]
    for n, c in enumerate(sample, start=1):
        pt = to_wgs(c["geom"].centroid)
        lon, lat = pt.x + r.normal(0, 1.5e-5), pt.y + r.normal(0, 1.5e-5)       # ~1.5 m handheld GPS error
        floors = max(1, round((c["height_m"] - 0.3) / 3.1))
        status = str(r.choice(["occupied", "occupied", "occupied", "under_construction", "vacant"]))
        gpx.waypoints.append(gpxpy.gpx.GPXWaypoint(lat, lon, name=f"GT-W{ward_id}-{n:04d}",
                                                   description=f"floors={floors}; status={status}; photo=GT-W{ward_id}-{n:04d}.jpg"))
    fp = os.path.join(d, "ground_truth.gpx")
    with open(fp, "w", encoding="utf-8") as f:
        f.write(gpx.to_xml())
    return fp


def write_gnss(d, ward_id, blocks, dtm_at, r):
    """GNSS control points (RTK against a CORS base) at block corners, in UTM x/y."""
    fp = os.path.join(d, "gnss_cors.csv")
    with open(fp, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["point_id", "x", "y", "h_ellipsoid_m", "sigma_h_cm", "sigma_v_cm", "method", "base_station", "surveyed_on"])
        n = 0
        for blk in blocks[::3]:
            x, y = blk.exterior.coords[0]
            n += 1
            h = dtm_at(x, y) - 88.0                                           # EGM2008 undulation ≈ −88 m at Visakhapatnam
            w.writerow([f"CP-W{ward_id}-{n:04d}", round(x + r.normal(0, 0.015), 3), round(y + r.normal(0, 0.015), 3),
                        round(h + r.normal(0, 0.03), 3), round(float(r.uniform(0.8, 2.5)), 1), round(float(r.uniform(1.5, 4.5)), 1),
                        "RTK-CORS", "VSKP-CORS", DATES["gnss_cors"]])
    return fp


def write_dsm(d, ward_utm, current, dem_path, r):
    """2-band GeoTIFF (DSM, DTM) at ≤ 4000 px: Copernicus terrain + current buildings at height."""
    minx, miny, maxx, maxy = ward_utm.bounds
    res = max(0.5, math.ceil(max(maxx - minx, maxy - miny) / 4000 * 10) / 10)
    wpx, hpx = int(math.ceil((maxx - minx) / res)), int(math.ceil((maxy - miny) / res))
    transform = from_origin(minx, maxy, res, res)
    dtm = np.zeros((hpx, wpx), dtype=np.float32)
    with rasterio.open(dem_path) as src:
        reproject(rasterio.band(src, 1), dtm, dst_transform=transform, dst_crs=UTM, resampling=Resampling.cubic)
    dtm = np.round(dtm / 0.05) * 0.05
    heights = features.rasterize(((b["geom"], b["height_m"]) for b in current), out_shape=(hpx, wpx),
                                 transform=transform, fill=0, dtype="float32", merge_alg=rasterio.enums.MergeAlg.replace)
    dsm = (dtm + heights).astype(np.float32)
    fp = os.path.join(d, "dsm_dtm.tif")
    with rasterio.open(fp, "w", driver="GTiff", width=wpx, height=hpx, count=2, dtype="float32", crs=UTM, transform=transform,
                       compress="deflate", predictor=3, tiled=True, blockxsize=512, blockysize=512) as dst:
        dst.write(dsm, 1)
        dst.write(dtm, 2)
        dst.set_band_description(1, "DSM")
        dst.set_band_description(2, "DTM")

    def dtm_at(x, y):
        col, row = int((x - minx) / res), int((maxy - y) / res)
        return float(dtm[min(max(row, 0), hpx - 1), min(max(col, 0), wpx - 1)])
    return fp, res, dtm_at


# ── one ward ─────────────────────────────────────────────────────────────────
def build_ward(ward, ctx):
    ward_id = ward["id"]
    r = rng("ward", ward_id)
    d = path(f"ward-{ward_id}", "x")
    d = os.path.dirname(d)
    ward_utm = ward["utm"]
    blds = ward_buildings(ward_utm, ctx["bld_utm"], ctx["bld_src"], ctx["bld_tree"])
    roads = ward_roads(ward_utm, ctx["roads"])
    blocks = blocks_from_roads(ward_utm, roads)
    b2023 = survey_2023(ward_id, blds, r)
    parcels = parcels_for_blocks(blocks, b2023, r)
    cadastral_attributes(ward_id, parcels, r)
    defects = inject_defects(parcels, r)
    current, changes = epoch_2025(ward_id, b2023, blocks, r)

    legacy = int(ward_id) % 3 == 0
    cad_fp, cad_crs = write_cadastral(d, ward_id, parcels, legacy)
    dsm_fp, res, dtm_at = write_dsm(d, ward_utm, current, ctx["dem"], r)
    files = [
        {"path": "cadastral.geojson", "type": "cadastral", "crs": cad_crs, "captured_at": DATES["cadastral"], "synthetic": True,
         "description": "Cadastral parcels generated from OSM street blocks around real buildings"},
        {"path": os.path.basename(write_municipal(d, ward_id, parcels, r)), "type": "municipal_gis", "crs": UTM,
         "captured_at": DATES["municipal_gis"], "synthetic": True, "description": "Property-tax GIS (zipped shapefile, UTM 44N)"},
        {"path": os.path.basename(write_revenue(d, ward_id, parcels, r)), "type": "revenue", "crs": "EPSG:4326",
         "captured_at": DATES["revenue"], "synthetic": True, "description": "Webland-style revenue extract (CSV with lon/lat)"},
        {"path": os.path.basename(write_revenue_scan(d, ward_id, parcels, r)), "type": "revenue", "scanned": True,
         "captured_at": DATES["revenue_scan"], "synthetic": True, "description": "Scanned 1-B record (OCR)"},
        {"path": os.path.basename(write_buildings(d, b2023, r)), "type": "building_footprint", "crs": "EPSG:4326",
         "captured_at": DATES["building_footprint"], "synthetic": False,
         "description": "Overture building footprints (Google Open Buildings / Microsoft ML / OSM); floors and heights synthetic"},
        {"path": os.path.basename(dsm_fp), "type": "dsm_dtm", "crs": UTM, "captured_at": DATES["dsm_dtm"], "synthetic": True,
         "description": f"Synthetic 2025 DSM/DTM at {res} m: Copernicus GLO-30 terrain + current buildings"},
        {"path": os.path.basename(write_utilities(d, ward_id, ward_utm, ctx["utilities"], roads, r)), "type": "utility",
         "crs": "EPSG:4326", "captured_at": DATES["utility"], "synthetic": True,
         "description": "OSM power lines / pipelines / drains + water mains generated along streets"},
        {"path": os.path.basename(write_ground_truth(d, ward_id, current, changes, r)), "type": "ground_truth",
         "crs": "EPSG:4326", "captured_at": DATES["ground_truth"], "synthetic": True, "description": "Field observations (GPX)"},
        {"path": os.path.basename(write_gnss(d, ward_id, blocks, dtm_at, r)), "type": "gnss_cors", "crs": UTM,
         "captured_at": DATES["gnss_cors"], "synthetic": True, "description": "GNSS/CORS control points (CSV, UTM x/y)"},
    ]
    write_json(os.path.join(d, "manifest.json"), {"ward_id": ward_id, "ward_name": ward["name"], "dataset": DATASET, "files": files})
    write_json(os.path.join(d, "answers.json"), {"ward_id": ward_id, "topology_defects": defects, "changes": changes,
                                                  "counts": {"buildings_2023": len(b2023), "buildings_2025": len(current),
                                                             "parcels": len(parcels), "blocks": len(blocks)}})
    print(f"[build] ward {ward_id} {ward['name']}: {len(b2023)} buildings, {len(parcels)} parcels, "
          f"{len(defects)} defects, {len(changes)} changes, DSM {res} m")
    return {"ward_id": ward_id, "buildings": len(b2023), "parcels": len(parcels)}


# ── context shared by all wards ──────────────────────────────────────────────
def context(osm, building_paths, dem_paths):
    from .wards import load_buildings
    geoms, src = load_buildings(building_paths)
    from pyproj import Transformer
    fwd = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform
    bld_utm = shapely.transform(geoms, lambda xy: np.column_stack(fwd(xy[:, 0], xy[:, 1])))
    roads = []
    for chunk in osm["roads"]:
        for e in chunk["elements"]:
            if e.get("type") == "way" and len(e.get("geometry", [])) >= 2:
                hw = e.get("tags", {}).get("highway", "")
                if hw in ("footway", "path", "steps", "cycleway", "corridor", "bridleway", "proposed", "construction"):
                    continue
                roads.append((to_utm(LineString([(p["lon"], p["lat"]) for p in e["geometry"]])), hw))
    utilities = [(to_utm(LineString([(p["lon"], p["lat"]) for p in e["geometry"]])), {**e.get("tags", {}), "_id": e["id"]})
                 for e in osm["utilities"]["elements"] if e.get("type") == "way" and len(e.get("geometry", [])) >= 2]
    print(f"[build] context: {len(bld_utm)} buildings, {len(roads)} road ways, {len(utilities)} utility ways")
    return {"bld_utm": bld_utm, "bld_src": src, "bld_tree": shapely.STRtree(bld_utm), "roads": roads,
            "utilities": utilities, "dem": dem_paths[0]}


def wards_from_file(fp):
    from .common import read_json
    out = []
    for f in read_json(fp)["features"]:
        out.append({"id": str(f["properties"]["id"]), "name": f["properties"]["name"], "utm": to_utm(shape(f["geometry"]))})
    return out
