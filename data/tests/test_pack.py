import numpy as np
import pytest
from shapely.geometry import Polygon, box

from naksha_data import build, fetch, load, wards
from naksha_data.common import initials_variant, rng


def test_quadkey_for_visakhapatnam():
    # The single Microsoft footprint tile that covers the whole GVMC bbox.
    for lon, lat in ((83.00, 17.55), (83.23, 17.75), (83.47, 17.95)):
        assert fetch._quadkey(lon, lat) == "123310330"


def test_dilate_erode_do_not_wrap_around_edges():
    m = np.zeros((5, 5), dtype=bool)
    m[2, 4] = True                                            # east edge
    d = wards.dilate(m, 1)
    assert d[2, 3] and not d[2, 0]                            # grows inwards, never onto the west edge
    assert wards.erode(d, 1).sum() <= d.sum()


def test_kmeans_finds_separated_clusters():
    r = np.random.default_rng(1)
    pts = np.vstack([r.normal(c, 5, (200, 2)) for c in ((0, 0), (1000, 0), (0, 1000))])
    centers, labels = wards.kmeans(pts, 3)
    assert sorted(np.bincount(labels)) == [200, 200, 200]
    assert min(np.linalg.norm(centers - (1000, 0), axis=1)) < 10


def _block_with_buildings():
    blk = box(0, 0, 100, 40)
    blds = [{"geom": box(x + 3, 5, x + 15, 20), "use": "residential", "floors": 2, "height_m": 6.5, "id": f"B{i}"}
            for i, x in enumerate((0, 25, 50))]
    return blk, blds


def test_parcels_cover_each_building_and_fill_the_rest():
    blk, blds = _block_with_buildings()
    parcels = build.parcels_for_blocks([blk], blds, rng("t"))
    built = [p for p in parcels if p["building"]]
    assert len(built) == 3
    for p in built:
        assert p["geom"].contains(p["building"]["geom"].centroid)
    assert any(p["building"] is None for p in parcels)        # the empty east end becomes vacant plots
    total = sum(p["geom"].area for p in parcels)
    assert total <= blk.area + 1e-6 and total > 0.8 * blk.area


def test_defects_are_recorded_by_parcel_id():
    grid = [box(x, y, x + 20, y + 20) for x in range(0, 400, 20) for y in range(0, 200, 20)]   # 200 parcels
    parcels = [{"geom": g, "clean": g, "building": None, "attrs": {"parcel_id": f"P{i}"}} for i, g in enumerate(grid)]
    truth = build.inject_defects(parcels, rng("defects"))
    kinds = {t["defect"] for t in truth}
    assert {"overlap", "sliver", "gap"} <= kinds
    assert all(t["parcel_id"].startswith("P") for t in truth)
    assert 0.02 <= len(truth) / len(parcels) <= 0.05          # ~3 %
    changed = {t["parcel_id"] for t in truth}
    assert all(p["clean"].equals(grid[i]) for i, p in enumerate(parcels))           # clean copies untouched
    assert sum(not p["geom"].equals(p["clean"]) for p in parcels) == len(changed)


def test_bow_tie_is_invalid_until_repaired():
    parcels = [{"geom": box(i * 10, 0, i * 10 + 10, 10), "clean": None, "building": None,
                "attrs": {"parcel_id": f"P{i}"}} for i in range(100)]
    truth = build.inject_defects(parcels, rng("bowtie"))
    bow = [t["parcel_id"] for t in truth if t["defect"] == "self_intersection"]
    assert bow and not next(p["geom"] for p in parcels if p["attrs"]["parcel_id"] == bow[0]).is_valid


def test_initials_variant_keeps_the_given_name():
    v = initials_variant("Venkata Ramana Pilla", rng("x"))
    assert "Venkata Ramana" in v and "P." in v


def test_storage_target_keeps_signed_host(monkeypatch):
    monkeypatch.setenv("R2_PUBLIC_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("STORAGE_INTERNAL_ENDPOINT", "http://minio:9000")
    url, headers = load._storage_target("http://localhost:9000/gvmc-data/sources/x.tif?X-Amz-Signature=abc")
    assert url == "http://minio:9000/gvmc-data/sources/x.tif?X-Amz-Signature=abc"
    assert headers == {"Host": "localhost:9000"}
    assert load._storage_target("https://acct.r2.cloudflarestorage.com/b/k")[1] == {}


@pytest.mark.parametrize("area,lo,hi", [(50, 1, 2), (300, 1, 3), (900, 2, 5), (3000, 3, 8)])
def test_floors_scale_with_footprint(area, lo, hi):
    f = build.floors_for(area, rng("floors", area))
    assert lo <= f <= hi


def test_polys_drops_non_polygons():
    from shapely.geometry import GeometryCollection, LineString
    g = GeometryCollection([Polygon([(0, 0), (1, 0), (1, 1)]), LineString([(0, 0), (2, 2)])])
    assert len(build._polys(g)) == 1
