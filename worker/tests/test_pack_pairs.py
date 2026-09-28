"""pack_pairs on a hand-made two-parcel ward in the open-data-pack layout."""
import csv
import json
import os
import zipfile

import pytest

pytest.importorskip("shapefile")
pytest.importorskip("rasterio")
from pyproj import Transformer  # noqa: E402
from shapely.geometry import box, mapping  # noqa: E402
from shapely.ops import transform  # noqa: E402

from harmonize.pack_pairs import pack_pairs, ward_pairs  # noqa: E402

UTM = "EPSG:32644"
to_wgs = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True).transform
X0, Y0 = 780000.0, 1965000.0
P1, P2 = box(X0, Y0, X0 + 15, Y0 + 20), box(X0 + 15, Y0, X0 + 30, Y0 + 20)      # adjacent parcels


def _geojson(path, feats):
    with open(path, "w") as f:
        json.dump({"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": mapping(transform(to_wgs, g)), "properties": p} for g, p in feats]}, f)


def _municipal_zip(d, feats):
    import shapefile
    from shapely.geometry.polygon import orient
    base = os.path.join(d, "municipal_gis")
    with shapefile.Writer(base, shapeType=shapefile.POLYGON) as w:
        w.field("assess_no", "C", 24)
        w.field("owner", "C", 60)
        w.field("survey_no", "C", 12)
        for g, (assess, owner, survey) in feats:
            w.poly([list(orient(g, sign=-1.0).exterior.coords)])
            w.record(assess, owner, survey)
    with open(base + ".prj", "w") as f:
        f.write('PROJCS["WGS 84 / UTM zone 44N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
                'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
                'PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",81],PARAMETER["scale_factor",0.9996],'
                'PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]')
    with zipfile.ZipFile(base + ".zip", "w") as z:
        for ext in ("shp", "shx", "dbf", "prj"):
            z.write(f"{base}.{ext}", f"municipal_gis.{ext}")
    return "municipal_gis.zip"


@pytest.fixture
def ward(tmp_path):
    d = tmp_path / "ward-7"
    d.mkdir()
    _geojson(d / "cadastral.geojson", [(P1, {"parcel_id": "W7-P00001", "owner_name": "Ravi Kumar", "survey_no": "101/1"}),
                                       (P2, {"parcel_id": "W7-P00002", "owner_name": "Lakshmi Varma", "survey_no": "101/2"})])
    _geojson(d / "building_footprint.geojson", [(P1.buffer(-2), {"bldg_id": "W7-B00001"}),
                                                (P2.buffer(-2), {"bldg_id": "W7-B00002"})])
    muni = _municipal_zip(str(d), [(P1, ("GVMC/007/000001", "R. Kumar", "101/1"))])
    with open(d / "revenue.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["khata_no", "survey_no", "owner_name", "lon", "lat"])
        for g, survey, owner in ((P1, "101/1", "Ravi Kumar"), (P2, "101/2", "Lakshmi Varma")):
            lon, lat = transform(to_wgs, g.representative_point()).coords[0]
            w.writerow(["123/A", survey, owner, lon, lat])
    files = [{"path": "cadastral.geojson", "type": "cadastral", "crs": "EPSG:4326", "captured_at": "2019-06-01"},
             {"path": muni, "type": "municipal_gis", "crs": UTM, "captured_at": "2024-04-01"},
             {"path": "revenue.csv", "type": "revenue", "crs": "EPSG:4326", "captured_at": "2021-01-15"},
             {"path": "building_footprint.geojson", "type": "building_footprint", "crs": "EPSG:4326",
              "captured_at": "2023-03-15"}]
    json.dump({"ward_id": "7", "files": files}, open(d / "manifest.json", "w"))
    json.dump({"ward_id": "7", "match_truth": {
        "municipal": {"GVMC/007/000001": "W7-P00001"}, "revenue_rows": ["W7-P00001", "W7-P00002"],
        "buildings": {"W7-B00001": "W7-P00001", "W7-B00002": "W7-P00002"}, "ground_truth": {}}},
        open(d / "answers.json", "w"))
    return d


def test_labels_follow_the_answer_key(ward):
    pairs, ward_id = ward_pairs(str(ward))
    assert ward_id == "7"
    by_types = {}
    for p in pairs:
        by_types.setdefault(tuple(sorted((p["a_type"], p["b_type"]))), []).append(p)
    # the municipal outline of parcel 1 matches cadastral parcel 1 only (IoU with parcel 2 is 0)
    muni_cad = by_types[("cadastral", "municipal_gis")]
    assert [p["label"] for p in muni_cad] == [True]
    # each revenue point is within 25 m of both parcels: one true and one false pair per point
    rev_cad = by_types[("cadastral", "revenue")]
    assert sorted(p["label"] for p in rev_cad) == [False, False, True, True]
    assert all(p["dist_m"] is not None and p["iou"] is None for p in rev_cad)
    # properties are what ingest stores: CSV lon/lat columns dropped
    assert all("lon" not in (p["a_props"] | p["b_props"]) for p in rev_cad)


def test_pack_groups_by_ward_and_skips_wards_without_answer_key(ward, tmp_path):
    old = tmp_path / "ward-8"
    old.mkdir()
    json.dump({"ward_id": "8", "files": []}, open(old / "manifest.json", "w"))
    json.dump({"ward_id": "8", "changes": []}, open(old / "answers.json", "w"))    # built before match_truth
    pairs, rename, groups = pack_pairs(str(tmp_path))
    assert pairs and set(groups) == {"ward-7"}
    assert rename[("cadastral", "municipal_gis")] == {"owner": "owner_name"}
