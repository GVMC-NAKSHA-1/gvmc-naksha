import json, os, socket, threading, time, traceback, uuid
import redis
from db import cursor
import queue_client as qc
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
MAX_ATTEMPTS = 3
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
REAP_EVERY = 30          # seconds between orphan / stale-row sweeps
STALE_GRACE_MIN = 10     # a 'running' row this old that no worker holds was lost
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


def _heartbeat_forever():
    # A thread, so the heartbeat stays alive while a long job (extraction, OCR) runs.
    while True:
        try:
            qc.heartbeat(r, WORKER_ID)
        except Exception:  # noqa: BLE001 — Redis blip; the next beat retries
            traceback.print_exc()
        time.sleep(qc.HEARTBEAT_TTL / 3)


def _reap():
    """Re-queue jobs of dead workers, and fail pipeline_jobs rows that no worker holds any more
    (e.g. lost by a pre-BLMOVE worker) so the UI does not show them 'running' forever."""
    for raw in qc.recover_orphans(r):
        try:
            _track(json.loads(raw), "queued", error="re-queued: worker stopped mid-job")
        except ValueError:
            pass
    try:
        held = list(qc.held_job_ids(r))
        with cursor() as cur:
            cur.execute("""UPDATE pipeline_jobs SET status='failed', finished_at=now(),
                                  error='lost: worker stopped mid-job and the job was not recoverable'
                           WHERE status='running' AND started_at < now() - make_interval(mins => %s)
                             AND NOT (id::text = ANY(%s))""", (STALE_GRACE_MIN, held))
    except Exception:  # noqa: BLE001
        traceback.print_exc()


def _process(raw):
    try:
        job = json.loads(raw)
    except ValueError:
        print("[worker] unparseable job, moved to dead-letter")
        r.lpush(qc.DEAD, raw)
        return
    handler = HANDLERS.get(job.get("jobType"))
    if not handler:
        print("[worker] unknown jobType", job.get("jobType"))
        _track(job, "failed", error=f"unknown jobType {job.get('jobType')}")
        return
    if _superseded(job):
        _track(job, "done", result={"skipped": "superseded by a newer queued job for this ward"})
        return
    _track(job, "running")
    try:
        result = handler(job)
        _track(job, "done", result=result if isinstance(result, dict) else None)
        print("[worker] done", job["jobType"], job.get("jobId"))
    except Exception as e:                                   # noqa: BLE001
        traceback.print_exc()
        job["error"], job["attempts"] = str(e), job.get("attempts", 0) + 1
        if job["attempts"] < MAX_ATTEMPTS:
            delay = qc.retry_later(r, job, job["attempts"])
            _track(job, "queued", error=f"{e} (retry in {delay:.0f}s)")
        else:
            _track(job, "failed", error=str(e))
            r.lpush(qc.DEAD, json.dumps(job))


def run():
    print("[worker]", WORKER_ID, "up, waiting on", qc.QUEUE)
    qc.heartbeat(r, WORKER_ID)
    threading.Thread(target=_heartbeat_forever, daemon=True).start()
    last_reap = 0.0
    while True:
        if time.monotonic() - last_reap >= REAP_EVERY:
            _reap()
            last_reap = time.monotonic()
        qc.promote_due(r)
        raw = qc.reserve(r, WORKER_ID, timeout=5)
        if raw is None:
            continue
        try:
            _process(raw)
        finally:
            # Only after the outcome is recorded (done / failed / scheduled for retry). If the
            # process dies before this line, the job stays held and recover_orphans re-queues it.
            qc.ack(r, WORKER_ID, raw)


if __name__ == "__main__":
    run()
