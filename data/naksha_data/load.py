"""Load wards and per-ward datasets into a running NAKSHA stack.

Files go through the public API exactly as an officer's upload does (register → presigned PUT →
complete), so the pipeline processes them the same way. The API has no ward-admin endpoint, so ward
rows and their outline files are written to the database and object storage directly.

Works for the open-data pack and for department data laid out the same way:
    <dir>/ward-<id>/manifest.json   + the files it lists   (see data/README.md)
"""
import json
import os
import time

import urllib.error
import urllib.parse
import urllib.request

import psycopg2
import psycopg2.extras

from .common import DATASET, OUT, read_json

API = os.environ.get("API_URL", "http://api:3000").rstrip("/") + "/api"
TOKEN = os.environ.get("API_TOKEN")                    # Supabase JWT when the API runs with auth on
DB = os.environ.get("DATABASE_URL", "postgres://gvmc:dev@db:5432/gvmcdb")
DONE = ("ready", "needs_georef", "pending_ocr", "processing")


def _headers(extra=None):
    h = {"Authorization": f"Bearer {TOKEN}"} if TOKEN else {"x-dev-role": "admin"}
    return {**h, **(extra or {})}


def _http(method, url, data=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _storage_target(url):
    """Presigned URLs are signed for the browser-facing endpoint (R2_PUBLIC_ENDPOINT, e.g.
    http://localhost:9000). Inside the compose network that host is unreachable, so send the request
    to STORAGE_INTERNAL_ENDPOINT (http://minio:9000) while keeping the signed Host header."""
    public, internal = os.environ.get("R2_PUBLIC_ENDPOINT", "").rstrip("/"), os.environ.get("STORAGE_INTERNAL_ENDPOINT", "").rstrip("/")
    if public and internal and url.startswith(public + "/"):
        return internal + url[len(public):], {"Host": urllib.parse.urlsplit(public).netloc}
    return url, {}


def api(method, p, body=None):
    data = json.dumps(body).encode() if body is not None else None
    code, raw = _http(method, API + p, data, _headers({"Content-Type": "application/json"} if data else None))
    if code >= 400:
        raise RuntimeError(f"{method} {p} → HTTP {code}: {raw[:300].decode(errors='replace')}")
    return json.loads(raw) if raw else None


def db():
    return psycopg2.connect(DB, cursor_factory=psycopg2.extras.RealDictCursor)


# ── wards ────────────────────────────────────────────────────────────────────
def load_wards(wards_file, drop_demo=False):
    import boto3
    from botocore.config import Config
    fc = read_json(wards_file)
    ep = os.environ.get("R2_ENDPOINT") or f"https://{os.environ.get('R2_ACCOUNT_ID', 'unset')}.r2.cloudflarestorage.com"
    s3 = boto3.client("s3", region_name="auto", endpoint_url=ep,
                      aws_access_key_id=os.environ.get("R2_ACCESS_KEY_ID"), aws_secret_access_key=os.environ.get("R2_SECRET_ACCESS_KEY"),
                      config=Config(s3={"addressing_style": "path"} if os.environ.get("R2_ENDPOINT") else {}))
    bucket = os.environ.get("R2_BUCKET_NAME", "gvmc-data")
    with db() as conn, conn.cursor() as cur:
        for f in fc["features"]:
            wid, name = str(f["properties"]["id"]), f["properties"]["name"]
            key = f"geojson/ward-{wid}.json"
            s3.put_object(Bucket=bucket, Key=key, ContentType="application/geo+json",
                          Body=json.dumps({"type": "FeatureCollection", "features": [f]}).encode())
            cur.execute("""
                INSERT INTO wards (id, name, bbox_north, bbox_south, bbox_east, bbox_west, geojson_r2, boundary)
                SELECT %(id)s, %(name)s, ST_YMax(g), ST_YMin(g), ST_XMax(g), ST_XMin(g), %(key)s, g
                FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326)), 3)) AS g) s
                ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, bbox_north = EXCLUDED.bbox_north,
                  bbox_south = EXCLUDED.bbox_south, bbox_east = EXCLUDED.bbox_east, bbox_west = EXCLUDED.bbox_west,
                  geojson_r2 = EXCLUDED.geojson_r2, boundary = EXCLUDED.boundary""",
                        {"id": wid, "name": name, "key": key, "geom": json.dumps(f["geometry"])})
        # Satellite (NDBI) alerts belong to whichever ward now contains them.
        cur.execute("""
            UPDATE properties p SET ward_id = (
              SELECT w.id FROM wards w WHERE w.boundary IS NOT NULL
              ORDER BY w.boundary <-> ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326) LIMIT 1)""")
        rehomed = cur.rowcount
        dropped = 0
        if drop_demo:
            cur.execute("""DELETE FROM data_sources WHERE metadata->>'demo' = 'true' OR r2_key LIKE 'demo/%%'""")
            dropped = cur.rowcount
        ids = [str(f["properties"]["id"]) for f in fc["features"]]
        cur.execute("SELECT id FROM wards WHERE NOT (id = ANY(%s))", (ids,))
        extra = [r["id"] for r in cur.fetchall()]
    print(f"[load] {len(fc['features'])} wards upserted, {rehomed} alerts re-homed, {dropped} demo sources dropped")
    if extra:
        print(f"[load] note: wards {extra} exist in the database but not in {os.path.basename(wards_file)}")


# ── files ────────────────────────────────────────────────────────────────────
def _existing(ward_id):
    return {s["original_name"]: s for s in api("GET", f"/sources?wardId={ward_id}") or []}


def upload(ward_id, entry, folder):
    fp = os.path.join(folder, entry["path"])
    name = f"w{ward_id}_{entry['path']}"
    body = {"type": entry["type"], "wardId": ward_id, "originalName": name}
    for k_in, k_api in (("crs", "crs"), ("captured_at", "capturedAt"), ("scanned", "scanned")):
        if entry.get(k_in) not in (None, ""):
            body[k_api] = entry[k_in]
    if body.get("scanned"):
        body.pop("crs", None)
    reg = api("POST", "/sources/upload", body)
    with open(fp, "rb") as f:
        target, host = _storage_target(reg["uploadUrl"])
        code, raw = _http("PUT", target, f.read(), {"Content-Type": reg["contentType"], **host}, timeout=900)
    if code >= 300:
        raise RuntimeError(f"storage PUT {name} → HTTP {code}: {raw[:200].decode(errors='replace')}")
    meta = {"dataset": entry.get("dataset", DATASET), "synthetic": bool(entry.get("synthetic", False)),
            "description": entry.get("description")}
    with db() as conn, conn.cursor() as cur:
        cur.execute("UPDATE data_sources SET metadata = metadata || %s::jsonb WHERE id = %s", (json.dumps(meta), reg["sourceId"]))
    api("POST", f"/sources/{reg['sourceId']}/complete")
    if body.get("scanned") and entry["type"] == "revenue":
        api("POST", f"/sources/{reg['sourceId']}/digitize")
    return reg["sourceId"]


def load_dir(root=OUT, wards=None):
    dirs = sorted((d for d in os.listdir(root) if d.startswith("ward-") and os.path.isdir(os.path.join(root, d))),
                  key=lambda d: (len(d), d))
    total = 0
    for d in dirs:
        man = read_json(os.path.join(root, d, "manifest.json"))
        wid = str(man["ward_id"])
        if wards and wid not in wards:
            continue
        have = _existing(wid)
        for entry in man["files"]:
            name = f"w{wid}_{entry['path']}"
            if name in have and have[name]["status"] in DONE:
                continue
            sid = upload(wid, entry, os.path.join(root, d))
            total += 1
            print(f"[load] ward {wid}: {entry['type']:<18} {entry['path']:<28} → {sid}")
    print(f"[load] {total} files uploaded")
    return total


# ── waiting and the final per-ward steps ─────────────────────────────────────
def job_counts():
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT status, count(*) AS n FROM pipeline_jobs GROUP BY status")
        return {r["status"]: r["n"] for r in cur.fetchall()}


def wait(poll=15, quiet_rounds=2):
    """Until nothing is queued or running for `quiet_rounds` polls in a row."""
    quiet, t0 = 0, time.time()
    while quiet < quiet_rounds:
        c = job_counts()
        busy = c.get("queued", 0) + c.get("running", 0)
        quiet = quiet + 1 if busy == 0 else 0
        print(f"[wait] {int(time.time() - t0)}s  queued={c.get('queued', 0)} running={c.get('running', 0)} "
              f"done={c.get('done', 0)} failed={c.get('failed', 0)}", flush=True)
        if quiet < quiet_rounds:
            time.sleep(poll)


def finish(wards=None):
    """Change detection per ward: 2023 survey footprints vs the AI layer extracted from the 2025 DSM."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("""SELECT ward_id, type, id, captured_at FROM data_sources
                       WHERE status = 'ready' AND type IN ('building_footprint', 'ai_extracted')
                       ORDER BY ward_id, captured_at DESC NULLS LAST, created_at DESC""")
        latest = {}
        for r in cur.fetchall():
            latest.setdefault((r["ward_id"], r["type"]), r["id"])
        cur.execute("SELECT DISTINCT ward_id FROM change_runs")
        already = {r["ward_id"] for r in cur.fetchall()}
    runs = 0
    for (wid, typ), sid in sorted(latest.items()):
        if typ != "building_footprint" or (wards and wid not in wards) or wid in already:
            continue
        ai = latest.get((wid, "ai_extracted"))
        if ai:
            api("POST", "/changes/run", {"wardId": wid, "baselineSourceId": str(sid), "currentSourceId": str(ai)})
            runs += 1
    print(f"[finish] {runs} change-detection runs queued")


def status():
    with db() as conn, conn.cursor() as cur:
        cur.execute("""SELECT status, count(*) AS n FROM data_sources GROUP BY status ORDER BY 1""")
        print("[status] sources:", {r["status"]: r["n"] for r in cur.fetchall()})
        print("[status] jobs:", job_counts())
        cur.execute("""SELECT job_type, left(error, 160) AS error, count(*) AS n FROM pipeline_jobs WHERE status = 'failed'
                       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15""")
        for r in cur.fetchall():
            print(f"[status] failed {r['n']:>4} × {r['job_type']}: {r['error']}")
        cur.execute("""SELECT (SELECT count(*) FROM wards) AS wards, (SELECT count(*) FROM source_features) AS features,
                              (SELECT count(*) FROM matches) AS matches, (SELECT count(*) FROM conflicts) AS conflicts,
                              (SELECT count(*) FROM harmonized_parcels) AS golden, (SELECT count(*) FROM topology_issues) AS topology,
                              (SELECT count(*) FROM change_detections) AS changes, (SELECT count(*) FROM sync_findings) AS findings""")
        print("[status] totals:", dict(cur.fetchone()))


def score(root=OUT, wards=None):
    """Recall of injected topology defects and of generated changes, from answers.json."""
    topo_hit = topo_all = 0
    by_type = {}
    ch = {"truth": 0, "found": 0}
    with db() as conn, conn.cursor() as cur:
        for d in sorted(os.listdir(root)):
            fp = os.path.join(root, d, "answers.json")
            if not d.startswith("ward-") or not os.path.exists(fp):
                continue
            ans = read_json(fp)
            wid = str(ans["ward_id"])
            if wards and wid not in wards:
                continue
            cur.execute("""SELECT sf.properties->>'parcel_id' AS pid, ti.issue_type
                           FROM topology_issues ti JOIN data_sources ds ON ds.id = ti.source_id AND ds.type = 'cadastral'
                           JOIN source_features sf ON sf.id = ANY(ti.feature_ids)
                           WHERE ds.ward_id = %s""", (wid,))
            found = {(r["pid"], r["issue_type"]) for r in cur.fetchall()}
            for t in ans["topology_defects"]:
                kinds = {"gap": ("gap", "sliver"), "sliver": ("sliver", "gap")}.get(t["defect"], (t["defect"],))
                ok = any((t["parcel_id"], k) in found for k in kinds)
                s = by_type.setdefault(t["defect"], [0, 0])
                s[0] += ok
                s[1] += 1
                topo_hit += ok
                topo_all += 1
            cur.execute("""SELECT cd.change_type, bf.properties->>'bldg_id' AS bid, ST_X(ST_Centroid(cd.geom)) AS x, ST_Y(ST_Centroid(cd.geom)) AS y
                           FROM change_detections cd LEFT JOIN source_features bf ON bf.id = cd.baseline_feature_id
                           WHERE cd.ward_id = %s""", (wid,))
            det = cur.fetchall()
            for c in ans["changes"]:
                ch["truth"] += 1
                if "bldg_id" in c:
                    ch["found"] += any(x["bid"] == c["bldg_id"] and x["change_type"] == c["change"] for x in det)
                else:
                    cx, cy = c["centroid"]
                    ch["found"] += any(x["change_type"] == "new_structure" and abs(x["x"] - cx) < 8e-5 and abs(x["y"] - cy) < 8e-5
                                       for x in det)
    rep = {"topology_recall": round(topo_hit / topo_all, 3) if topo_all else None,
           "topology_by_type": {k: f"{v[0]}/{v[1]}" for k, v in by_type.items()},
           "change_recall": round(ch["found"] / ch["truth"], 3) if ch["truth"] else None, "changes": ch}
    print("[score]", json.dumps(rep))
    return rep
