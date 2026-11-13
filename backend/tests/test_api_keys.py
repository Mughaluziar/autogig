"""Personal API keys: created once, stored hashed, act as their owner,
respect read/write scope, expiry and revocation, and can't manage keys,
sign-in or the team."""
import pytest

from conftest import memory_only, bearer, signup
from app import auth
from app.access import store as access_store
from app.config import get_settings
from app.routers.api_keys import hash_key


@pytest.fixture(autouse=True)
def fresh_access_store():
    access_store.reset_memory()
    yield
    access_store.reset_memory()


def session(client, email="dev@example.test"):
    data = signup(client, email=email)
    return bearer(auth.create_access_token(data["user"])), data["user"]


def create(client, headers, name="CI", scopes=("read",), days=90):
    res = client.post("/api/api-keys", json={"name": name, "scopes": list(scopes), "expiresInDays": days}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


@memory_only
def test_create_shows_the_secret_once_and_stores_a_hash(client):
    headers, user = session(client)
    made = create(client, headers, "Zapier", ("read", "write"))
    secret = made["secret"]
    assert secret.startswith("apk_") and len(secret) > 40
    assert made["key"]["prefix"] == secret[:12]
    assert made["key"]["scopes"] == ["read", "write"]
    assert made["key"]["status"] == "active"
    assert made["key"]["expiresAt"]

    listed = client.get("/api/api-keys", headers=headers).json()
    assert len(listed) == 1 and "secret" not in listed[0] and secret not in str(listed)
    stored = next(iter(access_store._mem["keys"].values()))
    assert stored["key_hash"] == hash_key(secret) and secret not in str(stored)


def test_validation(client):
    headers, _ = session(client)
    assert client.post("/api/api-keys", json={"name": ""}, headers=headers).status_code == 422
    assert client.post("/api/api-keys", json={"name": "x", "scopes": ["admin"]}, headers=headers).status_code == 422
    assert client.post("/api/api-keys", json={"name": "x", "expiresInDays": 7}, headers=headers).status_code == 422
    never = create(client, headers, days=None)
    assert never["key"]["expiresAt"] is None
    # Write implies read.
    assert create(client, headers, scopes=("write",))["key"]["scopes"] == ["read", "write"]


def test_key_acts_as_its_owner(client):
    headers, user = session(client)
    secret = create(client, headers)["secret"]
    res = client.get("/api/notifications", headers=bearer(secret))
    assert res.status_code == 200
    # X-API-Key works too.
    assert client.get("/api/notifications", headers={"X-API-Key": secret}).status_code == 200
    key = client.get("/api/api-keys", headers=headers).json()[0]
    assert key["lastUsedAt"]


def test_read_only_keys_cannot_write(client):
    headers, _ = session(client)
    read = create(client, headers, "read")["secret"]
    write = create(client, headers, "write", ("read", "write"))["secret"]
    body = {"state": {"accounts": []}, "version": 0}
    denied = client.put("/api/state", json=body, headers=bearer(read))
    assert denied.status_code == 403 and "read-only" in denied.json()["detail"]
    assert client.put("/api/state", json=body, headers=bearer(write)).status_code == 200


def test_keys_cannot_manage_keys_sign_in_or_team(client):
    headers, _ = session(client)
    secret = create(client, headers, scopes=("read", "write"))["secret"]
    for method, path in (("get", "/api/api-keys"), ("post", "/api/api-keys"), ("get", "/api/auth/me"),
                         ("get", "/api/team"), ("post", "/api/team/invites")):
        res = getattr(client, method)(path, headers=bearer(secret), **({"json": {}} if method == "post" else {}))
        assert res.status_code == 403, (method, path, res.text)


@memory_only
def test_revoked_expired_and_unknown_keys_fail(client):
    headers, _ = session(client)
    made = create(client, headers)
    secret = made["secret"]
    assert client.delete(f"/api/api-keys/{made['key']['id']}", headers=headers).json()["key"]["status"] == "revoked"
    assert client.get("/api/notifications", headers=bearer(secret)).status_code == 401

    other = create(client, headers, "old")
    access_store._mem["keys"][other["key"]["id"]]["expires_at"] = access_store.now().replace(year=2000)
    assert client.get("/api/notifications", headers=bearer(other["secret"])).status_code == 401
    assert client.get("/api/api-keys", headers=headers).json()[0]["status"] == "expired"

    assert client.get("/api/notifications", headers=bearer("apk_not-a-real-key")).status_code == 401


def test_users_only_see_and_revoke_their_own_keys(client):
    alice, _ = session(client, "alice@example.test")
    bob, _ = session(client, "bob@example.test")
    key = create(client, alice)["key"]
    assert client.get("/api/api-keys", headers=bob).json() == []
    assert client.delete(f"/api/api-keys/{key['id']}", headers=bob).status_code == 404
    assert client.get("/api/api-keys", headers=alice).json()[0]["status"] == "active"


def test_active_key_cap(client, monkeypatch):
    from app.routers import api_keys
    monkeypatch.setattr(api_keys, "MAX_ACTIVE_KEYS", 2)
    headers, _ = session(client)
    create(client, headers, "a")
    create(client, headers, "b")
    assert client.post("/api/api-keys", json={"name": "c"}, headers=headers).status_code == 409


def test_personal_key_passes_the_global_api_key_gate(client, monkeypatch):
    headers, _ = session(client)
    monkeypatch.setattr(get_settings(), "api_key", "global-gate")
    # Creating the key is a mutating browser request, so it needs the global key.
    res = client.post("/api/api-keys", json={"name": "CI", "scopes": ["read", "write"]},
                      headers={**headers, "X-API-Key": "global-gate"})
    assert res.status_code == 200
    secret = res.json()["secret"]
    assert client.post("/api/notifications/read-all", headers=bearer(secret)).status_code == 200
    # Without a personal key the gate still applies.
    assert client.post("/api/notifications/read-all", headers=headers).status_code == 401
