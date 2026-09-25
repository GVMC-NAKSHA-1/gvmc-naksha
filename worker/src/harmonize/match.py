import json
import os
from db import cursor, ward_lock
from queue_client import enqueue
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


def match_ward(job):
    ward = job["wardId"]
    with cursor() as cur:
        ward_lock(cur, ward)
        maps = _rename_maps(cur, ward)
        cur.execute(MATCH_SQL, {"ward": ward})
        candidates = cur.fetchall()
        cur.execute("""SELECT m.feature_a_id, m.feature_b_id FROM matches m JOIN conflicts c ON c.match_id = m.id
                       WHERE m.ward_id = %s AND c.status <> 'pending'""", (ward,))
        locked = [(r["feature_a_id"], r["feature_b_id"]) for r in cur.fetchall()]
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
            _, breakdown = confidence(float(p["match_score"]), p["a_type"], p["b_type"], attribute, recency)
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
    print(f"[match] ward {ward}: {len(pairs)} matches from {len(candidates)} candidates ({displaced} displaced)")
    return {"matches": len(pairs), "candidates": len(candidates), "displaced": displaced}
