import numpy as np
import pytest
from shapely.geometry import Polygon, box

from naksha_data import build, fetch, load, villages, wards
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


# The India LCC of the Survey of India village shapefile.
SOI_PRJ = ('PROJCS["LCC_WGS84",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
           'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],'
           'PARAMETER["False_Easting",4000000.0],PARAMETER["False_Northing",4000000.0],PARAMETER["Central_Meridian",80.0],'
           'PARAMETER["Standard_Parallel_1",12.472944],PARAMETER["Standard_Parallel_2",35.172806],'
           'PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",24.0],UNIT["Meter",1.0]]')


def _soi_zip(tmp_path):
    """Three villages: two GVMC parts that share an edge (in two mandals) and one outside the districts."""
    import io
    import zipfile

    import shapefile
    from pyproj import Transformer
    to_lcc = Transformer.from_crs("EPSG:4326", SOI_PRJ, always_xy=True).transform
    rows = [((83.20, 17.70, 83.25, 17.75), "Visakhapatnam", "Gajuwaka", "05001", "GVMC (M Corp. + OG) (Part)", "802947"),
            ((83.25, 17.70, 83.30, 17.75), "Anakapalli", "Paravada", "05002", "GVMC (M Corp. + OG) (Part)", "802947"),
            ((80.60, 16.50, 80.65, 16.55), "Guntur", "Mangalagiri", "05003", "Nidamarru", "590001")]
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON, encoding="utf-8")
    w.field("OBJECTID", "N", 10)
    for f in ("STATE_LGD", "District", "Dist_LGD", "Sub_dist", "Subdis_LGD", "Subdis_Typ", "Vill_name", "Vill_Cat", "Vill_LGD"):
        w.field(f, "C", 50)
    for oid, ((x0, y0, x1, y1), dist, mandal, mlgd, name, vlgd) in enumerate(rows, start=1):
        ring = [to_lcc(x, y) for x, y in ((x0, y0), (x0, y1), (x1, y1), (x1, y0), (x0, y0))]   # clockwise = outer
        w.poly([ring])
        w.record(oid, "28", dist, "743", mandal, mlgd, "MANDAL", name, "URBAN", vlgd)
    w.close()
    fp = tmp_path / "ANDHRA_PRADESH.zip"
    with zipfile.ZipFile(fp, "w") as z:
        for ext, buf in ((".shp", shp), (".shx", shx), (".dbf", dbf)):
            z.writestr("ANDHRA_PRADESH" + ext, buf.getvalue())
        z.writestr("ANDHRA_PRADESH.prj", SOI_PRJ)
    return fp


def _soi_dir(tmp_path):
    import zipfile
    folder = tmp_path / "ANDHRA_PRADESH"
    zipfile.ZipFile(_soi_zip(tmp_path)).extractall(folder)
    return folder


@pytest.mark.parametrize("layout", [_soi_zip, _soi_dir])
def test_soi_villages_are_filtered_and_reprojected(tmp_path, layout):
    src = str(layout(tmp_path))
    assert villages.available(src)
    rows = villages.read(src)
    assert [p["mandal"] for _, p in rows] == ["Gajuwaka", "Paravada"]            # Guntur is outside the districts
    assert rows[0][1]["vill_lgd"] == "802947" and rows[0][1]["mandal_lgd"] == "05001"
    assert [p["objectid"] for _, p in rows] == ["1", "2"]                         # unique key: LGD codes repeat
    x0, y0, x1, y1 = rows[0][0].bounds
    assert abs(x0 - 83.20) < 1e-6 and abs(y1 - 17.75) < 1e-6                    # back in lon/lat


def test_gvmc_outline_dissolves_the_parts(tmp_path):
    outline = villages.gvmc_outline(villages.read(_soi_zip(tmp_path)))
    assert outline.geom_type == "Polygon"
    assert outline.equals_exact(box(83.20, 17.70, 83.30, 17.75), 1e-5) or abs(outline.area - 0.005) < 1e-6


def test_lfs_pointer_is_not_treated_as_data(tmp_path):
    folder = tmp_path / "ANDHRA_PRADESH"
    folder.mkdir()
    (folder / "ANDHRA_PRADESH.shp").write_bytes(b"version https://git-lfs.github.com/spec/v1\noid sha256:ab\nsize 65695648\n")
    assert not villages.available(str(folder))
    assert not villages.available(str(tmp_path / "missing.zip"))
