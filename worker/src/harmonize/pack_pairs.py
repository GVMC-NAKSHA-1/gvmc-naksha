"""Labelled match pairs from a built open-data-pack ward (data/naksha_data build → out/ward-<id>/).

Each layer is read with the worker's own ingest adapters and CRS handling, so records carry exactly
the properties the platform stores. Candidate pairs follow match_ward.sql (candidates.py), and the
label comes from the ward's answers.json `match_truth`: which cadastral parcel every municipal
record, revenue row, building and field observation was generated from. Real OSM streets and real
building footprints make this far closer to a live ward than synth_pairs.py.
"""
import glob
import json
import os
from datetime import datetime, timezone

from shapely.ops import transform as shp_transform
from pyproj import Transformer

from harmonize.candidates import Record, candidate_pairs

UTM = "EPSG:32644"
LAYERS = ("cadastral", "municipal_gis", "revenue", "building_footprint", "ground_truth")


def _read(path, crs):
    """[(WGS84 geometry, props)] through the same adapter → reproject → repair chain as ingest."""
    from ingest.adapters import pick_adapter
    from spatial.geo_transform import detect_crs, reproject_to_wgs84
    from spatial.topology import validate_and_fix
    out, file_crs = [], None
    for rec, embedded in pick_adapter(path, "")(path):
        src_crs = crs or embedded or file_crs or (file_crs := detect_crs(path))
        g = reproject_to_wgs84(rec["geometry"], src_crs)
        if not g.is_empty:
            out.append((validate_and_fix(g)[0], rec["properties"] or {}))
    return out


def _key(layer, i, props, truth):
    bld = truth.get("buildings", {})
    if layer == "cadastral":
        return props.get("parcel_id")
    if layer == "municipal_gis":
        return truth.get("municipal", {}).get(props.get("assess_no"))
    if layer == "revenue":
        rows = truth.get("revenue_rows", [])
        return rows[i] if i < len(rows) else None
    if layer == "building_footprint":
        return bld.get(props.get("bldg_id"))
    if layer == "ground_truth":
        return bld.get(truth.get("ground_truth", {}).get(props.get("name")))
    return None


def ward_pairs(ward_dir):
    """→ (pairs, ward_id). Empty when the ward was built before match_truth existed."""
    with open(os.path.join(ward_dir, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    with open(os.path.join(ward_dir, "answers.json"), encoding="utf-8") as f:
        truth = json.load(f).get("match_truth")
    if not truth:
        return [], manifest["ward_id"]
    to_utm = Transformer.from_crs("EPSG:4326", UTM, always_xy=True).transform
    records, captured = [], {}
    for entry in manifest["files"]:
        layer = entry["type"]
        if layer not in LAYERS or entry.get("scanned"):
            continue
        captured[layer] = datetime.fromisoformat(entry["captured_at"]).replace(tzinfo=timezone.utc)
        for i, (g, props) in enumerate(_read(os.path.join(ward_dir, entry["path"]), entry.get("crs"))):
            records.append(Record(f"{layer}:{i}", _key(layer, i, props, truth), layer,
                                  shp_transform(to_utm, g), props))
    return candidate_pairs(records, captured), manifest["ward_id"]


def pack_pairs(pack_dir, wards=None):
    """All wards under pack_dir → (pairs, rename maps, ward id per pair)."""
    pairs, groups = [], []
    for d in sorted(glob.glob(os.path.join(pack_dir, "ward-*"))):
        if wards and os.path.basename(d).split("-", 1)[1] not in wards:
            continue
        wp, ward_id = ward_pairs(d)
        pairs += wp
        groups += [f"ward-{ward_id}"] * len(wp)
        print(f"[pack] ward {ward_id}: {len(wp)} candidate pairs, {sum(p['label'] for p in wp)} true matches")
    # The pack's schema difference municipal "owner" ↔ "owner_name", as an approved schema mapping.
    rename = {}
    for other in ("cadastral", "revenue"):
        rename[("municipal_gis", other)] = {"owner_name": "owner"}
        rename[(other, "municipal_gis")] = {"owner": "owner_name"}
    return pairs, rename, groups
