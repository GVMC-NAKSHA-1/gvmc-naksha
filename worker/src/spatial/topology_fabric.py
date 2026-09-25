"""Automated topology correction for a polygon source (parcel fabric / footprints).

Detects, in a metric UTM projection:
  overlap           two parcels claim the same ground        → fix: clip it out of the smaller parcel
  gap / sliver      unclaimed strip between neighbours      → fix: merge into the neighbour sharing
                    (narrower than 2 × gap_max_width_m)        the longest boundary
  duplicate_vertex  repeated / near-coincident vertices      → fix: ST_RemoveRepeatedPoints
  self_intersection geometries already repaired at ingestion → logged (auto_fixed)

With autoFix the proposed geometry is written back to source_features; otherwise issues stay
`open` for review (the API applies the same SQL on accept).
"""
import json
import math

from db import cursor
from queue_client import enqueue

DEFAULTS = {"toleranceM": 0.05, "gapMaxWidthM": 1.0, "sliverMaxWidthM": 0.5, "overlapMinSqm": 0.25, "autoFix": False}


def classify_gap(area_sqm: float, perimeter_m: float, sliver_max_width_m: float = 0.5) -> str:
    """Mean width of a thin strip ≈ 2·area / perimeter. Very thin strips are slivers."""
    width = 2 * area_sqm / perimeter_m if perimeter_m else 0
    return "sliver" if width < sliver_max_width_m else "gap"


def utm_srid(lon: float, lat: float) -> int:
    zone = int((lon + 180) // 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


# Geometry of every polygonal feature of the source, in UTM.
_FEATS = """
  SELECT id, ST_Transform(ST_CollectionExtract(ST_MakeValid(geom), 3), %(srid)s) AS g
  FROM source_features WHERE source_id = %(src)s AND ST_Dimension(geom) = 2
"""


def _detect(cur, src, srid, p):
    issues = []
    tol_deg = p["toleranceM"] / 111320
    # Duplicate / near-coincident vertices.
    cur.execute("""
        SELECT id, ST_AsGeoJSON(geom)::json AS geom,
               ST_NPoints(geom) - ST_NPoints(ST_RemoveRepeatedPoints(geom, %(tol)s)) AS dup
        FROM source_features WHERE source_id = %(src)s AND ST_Dimension(geom) = 2""", {"src": src, "tol": tol_deg})
    for r in cur.fetchall():
        if r["dup"] > 0:
            issues.append({"issue_type": "duplicate_vertex", "geom": r["geom"], "area_sqm": 0,
                           "feature_ids": [r["id"]], "fix": {"action": "remove_repeated_points", "target": str(r["id"]),
                                                             "tolerance_deg": tol_deg, "vertices_removed": r["dup"]}})
    # Geometries repaired during ingestion.
    cur.execute("""SELECT id, ST_AsGeoJSON(geom)::json AS geom FROM source_features
                   WHERE source_id = %s AND was_invalid""", (src,))
    for r in cur.fetchall():
        issues.append({"issue_type": "self_intersection", "geom": r["geom"], "area_sqm": 0, "status": "auto_fixed",
                       "feature_ids": [r["id"]], "fix": {"action": "make_valid", "target": str(r["id"]), "applied_at": "ingestion"}})
    # Overlaps between pairs. Candidates come from the base table so the GiST index on geom is used;
    # only those pairs are made valid and projected to UTM for metric areas.
    cur.execute("""
        WITH cand AS (
          SELECT a.id AS a, b.id AS b,
                 ST_Transform(ST_CollectionExtract(ST_MakeValid(a.geom), 3), %(srid)s) AS ag,
                 ST_Transform(ST_CollectionExtract(ST_MakeValid(b.geom), 3), %(srid)s) AS bg
          FROM source_features a
          JOIN source_features b ON b.source_id = a.source_id AND a.id < b.id AND ST_Intersects(a.geom, b.geom)
          WHERE a.source_id = %(src)s AND ST_Dimension(a.geom) = 2 AND ST_Dimension(b.geom) = 2),
        ov AS (
          SELECT a, b, ST_Area(ag) AS a_area, ST_Area(bg) AS b_area, ST_Intersection(ag, bg) AS ig
          FROM cand WHERE NOT ST_Touches(ag, bg))
        SELECT a, b, a_area, b_area, ST_Area(ig) AS area,
               ST_AsGeoJSON(ST_Transform(ST_CollectionExtract(ig, 3), 4326))::json AS geom
        FROM ov WHERE ST_Area(ig) > %(min)s""", {"src": src, "srid": srid, "min": p["overlapMinSqm"]})
    for r in cur.fetchall():
        smaller, larger = (r["a"], r["b"]) if r["a_area"] <= r["b_area"] else (r["b"], r["a"])
        issues.append({"issue_type": "overlap", "geom": r["geom"], "area_sqm": round(r["area"], 2),
                       "feature_ids": [r["a"], r["b"]],
                       "fix": {"action": "clip_from", "target": str(smaller), "keep": str(larger)}})
    # Gaps / slivers: closing (buffer +w, −w) of the union minus the union.
    w = p["gapMaxWidthM"] / 2
    cur.execute(f"""
        WITH f AS ({_FEATS}), u AS (SELECT ST_Union(g) AS g FROM f),
             gaps AS (SELECT (ST_Dump(ST_Difference(ST_Buffer(ST_Buffer(u.g, %(w)s, 'join=mitre'), -%(w)s, 'join=mitre'), u.g))).geom AS g FROM u)
        SELECT ST_AsGeoJSON(ST_Transform(gaps.g, 4326))::json AS geom, ST_Area(gaps.g) AS area, ST_Perimeter(gaps.g) AS perim,
               (SELECT f.id FROM f WHERE ST_DWithin(f.g, gaps.g, 0.01)
                ORDER BY ST_Length(ST_Intersection(ST_Boundary(f.g), ST_Buffer(gaps.g, 0.01))) DESC LIMIT 1) AS neighbour,
               -- text[], not uuid[]: psycopg2 has no uuid[] caster and would return the raw array literal as one string
               ARRAY(SELECT f.id::text FROM f WHERE ST_DWithin(f.g, gaps.g, 0.01)) AS touching
        FROM gaps WHERE ST_Area(gaps.g) > 0.05""", {"src": src, "srid": srid, "w": w})
    for r in cur.fetchall():
        if not r["neighbour"]:
            continue
        kind = classify_gap(r["area"], r["perim"], p["sliverMaxWidthM"])
        issues.append({"issue_type": kind, "geom": r["geom"], "area_sqm": round(r["area"], 2),
                       "feature_ids": r["touching"], "fix": {"action": "merge_into", "target": str(r["neighbour"])}})
    return issues


APPLY_SQL = {
    # geometry of the issue (%(issue_geom)s) is WGS84 GeoJSON
    "clip_from": """UPDATE source_features t SET geom = ST_CollectionExtract(ST_MakeValid(ST_Difference(t.geom, k.geom)), 3)
                    FROM source_features k WHERE t.id = %(target)s AND k.id = %(keep)s RETURNING ST_AsGeoJSON(t.geom)::json AS g""",
    "merge_into": """UPDATE source_features t SET geom = ST_CollectionExtract(ST_MakeValid(ST_Union(t.geom,
                        ST_SetSRID(ST_GeomFromGeoJSON(%(issue_geom)s), 4326))), 3)
                     WHERE t.id = %(target)s RETURNING ST_AsGeoJSON(t.geom)::json AS g""",
    "remove_repeated_points": """UPDATE source_features t SET geom = ST_RemoveRepeatedPoints(t.geom, %(tolerance_deg)s)
                                 WHERE t.id = %(target)s RETURNING ST_AsGeoJSON(t.geom)::json AS g""",
}


def _proposed(cur, issue):
    """Geometry the target feature would have after the fix, without changing it."""
    fix = issue["fix"]
    if fix["action"] == "clip_from":
        cur.execute("""SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(ST_Difference(t.geom, k.geom)), 3))::json AS g
                       FROM source_features t, source_features k WHERE t.id=%s AND k.id=%s""", (fix["target"], fix["keep"]))
    elif fix["action"] == "merge_into":
        cur.execute("""SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(ST_Union(t.geom,
                              ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))), 3))::json AS g
                       FROM source_features t WHERE t.id=%s""", (json.dumps(issue["geom"]), fix["target"]))
    elif fix["action"] == "remove_repeated_points":
        cur.execute("SELECT ST_AsGeoJSON(ST_RemoveRepeatedPoints(geom, %s))::json AS g FROM source_features WHERE id=%s",
                    (fix["tolerance_deg"], fix["target"]))
    else:
        return None
    row = cur.fetchone()
    return row["g"] if row else None


def fix_topology(job):
    """job: {sourceId, wardId?, toleranceM?, gapMaxWidthM?, sliverMaxWidthM?, overlapMinSqm?, autoFix?}"""
    src = job["sourceId"]
    p = {**DEFAULTS, **{k: v for k, v in job.items() if k in DEFAULTS and v is not None}}
    with cursor() as cur:
        cur.execute("SELECT ward_id FROM data_sources WHERE id=%s", (src,))
        ward = (cur.fetchone() or {}).get("ward_id")
        cur.execute("""SELECT ST_X(c) AS lon, ST_Y(c) AS lat FROM
                       (SELECT ST_Centroid(ST_Collect(geom)) AS c FROM source_features WHERE source_id=%s) s""", (src,))
        c = cur.fetchone()
        if not c or c["lon"] is None:
            return {"issues": 0}
        srid = utm_srid(c["lon"], c["lat"])
        # Re-runs replace the previous unresolved findings.
        cur.execute("DELETE FROM topology_issues WHERE source_id=%s AND status IN ('open','auto_fixed')", (src,))
        issues = _detect(cur, src, srid, p)

        counts, fixed = {}, 0
        for iss in issues:
            counts[iss["issue_type"]] = counts.get(iss["issue_type"], 0) + 1
            status = iss.get("status", "open")
            fixed_geom = None
            action = iss["fix"].get("action")
            if status == "open" and action in APPLY_SQL:
                if p["autoFix"]:
                    cur.execute(APPLY_SQL[action], {**iss["fix"], "issue_geom": json.dumps(iss["geom"])})
                    row = cur.fetchone()
                    fixed_geom = row["g"] if row else None
                    status = "auto_fixed"; fixed += 1
                else:
                    fixed_geom = _proposed(cur, iss)
            cur.execute(
                """INSERT INTO topology_issues (ward_id, source_id, issue_type, geom, area_sqm, feature_ids, status, fix, fixed_geom)
                   VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s::uuid[], %s, %s,
                           CASE WHEN %s::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) END)""",
                (ward, src, iss["issue_type"], json.dumps(iss["geom"]), iss["area_sqm"],
                 [str(x) for x in iss["feature_ids"]], status, json.dumps(iss["fix"]),
                 json.dumps(fixed_geom) if fixed_geom else None, json.dumps(fixed_geom) if fixed_geom else None))
    if fixed and ward:
        enqueue("HARMONIZE_WARD", wardId=ward)
    print(f"[topology] source {src}: {counts} ({fixed} auto-fixed)")
    return {"issues": sum(counts.values()), "by_type": counts, "auto_fixed": fixed, "srid": srid}
