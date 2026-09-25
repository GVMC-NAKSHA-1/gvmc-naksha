"""Validation & synchronisation.

Per source: a weighted data-quality score from checks (CRS declared, geometry validity,
attribute completeness, duplicate identifiers, ward coverage, open topology issues, freshness).
Per ward: how AI-extracted / surveyed structures line up with the cadastral fabric —
unregistered structures, encroachments across parcel boundaries, vacant parcels, and attribute
drift between matched records — written as `sync_findings` for review.
"""
import json
from datetime import datetime, timezone

from db import cursor, ward_lock

ID_FIELDS = ("parcel_id", "khata_no", "survey_no", "bldg_id", "asset_id", "property_tax_id")
PARCEL_TYPES = ("cadastral", "municipal_gis")
STRUCTURE_TYPES = ("ai_extracted", "building_footprint")


# ── pure helpers (unit-tested) ──────────────────────────────────────────────
def completeness(props_list, fields):
    """Share of (feature, field) cells that are non-empty."""
    fields = [f for f in fields if not f.startswith("_")]
    if not props_list or not fields:
        return 1.0
    filled = sum(1 for p in props_list for f in fields if (p or {}).get(f) not in (None, ""))
    return filled / (len(props_list) * len(fields))


def duplicate_count(props_list):
    for f in ID_FIELDS:
        vals = [(p or {}).get(f) for p in props_list if (p or {}).get(f) not in (None, "")]
        if vals:
            return len(vals) - len(set(map(str, vals))), f
    return 0, None


def weighted_score(checks):
    """checks: [{value: 0–1 (partial credit), weight}] → 0–100."""
    total = sum(c["weight"] for c in checks)
    if not total:
        return 100.0
    return round(100 * sum(c["weight"] * max(0.0, min(1.0, c["value"])) for c in checks) / total, 1)


def _check(key, label, value, passed, weight, detail=""):
    return {"key": key, "label": label, "value": round(float(value), 4), "passed": bool(passed),
            "weight": weight, "detail": detail}


# ── per-source report ───────────────────────────────────────────────────────
def _source_checks(cur, src, ward_bbox):
    cur.execute("""SELECT properties, ST_IsValid(geom) AS valid,
                          ST_X(ST_Centroid(geom)) AS x, ST_Y(ST_Centroid(geom)) AS y
                   FROM source_features WHERE source_id=%s""", (src["id"],))
    rows = cur.fetchall()
    n = len(rows) or 1
    props = [r["properties"] for r in rows]
    fields = (src["metadata"] or {}).get("fields") or sorted({k for p in props for k in (p or {})})
    valid = sum(1 for r in rows if r["valid"]) / n
    comp = completeness(props, fields)
    dups, dup_field = duplicate_count(props)
    inside = 1.0
    if ward_bbox and rows:
        w, s, e, nn = ward_bbox
        inside = sum(1 for r in rows if w <= r["x"] <= e and s <= r["y"] <= nn) / n
    cur.execute("SELECT count(*) AS c FROM topology_issues WHERE source_id=%s AND status='open'", (src["id"],))
    topo = cur.fetchone()["c"]
    age_years = None
    if src["captured_at"]:
        cap = src["captured_at"] if src["captured_at"].tzinfo else src["captured_at"].replace(tzinfo=timezone.utc)
        age_years = (datetime.now(timezone.utc) - cap).days / 365.25
    return [
        _check("crs", "Coordinate reference system declared", 1 if src["crs"] else 0.5, bool(src["crs"]), 1,
               src["crs"] or "detected from file"),
        _check("geometry_validity", "Valid geometries", valid, valid >= 0.99, 2, f"{round(valid * 100, 1)}% valid"),
        _check("completeness", "Attribute completeness", comp, comp >= 0.9, 2, f"{round(comp * 100, 1)}% of {len(fields)} fields filled"),
        _check("duplicates", "Unique identifiers", 1 - min(1, dups / n), dups == 0, 1,
               f"{dups} duplicate {dup_field}" if dup_field else "no identifier field"),
        _check("coverage", "Within ward boundary", inside, inside >= 0.95, 1, f"{round(inside * 100, 1)}% of features"),
        _check("topology", "No open topology issues", 1 / (1 + topo), topo == 0, 2, f"{topo} open issues"),
        _check("freshness", "Captured within 5 years", 1 if age_years is None else max(0, 1 - max(0, age_years - 5) / 10),
               age_years is None or age_years <= 5, 1, "unknown" if age_years is None else f"{round(age_years, 1)} years old"),
    ]


# ── ward synchronisation (PostGIS, geography areas) ─────────────────────────
SYNC_SQL = {
    "unregistered_structure": """
        SELECT s.id, ST_AsGeoJSON(s.geom)::json AS geom, ds.type AS source_type,
               jsonb_build_object('area_sqm', round(ST_Area(s.geom::geography)::numeric, 1), 'source_type', ds.type,
                                  'confidence', s.properties->'confidence') AS detail
        FROM source_features s JOIN data_sources ds ON ds.id = s.source_id
        WHERE ds.id = %(struct)s AND NOT EXISTS (
          SELECT 1 FROM source_features p JOIN data_sources dp ON dp.id = p.source_id
          WHERE dp.ward_id = %(ward)s AND dp.type::text = ANY(%(parcel_types)s) AND dp.status = 'ready'
            AND ST_Intersects(p.geom, s.geom)
            AND ST_Area(ST_Intersection(p.geom, s.geom)::geography) > 0.2 * ST_Area(s.geom::geography))""",
    "encroachment": """
        WITH best AS (
          SELECT s.id AS sid, s.geom AS sg, p.id AS pid, p.geom AS pg,
                 row_number() OVER (PARTITION BY s.id ORDER BY ST_Area(ST_Intersection(p.geom, s.geom)) DESC) AS rn
          FROM source_features s
          JOIN source_features p ON ST_Intersects(p.geom, s.geom)
          JOIN data_sources dp ON dp.id = p.source_id
          WHERE s.source_id = %(struct)s AND dp.ward_id = %(ward)s AND dp.type::text = ANY(%(parcel_types)s) AND dp.status = 'ready')
        SELECT sid AS id, ST_AsGeoJSON(ST_CollectionExtract(ST_Difference(sg, pg), 3))::json AS geom, pid,
               jsonb_build_object('outside_sqm', round(ST_Area(ST_Difference(sg, pg)::geography)::numeric, 1),
                                  'outside_pct', round((100 * ST_Area(ST_Difference(sg, pg)::geography)
                                                        / NULLIF(ST_Area(sg::geography), 0))::numeric, 1),
                                  'parcel_id', pid) AS detail
        FROM best WHERE rn = 1
          AND ST_Area(ST_Difference(sg, pg)::geography) > 0.15 * ST_Area(sg::geography)
          AND ST_Area(ST_Intersection(sg, pg)::geography) > 0.2 * ST_Area(sg::geography)""",
    "vacant_parcel": """
        SELECT p.id, ST_AsGeoJSON(p.geom)::json AS geom,
               jsonb_build_object('area_sqm', round(ST_Area(p.geom::geography)::numeric, 1),
                                  'parcel_id', p.properties->>'parcel_id') AS detail
        FROM source_features p JOIN data_sources dp ON dp.id = p.source_id
        WHERE dp.id = %(parcel)s AND NOT EXISTS (
          SELECT 1 FROM source_features s WHERE s.source_id = %(struct)s AND ST_Intersects(p.geom, s.geom))""",
}


def _latest(cur, ward, types):
    cur.execute("""SELECT id FROM data_sources WHERE ward_id=%s AND type::text = ANY(%s) AND status='ready'
                   ORDER BY captured_at DESC NULLS LAST, created_at DESC LIMIT 1""", (ward, list(types)))
    r = cur.fetchone()
    return r["id"] if r else None


def validate_ward(job):
    ward = job["wardId"]
    with cursor() as cur:
        ward_lock(cur, ward)
        cur.execute("SELECT bbox_west, bbox_south, bbox_east, bbox_north FROM wards WHERE id=%s", (ward,))
        b = cur.fetchone()
        bbox = [float(b["bbox_west"]), float(b["bbox_south"]), float(b["bbox_east"]), float(b["bbox_north"])] if b and b["bbox_west"] else None
        cur.execute("""SELECT * FROM data_sources WHERE ward_id=%s AND status='ready'
                       AND type NOT IN ('ori','drone_imagery','dsm_dtm')""", (ward,))
        sources = cur.fetchall()
        scores = []
        for src in sources:
            checks = _source_checks(cur, src, bbox)
            score = weighted_score(checks)
            scores.append(score)
            cur.execute("INSERT INTO validation_reports (ward_id, source_id, score, checks) VALUES (%s,%s,%s,%s)",
                        (ward, src["id"], score, json.dumps(checks)))

        # Synchronisation of structures (AI-extracted preferred) with the cadastral fabric.
        struct = _latest(cur, ward, ("ai_extracted",)) or _latest(cur, ward, ("building_footprint",))
        parcel = _latest(cur, ward, ("cadastral",)) or _latest(cur, ward, ("municipal_gis",))
        findings = []
        if struct and parcel:
            params = {"ward": ward, "struct": struct, "parcel": parcel, "parcel_types": list(PARCEL_TYPES)}
            for kind, sql in SYNC_SQL.items():
                cur.execute(sql, params)
                for r in cur.fetchall():
                    ids = [r["id"]] + ([r["pid"]] if r.get("pid") else [])
                    findings.append((kind, r["geom"], ids, r["detail"]))
        cur.execute("""SELECT c.id, c.detail, ST_AsGeoJSON(fa.geom)::json AS geom, m.feature_a_id, m.feature_b_id
                       FROM conflicts c JOIN matches m ON m.id = c.match_id JOIN source_features fa ON fa.id = m.feature_a_id
                       WHERE c.ward_id=%s AND c.status IN ('pending','needs_review')
                         AND c.conflict_type IN ('attribute_mismatch','both')""", (ward,))
        for r in cur.fetchall():
            findings.append(("attribute_drift", r["geom"], [r["feature_a_id"], r["feature_b_id"]],
                             {"fields": (r["detail"] or {}).get("disagreeing_fields", []), "conflict_id": str(r["id"])}))

        n_struct = 0
        if struct:
            cur.execute("SELECT count(*) AS c FROM source_features WHERE source_id=%s", (struct,))
            n_struct = cur.fetchone()["c"]
        unreg = sum(1 for f in findings if f[0] == "unregistered_structure")
        sync_rate = 1 - unreg / n_struct if n_struct else 1.0
        ward_checks = [
            _check("source_quality", "Mean source quality", (sum(scores) / len(scores) / 100) if scores else 0, bool(scores) and min(scores) >= 70, 3,
                   f"{len(scores)} sources validated"),
            _check("registered_structures", "Structures registered in cadastre", sync_rate, sync_rate >= 0.95, 3,
                   f"{unreg} of {n_struct} structures unregistered" if n_struct else "no structure layer"),
            _check("encroachments", "No boundary encroachments", 1 / (1 + sum(1 for f in findings if f[0] == 'encroachment')),
                   not any(f[0] == "encroachment" for f in findings), 2, ""),
            _check("attribute_drift", "Attributes agree across departments", 1 / (1 + sum(1 for f in findings if f[0] == 'attribute_drift')),
                   not any(f[0] == "attribute_drift" for f in findings), 2, ""),
        ]
        ward_score = weighted_score(ward_checks)
        cur.execute("""INSERT INTO validation_reports (ward_id, source_id, score, checks) VALUES (%s, NULL, %s, %s)
                       RETURNING id""", (ward, ward_score, json.dumps(ward_checks)))
        report_id = cur.fetchone()["id"]
        cur.execute("DELETE FROM sync_findings WHERE ward_id=%s", (ward,))
        for kind, geom, ids, detail in findings:
            if not geom:
                continue
            cur.execute("""INSERT INTO sync_findings (ward_id, report_id, finding_type, geom, feature_ids, detail)
                           VALUES (%s,%s,%s, ST_SetSRID(ST_GeomFromGeoJSON(%s),4326), %s::uuid[], %s)""",
                        (ward, report_id, kind, json.dumps(geom), [str(i) for i in ids], json.dumps(detail, default=str)))
    counts = {}
    for f in findings:
        counts[f[0]] = counts.get(f[0], 0) + 1
    print(f"[validate] ward {ward}: score {ward_score}, {len(sources)} sources, findings {counts}")
    return {"ward_score": ward_score, "sources": len(sources), "findings": counts}
