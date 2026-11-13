"""Test setup — isolates the app from real services.

Environment variables override backend/.env, so tests never touch the real
MongoDB, Groq or email provider even when a developer's .env has them set.

By default storage is in memory. To run the same suite against a real MongoDB
(a throwaway one — the test database is dropped before every test):
    TEST_MONGODB_URI=mongodb://localhost:27017 pytest
"""
import os

TEST_MONGODB_URI = os.environ.get("TEST_MONGODB_URI", "")
TEST_DB = "autopilot_test"

os.environ.update({
    "ENVIRONMENT": "test",
    "SECRET_KEY": "test-secret-key-that-is-at-least-32-characters",
    "OWNER_EMAILS": "owner@example.com",
    "MONGODB_URI": TEST_MONGODB_URI,
    "MONGODB_DB": TEST_DB,
    "GROQ_API_KEY": "",
    "RESEND_API_KEY": "",
    "SMTP_HOST": "",
    "API_KEY": "",
    "WORKER_URL": "",
    "WORKER_KEY": "",
    "SEED_DEMO_DATA": "false",
    "FREELANCER_OAUTH_TOKEN": "",
    "UPWORK_ACCESS_TOKEN": "",
    "UPWORK_CLIENT_ID": "",
    "UPWORK_CLIENT_SECRET": "",
    "UPWORK_REDIRECT_URI": "",
    "UPWORK_COMMERCIAL_APPROVED": "false",
    # A fixed test-only key so stored tokens can be encrypted in tests.
    "TOKEN_ENCRYPTION_KEY": "QJDEW1E_B8Va9nvrnjNsC4dPvK_qG0x6RPJmStbxHNo=",
    "NANGO_SECRET_KEY": "",
    "STRIPE_SECRET_KEY": "",
    "STRIPE_WEBHOOK_SECRET": "",
    "PAYMENTS_CRYPTO_ENABLED": "false",
    # Most tests sign up and use the session straight away; the email
    # verification tests switch it on.
    "EMAIL_VERIFICATION": "false",
    "PUBLIC_API_URL": "",
})

import httpx  # noqa: E402
import pytest  # noqa: E402

# For the few tests that read the in-memory store directly, or run their own event loop.
memory_only = pytest.mark.skipif(bool(TEST_MONGODB_URI), reason="inspects in-memory storage directly; covered in memory mode")
from fastapi.testclient import TestClient  # noqa: E402

from app import auth, db, oauth, repo, security  # noqa: E402
from app.orders import store as order_store  # noqa: E402
from app.payments import store as payments_store  # noqa: E402
from app.routers import payments as payments_router  # noqa: E402
from app.upwork import store as upwork_store  # noqa: E402
from app.capital import ledger as capital_ledger, store as capital_store  # noqa: E402
from app.token import service as token_service, state as token_state  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def no_outbound_http(monkeypatch):
    """The app's outbound calls (job feeds, Freelancer.com, Upwork, webhooks,
    the worker) all use httpx.AsyncClient — fail them loudly in tests."""
    async def blocked(self, request, **kwargs):
        raise RuntimeError(f"Outbound HTTP in a test: {request.url}")
    monkeypatch.setattr(httpx.AsyncClient, "send", blocked)


@pytest.fixture
def client():
    db._mem_users.clear()
    db._mem_identities.clear()
    oauth.reset_memory()
    repo.reset_memory()
    order_store.reset_memory()
    payments_store.reset_memory()
    upwork_store.reset_memory()
    payments_router._checkout_hits.clear()
    capital_store.reset_memory()
    capital_ledger.reset_memory()
    token_state.reset_memory()
    token_service._transparency_cache.clear()
    auth._failures.clear()
    # Every TestClient request shares one client IP; without this the
    # per-IP rate limiter trips once the whole suite passes 240 requests/min.
    security._hits.clear()
    security._auth_hits.clear()
    if TEST_MONGODB_URI:
        from pymongo import MongoClient
        MongoClient(TEST_MONGODB_URI).drop_database(TEST_DB)
        # Motor clients are bound to an event loop; each TestClient has its own.
        db._client = db._db = None
    with TestClient(app) as c:
        yield c


def signup(client, email="agency@example.com", password="correct-horse", role="admin", **extra):
    res = client.post("/api/auth/signup", json={"email": email, "password": password, "role": role, **extra})
    assert res.status_code == 200, res.text
    return res.json()


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def run(client, fn, *args):
    """Call an async app function (repo/db) on the app's own event loop."""
    return client.portal.call(fn, *args)
