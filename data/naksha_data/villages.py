"""Official village boundaries: Survey of India → ORGI harmonised village shapefile (Andhra Pradesh).

The shapefile (ANDHRA_PRADESH.shp/.dbf/.shx/.prj, ~18 000 villages, India LCC on WGS 84) is not
downloadable without a login, so it ships in the repo through Git LFS (`git lfs pull`). It is read,
as a folder or a zip, from the first that exists:
    $NAKSHA_VILLAGES_PATH, data/soi/ANDHRA_PRADESH/, <DATA_CACHE>/soi/ANDHRA_PRADESH.zip
It gives two things the open pack otherwise has to invent:
  - the official GVMC outline: every polygon with LGD code 802947, "GVMC (M Corp. + OG) (Part)",
    one part per mandal it spans (Visakhapatnam and Anakapalli districts)
  - villages with LGD codes (district / mandal / village), so parcels can be joined to revenue records
"""
import io
import os
import zipfile

import shapefile
import shapely
from pyproj import CRS, Transformer
from shapely import ops
from shapely.geometry import shape
from shapely.ops import unary_union

from .common import CACHE

GVMC_LGD = "802947"
DISTRICTS = ("Visakhapatnam", "Anakapalli")      # the districts GVMC spans
FIELDS = {"vill_lgd": "Vill_LGD", "name": "Vill_name", "category": "Vill_Cat", "mandal": "Sub_dist",
          "mandal_lgd": "Subdis_LGD", "mandal_type": "Subdis_Typ", "district": "District", "dist_lgd": "Dist_LGD",
          "state_lgd": "STATE_LGD"}


REPO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "soi", "ANDHRA_PRADESH")
LFS_POINTER = b"version https://git-lfs"


def source():
    """The first configured / existing folder or zip (the last candidate if none exists)."""
    env = os.environ.get("NAKSHA_VILLAGES_PATH") or os.environ.get("NAKSHA_VILLAGES_ZIP")
    if env:
        return env
    zipped = os.path.join(CACHE, "soi", "ANDHRA_PRADESH.zip")
    return REPO_DIR if os.path.isdir(REPO_DIR) else zipped


def _shp_in_dir(folder):
    return next((os.path.join(folder, n) for n in sorted(os.listdir(folder)) if n.lower().endswith(".shp")), None)


def available(src=None):
    """True when the data is really there — not missing, and not an LFS pointer left by a clone
    without `git lfs pull` (the pack then falls back to the OpenStreetMap study area)."""
    src = src or source()
    if os.path.isdir(src):
        shp = _shp_in_dir(src)
        if not shp:
            return False
        with open(shp, "rb") as f:
            if f.read(len(LFS_POINTER)) == LFS_POINTER:
                print(f"[villages] {shp} is a Git LFS pointer: run `git lfs pull` to fetch the village boundaries")
                return False
        return True
    return os.path.isfile(src)


def _parts(src):
    """→ ({'.shp' | '.shx' | '.dbf': BytesIO}, prj WKT) from a folder or a zip."""
    if os.path.isdir(src):
        base = os.path.splitext(_shp_in_dir(src))[0]
        blob = {ext: open(base + ext, "rb").read() for ext in (".shp", ".shx", ".dbf", ".prj")}
    else:
        with zipfile.ZipFile(src) as z:
            member = {os.path.splitext(n)[1].lower(): n for n in z.namelist() if not n.endswith(".shp.xml")}
            blob = {ext: z.read(member[ext]) for ext in (".shp", ".shx", ".dbf", ".prj")}
    return {ext: io.BytesIO(blob[ext]) for ext in (".shp", ".shx", ".dbf")}, blob[".prj"].decode("utf-8", "replace")


def read(src=None, districts=DISTRICTS):
    """→ [(polygon WGS84, properties)] for the villages in `districts` (None = the whole state)."""
    raw, wkt = _parts(src or source())
    fwd = Transformer.from_crs(CRS.from_wkt(wkt), "EPSG:4326", always_xy=True).transform
    wanted = {d.lower() for d in districts} if districts else None
    out = []
    with shapefile.Reader(shp=raw[".shp"], shx=raw[".shx"], dbf=raw[".dbf"], encoding="utf-8") as sf:
        for i, rec in enumerate(sf.iterRecords()):
            if wanted and rec["District"].strip().lower() not in wanted:
                continue
            geom = shapely.make_valid(ops.transform(fwd, shape(sf.shape(i).__geo_interface__)))
            props = {k: str(rec[v]).strip() for k, v in FIELDS.items()}
            out.append((geom, props))
    return out


def gvmc_outline(villages):
    """Dissolved GVMC municipal corporation boundary (WGS84) from the LGD 802947 parts."""
    parts = [g for g, p in villages if p["vill_lgd"] == GVMC_LGD]
    if not parts:
        raise RuntimeError(f"no polygons with LGD {GVMC_LGD} (GVMC) in {source()}")
    # The parts are cut along mandal lines; a small buffer closes digitising slivers between them.
    return shapely.make_valid(unary_union(parts).buffer(1e-5).buffer(-1e-5))
