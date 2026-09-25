import json, os, traceback
import redis
from db import cursor
from ingest.adapters import normalize_source
from ocr.digitize import digitize
from harmonize.match import match_ward
from harmonize.conflicts import detect_conflicts
from harmonize.schema_map import run_schema_map
from harmonize.assemble import assemble_ward, export_harmonized
from extract.footprints import extract_features
from spatial.topology_fabric import fix_topology
from georef.gcp import georeference
from change.epochs import detect_changes
from validate.report import validate_ward

# None of these modules build a Groq client or load a model at import time — schema_map.py and
# assemble.py read GROQ_API_KEY lazily, extract/footprints.py loads the ONNX model only when a job
# asks for it — so the worker starts with only DATABASE_URL / REDIS_URL / R2_* set.
HANDLERS = {
    "NORMALIZE_SOURCE":  normalize_source,     # ETL: read → reproject → repair → store
    "DIGITIZE_SOURCE":   digitize,             # OCR of scanned revenue records
    "SCHEMA_MAP":        run_schema_map,       # intelligent attribute mapping
    "HARMONIZE_WARD":    match_ward,           # AI/ML spatial matching + confidence
    "DETECT_CONFLICTS":  detect_conflicts,     # spatial conflict framework
    "ASSEMBLE_WARD":     assemble_ward,        # golden record
    "EXPORT_HARMONIZED": export_harmonized,    # GeoPackage export
    "EXTRACT_FEATURES":  extract_features,     # GeoAI building-footprint extraction
    "FIX_TOPOLOGY":      fix_topology,         # parcel-fabric topology correction
    "GEOREFERENCE":      georeference,         # GCP geo-referencing of scans
    "DETECT_CHANGES":    detect_changes,       # multi-epoch change detection
    "VALIDATE_WARD":     validate_ward,        # data-quality + AI↔cadastre synchronisation
}

r = redis.from_url(os.environ["REDIS_URL"])
QUEUE, DEAD = "queue:ingest", "queue:ingest:dead"
MAX_ATTEMPTS = 3
# Ward-level jobs recompute the whole ward, so when a newer one for the same ward is already queued
# the older one is redundant (every upload queues HARMONIZE_WARD; a bulk load queues many per ward).
# The queue is FIFO, so the newer job still runs after this one would have.
COALESCE = ("HARMONIZE_WARD", "DETECT_CONFLICTS", "ASSEMBLE_WARD", "VALIDATE_WARD")


def _superseded(job):
    if job.get("jobType") not in COALESCE or not job.get("jobId") or not job.get("wardId"):
        return False
    try:
        with cursor() as cur:
            cur.execute("""SELECT 1 FROM pipeline_jobs me JOIN pipeline_jobs n
                             ON n.job_type = me.job_type AND n.ward_id = me.ward_id
                            AND n.status = 'queued' AND n.created_at > me.created_at AND n.id <> me.id
                           WHERE me.id = %s LIMIT 1""", (job["jobId"],))
            return cur.fetchone() is not None
    except Exception:  # noqa: BLE001 — when in doubt, run the job
        traceback.print_exc()
        return False


def _track(job, status, result=None, error=None):
    """Mirror the job's lifecycle into pipeline_jobs (rows are created by whoever enqueued it)."""
    job_id = job.get("jobId")
    if not job_id:
        return
    try:
        with cursor() as cur:
            cur.execute(
                """INSERT INTO pipeline_jobs (id, job_type, ward_id, source_id, payload)
                   VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                (job_id, job.get("jobType"), job.get("wardId"), job.get("sourceId"), json.dumps(job)))
            if status == "running":
                cur.execute("""UPDATE pipeline_jobs SET status='running', started_at=now(), attempts=attempts+1
                               WHERE id=%s""", (job_id,))
            else:
                cur.execute("""UPDATE pipeline_jobs SET status=%s, result=%s, error=%s,
                                      finished_at=CASE WHEN %s IN ('done','failed') THEN now() END
                               WHERE id=%s""",
                            (status, json.dumps(result, default=str) if result is not None else None, error, status, job_id))
    except Exception:  # noqa: BLE001 — tracking must never break the job itself
        traceback.print_exc()


def run():
    print("[worker] up, waiting on", QUEUE)
    while True:
        item = r.brpop(QUEUE, timeout=5)
        if not item:
            continue
        job = json.loads(item[1])
        handler = HANDLERS.get(job.get("jobType"))
        if not handler:
            print("[worker] unknown jobType", job.get("jobType"))
            _track(job, "failed", error=f"unknown jobType {job.get('jobType')}")
            continue
        if _superseded(job):
            _track(job, "done", result={"skipped": "superseded by a newer queued job for this ward"})
            continue
        _track(job, "running")
        try:
            result = handler(job)
            _track(job, "done", result=result if isinstance(result, dict) else None)
            print("[worker] done", job["jobType"], job.get("jobId"))
        except Exception as e:                                   # noqa: BLE001
            traceback.print_exc()
            job["error"], job["attempts"] = str(e), job.get("attempts", 0) + 1
            if job["attempts"] < MAX_ATTEMPTS:
                _track(job, "queued", error=str(e))
                r.lpush(QUEUE, json.dumps(job))
            else:
                _track(job, "failed", error=str(e))
                r.lpush(DEAD, json.dumps(job))


if __name__ == "__main__":
    run()
