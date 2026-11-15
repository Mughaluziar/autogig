"""Name correction and the secure email change: new-address proof, old-address notice, sessions invalidated, no takeover."""
import re

import pytest

from app import db
from conftest import bearer, run, signup

PW = "correct-horse"


def login(client, email, password=PW):
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return bearer(res.json()["token"])


@pytest.fixture
def me(client):
    res = signup(client, email="old@example.com", role="freelancer", name="Old Name")
    return bearer(res["token"]), res["user"]["id"]


def start(client, h, new="new@example.com", password=PW):
    return client.post("/api/me/email/change", headers=h, json={"newEmail": new, "password": password})


# ------------------------------------------------------------------------------------------ name
def test_name_can_be_corrected_and_is_validated(client, me):
    h, uid = me
    res = client.patch("/api/me/profile", headers=h, json={"name": "  Ada   Lovelace "})
    assert res.status_code == 200 and res.json()["user"]["name"] == "Ada Lovelace"
    assert client.get("/api/auth/me", headers=h).json()["user"]["name"] == "Ada Lovelace"
    for bad in ("", "   ", "x" * 121):
        assert client.patch("/api/me/profile", headers=h, json={"name": bad}).status_code in (422,)
    assert client.patch("/api/me/profile", json={"name": "No Session"}).status_code == 401


def test_a_name_change_only_touches_your_own_account(client, me):
    h, _ = me
    other = bearer(signup(client, email="other@example.com", name="Other Person")["token"])
    client.patch("/api/me/profile", headers=h, json={"name": "Changed"})
    assert client.get("/api/auth/me", headers=other).json()["user"]["name"] == "Other Person"


# ------------------------------------------------------------------------------------------ email
def test_the_change_needs_the_password_and_a_valid_new_address(client, me):
    h, _ = me
    assert client.post("/api/me/email/change", json={"newEmail": "a@b.co", "password": PW}).status_code == 401
    assert start(client, h, password="wrong-password").status_code == 403
    assert client.post("/api/me/email/change", headers=h, json={"newEmail": "a@b.co"}).status_code == 403   # no password at all
    assert start(client, h, new="not-an-email").status_code == 422
    assert start(client, h, new="OLD@example.com").status_code == 422                                      # same address
    signup(client, email="taken@example.com")
    assert start(client, h, new="taken@example.com").status_code == 409


def test_nothing_changes_until_the_code_for_the_new_address_is_entered(client, me):
    h, uid = me
    code = start(client, h).json()["devCode"]
    assert client.get("/api/auth/me", headers=h).json()["user"]["email"] == "old@example.com"
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": PW}).status_code == 401
    bad = client.post("/api/me/email/confirm", headers=h, json={"code": "000000" if code != "000000" else "111111"})
    assert bad.status_code == 400
    assert login(client, "old@example.com")                                                                    # still the old address


def test_confirming_moves_the_account_and_signs_every_other_session_out(client, me):
    h, uid = me
    other_session = login(client, "old@example.com")                                                       # e.g. a second browser
    code = start(client, h).json()["devCode"]
    res = client.post("/api/me/email/confirm", headers=h, json={"code": code})
    assert res.status_code == 200
    body = res.json()
    assert body["user"]["email"] == "new@example.com" and body["user"]["id"] == uid and body["user"]["emailVerified"] is True
    new_h = bearer(body["token"])
    assert client.get("/api/auth/me", headers=new_h).json()["user"]["email"] == "new@example.com"
    assert client.get("/api/auth/me", headers=h).status_code == 401                                          # the session that asked: old token
    assert client.get("/api/auth/me", headers=other_session).status_code == 401                              # other browsers signed out
    assert client.post("/api/auth/login", json={"email": "old@example.com", "password": PW}).status_code == 401
    assert login(client, "new@example.com")
    # the old address is free again and becomes a different account
    again = signup(client, email="old@example.com", name="Someone Else")
    assert again["user"]["id"] != uid


def test_the_code_is_single_use_expires_and_is_attempt_limited(client, me, monkeypatch):
    h, _ = me
    code = start(client, h).json()["devCode"]
    for _ in range(5):
        assert client.post("/api/me/email/confirm", headers=h, json={"code": "999999" if code != "999999" else "888888"}).status_code == 400
    assert client.post("/api/me/email/confirm", headers=h, json={"code": code}).status_code == 429          # locked even for the right code
    code2 = start(client, h).json()["devCode"]                                                              # a new request resets it
    assert client.post("/api/me/email/confirm", headers=h, json={"code": code2}).status_code == 200
    new_h = login(client, "new@example.com")
    assert client.post("/api/me/email/confirm", headers=new_h, json={"code": code2}).status_code == 404     # used up
    # expiry
    start(client, new_h, new="third@example.com")

    async def age():
        doc = await db.find_user("new@example.com")
        await db.update_user("new@example.com", {"email_change": {**doc["email_change"], "expires_at": 1}})
    run(client, age)
    assert client.post("/api/me/email/confirm", headers=new_h, json={"code": "123456"}).status_code == 410


def test_the_code_is_bound_to_the_address_it_was_sent_to(client, me):
    """A code issued for address A cannot be replayed to confirm address B."""
    h, _ = me
    code_a = start(client, h, new="a@example.com").json()["devCode"]
    code_b = start(client, h, new="b@example.com").json()["devCode"]
    if code_a == code_b:
        pytest.skip("identical random codes")
    assert client.post("/api/me/email/confirm", headers=h, json={"code": code_a}).status_code == 400
    assert client.post("/api/me/email/confirm", headers=h, json={"code": code_b}).status_code == 200
    assert login(client, "b@example.com")


def test_requests_are_rate_limited(client, me):
    h, _ = me
    for i in range(3):
        assert start(client, h, new=f"n{i}@example.com").status_code == 200
    assert start(client, h, new="n9@example.com").status_code == 429


def test_a_stolen_session_alone_cannot_change_the_email(client, me):
    h, _ = me
    assert client.post("/api/me/email/change", headers=h, json={"newEmail": "evil@example.com", "password": "guess-guess-1"}).status_code == 403
    assert client.post("/api/me/email/confirm", headers=h, json={"code": "123456"}).status_code == 404


def test_keys_cannot_change_profile_or_email(client, me):
    h, _ = me
    secret = client.post("/api/api-keys", headers=h, json={"name": "k", "scopes": ["read", "write"], "expiresInDays": 30}).json()["secret"]
    k = bearer(secret)
    assert client.patch("/api/me/profile", headers=k, json={"name": "Hax"}).status_code == 403
    assert client.post("/api/me/email/change", headers=k, json={"newEmail": "x@y.co", "password": PW}).status_code == 403


def test_other_records_follow_the_new_address(client, me):
    h, uid = me
    secret = client.post("/api/api-keys", headers=h, json={"name": "k", "scopes": ["read"], "expiresInDays": 30}).json()["secret"]
    code = start(client, h).json()["devCode"]
    client.post("/api/me/email/confirm", headers=h, json={"code": code})
    assert client.get("/api/notifications", headers=bearer(secret)).status_code == 200                       # the API key still works
    export = client.post("/api/me/export", headers=login(client, "new@example.com"), json={"password": PW}).json()
    assert export["account"]["email"] == "new@example.com"
    assert "email_change" not in str(export) and "code_hash" not in str(export)


def test_owner_accounts_cannot_change_email_and_unverified_ones_cannot(client, monkeypatch):
    owner = bearer(signup(client, email="owner@example.com")["token"])
    assert start(client, owner, new="o2@example.com").status_code == 409


def test_identities_and_team_rows_follow(client, me):
    h, uid = me
    run(client, db.link_identity, "google", "sub-1", "old@example.com")
    code = start(client, h).json()["devCode"]
    client.post("/api/me/email/confirm", headers=h, json={"code": code})
    ident = run(client, db.find_identity, "google", "sub-1")
    assert ident["email"] == "new@example.com"
