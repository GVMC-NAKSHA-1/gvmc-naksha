"""Enqueue follow-up jobs from inside the worker.

Every job is also recorded in `pipeline_jobs` so the UI's pipeline-activity view sees chained
work (match → conflicts → assemble → validate) the same way it sees API-queued jobs.
"""
import json
import os
import uuid

import redis

from db import cursor

QUEUE = "queue:ingest"
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
