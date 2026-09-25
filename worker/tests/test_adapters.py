import os
import zipfile

import pytest
import shapefile

from ingest.adapters import geotiff_adapter, pick_adapter, point_adapter, vector_adapter

UTM44_PRJ = ('PROJCS["WGS 84 / UTM zone 44N",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
             'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],'
             'PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",81],PARAMETER["scale_factor",0.9996],'
             'PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1]]')


def test_format_decides_before_source_type():
    assert pick_adapter("/tmp/x_revenue.csv", "revenue") is point_adapter      # was vector_adapter → json.load crash
    assert pick_adapter("/tmp/x.geojson", "revenue") is vector_adapter
    assert pick_adapter("/tmp/x.csv", "cadastral") is point_adapter
    assert pick_adapter("/tmp/x.zip", "municipal_gis") is vector_adapter
    assert pick_adapter("/tmp/x.gpx", "ground_truth") is point_adapter
    assert pick_adapter("/tmp/x.tif", "cadastral") is geotiff_adapter
    assert pick_adapter("/tmp/x.bin", "utility") is vector_adapter             # unknown extension → type default


@pytest.mark.parametrize("header", ["lon,lat", "Longitude,Latitude", "lng,lat", "X,Y"])
def test_csv_coordinate_columns(tmp_path, header):
    p = tmp_path / "revenue.csv"
    p.write_text(f"khata_no,{header},owner_name\n4521/B,83.21,17.69,Venkatesh Rao\nbad,,,skipped\n", encoding="utf-8")
    rows = list(point_adapter(str(p)))
    assert len(rows) == 1                                                       # blank coordinates are skipped
    rec, crs = rows[0]
    assert (rec["geometry"].x, rec["geometry"].y) == (83.21, 17.69)
    assert rec["properties"] == {"khata_no": "4521/B", "owner_name": "Venkatesh Rao"}
    assert crs == "EPSG:4326"


def test_csv_without_coordinates_explains(tmp_path):
    p = tmp_path / "revenue.csv"
    p.write_text("khata_no,owner_name\n1,A\n", encoding="utf-8")
    with pytest.raises(ValueError, match="coordinate columns"):
        list(point_adapter(str(p)))


def test_csv_with_excel_bom(tmp_path):
    p = tmp_path / "gnss.csv"
    p.write_bytes("﻿lon,lat,point_id\n83.2,17.7,CP1\n".encode("utf-8"))
    assert list(point_adapter(str(p)))[0][0]["properties"] == {"point_id": "CP1"}


def _zipped_parcels(tmp_path, prj=UTM44_PRJ, name="parcels"):
    base = tmp_path / name
    with shapefile.Writer(str(base), shapeType=shapefile.POLYGON) as w:
        w.field("parcel_id", "C")
        w.field("area_sqm", "N", decimal=2)
        w.poly([[(740000, 1958000), (740020, 1958000), (740020, 1958030), (740000, 1958030), (740000, 1958000)]])
        w.record("W4-001", 600.0)
    if prj:
        (tmp_path / f"{name}.prj").write_text(prj)
    zp = tmp_path / f"{name}.zip"
    with zipfile.ZipFile(zp, "w") as z:
        for ext in ("shp", "shx", "dbf", "prj"):
            f = tmp_path / f"{name}.{ext}"
            if f.exists():
                z.write(f, f"layer/{name}.{ext}")                               # nested folder, as zips often are
    return str(zp)


def test_zipped_shapefile_with_prj(tmp_path):
    rows = list(vector_adapter(_zipped_parcels(tmp_path)))
    assert len(rows) == 1
    rec, crs = rows[0]
    assert rec["properties"]["parcel_id"] == "W4-001"
    assert rec["geometry"].area == pytest.approx(600.0)
    assert "UTM zone 44N" in crs                                                # CRS travels with the .prj


def test_zipped_shapefile_without_prj_has_no_crs(tmp_path):
    rec, crs = next(vector_adapter(_zipped_parcels(tmp_path, prj=None)))
    assert crs is None                                                          # normalize_source then asks for a declared CRS


def test_zip_without_shapefile(tmp_path):
    zp = tmp_path / "docs.zip"
    with zipfile.ZipFile(zp, "w") as z:
        z.writestr("readme.txt", "no layer here")
    with pytest.raises(ValueError, match="no .shp"):
        list(vector_adapter(str(zp)))
