import json
import os
from db import cursor, ward_lock
from queue_client import enqueue
from harmonize import ml_match
from harmonize.features import pair_features, to_json
from harmonize.scoring import attribute_score, confidence, recency_score

MATCH_SQL = open(os.path.join(os.path.dirname(__file__), "match_ward.sql")).read()  # the WITH pairs ... query


def _rename_maps(cur, ward):
    """{(source_a_id, source_b_id): {field_b: field_a}} from approved / unreviewed schema mappings."""
    cur.execute(
        """SELECT sm.source_a_id::text AS a, sm.source_b_id::text AS b, sm.field_a, sm.field_b
           FROM schema_mappings sm JOIN data_sources da ON da.id = sm.source_a_id
           WHERE da.ward_id = %s AND COALESCE(sm.approved, true)""", (ward,))
    maps = {}
    for r in cur.fetchall():
        maps.setdefault((r["a"], r["b"]), {})[r["field_b"]] = r["field_a"]
        maps.setdefault((r["b"], r["a"]), {})[r["field_a"]] = r["field_b"]
    return maps


def select_one_to_one(pairs, locked=()):
    """Greedy one-to-one assignment per pair of sources, best match_score first.

    A feature keeps at most one partner in each other source, so golden-record clustering stays
    parcel-sized instead of chaining a dense neighbourhood together. `locked` pairs (a_id, b_id) —
    matches an officer already decided on — are claimed first and always kept.
    """
    locked = {frozenset(map(str, p)) for p in locked}
    taken = set()                                    # (source pair, feature id)
    chosen = []
    ranked = sorted(pairs, key=lambda p: (frozenset((str(p["a_id"]), str(p["b_id"]))) not in locked,
                                          -float(p["match_score"])))
    for p in ranked:
        group = frozenset((str(p["a_source"]), str(p["b_source"])))
        ka, kb = (group, str(p["a_id"])), (group, str(p["b_id"]))
        if ka in taken or kb in taken:
            continue
        taken.update((ka, kb))
        chosen.append(p)
    return chosen


def _officer_labels(cur, ward):
    """(confirmed pairs, rejected pairs) from match_labels; empty until migration 0020 is applied."""
    cur.execute("SELECT to_regclass('public.match_labels') AS t")
    if not cur.fetchone()["t"]:
        return [], set()
    cur.execute("SELECT feature_a_id, feature_b_id, label FROM match_labels WHERE ward_id = %s", (ward,))
    rows = cur.fetchall()
    confirmed = [(r["feature_a_id"], r["feature_b_id"]) for r in rows if r["label"]]
    rejected = {frozenset((str(r["feature_a_id"]), str(r["feature_b_id"]))) for r in rows if not r["label"]}
    return confirmed, rejected


def apply_model(candidates, maps, bundle, locked=()):
    """Attach features (always — officer labels snapshot them) and, with a model, replace the
    geometric match_score by 100 × P(match) and drop pairs below the threshold unless locked."""
    locked = {frozenset(map(str, p)) for p in locked}
    feats = [pair_features(p, maps.get((str(p["a_source"]), str(p["b_source"])), {})) for p in candidates]
    probs = ml_match.predict(bundle, feats) if bundle else [None] * len(candidates)
    out = []
    for p, f, prob in zip(candidates, feats, probs):
        p = {**p, "features": f, "geo_score": float(p["match_score"])}
        if prob is not None:
            p["ml_probability"] = float(prob)
            p["match_score"] = round(100 * float(prob), 2)
            if prob < ml_match.THRESHOLD and frozenset((str(p["a_id"]), str(p["b_id"]))) not in locked:
                continue
        out.append(p)
    return out


def match_ward(job):
    ward = job["wardId"]
    bundle = ml_match.load()
    with cursor() as cur:
        ward_lock(cur, ward)
        maps = _rename_maps(cur, ward)
        cur.execute(MATCH_SQL, {"ward": ward})
        candidates = cur.fetchall()
        cur.execute("""SELECT m.feature_a_id, m.feature_b_id FROM matches m JOIN conflicts c ON c.match_id = m.id
                       WHERE m.ward_id = %s AND c.status <> 'pending'""", (ward,))
        locked = [(r["feature_a_id"], r["feature_b_id"]) for r in cur.fetchall()]
        confirmed, rejected = _officer_labels(cur, ward)
        locked += confirmed
        candidates = [p for p in candidates if frozenset((str(p["a_id"]), str(p["b_id"]))) not in rejected]
        n_candidates = len(candidates)
        candidates = apply_model(candidates, maps, bundle, locked)
        pairs = select_one_to_one(candidates, locked)
        # Matches displaced by a better one go, unless an officer already decided their conflict.
        keep = [f"{p['a_id']}|{p['b_id']}" for p in pairs] + [f"{a}|{b}" for a, b in locked]
        cur.execute("""DELETE FROM matches WHERE ward_id = %s
                       AND (feature_a_id::text || '|' || feature_b_id::text) <> ALL(%s)""", (ward, keep))
        displaced = cur.rowcount
        for p in pairs:
            rename = maps.get((str(p["a_source"]), str(p["b_source"])), {})
            attribute, _ = attribute_score(p["a_props"], p["b_props"], rename)
            recency = recency_score(p["a_captured"], p["b_captured"])
            _, breakdown = confidence(p["geo_score"], p["a_type"], p["b_type"], attribute, recency)
            breakdown["ml_features"] = to_json(p["features"])
            if "ml_probability" in p:
                breakdown["ml_probability"] = round(p["ml_probability"], 4)
                breakdown["model_version"] = bundle["version"]
            cur.execute(
                """INSERT INTO matches (ward_id, feature_a_id, feature_b_id, source_a_type, source_b_type,
                                        geometry_iou, centroid_distance_m, match_score, confidence_breakdown)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (feature_a_id, feature_b_id) DO UPDATE SET
                       match_score = EXCLUDED.match_score,
                       geometry_iou = EXCLUDED.geometry_iou,
                       centroid_distance_m = EXCLUDED.centroid_distance_m,
                       confidence_breakdown = EXCLUDED.confidence_breakdown,
                       matched_at = now()""",
                (ward, p["a_id"], p["b_id"], p["a_type"], p["b_type"],
                 p["iou"], p["dist_m"], p["match_score"], json.dumps(breakdown)))
    enqueue("DETECT_CONFLICTS", wardId=ward)
    how = f"ML {bundle['version']}" if bundle else "rules"
    print(f"[match] ward {ward}: {len(pairs)} matches from {n_candidates} candidates via {how} ({displaced} displaced)")
    return {"matches": len(pairs), "candidates": n_candidates, "displaced": displaced, "scored_by": how}
