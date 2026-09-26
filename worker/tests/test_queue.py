import json

import fakeredis
import pytest

import queue_client as qc


@pytest.fixture
def r():
    return fakeredis.FakeRedis()


def _push(r, job_id):
    r.lpush(qc.QUEUE, json.dumps({"jobId": job_id, "jobType": "HARMONIZE_WARD"}))


def test_reserve_holds_job_until_ack(r):
    _push(r, "a")
    raw = qc.reserve(r, "w1", timeout=1)
    assert json.loads(raw)["jobId"] == "a"
    assert r.llen(qc.QUEUE) == 0
    assert qc.held_job_ids(r) == {"a"}
    qc.ack(r, "w1", raw)
    assert r.llen(qc.processing_key("w1")) == 0
    assert qc.held_job_ids(r) == set()


def test_reserve_is_fifo(r):
    for i in ("a", "b", "c"):
        _push(r, i)
    got = [json.loads(qc.reserve(r, "w1", timeout=1))["jobId"] for _ in range(3)]
    assert got == ["a", "b", "c"]


def test_dead_worker_jobs_are_requeued_oldest_first(r):
    for i in ("a", "b"):
        _push(r, i)
    qc.reserve(r, "dead", timeout=1)
    qc.reserve(r, "dead", timeout=1)          # dead worker held a, b and never sent a heartbeat
    _push(r, "c")
    qc.heartbeat(r, "alive")
    qc.reserve(r, "alive", timeout=1)          # alive worker takes c and is still running it

    recovered = qc.recover_orphans(r)
    assert sorted(json.loads(x)["jobId"] for x in recovered) == ["a", "b"]
    assert qc.held_job_ids(r) == {"c"}         # the live worker's job is untouched
    nxt = [json.loads(qc.reserve(r, "alive", timeout=1))["jobId"] for _ in range(2)]
    assert nxt == ["a", "b"]


def test_live_worker_is_not_reaped(r):
    _push(r, "a")
    qc.heartbeat(r, "w1")
    qc.reserve(r, "w1", timeout=1)
    assert qc.recover_orphans(r) == []
    assert qc.held_job_ids(r) == {"a"}


def test_backoff_is_exponential_and_capped():
    assert [qc.backoff_seconds(n) for n in (1, 2, 3)] == [qc.BACKOFF_BASE, qc.BACKOFF_BASE * 2, qc.BACKOFF_BASE * 4]
    assert qc.backoff_seconds(50) == qc.BACKOFF_MAX


def test_retry_waits_for_backoff_then_promotes(r):
    delay = qc.retry_later(r, {"jobId": "a", "jobType": "X"}, attempts=2, now=1000)
    assert qc.promote_due(r, now=1000 + delay - 1) == 0
    assert r.llen(qc.QUEUE) == 0
    assert qc.promote_due(r, now=1000 + delay) == 1
    assert r.zcard(qc.DELAYED) == 0
    assert json.loads(qc.reserve(r, "w1", timeout=1))["jobId"] == "a"
    assert qc.promote_due(r, now=1e12) == 0    # promoted exactly once
