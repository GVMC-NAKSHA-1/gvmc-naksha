"""B.10 — golden record assembly + cadastre export.

assemble_ward   clusters the ward's `matches` into connected components (union-find over
                feature_a_id / feature_b_id), then writes one `harmonized_parcels` row per
                cluster: geometry from the highest-SOURCE_RELIABILITY polygonal member,
                attributes merged field-by-field (most-reliable source wins; `schema_mappings`
                renames B's fields onto A's canonical names), provenance + confidence +
                unresolved-conflict count. A full re-assemble is idempotent (deletes the
                ward's rows first).

export_harmonized  reads `harmonized_parcels` for the ward and writes a GeoPackage via fiona,
                uploads it to R2, and marks the `harmonized_exports` row `ready`.
"""
import json
import tempfile

from db import cursor, ward_lock
from r2 import upload
from queue_client import enqueue

from harmonize.scoring import SOURCE_RELIABILITY  # noqa: E402 — single source of truth


class _UF:
    def __init__(self):
        self.p = {}

    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        self.p[self.find(a)] = self.find(b)


def assemble_ward(job):
    ward = job["wardId"]
    with cursor() as cur:
        ward_lock(cur, ward)
        cur.execute(
            "SELECT id, feature_a_id, feature_b_id, match_score FROM matches WHERE ward_id = %s",
            (ward,),
        )
        matches = cur.fetchall()
        cur.execute(
            """SELECT sm.field_a, sm.field_b FROM schema_mappings sm
               JOIN data_sources da ON da.id = sm.source_a_id
               WHERE da.ward_id = %s AND COALESCE(sm.approved, true)""",
            (ward,),
        )
        rename = {r["field_b"]: r["field_a"] for r in cur.fetchall()}  # B's field -> A's canonical name

        uf = _UF()
        for m in matches:
            uf.union(m["feature_a_id"], m["feature_b_id"])
        clusters = {}
        for m in matches:
            root = uf.find(m["feature_a_id"])
            c = clusters.setdefault(root, {"features": set(), "matches": [], "scores": []})
            c["features"].update([m["feature_a_id"], m["feature_b_id"]])
            c["matches"].append(m["id"])
            c["scores"].append(float(m["match_score"]))

        cur.execute("DELETE FROM harmonized_parcels WHERE ward_id = %s", (ward,))
        made = 0
        for c in clusters.values():
            fids = list(c["features"])
            cur.execute(
                """SELECT sf.id::text AS id, sf.source_id::text AS source_id, ds.type,
                          ST_GeometryType(sf.geom) AS gtype,
                          ST_AsGeoJSON(ST_Multi(sf.geom))::json AS geojson, sf.properties
                   FROM source_features sf JOIN data_sources ds ON ds.id = sf.source_id
                   WHERE sf.id = ANY(%s::uuid[])""",
                (fids,),
            )
            members = sorted(
                cur.fetchall(),
                key=lambda r: SOURCE_RELIABILITY.get(r["type"], 0.5),
                reverse=True,
            )
            poly = next((r for r in members if "Polygon" in (r["gtype"] or "")), None)
            if not poly:
                continue  # no polygonal member -> skip (future: hull / point parcels)

            attrs, prov = {}, {}
            for r in members:  # most-reliable first
                for k, v in (r["properties"] or {}).items():
                    key = rename.get(k, k)
                    if key not in attrs and v not in (None, ""):
                        attrs[key] = v
                        prov[key] = r["type"]

            cur.execute(
                "SELECT count(*) AS n FROM conflicts WHERE match_id = ANY(%s::uuid[]) AND status <> 'resolved'",
                (c["matches"],),
            )
            conflict_count = cur.fetchone()["n"]
            confidence = (
                round(sum(c["scores"]) / len(c["scores"]) / 100, 4) if c["scores"] else None
            )

            cur.execute(
                """INSERT INTO harmonized_parcels
                     (ward_id, geom, geom_source_id, geom_source_type, attributes,
                      attribute_provenance, member_feature_ids, match_ids, confidence, conflict_count)
                   VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s::uuid, %s, %s, %s,
                           %s::uuid[], %s::uuid[], %s, %s)""",
                (ward, json.dumps(poly["geojson"]), poly["source_id"], poly["type"],
                 json.dumps(attrs), json.dumps(prov), fids, c["matches"], confidence, conflict_count),
            )
            made += 1
    print(f"[assemble] ward {ward}: {made} harmonized parcels")
    # Close the loop: re-validate the ward against the new golden records.
    enqueue("VALIDATE_WARD", wardId=ward)
    return {"harmonized_parcels": made}


def export_harmonized(job):
    import fiona

    ward, export_id = job["wardId"], job["exportId"]
    try:
        with cursor() as cur:
            cur.execute(
                """SELECT id, ST_AsGeoJSON(geom)::json AS geom, attributes, confidence
                   FROM harmonized_parcels WHERE ward_id = %s""",
                (ward,),
            )
            rows = cur.fetchall()
        keys = sorted({k for r in rows for k in (r["attributes"] or {})})
        schema = {
            "geometry": "MultiPolygon",
            "properties": {**{k: "str" for k in keys}, "hp_id": "str", "confidence": "float"},
        }
        key = f"exports/harmonized/{ward}_{export_id}.gpkg"
        # Fiona refuses to write over an existing file, so the path must not exist yet (no mkstemp).
        with tempfile.TemporaryDirectory() as tmp:
            path = f"{tmp}/harmonized_{ward}.gpkg"
            with fiona.open(path, "w", driver="GPKG", crs="EPSG:4326", schema=schema) as dst:
                for r in rows:
                    dst.write({
                        "geometry": r["geom"],
                        "properties": {
                            **{k: str((r["attributes"] or {}).get(k, "")) for k in keys},
                            "hp_id": str(r["id"]),
                            "confidence": float(r["confidence"] or 0.0),
                        },
                    })
            upload(path, key, "application/geopackage+sqlite3")
        with cursor() as cur:
            cur.execute(
                "UPDATE harmonized_exports SET status='ready', r2_key=%s, feature_count=%s WHERE id=%s",
                (key, len(rows), export_id),
            )
        print(f"[export] ward {ward}: {len(rows)} parcels -> {key}")
        return {"parcels": len(rows), "key": key}
    except Exception as e:  # noqa: BLE001
        with cursor() as cur:
            cur.execute(
                "UPDATE harmonized_exports SET status='failed', error=%s WHERE id=%s",
                (str(e), export_id),
            )
        raise
