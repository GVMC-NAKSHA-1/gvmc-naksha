"""Ward zones for GVMC.

No open dataset publishes GVMC ward boundaries (not OpenStreetMap, not datameet), so the pack
generates 98 zones and marks them synthetic:
  1. study area  = union of the GVMC mandals from OpenStreetMap
  2. urban area  = 100 m cells with ≥ 5 buildings / ha, morphologically closed and opened
  3. ward seeds  = k-means (k = 98) on building centroids, so zones hold similar numbers of
                   buildings — the way real wards are balanced by population
  4. ward shapes = Voronoi cells of the seeds clipped to the urban area
  5. names       = the most prominent real OSM locality inside each zone
Official boundaries replace these with `load --wards-file <official.geojson>`.
"""
import numpy as np
import shapely
from rasterio import features
from rasterio.transform import from_origin
from shapely.geometry import MultiPoint, Point, shape
from shapely.ops import linemerge, polygonize, unary_union

from .common import GVMC_MANDALS, WARD_COUNT, path, to_utm, to_wgs, write_geojson

PLACE_RANK = {"town": 0, "suburb": 1, "quarter": 2, "neighbourhood": 3, "village": 4, "hamlet": 5}


# ── inputs ───────────────────────────────────────────────────────────────────
def mandal_polygons(osm_mandals):
    """{name: polygon (WGS84)} from Overpass relations returned with `out geom`."""
    out = {}
    for rel in osm_mandals["elements"]:
        tags = rel.get("tags", {})
        name = tags.get("name:en") or tags.get("name")
        lines = [shapely.LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                 for m in rel.get("members", []) if m.get("type") == "way" and m.get("role", "outer") in ("outer", "")
                 and len(m.get("geometry", [])) >= 2]
        polys = list(polygonize(linemerge(unary_union(lines)))) if lines else []
        if polys:
            out[name] = shapely.make_valid(unary_union(polys))
    return out


def load_buildings(paths):
    """→ (geometries WGS84 ndarray, sources ndarray)."""
    from .fetch import read_buildings
    geoms, srcs = read_buildings(paths)
    return np.array(geoms, dtype=object), np.array(srcs, dtype=object)


# ── raster helpers (no scipy) ────────────────────────────────────────────────
def _shift_or(m, r):
    """OR of m shifted over a disc of radius r (padded, so nothing wraps around the edges)."""
    p = np.pad(m, r)
    out = p.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                out |= np.roll(np.roll(p, dy, 0), dx, 1)
    return out[r:-r, r:-r] if r else out


def dilate(m, r):
    return _shift_or(m, r)


def erode(m, r):
    return ~_shift_or(~m, r)


def urban_area(centroids_utm, region_utm, cell=100.0, min_per_cell=5, min_km2=0.25):
    """Built-up mask from building density → polygon (UTM)."""
    x0, y0, x1, y1 = region_utm.bounds
    nx, ny = int(np.ceil((x1 - x0) / cell)), int(np.ceil((y1 - y0) / cell))
    cx = np.clip(((centroids_utm[:, 0] - x0) / cell).astype(int), 0, nx - 1)
    cy = np.clip(((y1 - centroids_utm[:, 1]) / cell).astype(int), 0, ny - 1)
    counts = np.zeros((ny, nx), dtype=np.int32)
    np.add.at(counts, (cy, cx), 1)
    m = counts >= min_per_cell
    m = erode(dilate(m, 3), 3)                      # close: join dense patches across roads / parks
    m = dilate(erode(m, 1), 1)                      # open: drop isolated cells
    polys = [shape(g) for g, v in features.shapes(m.astype(np.uint8), mask=m, transform=from_origin(x0, y1, cell, cell)) if v]
    area = unary_union(polys).intersection(region_utm)
    parts = [p for p in getattr(area, "geoms", [area]) if p.area >= min_km2 * 1e6]
    return unary_union(parts).buffer(50).buffer(-50).simplify(20)


def kmeans(points, k, seed=7, iters=40):
    """Lloyd's k-means with k-means++ seeding (numpy only)."""
    r = np.random.default_rng(seed)
    n = len(points)
    centers = [points[r.integers(n)]]
    d2 = np.full(n, np.inf)
    for _ in range(1, k):
        d2 = np.minimum(d2, ((points - centers[-1]) ** 2).sum(1))
        centers.append(points[r.choice(n, p=d2 / d2.sum())])
    c = np.array(centers)
    for _ in range(iters):
        lab = np.empty(n, dtype=np.int32)
        for s in range(0, n, 50000):                 # chunked to bound memory
            blk = points[s:s + 50000]
            lab[s:s + 50000] = ((blk[:, None, :] - c[None, :, :]) ** 2).sum(2).argmin(1)
        new = np.array([points[lab == i].mean(0) if (lab == i).any() else c[i] for i in range(k)])
        if np.allclose(new, c, atol=1.0):
            break
        c = new
    return c, lab


def name_wards(wards_utm, places):
    """Most prominent OSM locality inside each ward (else the nearest); duplicates get a suffix."""
    pts = []
    for e in places["elements"]:
        t = e.get("tags", {})
        nm = t.get("name:en") or t.get("name")
        if nm and t.get("place") in PLACE_RANK:
            pts.append((to_utm(Point(e["lon"], e["lat"])), nm, PLACE_RANK[t["place"]]))
    names, seen = [], {}
    for w in wards_utm:
        c = w.representative_point()
        inside = [p for p in pts if w.contains(p[0])]
        pool = inside or pts
        best = min(pool, key=lambda p: (p[2] if inside else 0, p[0].distance(c)))[1] if pool else "Ward"
        seen[best] = seen.get(best, 0) + 1
        names.append(best if seen[best] == 1 else f"{best} {seen[best]}")
    return names


def build(osm, building_paths):
    mandals = mandal_polygons(osm["mandals"])
    missing = [m for m in GVMC_MANDALS if m not in mandals]
    region = unary_union([mandals[m] for m in GVMC_MANDALS if m in mandals])
    print(f"[wards] study area from {len(GVMC_MANDALS) - len(missing)} mandals (missing: {missing or 'none'})")
    region_utm = to_utm(region)

    geoms, _ = load_buildings(building_paths)
    cent = shapely.centroid(geoms)
    xy = np.column_stack([shapely.get_x(cent), shapely.get_y(cent)])
    shapely.prepare(region)
    inside = shapely.contains_xy(region, xy[:, 0], xy[:, 1])
    from pyproj import Transformer
    fwd = Transformer.from_crs("EPSG:4326", "EPSG:32644", always_xy=True)
    ux, uy = fwd.transform(xy[inside, 0], xy[inside, 1])
    pts = np.column_stack([ux, uy])
    urban = urban_area(pts, region_utm)
    shapely.prepare(urban)
    in_urban = shapely.contains_xy(urban, pts[:, 0], pts[:, 1])
    pts = pts[in_urban]
    print(f"[wards] {len(pts)} buildings in an urban area of {urban.area / 1e6:.0f} km²")

    centers, labels = kmeans(pts, WARD_COUNT)
    cells = shapely.voronoi_polygons(MultiPoint(centers), extend_to=urban.envelope.buffer(1000))
    by_center = []
    for c in centers:
        cell = next(g for g in cells.geoms if g.contains(Point(c)))
        by_center.append(cell.intersection(urban))
    order = sorted(range(WARD_COUNT), key=lambda i: (-round(centers[i][1], -3), centers[i][0]))   # north → south
    wards_utm = [shapely.make_valid(by_center[i]) for i in order]
    counts = [int((labels == i).sum()) for i in order]
    names = name_wards(wards_utm, osm["places"])

    feats = []
    for n, (w, nm, cnt) in enumerate(zip(wards_utm, names, counts), start=1):
        feats.append((to_wgs(w), {"id": str(n), "name": nm, "building_count": cnt, "area_km2": round(w.area / 1e6, 3),
                                  "synthetic": True,
                                  "method": "k-means zones of building centroids, clipped to the built-up area"}))
    write_geojson(path("wards.geojson"), feats)
    write_geojson(path("study_area.geojson"), [(to_wgs(urban), {"name": "GVMC built-up study area", "synthetic": True})])
    print(f"[wards] {len(feats)} wards → {path('wards.geojson')}")
    return feats
