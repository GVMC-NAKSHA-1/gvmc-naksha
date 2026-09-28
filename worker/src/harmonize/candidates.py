"""Candidate match pairs computed in Python with the same rules as match_ward.sql — for building
labelled training data (synth_pairs.py, pack_pairs.py) without a database.

Geometries are in a metric CRS (UTM 44N). A record's `key` is what it describes (a parcel id);
a pair is a true match when both keys are set and equal.
"""
from collections import namedtuple

import shapely

Record = namedtuple("Record", "id key type geom props")

PRUNE_M, MIN_IOU, MAX_DIST_M = 33.0, 0.30, 25.0
# Reference layers match_ward.sql never pairs (rasters, utility networks, GNSS control points).
SKIP_TYPES = {"ori", "drone_imagery", "dsm_dtm", "utility", "gnss_cors"}


def _is_area(g):
    return g.geom_type in ("Polygon", "MultiPolygon")


def candidate_pair(a, b, captured):
    """Pair dict shaped like a match_ward.sql row (+ "label"), or None when the rules reject it."""
    both_areas = _is_area(a.geom) and _is_area(b.geom)
    iou = dist = None
    if both_areas:
        inter = a.geom.intersection(b.geom).area
        iou = inter / a.geom.union(b.geom).area if inter > 0 else 0.0
    else:
        dist = a.geom.centroid.distance(b.geom.centroid)
    if not ((iou or 0) >= MIN_IOU or (dist if dist is not None else 999) <= MAX_DIST_M):
        return None
    return {
        "a_id": a.id, "b_id": b.id, "a_type": a.type, "b_type": b.type, "a_source": a.type, "b_source": b.type,
        "a_props": a.props, "b_props": b.props, "a_captured": captured.get(a.type), "b_captured": captured.get(b.type),
        "iou": iou, "dist_m": dist,
        "area_a": a.geom.area if _is_area(a.geom) else None,
        "area_b": b.geom.area if _is_area(b.geom) else None,
        "perim_a": a.geom.length if _is_area(a.geom) else None,
        "perim_b": b.geom.length if _is_area(b.geom) else None,
        "hausdorff_m": a.geom.hausdorff_distance(b.geom) if both_areas else None,
        "match_score": round(100 * (iou if iou is not None else max(0.0, 1 - dist / MAX_DIST_M)), 2),
        "label": a.key is not None and a.key == b.key,
    }


def candidate_pairs(records, captured):
    """All candidate pairs between records of different types (STRtree-pruned at 33 m, as the SQL)."""
    records = [r for r in records if r.type not in SKIP_TYPES and not r.geom.is_empty
               and r.geom.geom_type not in ("LineString", "MultiLineString")]
    if not records:
        return []
    tree = shapely.STRtree([r.geom for r in records])
    out = []
    for i, a in enumerate(records):
        for j in tree.query(a.geom, predicate="dwithin", distance=PRUNE_M):
            if j <= i or records[j].type == a.type:
                continue
            p = candidate_pair(a, records[j], captured)
            if p:
                out.append(p)
    return out
