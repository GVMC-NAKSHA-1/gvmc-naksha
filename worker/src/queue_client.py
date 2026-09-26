"""Job queue: enqueue follow-up jobs, plus the reliable-delivery primitives the worker loop uses.

Every job is also recorded in `pipeline_jobs` so the UI's pipeline-activity view sees chained
work (match → conflicts → assemble → validate) the same way it sees API-queued jobs.

Delivery is at-least-once:
- `reserve` moves a job atomically (BLMOVE) from the queue into this worker's processing list, so a
  worker killed mid-job leaves the job in Redis instead of losing it.
- Each worker keeps a heartbeat key alive; `recover_orphans` moves the processing list of a worker
  whose heartbeat expired back onto the queue.
- Failed jobs wait in a delayed ZSET with exponential back-off before `promote_due` re-queues them.
"""
import json
import os
import time
import uuid

import redis

from db import cursor

QUEUE = "queue:ingest"
DEAD = "queue:ingest:dead"
DELAYED = "queue:ingest:delayed"                # ZSET: raw job → epoch seconds it may run again
PROCESSING_PREFIX = "queue:ingest:processing:"  # + worker id → LIST of jobs that worker holds
HEARTBEAT_PREFIX = "worker:alive:"              # + worker id → key with a TTL
HEARTBEAT_TTL = 30
BACKOFF_BASE = float(os.environ.get("JOB_BACKOFF_SECONDS", "5"))
BACKOFF_MAX = 600
_r = None


def _redis():
    global _r
    if _r is None:
        _r = redis.from_url(os.environ["REDIS_URL"])
    return _r


def enqueue(job_type: str, **payload) -> str:
    job_id = str(uuid.uuid4())
    job = {"jobId": job_id, "jobType": job_type, **payload}
    with cursor() as cur:
        cur.execute(
            """INSERT INTO pipeline_jobs (id, job_type, ward_id, source_id, payload)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
            (job_id, job_type, payload.get("wardId"), payload.get("sourceId"), json.dumps(payload)),
        )
    _redis().lpush(QUEUE, json.dumps(job))
    return job_id


def _key(k):
    return k.decode() if isinstance(k, bytes) else k


def processing_key(worker_id: str) -> str:
    return PROCESSING_PREFIX + worker_id


def heartbeat(r, worker_id: str) -> None:
    r.set(HEARTBEAT_PREFIX + worker_id, "1", ex=HEARTBEAT_TTL)


def reserve(r, worker_id: str, timeout: int = 5):
    """Blocks up to `timeout` s; returns the raw job, now held in this worker's processing list."""
    return r.blmove(QUEUE, processing_key(worker_id), timeout, "RIGHT", "LEFT")


def ack(r, worker_id: str, raw) -> None:
    """The job is finished (done, failed, or re-scheduled) — drop it from the processing list."""
    r.lrem(processing_key(worker_id), 1, raw)


def backoff_seconds(attempts: int) -> float:
    return min(BACKOFF_BASE * 2 ** max(attempts - 1, 0), BACKOFF_MAX)


def retry_later(r, job: dict, attempts: int, now: float | None = None) -> float:
    delay = backoff_seconds(attempts)
    r.zadd(DELAYED, {json.dumps(job): (now if now is not None else time.time()) + delay})
    return delay


def promote_due(r, now: float | None = None) -> int:
    """Moves delayed jobs whose back-off has elapsed onto the queue. Safe with many workers:
    only the one whose ZREM succeeds re-queues a given job."""
    moved = 0
    for raw in r.zrangebyscore(DELAYED, 0, now if now is not None else time.time()):
        if r.zrem(DELAYED, raw):
            r.lpush(QUEUE, raw)
            moved += 1
    return moved


def recover_orphans(r) -> list:
    """Re-queues the jobs held by workers whose heartbeat expired; returns the raw jobs moved.
    They go to the consuming end of the queue, oldest first, since they were started first."""
    recovered = []
    for key in r.scan_iter(match=PROCESSING_PREFIX + "*"):
        worker_id = _key(key)[len(PROCESSING_PREFIX):]
        if r.exists(HEARTBEAT_PREFIX + worker_id):
            continue
        while (raw := r.lmove(key, QUEUE, "LEFT", "RIGHT")) is not None:
            recovered.append(raw)
    return recovered


def held_job_ids(r) -> set:
    """jobIds currently in any worker's processing list (i.e. legitimately running)."""
    ids = set()
    for key in r.scan_iter(match=PROCESSING_PREFIX + "*"):
        for raw in r.lrange(key, 0, -1):
            try:
                ids.add(json.loads(raw).get("jobId"))
            except (ValueError, AttributeError):
                pass
    ids.discard(None)
    return ids
