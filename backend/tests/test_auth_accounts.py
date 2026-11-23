"""Signup profile, email verification, the retired client role and password changes."""
import time

import pytest

from app import auth, db, email as mail
from app.config import get_settings
from app.routers import auth as auth_router
from conftest import bearer, run, signup


@pytest.fixture
def verification_on(monkeypatch):
    monkeypatch.setattr(get_settings(), "email_verification", True)


def _signup_raw(client, **body):
    payload = {"email": "maya@example.com", "password": "correct-horse", "role": "freelancer", **body}
    return client.post("/api/auth/signup", json=payload)


# --- Signup profile ----------------------------------------------------------
def test_signup_stores_profile_and_normalizes_linked_account(client):
    res = _signup_raw(client, name="Maya Lin", profile={
        "country": "United States", "hourlyRate": 85, "skills": ["React", " react ", "Node"],
        "experience": "6–10", "availability": "Full-time", "bio": "Product engineer.",
        "linkedAccount": {"platform": "github", "url": "@mayalin"},
    })
    assert res.status_code == 200, res.text
    profile = res.json()["user"]["profile"]
    assert profile["country"] == "United States"
    assert profile["hourlyRate"] == 85
    assert profile["skills"] == ["React", "Node"]
    assert profile["linkedAccount"] == {"platform": "github", "label": "GitHub", "url": "https://github.com/mayalin"}
    assert run(client, db.find_user, "maya@example.com")["profile"]["bio"] == "Product engineer."


@pytest.mark.parametrize("platform, url, detail", [
    ("upwork", "mayalin", "full link"),
    ("linkedin", "https://evil.example/in/maya", "isn't a LinkedIn link"),
    ("github", "https://github.com", "not the home page"),
    ("myspace", "maya", "supported platform"),
])
def test_signup_rejects_bad_linked_account(client, platform, url, detail):
    res = _signup_raw(client, profile={"linkedAccount": {"platform": platform, "url": url}})
    assert res.status_code == 422
    assert detail in res.json()["detail"]
    assert run(client, db.find_user, "maya@example.com") is None


@pytest.mark.parametrize("platform, value, expected", [
    ("upwork", "https://www.upwork.com/freelancers/~01abc", "https://www.upwork.com/freelancers/~01abc"),
    ("fiverr", "jane_d", "https://www.fiverr.com/jane_d"),
    ("freelancer", "john.doe", "https://www.freelancer.com/u/john.doe"),
    ("linkedin", "linkedin.com/in/jane-doe/", "https://linkedin.com/in/jane-doe"),
    ("other", "janedoe.dev/work", "https://janedoe.dev/work"),
])
def test_linked_account_normalization(platform, value, expected):
    assert auth_router.normalize_linked_account(platform, value) == expected


# --- Retired client role -----------------------------------------------------
def test_client_signup_is_rejected(client):
    res = _signup_raw(client, role="client")
    assert res.status_code == 422
    assert "no longer offered" in res.json()["detail"]


def test_existing_client_account_cannot_sign_in(client):
    run(client, db.create_user, "Old Client", "client@example.com", auth.hash_password("correct-horse"), "client", None)
    res = client.post("/api/auth/login", json={"email": "client@example.com", "password": "correct-horse"})
    assert res.status_code == 403
    assert "retired" in res.json()["detail"]
    # A wrong password still gets the generic answer, so nothing is revealed.
    bad = client.post("/api/auth/login", json={"email": "client@example.com", "password": "wrong-pass"})
    assert bad.status_code == 401


def test_existing_client_session_is_ended(client):
    run(client, db.create_user, "Old Client", "client@example.com", auth.hash_password("correct-horse"), "client", None)
    token = auth.create_access_token({"id": "u-x", "email": "client@example.com", "role": "client"})
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401


# --- Email verification ------------------------------------------------------
def test_without_verification_signup_is_ready_to_use(client):
    data = signup(client)
    assert data["verification"] == {"required": False}
    assert data["user"]["verificationRequired"] is False
    assert client.get("/api/notifications", headers=bearer(data["token"])).status_code == 200


def test_signup_requires_code_and_blocks_other_routes(client, verification_on):
    data = _signup_raw(client).json()
    v = data["verification"]
    assert v["required"] is True and v["sent"] is False
    assert len(v["devCode"]) == 6 and v["devCode"].isdigit()
    assert data["user"]["emailVerified"] is False and data["user"]["verificationRequired"] is True
    token = data["token"]
    blocked = client.get("/api/notifications", headers=bearer(token))
    assert blocked.status_code == 403 and "Verify your email" in blocked.json()["detail"]
    me = client.get("/api/auth/me", headers=bearer(token))
    assert me.status_code == 200 and me.json()["user"]["verificationRequired"] is True
    # Only a hash is stored.
    stored = run(client, db.find_user, "maya@example.com")["verify"]
    assert v["devCode"] not in str(stored)

    ok = client.post("/api/auth/verify-email", json={"code": v["devCode"]}, headers=bearer(token))
    assert ok.status_code == 200
    fresh = ok.json()
    assert fresh["user"]["emailVerified"] is True and fresh["user"]["verificationRequired"] is False
    assert client.get("/api/notifications", headers=bearer(fresh["token"])).status_code == 200
    assert "verify" not in run(client, db.find_user, "maya@example.com")


def test_me_renews_a_pending_token_once_verified_elsewhere(client, verification_on):
    # Signed up on one device, confirmed the code on another: the first
    # device's pending token must not leave it stuck on 403s.
    data = _signup_raw(client).json()
    stale = data["token"]
    other = client.post("/api/auth/verify-email", json={"code": data["verification"]["devCode"]}, headers=bearer(stale))
    assert other.status_code == 200
    assert client.get("/api/notifications", headers=bearer(stale)).status_code == 403
    me = client.get("/api/auth/me", headers=bearer(stale)).json()
    assert me["user"]["verificationRequired"] is False
    assert client.get("/api/notifications", headers=bearer(me["token"])).status_code == 200
    # A full session gets no token back, and a still-pending one isn't upgraded.
    assert "token" not in client.get("/api/auth/me", headers=bearer(me["token"])).json()
    pending = _signup_raw(client, email="sam@example.com").json()
    assert "token" not in client.get("/api/auth/me", headers=bearer(pending["token"])).json()


def test_wrong_codes_are_limited(client, verification_on):
    data = _signup_raw(client).json()
    token, code = data["token"], data["verification"]["devCode"]
    wrong = "000000" if code != "000000" else "111111"
    for left in (4, 3, 2, 1):
        res = client.post("/api/auth/verify-email", json={"code": wrong}, headers=bearer(token))
        assert res.status_code == 400 and f"{left} attempt" in res.json()["detail"]
    res = client.post("/api/auth/verify-email", json={"code": wrong}, headers=bearer(token))
    assert res.status_code == 400 and "Request a new code" in res.json()["detail"]
    # Even the right code no longer works once the attempts are used up.
    res = client.post("/api/auth/verify-email", json={"code": code}, headers=bearer(token))
    assert res.status_code == 429


def test_expired_code_is_rejected(client, verification_on):
    data = _signup_raw(client).json()
    doc = run(client, db.find_user, "maya@example.com")
    run(client, db.update_user, "maya@example.com", {"verify": {**doc["verify"], "expires_at": time.time() - 1}})
    res = client.post("/api/auth/verify-email", json={"code": data["verification"]["devCode"]},
                      headers=bearer(data["token"]))
    assert res.status_code == 400 and "expired" in res.json()["detail"]


def test_resend_has_a_cooldown_and_issues_a_new_code(client, verification_on):
    data = _signup_raw(client).json()
    token, first = data["token"], data["verification"]["devCode"]
    res = client.post("/api/auth/resend-verification", headers=bearer(token))
    assert res.status_code == 429 and res.headers["Retry-After"]
    doc = run(client, db.find_user, "maya@example.com")
    run(client, db.update_user, "maya@example.com",
        {"verify": {**doc["verify"], "sent_at": [time.time() - 120]}})
    res = client.post("/api/auth/resend-verification", headers=bearer(token))
    assert res.status_code == 200
    second = res.json()["devCode"]
    if second != first:
        old = client.post("/api/auth/verify-email", json={"code": first}, headers=bearer(token))
        assert old.status_code == 400
    assert client.post("/api/auth/verify-email", json={"code": second}, headers=bearer(token)).status_code == 200


def test_resend_has_an_hourly_cap(client, verification_on):
    data = _signup_raw(client).json()
    doc = run(client, db.find_user, "maya@example.com")
    stamp = time.time() - 300
    run(client, db.update_user, "maya@example.com",
        {"verify": {**doc["verify"], "sent_at": [stamp - i for i in range(5)]}})
    res = client.post("/api/auth/resend-verification", headers=bearer(data["token"]))
    assert res.status_code == 429 and "an hour" in res.json()["detail"]


def test_code_is_emailed_when_a_provider_is_configured(client, verification_on, monkeypatch):
    sent: list[tuple[str, str, str]] = []

    async def fake_send(to, subject, html):
        sent.append((to, subject, html))
        return True

    monkeypatch.setattr(mail, "enabled", lambda: True)
    monkeypatch.setattr(mail, "send_email", fake_send)
    v = _signup_raw(client).json()["verification"]
    assert v["sent"] is True and "devCode" not in v
    assert sent[0][0] == "maya@example.com" and "verification code" in sent[0][1]


def test_production_without_email_blocks_signup_and_hides_dev_codes(client, verification_on, monkeypatch):
    monkeypatch.setattr(get_settings(), "environment", "production")
    res = _signup_raw(client)
    assert res.status_code == 503
    assert "devCode" not in res.json()
    assert client.get("/api/auth/providers").json()["emailVerification"] == {
        "enforced": True, "delivery": "unavailable",
    }


def test_login_of_unverified_account_returns_restricted_session(client, verification_on):
    _signup_raw(client)
    res = client.post("/api/auth/login", json={"email": "maya@example.com", "password": "correct-horse"})
    assert res.status_code == 200
    assert res.json()["user"]["verificationRequired"] is True
    assert client.get("/api/notifications", headers=bearer(res.json()["token"])).status_code == 403


def test_accounts_from_before_verification_count_as_verified(client, verification_on):
    run(client, db.create_user, "Legacy", "legacy@example.com", auth.hash_password("correct-horse"), "admin", None)
    res = client.post("/api/auth/login", json={"email": "legacy@example.com", "password": "correct-horse"})
    assert res.json()["user"]["emailVerified"] is True
    assert client.get("/api/notifications", headers=bearer(res.json()["token"])).status_code == 200


# --- Change password ---------------------------------------------------------
def test_change_password(client):
    token = signup(client)["token"]
    bad = client.post("/api/auth/change-password", json={"currentPassword": "nope-nope", "newPassword": "brand-new-pass"},
                      headers=bearer(token))
    assert bad.status_code == 400
    short = client.post("/api/auth/change-password", json={"currentPassword": "correct-horse", "newPassword": "short"},
                        headers=bearer(token))
    assert short.status_code == 422
    same = client.post("/api/auth/change-password", json={"currentPassword": "correct-horse", "newPassword": "correct-horse"},
                       headers=bearer(token))
    assert same.status_code == 422
    ok = client.post("/api/auth/change-password", json={"currentPassword": "correct-horse", "newPassword": "brand-new-pass"},
                     headers=bearer(token))
    assert ok.status_code == 200
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "correct-horse"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "brand-new-pass"}).status_code == 200


def test_change_password_requires_a_session(client):
    assert client.post("/api/auth/change-password", json={"newPassword": "brand-new-pass"}).status_code == 401


# --- Re-signing up over a pending (never verified) signup ---------------------
def _backdate_codes(client, email="maya@example.com", seconds=120, count=1):
    doc = run(client, db.find_user, email)
    stamp = time.time() - seconds
    run(client, db.update_user, email, {"verify": {**doc["verify"], "sent_at": [stamp - i for i in range(count)]}})


def test_signup_replaces_a_pending_unverified_signup(client, verification_on):
    first = _signup_raw(client, name="Typo Name", password="first-password", role="freelancer").json()
    _backdate_codes(client)
    res = _signup_raw(client, name="Maya Lin", password="second-password", role="admin",
                      profile={"country": "Canada"})
    assert res.status_code == 200, res.text
    second = res.json()
    assert second["user"]["id"] != first["user"]["id"]
    assert second["user"]["name"] == "Maya Lin" and second["user"]["role"] == "admin"
    assert second["user"]["profile"] == {"country": "Canada"}
    assert second["verification"]["devCode"]
    # The old password and the old session are gone.
    assert client.post("/api/auth/login", json={"email": "maya@example.com", "password": "first-password"}).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(first["token"])).status_code == 401
    assert client.post("/api/auth/resend-verification", headers=bearer(first["token"])).status_code == 401
    # The old code no longer works; the new one does.
    old = client.post("/api/auth/verify-email", json={"code": first["verification"]["devCode"]},
                      headers=bearer(second["token"]))
    if first["verification"]["devCode"] != second["verification"]["devCode"]:
        assert old.status_code == 400
    ok = client.post("/api/auth/verify-email", json={"code": second["verification"]["devCode"]},
                     headers=bearer(second["token"]))
    assert ok.status_code == 200 and ok.json()["user"]["emailVerified"] is True
    assert client.post("/api/auth/login", json={"email": "maya@example.com", "password": "second-password"}).status_code == 200


def test_signup_over_a_verified_account_is_still_rejected(client, verification_on):
    data = _signup_raw(client).json()
    client.post("/api/auth/verify-email", json={"code": data["verification"]["devCode"]}, headers=bearer(data["token"]))
    res = _signup_raw(client, password="another-password")
    assert res.status_code == 409
    assert client.post("/api/auth/login", json={"email": "maya@example.com", "password": "correct-horse"}).status_code == 200


def test_pending_signup_is_not_replaced_when_verification_is_off(client):
    # Without enforcement an unverified account is fully usable: never replaced.
    signup(client, email="maya@example.com")
    assert _signup_raw(client, password="another-password").status_code == 409


def test_accounts_from_social_sign_in_are_not_replaced(client, verification_on):
    run(client, db.create_user, "Sam", "maya@example.com", "", "admin", None,
        {"email_verified": False, "auth_provider": "microsoft", "verify": {"sent_at": []}})
    assert _signup_raw(client).status_code == 409
    run(client, db.update_user, "maya@example.com", {}, ("auth_provider",))
    run(client, db.link_identity, "github", "42", "maya@example.com")
    assert _signup_raw(client).status_code == 409


def test_replacing_a_pending_signup_respects_code_limits(client, verification_on):
    _signup_raw(client, password="first-password")
    res = _signup_raw(client, password="second-password")
    assert res.status_code == 429 and res.headers["Retry-After"]
    _backdate_codes(client, seconds=300, count=5)
    res = _signup_raw(client, password="second-password")
    assert res.status_code == 429 and "an hour" in res.json()["detail"]
    # Neither attempt replaced the account.
    assert client.post("/api/auth/login", json={"email": "maya@example.com", "password": "first-password"}).status_code == 200
