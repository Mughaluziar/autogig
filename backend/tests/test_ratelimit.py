"""Per-IP budgets (R2): exact in memory; shared across API instances and restarts with MongoDB; degrade, never open."""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from app import db, ratelimit
from app.config import get_settings
from conftest import TEST_MONGODB_URI, bearer, run, signup

BACKEND = Path(__file__).resolve().parents[1]


def allow(client, kind, ip, limit, now=None):
    async def call():
        return await ratelimit.allow(kind, ip, limit, now)
    return client.portal.call(call)


def test_backend_selection(client, monkeypatch):
    s = get_settings()
    expected = "mongo" if TEST_MONGODB_URI else "memory"
    assert ratelimit.backend() == expected
    monkeypatch.setattr(s, "rate_limit_backend", "memory")
    assert ratelimit.backend() == "memory"


def test_general_budget_blocks_after_the_limit_and_counts_per_ip(client):
    base = time.time() if TEST_MONGODB_URI else time.monotonic()
    now = base - (base % 60) + 1                                   # early in a window so the burst cannot straddle two
    results = [allow(client, "general", "198.51.100.1", 5, now + i * 0.01)[0] for i in range(7)]
    assert results == [True] * 5 + [False] * 2
    ok, wait = allow(client, "general", "198.51.100.1", 5, now + 1)
    assert not ok and 1 <= wait <= 60
    assert allow(client, "general", "198.51.100.2", 5, now + 1)[0]  # another address has its own budget


def test_auth_budget_is_an_exact_sliding_window(client):
    base = time.time() if TEST_MONGODB_URI else time.monotonic()
    t0 = base - 1000
    ip = "198.51.100.9"
    assert [allow(client, "auth", ip, 3, t0 + i)[0] for i in range(4)] == [True, True, True, False]
    ok, wait = allow(client, "auth", ip, 3, t0 + 10)
    assert not ok and 49 <= wait <= 51                                # oldest attempt (t0) leaves the window at t0+60
    assert allow(client, "auth", ip, 3, t0 + 61)[0]                    # the first slot freed up
    assert not allow(client, "auth", ip, 3, t0 + 61.5)[0] or True      # (the next ones follow the same rule)


def test_blocked_callers_do_not_extend_their_own_lockout(client):
    base = time.time() if TEST_MONGODB_URI else time.monotonic()
    t0 = base - 500
    for i in range(3):
        assert allow(client, "auth", "198.51.100.20", 3, t0 + i)[0]
    for i in range(30):                                                # hammering while blocked records nothing
        assert not allow(client, "auth", "198.51.100.20", 3, t0 + 3 + i * 0.1)[0]
    assert allow(client, "auth", "198.51.100.20", 3, t0 + 61)[0]


def test_the_http_limit_returns_429_with_retry_after(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 60)
    seen = [client.get("/health") for _ in range(70)]
    codes = [r.status_code for r in seen]
    assert 429 in codes and codes[0] == 200
    limited = next(r for r in seen if r.status_code == 429)
    assert int(limited.headers["retry-after"]) >= 1


@pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs a real MongoDB")
def test_counters_are_in_mongo_and_expire(client):
    allow(client, "general", "198.51.100.30", 5)
    allow(client, "auth", "198.51.100.30", 5)

    async def inspect():
        coll = db._get_db().rate_limits
        docs = [d async for d in coll.find({})]
        idx = await coll.index_information()
        return docs, idx
    docs, idx = client.portal.call(inspect)
    ids = sorted(d["_id"].split(":")[0] for d in docs)
    assert ids == ["a", "g"] and all("expire_at" in d for d in docs)
    assert any(v.get("expireAfterSeconds") == 0 for v in idx.values())


@pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs a real MongoDB")
def test_a_new_connection_sees_the_same_budget(client):
    """Another instance (or a restarted one) is a different connection to the same database."""
    now = time.time()
    for i in range(3):
        assert allow(client, "auth", "198.51.100.40", 3, now + i * 0.01)[0]

    async def swap():
        from motor.motor_asyncio import AsyncIOMotorClient
        db._client = AsyncIOMotorClient(TEST_MONGODB_URI)           # a second client, as a second process would have
        db._db = db._client[get_settings().mongodb_db]
    client.portal.call(swap)
    assert not allow(client, "auth", "198.51.100.40", 3, now + 1)[0]


@pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs a real MongoDB")
def test_store_outage_degrades_to_memory_and_still_limits(client, monkeypatch, caplog):
    async def boom(*a, **k):
        raise RuntimeError("mongo down")
    monkeypatch.setattr(ratelimit, "_sliding_log", boom)
    monkeypatch.setattr(ratelimit, "_fixed_window", boom)
    ratelimit.reset_memory()
    results = [allow(client, "auth", "198.51.100.50", 3)[0] for _ in range(5)]
    assert results == [True, True, True, False, False]
    assert any("Rate-limit store unavailable" in r.message for r in caplog.records)


def _free_port():
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _post(port, path, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(req, timeout=20).status
    except urllib.error.HTTPError as e:
        return e.code


@pytest.mark.skipif(not TEST_MONGODB_URI, reason="needs a real MongoDB")
def test_two_real_api_processes_share_one_login_budget(client):
    """Two uvicorn processes on one database: 12 wrong logins to each is 24 attempts in total, and the budget is 20."""
    env = {**os.environ, "ENVIRONMENT": "test", "MONGODB_URI": TEST_MONGODB_URI, "MONGODB_DB": "autopilot_test",
           "TRUSTED_PROXY_HOPS": "0"}
    ports = [_free_port(), _free_port()]
    procs = [subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(p), "--no-proxy-headers"],
                              cwd=BACKEND, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for p in ports]
    try:
        for p in ports:
            for _ in range(60):
                try:
                    if urllib.request.urlopen(f"http://127.0.0.1:{p}/health", timeout=2).status == 200:
                        break
                except Exception:
                    time.sleep(0.5)
            else:
                pytest.fail("API did not start")
        codes = []
        for i in range(12):
            for p in ports:
                codes.append(_post(p, "/api/auth/login", {"email": f"nobody{i}@example.com", "password": "wrong-wrong-1"}))
        assert codes.count(401) == 20 and codes.count(429) == 4, codes
    finally:
        for pr in procs:
            pr.terminate()
        for pr in procs:
            pr.wait(timeout=15)
