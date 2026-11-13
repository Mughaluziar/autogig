"""Upwork connected directly over OAuth 2.0: the connect flow, encrypted token
storage, refresh (including concurrent refreshes), and its use by order sync
and job search."""
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import bearer, run, signup
from app import crypto
from app.config import Settings, get_settings
from app.integrations import _nango_integrations_allowed
from app.orders import store as order_store
from app.routers import upwork_connect
from app.upwork import client as uw_client
from app.upwork import store as uw_store

SITE = "https://app.example.test"
REDIRECT = "https://api.example.test/api/upwork/oauth/callback"


class FakeUpwork:
    """Stands in for Upwork's token endpoint and GraphQL API. Refresh tokens
    rotate: using one retires it, as a strict OAuth server would."""

    def __init__(self, monkeypatch):
        self.codes = {"code-maya": "uw-maya", "code-sam": "uw-sam"}
        self.access: dict[str, str] = {}
        self.refresh: dict[str, str] = {}
        self.token_forms: list[dict] = []
        self.queries: list[tuple[str, str]] = []
        self.n = 0
        monkeypatch.setattr(uw_client, "_token_request", self._token)
        monkeypatch.setattr(uw_client, "_graphql_request", self._graphql)

    def _issue(self, user: str) -> dict:
        self.n += 1
        access, refresh = f"at-{self.n}", f"rt-{self.n}"
        self.access[access], self.refresh[refresh] = user, user
        return {"access_token": access, "refresh_token": refresh, "token_type": "Bearer", "expires_in": 86399}

    async def _token(self, form: dict):
        self.token_forms.append(dict(form))
        if form["grant_type"] == "authorization_code":
            user = self.codes.get(form["code"])
        else:
            user = self.refresh.pop(form.get("refresh_token"), None)
        return (200, self._issue(user)) if user else (400, {"error": "invalid_grant"})

    async def _graphql(self, token: str, body: dict):
        self.queries.append((token, body["query"]))
        user = self.access.get(token)
        if not user:
            return 401, None
        if "user { id nid name }" in body["query"]:
            return 200, {"data": {"user": {"id": user, "nid": user.removeprefix("uw-"), "name": user.title()}}}
        if "marketplaceJobPostingsSearch" in body["query"]:
            node = {"id": "1", "title": "Build a React dashboard", "description": "Ongoing work", "skills": [{"name": "React"}],
                    "amount": {"rawValue": "1500", "currency": "USD"}, "totalApplicants": 3, "ciphertext": "~01abc"}
            return 200, {"data": {"marketplaceJobPostingsSearch": {"totalCount": 1, "edges": [{"node": node}]}}}
        return 200, {"data": {"user": {"offer": {"edges": []}}}}


@pytest.fixture
def upwork(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "upwork_client_id", "client-123")
    monkeypatch.setattr(settings, "upwork_client_secret", "secret-xyz")
    monkeypatch.setattr(settings, "upwork_redirect_uri", REDIRECT)
    monkeypatch.setattr(settings, "upwork_commercial_approved", True)
    monkeypatch.setattr(settings, "upwork_offers_read_approved", True)
    monkeypatch.setattr(settings, "public_site_url", SITE)
    return FakeUpwork(monkeypatch)


def start(client, headers, return_to="/dashboard/orders"):
    res = client.post("/api/upwork/oauth/start", headers=headers, json={"returnTo": return_to})
    assert res.status_code == 200, res.text
    return parse_qs(urlparse(res.json()["authorizeUrl"]).query)


def callback(client, **params):
    res = client.get("/api/upwork/oauth/callback", params=params, follow_redirects=False)
    assert res.status_code == 303, res.text
    location = urlparse(res.headers["location"])
    return location, {k: v[0] for k, v in parse_qs(location.query).items()}


def connect(client, headers, code="code-maya", return_to="/dashboard/orders") -> str:
    query = start(client, headers, return_to)
    location, params = callback(client, code=code, state=query["state"][0])
    assert params["upwork"] == "connected", params
    return params["connectionId"]


def user(client, email):
    session = signup(client, email=email)
    return bearer(session["token"]), session["user"]["id"]


# --------------------------------------------------------------------------- #
# Configuration gates
# --------------------------------------------------------------------------- #
def test_connecting_stays_off_until_approved_and_configured(client, monkeypatch):
    headers, _ = user(client, "gate@example.com")
    body = client.get("/api/upwork/connections", headers=headers).json()
    assert body["canConnect"] is False and "approved" in body["reason"]
    assert client.post("/api/upwork/oauth/start", headers=headers, json={}).status_code == 503

    monkeypatch.setattr(get_settings(), "upwork_commercial_approved", True)
    body = client.get("/api/upwork/connections", headers=headers).json()
    assert body["canConnect"] is False
    assert "UPWORK_CLIENT_ID" in body["reason"] and "UPWORK_REDIRECT_URI" in body["reason"]


def test_nango_never_offers_upwork(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "nango_integrations", "upwork,microsoft-outlook")
    monkeypatch.setattr(settings, "outlook_inbox_read_approved", True)
    monkeypatch.setattr(settings, "inbound_email_platforms", "Upwork")
    assert _nango_integrations_allowed(settings) == {"microsoft-outlook"}


# --------------------------------------------------------------------------- #
# The connect flow
# --------------------------------------------------------------------------- #
def test_full_flow_stores_encrypted_tokens_and_returns_to_the_app(client, upwork):
    headers, uid = user(client, "maya@example.com")
    query = start(client, headers)
    assert query["client_id"] == ["client-123"] and query["redirect_uri"] == [REDIRECT]
    assert query["response_type"] == ["code"] and len(query["state"][0]) >= 32

    location, params = callback(client, code="code-maya", state=query["state"][0])
    assert f"{location.scheme}://{location.netloc}{location.path}" == f"{SITE}/dashboard/orders"
    assert params["upwork"] == "connected" and params["connectionId"].startswith("uwc_")

    exchange = upwork.token_forms[-1]
    assert exchange == {"grant_type": "authorization_code", "code": "code-maya", "redirect_uri": REDIRECT,
                        "client_id": "client-123", "client_secret": "secret-xyz"}

    stored = run(client, uw_store.get_connection, params["connectionId"], uid)
    assert stored["upwork_user_id"] == "uw-maya" and stored["status"] == "active"
    assert "at-1" not in str(stored) and "rt-1" not in str(stored)
    assert crypto.decrypt(stored["access_token"]) == "at-1" and crypto.decrypt(stored["refresh_token"]) == "rt-1"

    listed = client.get("/api/upwork/connections", headers=headers).json()
    assert listed["canConnect"] is True
    assert [c["handle"] for c in listed["connections"]] == ["maya"]
    # Tokens never leave the server, encrypted or not.
    assert set(listed["connections"][0]) == {"id", "handle", "name", "status", "connectedAt", "lastRefreshedAt"}


def test_state_is_single_use_and_expires(client, upwork, monkeypatch):
    headers, _ = user(client, "state@example.com")
    state = start(client, headers)["state"][0]
    assert callback(client, code="code-maya", state=state)[1]["upwork"] == "connected"
    _, again = callback(client, code="code-maya", state=state)
    assert again == {"upwork": "error", "reason": "expired"}
    assert callback(client, code="code-maya", state="x" * 43)[1]["reason"] == "expired"

    monkeypatch.setattr(upwork_connect, "STATE_TTL", timedelta(seconds=-1))
    stale = start(client, headers)["state"][0]
    assert callback(client, code="code-sam", state=stale)[1]["reason"] == "expired"


def test_denied_or_rejected_authorization_stores_nothing(client, upwork):
    headers, uid = user(client, "deny@example.com")
    state = start(client, headers, "/dashboard/accounts")["state"][0]
    location, params = callback(client, error="access_denied", state=state)
    assert location.path == "/dashboard/accounts" and params == {"upwork": "error", "reason": "denied"}

    state = start(client, headers)["state"][0]
    assert callback(client, code="stolen-code", state=state)[1]["reason"] == "rejected"
    assert run(client, uw_store.list_connections, uid) == []


def test_return_page_is_allowlisted(client, upwork):
    headers, _ = user(client, "redirect@example.com")
    for target in ("https://evil.example", "//evil.example/x", "/dashboard/orders/../../x", "/dashboard/bidding"):
        assert client.post("/api/upwork/oauth/start", headers=headers, json={"returnTo": target}).status_code == 422


def test_reconnecting_the_same_account_updates_it(client, upwork):
    headers, uid = user(client, "again@example.com")
    first = connect(client, headers)
    second = connect(client, headers)
    assert first == second
    stored = run(client, uw_store.list_connections, uid)
    assert len(stored) == 1 and crypto.decrypt(stored[0]["access_token"]) == "at-2"
    assert connect(client, headers, code="code-sam") != first


# --------------------------------------------------------------------------- #
# Order sync on a direct connection
# --------------------------------------------------------------------------- #
def add_account(client, headers, connection_id):
    return client.post("/api/orders/accounts", headers=headers,
                       json={"platform": "Upwork", "mode": "api", "connectionId": connection_id})


def test_order_account_runs_on_the_connection(client, upwork):
    headers, uid = user(client, "orders@example.com")
    cid = connect(client, headers)
    res = add_account(client, headers, cid)
    assert res.status_code == 200, res.text
    account = res.json()
    assert account["connection"] == "upwork_oauth" and account["externalAccountId"] == "uw-maya"
    # The first sync ran in the background with the connection's own token.
    synced = client.get("/api/orders/accounts", headers=headers).json()[0]
    assert synced["lastSyncStatus"] == "ok"
    assert any(token == "at-1" and "offer(pagination" in query for token, query in upwork.queries)
    assert add_account(client, headers, cid).status_code == 409


def test_someone_elses_connection_cannot_be_used(client, upwork):
    alice, _ = user(client, "alice-uw@example.com")
    bob, _ = user(client, "bob-uw@example.com")
    cid = connect(client, alice)
    assert add_account(client, bob, cid).status_code == 404
    assert client.delete(f"/api/upwork/connections/{cid}", headers=bob).status_code == 404


def test_expired_token_is_refreshed_and_the_new_refresh_token_kept(client, upwork):
    headers, uid = user(client, "refresh@example.com")
    cid = connect(client, headers)
    conn = run(client, uw_store.update_connection, cid, {"expires_at": uw_store.now() - timedelta(minutes=1)})
    status, payload = run(client, uw_client.graphql, cid, uid, "query { user { id nid name } }")
    assert status == 200 and payload["data"]["user"]["id"] == "uw-maya"
    assert upwork.token_forms[-1]["grant_type"] == "refresh_token" and upwork.token_forms[-1]["refresh_token"] == "rt-1"
    stored = run(client, uw_store.get_connection, cid, uid)
    assert crypto.decrypt(stored["refresh_token"]) == "rt-2" and stored["version"] > conn["version"]
    assert stored["expires_at"] > uw_store.now() + timedelta(hours=23)


def test_a_401_refreshes_once_and_retries(client, upwork):
    headers, uid = user(client, "retry@example.com")
    cid = connect(client, headers)
    upwork.access.pop("at-1")  # revoked on Upwork's side before it expired
    status, _ = run(client, uw_client.graphql, cid, uid, "query { user { id nid name } }")
    assert status == 200 and [t for t, _ in upwork.queries[-2:]] == ["at-1", "at-2"]


def test_concurrent_refresh_uses_the_token_the_winner_stored(client, upwork):
    headers, uid = user(client, "race@example.com")
    cid = connect(client, headers)
    stale = run(client, uw_store.update_connection, cid, {"expires_at": uw_store.now() - timedelta(minutes=1)})
    winner = run(client, uw_client.access_token, stale)
    # The loser still holds the old snapshot, whose refresh token was just retired.
    loser = run(client, uw_client.access_token, stale)
    assert winner == loser == "at-2"
    assert run(client, uw_store.get_connection, cid, uid)["status"] == "active"


def test_rejected_refresh_flags_the_account_and_reconnecting_restores_it(client, upwork):
    headers, uid = user(client, "reauth@example.com")
    cid = connect(client, headers)
    account = add_account(client, headers, cid).json()
    upwork.refresh.clear()  # the user revoked the app on Upwork
    run(client, uw_store.update_connection, cid, {"expires_at": uw_store.now() - timedelta(minutes=1)})

    synced = client.post(f"/api/orders/accounts/{account['id']}/sync", headers=headers).json()
    assert synced["status"] == "error"
    assert run(client, uw_store.get_connection, cid, uid)["status"] == "needs_reauth"
    assert run(client, order_store.get_account, uid, account["id"])["status"] == "needs_reauth"

    assert connect(client, headers) == cid
    assert run(client, uw_store.get_connection, cid, uid)["status"] == "active"
    restored = run(client, order_store.get_account, uid, account["id"])
    assert restored["status"] == "active" and restored["consecutive_failures"] == 0


def test_disconnect_deletes_tokens_and_pauses_its_accounts(client, upwork):
    headers, uid = user(client, "bye@example.com")
    cid = connect(client, headers)
    account = add_account(client, headers, cid).json()
    res = client.delete(f"/api/upwork/connections/{cid}", headers=headers)
    assert res.status_code == 200 and res.json()["accountsAffected"] == 1
    assert run(client, uw_store.get_connection, cid, uid) is None
    paused = run(client, order_store.get_account, uid, account["id"])
    assert paused["status"] == "needs_reauth" and "removed" in paused["last_sync_error"]


# --------------------------------------------------------------------------- #
# Job search on a direct connection
# --------------------------------------------------------------------------- #
def test_job_search_goes_live_on_the_users_connection(client, upwork):
    headers, _ = user(client, "jobs@example.com")
    assert client.get("/api/upwork/status", headers=headers).json()["connected"] is False
    assert client.get("/api/upwork/jobs", headers=headers).json()["live"] is False
    connect(client, headers, return_to="/dashboard/accounts")
    assert client.get("/api/upwork/status", headers=headers).json()["mode"] == "live"
    found = client.get("/api/upwork/jobs", params={"q": "react"}, headers=headers).json()
    assert found["live"] is True and found["jobs"][0]["title"] == "Build a React dashboard"
    assert client.get("/api/integrations/capabilities", headers=headers).json()["job_finder"]["Upwork"]["ready"] is True


# --------------------------------------------------------------------------- #
# Encryption keys
# --------------------------------------------------------------------------- #
def test_keys_rotate_and_bad_keys_are_refused(monkeypatch):
    from cryptography.fernet import Fernet
    settings = get_settings()
    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "token_encryption_key", old)
    sealed = crypto.encrypt("secret-token")
    monkeypatch.setattr(settings, "token_encryption_key", f"{new},{old}")
    assert crypto.decrypt(sealed) == "secret-token"
    monkeypatch.setattr(settings, "token_encryption_key", new)
    with pytest.raises(crypto.DecryptError):
        crypto.decrypt(sealed)
    monkeypatch.setattr(settings, "token_encryption_key", "not-a-key")
    assert crypto.configured() is False and "UPWORK_CLIENT_ID" in uw_client.missing_settings(settings)
    with pytest.raises(RuntimeError):
        Settings(environment="production", secret_key="s" * 40, token_encryption_key="not-a-key").validate_for_production()
