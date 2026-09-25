import json
from db import cursor, ward_lock
from queue_client import enqueue

def _severity(match_score, attr_disagree_ratio, hard_geometry_disagreement):
    if match_score < 40 or hard_geometry_disagreement:
        return "critical"
    if match_score < 70:
        return "high"
    if match_score < 90 or attr_disagree_ratio > 0.34:
        return "medium"
    return "low"

def detect_conflicts(job):
    ward = job["wardId"]
    with cursor() as cur:
        ward_lock(cur, ward)
        cur.execute("""
            SELECT m.id, m.match_score, m.geometry_iou,
                   fa.properties AS a_props, fb.properties AS b_props
            FROM matches m
            JOIN source_features fa ON fa.id = m.feature_a_id
            JOIN source_features fb ON fb.id = m.feature_b_id
            WHERE m.ward_id = %s
              AND NOT EXISTS (SELECT 1 FROM conflicts c WHERE c.match_id = m.id)""", (ward,))
        rows = cur.fetchall()
        made = 0
        for r in rows:
            a, b = r["a_props"] or {}, r["b_props"] or {}
            shared = set(a) & set(b)
            disagree = [k for k in shared if str(a[k]).strip().lower() != str(b[k]).strip().lower()]
            iou = float(r["geometry_iou"]) if r["geometry_iou"] is not None else None
            geom_bad = (iou is not None and iou < 0.30)
            if not disagree and not geom_bad:
                continue
            ctype = "both" if (disagree and geom_bad) else ("attribute_mismatch" if disagree else "geometry_mismatch")
            sev = _severity(float(r["match_score"]), len(disagree) / max(len(shared), 1), geom_bad)
            cur.execute("""
                INSERT INTO conflicts (ward_id, match_id, conflict_type, severity, detail, suggested_resolution)
                VALUES (%s,%s,%s,%s,%s,%s)""",
                (ward, r["id"], ctype, sev,
                 json.dumps({"disagreeing_fields": disagree, "iou": iou}),
                 f"Reconcile {', '.join(disagree) or 'geometry'}; trust the higher-reliability source."))
            made += 1
    # B.10: (re)assemble the ward's golden record now that matches + conflicts are known.
    enqueue("ASSEMBLE_WARD", wardId=ward)
    print(f"[conflicts] ward {ward}: {made} created; enqueued ASSEMBLE_WARD")
    return {"conflicts_created": made}
