"""Shared paths, projections and writers for the open-data pack."""
import json
import os
import zlib

import numpy as np
from pyproj import CRS, Transformer
from shapely import ops
from shapely.geometry import mapping

OUT = os.environ.get("DATA_OUT", "/data/out")
CACHE = os.environ.get("DATA_CACHE", "/data/cache")

# Study area: the Greater Visakhapatnam Municipal Corporation, from Bheemunipatnam in the north-east
# to Anakapalli in the south-west (lon/lat).
GVMC_BBOX = (83.00, 17.55, 83.47, 17.95)
# GVMC spans these OpenStreetMap mandals (admin_level 6). Their union bounds the study area; the
# built-up mask then drops the rural hinterland.
GVMC_MANDALS = ("Visakhapatnam Urban", "Visakhapatnam Rural", "Gajuwaka", "Pedagantyada", "Pendurthi",
                "Bheemunipatnam", "Anakapalle", "Paravada", "Sabbavaram", "Anandapuram")
WARD_COUNT = 98                     # GVMC wards after the 2021 delimitation
UTM = "EPSG:32644"                  # WGS 84 / UTM 44N: metric working CRS for Visakhapatnam
DATASET = "naksha-open-pack-v1"

_fwd = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform
_inv = Transformer.from_crs(UTM, "EPSG:4326", always_xy=True).transform


def to_utm(g):
    return ops.transform(_fwd, g)


def to_wgs(g):
    return ops.transform(_inv, g)


def path(*parts):
    p = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def cache(*parts):
    p = os.path.join(CACHE, *parts)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def rng(*key):
    """Deterministic generator per (step, ward, …): rebuilding gives identical files."""
    return np.random.default_rng(zlib.crc32("|".join(map(str, key)).encode()))


def _round(g, nd):
    return json.loads(json.dumps(mapping(g)), parse_float=lambda s: round(float(s), nd))


def write_geojson(fp, features, crs=None, nd=7):
    """features: [(shapely geometry, properties)]. crs: EPSG code to declare in a legacy `crs`
    member (GeoJSON 2008) when the coordinates are not WGS84."""
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "geometry": _round(g, nd), "properties": p} for g, p in features]}
    if crs:
        fc["crs"] = {"type": "name", "properties": {"name": crs}}
    with open(fp, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    return fp


def esri_wkt(epsg):
    return CRS.from_user_input(epsg).to_wkt("WKT1_ESRI")


def read_json(fp):
    with open(fp, encoding="utf-8") as f:
        return json.load(f)


def write_json(fp, obj):
    with open(fp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, default=str)
    return fp


# ── synthetic people (common Telugu given names and family names) ────────────
GIVEN = ("Venkata Ramana", "Srinivasa Rao", "Satyanarayana", "Lakshmi", "Padmavathi", "Suresh", "Ramesh", "Durga Prasad",
         "Sai Kumar", "Anil Kumar", "Kiran", "Madhavi", "Swathi", "Nagaraju", "Appala Naidu", "Rama Krishna", "Sujatha",
         "Bhavani", "Chandra Sekhar", "Gopala Krishna", "Hemalatha", "Jagadeesh", "Kalyani", "Mohan Rao", "Naveen",
         "Prasanna", "Rajeswari", "Sravani", "Tirupathi Rao", "Uma Maheswari", "Vijaya Lakshmi", "Yedukondalu",
         "Adinarayana", "Bangaru Raju", "Chinna Rao", "Dhanalakshmi", "Eswara Rao", "Govinda Rao", "Kanaka Durga",
         "Murali Krishna", "Narasimha Murthy", "Pydi Raju", "Sanyasi Rao", "Simhachalam", "Varalakshmi")
FAMILY = ("Naidu", "Reddy", "Rao", "Varma", "Raju", "Sastry", "Murthy", "Chowdary", "Patnaik", "Setti", "Gupta",
          "Allu", "Bonam", "Chintala", "Dasari", "Gorle", "Kolla", "Koppula", "Mutyala", "Palla", "Pilla",
          "Ravada", "Sanapala", "Tadi", "Uppada", "Vasupalli", "Yellapu", "Boddu", "Karri", "Lanka")


def person(r):
    return f"{r.choice(GIVEN)} {r.choice(FAMILY)}"


def initials_variant(name, r):
    """How another department might record the same owner: 'P. Venkata Ramana' vs 'Venkata Ramana Pilla'."""
    parts = name.split()
    family, given = parts[-1], " ".join(parts[:-1])
    return f"{family[0]}. {given}" if r.random() < 0.5 else f"{given} {family[0]}."
