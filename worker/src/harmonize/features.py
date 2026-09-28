"""Feature vector for one candidate match pair (pure — no DB / network, unit-tested in tests/).

The same function feeds live matching (match.py, pairs from match_ward.sql) and training
(synth_pairs.py / match_labels snapshots), so the model never sees features computed two ways.
Missing values are NaN: HistGradientBoosting handles them natively, and "no owner field on one
side" is itself informative.
"""
import math

from harmonize.scoring import SOURCE_RELIABILITY, attribute_score, recency_score, value_similarity

SOURCE_TYPES = sorted(SOURCE_RELIABILITY)

# The same land fact under the names different departments use (after schema-mapping renames).
OWNER_KEYS = ("owner_name", "owner", "pattadar", "pattadar_name", "owner_nm")
SURVEY_KEYS = ("survey_no", "sy_no", "survey", "survey_number")
KHATA_KEYS = ("khata_no", "khata", "khatha_no", "assess_no")

FEATURES = [
    "iou", "dist_m", "is_point_pair", "area_ratio", "hausdorff_m", "compactness_diff",
    "attr_score", "n_shared_fields", "owner_sim", "survey_sim", "khata_sim",
    "reliability_min", "reliability_max", "recency",
] + [f"src_{t}" for t in SOURCE_TYPES]

NAN = float("nan")


def _f(v):
    try:
        return NAN if v is None else float(v)
    except (TypeError, ValueError):
        return NAN


def _first(props, keys):
    for k in keys:
        v = props.get(k)
        if v not in (None, ""):
            return v
    return None


def _field_sim(a, b, keys):
    va, vb = _first(a, keys), _first(b, keys)
    return NAN if va is None or vb is None else value_similarity(va, vb)


def _compactness(area, perim):
    """Polsby-Popper 4πA/P²: 1 for a circle, lower for thin or ragged shapes."""
    area, perim = _f(area), _f(perim)
    if not (area > 0 and perim > 0):
        return NAN
    return 4 * math.pi * area / perim ** 2


def pair_features(p, rename=None):
    """p: a candidate pair as match_ward.sql returns it → {feature name: float}."""
    a_props, b_props = p.get("a_props") or {}, p.get("b_props") or {}
    b_norm = {(rename or {}).get(k, k): v for k, v in b_props.items()}
    attr, shared = attribute_score(a_props, b_props, rename)
    area_a, area_b = _f(p.get("area_a")), _f(p.get("area_b"))
    ca, cb = _compactness(area_a, p.get("perim_a")), _compactness(area_b, p.get("perim_b"))
    rel = (SOURCE_RELIABILITY.get(p.get("a_type"), 0.5), SOURCE_RELIABILITY.get(p.get("b_type"), 0.5))
    feats = {
        "iou": _f(p.get("iou")),
        "dist_m": _f(p.get("dist_m")),
        "is_point_pair": 1.0 if p.get("iou") is None else 0.0,
        "area_ratio": min(area_a, area_b) / max(area_a, area_b) if area_a > 0 and area_b > 0 else NAN,
        "hausdorff_m": _f(p.get("hausdorff_m")),
        "compactness_diff": abs(ca - cb),
        "attr_score": attr if shared else NAN,
        "n_shared_fields": float(len(shared)),
        "owner_sim": _field_sim(a_props, b_norm, OWNER_KEYS),
        "survey_sim": _field_sim(a_props, b_norm, SURVEY_KEYS),
        "khata_sim": _field_sim(a_props, b_norm, KHATA_KEYS),
        "reliability_min": min(rel),
        "reliability_max": max(rel),
        "recency": recency_score(p.get("a_captured"), p.get("b_captured")),
    }
    for t in SOURCE_TYPES:
        feats[f"src_{t}"] = 1.0 if t in (p.get("a_type"), p.get("b_type")) else 0.0
    return feats


def to_row(feats):
    """Feature dict → list in FEATURES order (unknown / missing → NaN)."""
    return [_f(feats.get(k)) for k in FEATURES]


def to_json(feats):
    """JSON-safe snapshot (jsonb rejects NaN) for matches.confidence_breakdown / match_labels."""
    return {k: (None if isinstance(v, float) and math.isnan(v) else round(v, 5)) for k, v in feats.items()}
