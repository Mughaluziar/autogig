"""Terms of Service / Privacy Policy acceptance is recorded on the server with the version and a UTC timestamp."""
import json
from datetime import datetime, timezone

import pytest

from app import rights_store
from app.config import get_settings
from conftest import bearer, run, signup

BODY = {"email": "new@example.com", "password": "correct-horse", "role": "freelancer", "name": "New Person"}


@pytest.fixture(autouse=True)
def terms_required(monkeypatch):
    monkeypatch.setattr(get_settings(), "require_terms_acceptance", True)


def versions(client):
    return {k: v for k, v in client.get("/api/legal/versions").json().items() if k in ("terms", "privacy")}


def history(client, user_id):
    async def fetch():
        return await rights_store.list_for("terms_acceptances", user_id)
    return client.portal.call(fetch)


def test_versions_are_public(client):
    body = client.get("/api/legal/versions").json()
    assert body["terms"].startswith("draft-") and body["privacy"].startswith("draft-") and body["required"] is True


def test_signup_without_acceptance_is_rejected(client):
    res = client.post("/api/auth/signup", json=BODY)
    assert res.status_code == 422 and "Terms" in res.json()["detail"]
    assert client.post("/api/auth/login", json={"email": BODY["email"], "password": BODY["password"]}).status_code == 401


def test_signup_with_stale_versions_is_rejected(client):
    res = client.post("/api/auth/signup", json={**BODY, "acceptedTerms": {"terms": "old-1", "privacy": "old-1"}})
    assert res.status_code == 409
    assert client.post("/api/auth/login", json={"email": BODY["email"], "password": BODY["password"]}).status_code == 401


def test_signup_records_the_acceptance_with_version_and_time(client):
    before = datetime.now(timezone.utc)
    res = client.post("/api/auth/signup", json={**BODY, "acceptedTerms": versions(client)})
    assert res.status_code == 200
    user = res.json()["user"]
    assert user["needsTermsAcceptance"] is False
    rows = history(client, user["id"])
    assert len(rows) == 1
    row = rows[0]
    assert row["terms_version"] == get_settings().terms_version and row["privacy_version"] == get_settings().privacy_version
    assert row["method"] == "signup" and before <= row["accepted_at"] <= datetime.now(timezone.utc)
    me = client.get("/api/me/terms", headers=bearer(res.json()["token"])).json()
    assert me["needsAcceptance"] is False and me["history"][0]["method"] == "signup"
    assert set(row) == {"id", "user_id", "terms_version", "privacy_version", "accepted_at", "method"}          # data minimisation


def test_new_version_asks_existing_users_again_and_history_is_kept(client, monkeypatch):
    res = client.post("/api/auth/signup", json={**BODY, "acceptedTerms": versions(client)})
    h = bearer(res.json()["token"])
    monkeypatch.setattr(get_settings(), "terms_version", "draft-2027-01-01")
    assert client.get("/api/auth/me", headers=h).json()["user"]["needsTermsAcceptance"] is True
    assert client.get("/api/me/terms", headers=h).json()["needsAcceptance"] is True
    assert client.post("/api/me/terms/accept", headers=h, json={"terms": "draft-2026-11-14", "privacy": get_settings().privacy_version}).status_code == 409
    ok = client.post("/api/me/terms/accept", headers=h, json=versions(client))
    assert ok.status_code == 200
    assert client.get("/api/auth/me", headers=h).json()["user"]["needsTermsAcceptance"] is False
    rows = history(client, res.json()["user"]["id"])
    assert [r["terms_version"] for r in rows] == ["draft-2027-01-01", "draft-2026-11-14"]      # append-only, newest first
    assert [r["method"] for r in rows] == ["reaccept", "signup"]


def test_social_style_account_without_acceptance_is_flagged(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "require_terms_acceptance", False)
    tok = signup(client, email="oauthish@example.com")
    monkeypatch.setattr(get_settings(), "require_terms_acceptance", True)
    h = bearer(tok["token"])
    assert client.get("/api/auth/me", headers=h).json()["user"]["needsTermsAcceptance"] is True
    assert client.post("/api/me/terms/accept", headers=h, json=versions(client)).status_code == 200


def test_acceptance_history_is_per_user(client):
    a = client.post("/api/auth/signup", json={**BODY, "acceptedTerms": versions(client)}).json()
    b = client.post("/api/auth/signup", json={**BODY, "email": "b@example.com", "acceptedTerms": versions(client)}).json()
    assert len(history(client, a["user"]["id"])) == 1 and len(history(client, b["user"]["id"])) == 1
    assert client.get("/api/me/terms").status_code == 401


def test_switching_the_requirement_off_never_blocks_signup(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "require_terms_acceptance", False)
    assert client.post("/api/auth/signup", json=BODY).status_code == 200
