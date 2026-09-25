"""Change detection between two survey epochs of structure footprints.

Baseline (e.g. 2023 building-footprint survey) vs current (e.g. 2025 AI extraction from ORI /
drone / DSM). Each current footprint is paired with the baseline footprint it overlaps most:

  new_structure       no baseline overlap (overlap ratio < min_overlap)
  extension/reduction matched, footprint area changed by more than area_change_pct
  vertical_extension  matched, height grew by more than height_change_m (when heights exist)
  demolished          baseline footprint with no current counterpart
"""
import json

from db import cursor

DEFAULTS = {"minOverlap": 0.2, "areaChangePct": 15.0, "heightChangeM": 2.5, "minAreaSqm": 10.0}


def _height(props):
    for k in ("height_m", "height", "bldg_height"):
        try:
            if props.get(k) is not None:
                return float(props[k])
        except (TypeError, ValueError):
            pass
    return None


def classify_changes(baseline, current, params=None):
    """baseline/current: [(id, shapely geometry in a METRIC CRS, props)] → list of change dicts."""
    p = {**DEFAULTS, **(params or {})}
    out = []
    used = set()
    for cid, cg, cprops in current:
        if cg.is_empty or cg.area < p["minAreaSqm"]:
            continue
        best, best_ratio = None, 0.0
        for bid, bg, bprops in baseline:
            if not cg.intersects(bg):
                continue
            inter = cg.intersection(bg).area
            ratio = inter / min(cg.area, bg.area) if min(cg.area, bg.area) else 0
            if ratio > best_ratio:
                best, best_ratio = (bid, bg, bprops), ratio
        src_conf = float(cprops.get("confidence", 0.85) or 0.85)
        if best is None or best_ratio < p["minOverlap"]:
            out.append({"change_type": "new_structure", "current_id": cid, "baseline_id": None,
                        "area_before": None, "area_after": cg.area, "height_before": None, "height_after": _height(cprops),
                        "confidence": round(min(0.99, src_conf * (1 - best_ratio)), 4)})
            continue
        bid, bg, bprops = best
        used.add(bid)
        delta_pct = 100 * (cg.area - bg.area) / bg.area
        hb, ha = _height(bprops), _height(cprops)
        common = {"current_id": cid, "baseline_id": bid, "area_before": bg.area, "area_after": cg.area,
                  "height_before": hb, "height_after": ha}
        if hb is not None and ha is not None and ha - hb > p["heightChangeM"]:
            out.append({**common, "change_type": "vertical_extension",
                        "confidence": round(min(0.99, src_conf * min(1.0, 0.6 + (ha - hb) / 15)), 4)})
        elif abs(delta_pct) > p["areaChangePct"]:
            out.append({**common, "change_type": "extension" if delta_pct > 0 else "reduction",
                        "confidence": round(min(0.99, src_conf * best_ratio * min(1.0, 0.6 + abs(delta_pct) / 100)), 4)})
    for bid, bg, bprops in baseline:
        if bid in used or bg.area < p["minAreaSqm"]:
            continue
        overlap = max((bg.intersection(cg).area / bg.area for _, cg, _ in current if bg.intersects(cg)), default=0)
        if overlap < p["minOverlap"]:
            out.append({"change_type": "demolished", "current_id": None, "baseline_id": bid,
                        "area_before": bg.area, "area_after": None, "height_before": _height(bprops), "height_after": None,
                        "confidence": round(0.8 * (1 - overlap), 4)})
    return out


def _load(cur, source_id):
    cur.execute("""SELECT id::text AS id, ST_AsGeoJSON(geom)::json AS geom, properties
                   FROM source_features WHERE source_id=%s AND ST_Dimension(geom) = 2""", (source_id,))
    return cur.fetchall()


def detect_changes(job):
    """job: {runId}"""
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform as shp_transform
    from spatial.topology_fabric import utm_srid
    run_id = job["runId"]
    with cursor() as cur:
        cur.execute("SELECT * FROM change_runs WHERE id=%s", (run_id,))
        run = cur.fetchone()
        cur.execute("UPDATE change_runs SET status='running' WHERE id=%s", (run_id,))
        base_rows, cur_rows = _load(cur, run["baseline_source_id"]), _load(cur, run["current_source_id"])
    try:
        rows = base_rows + cur_rows
        if not rows:
            raise ValueError("both sources are empty")
        first = shape(rows[0]["geom"]).centroid
        to_m = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_srid(first.x, first.y)}", always_xy=True).transform
        wgs = {r["id"]: r["geom"] for r in rows}
        conv = lambda rs: [(r["id"], shp_transform(to_m, shape(r["geom"])), r["properties"] or {}) for r in rs]  # noqa: E731
        changes = classify_changes(conv(base_rows), conv(cur_rows), run["params"])
        summary = {}
        with cursor() as cur:
            cur.execute("DELETE FROM change_detections WHERE run_id=%s", (run_id,))
            for c in changes:
                summary[c["change_type"]] = summary.get(c["change_type"], 0) + 1
                geom = wgs[c["current_id"] or c["baseline_id"]]
                before = wgs.get(c["baseline_id"]) if c["baseline_id"] else None
                cur.execute(
                    """INSERT INTO change_detections (run_id, ward_id, change_type, geom, geom_before, baseline_feature_id,
                           current_feature_id, area_before, area_after, height_before, height_after, confidence)
                       VALUES (%s,%s,%s, ST_SetSRID(ST_GeomFromGeoJSON(%s),4326),
                               CASE WHEN %s::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(%s),4326) END,
                               %s,%s,%s,%s,%s,%s,%s)""",
                    (run_id, run["ward_id"], c["change_type"], json.dumps(geom),
                     json.dumps(before) if before else None, json.dumps(before) if before else None,
                     c["baseline_id"], c["current_id"],
                     round(c["area_before"], 2) if c["area_before"] is not None else None,
                     round(c["area_after"], 2) if c["area_after"] is not None else None,
                     c["height_before"], c["height_after"], c["confidence"]))
            cur.execute("UPDATE change_runs SET status='done', summary=%s, finished_at=now() WHERE id=%s",
                        (json.dumps(summary), run_id))
        print(f"[changes] run {run_id}: {summary}")
        return {"changes": len(changes), "by_type": summary}
    except Exception as e:  # noqa: BLE001
        with cursor() as cur:
            cur.execute("UPDATE change_runs SET status='failed', error=%s, finished_at=now() WHERE id=%s", (str(e), run_id))
        raise
