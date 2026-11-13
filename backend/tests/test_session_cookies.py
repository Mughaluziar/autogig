"""Cookie sessions: HttpOnly cookie, CSRF, Origin check, logout/revocation, expiry, regression for bearer auth."""
import re

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from conftest import bearer, signup

ORIGIN = "http://localhost:3000"           # the default CORS_ORIGINS entry
COOKIE_MODE = {"X-Session-Mode": "cookie", "Origin": ORIGIN}
PW = "correct-horse"


def new_client():
    return TestClient(app, base_url="http://testserver")


def cookie_login(c, email="agency@example.com", password=PW, extra=None):
    return c.post("/api/auth/login", json={"email": email, "password": password}, headers={**COOKIE_MODE, **(extra or {})})


def csrf(c):
    return {"X-CSRF-Token": c.cookies.get("autopilot_csrf"), "Origin": ORIGIN}


def set_cookie_headers(res):
    return res.headers.get_list("set-cookie")


@pytest.fixture
def account(client):
    signup(client)
    return client


def test_cookie_login_sets_httponly_session_and_readable_csrf_and_no_token_in_body(account):
    c = new_client()
    res = cookie_login(c)
    assert res.status_code == 200
    assert "token" not in res.json() and res.json()["user"]["email"] == "agency@example.com"
    cookies = {re.match(r"([^=]+)=", h).group(1): h for h in set_cookie_headers(res)}
    session, token = cookies["autopilot_session"], cookies["autopilot_csrf"]
    assert "httponly" in session.lower() and "samesite=lax" in session.lower() and "path=/" in session.lower()
    assert "httponly" not in token.lower() and "samesite=lax" in token.lower()
    assert re.search(r"max-age=\d+", session.lower())


def test_secure_flag_follows_https_and_production(account, monkeypatch):
    c = new_client()
    over_https = cookie_login(c, extra={"X-Forwarded-Proto": "https"})
    assert all("secure" in h.lower() for h in set_cookie_headers(over_https))
    monkeypatch.setattr(get_settings(), "environment", "production")
    assert all("secure" in h.lower() for h in set_cookie_headers(cookie_login(new_client())))
    monkeypatch.setattr(get_settings(), "environment", "test")
    assert not any("secure" in h.lower() for h in set_cookie_headers(cookie_login(new_client())))
    monkeypatch.setattr(get_settings(), "cookie_secure", "true")
    assert all("secure" in h.lower() for h in set_cookie_headers(cookie_login(new_client())))


def test_session_persists_across_requests_like_a_page_refresh(account):
    c = new_client()
    cookie_login(c)
    for _ in range(3):
        me = c.get("/api/auth/me")
        assert me.status_code == 200 and me.json()["user"]["email"] == "agency@example.com"
    assert "token" not in me.json()


def test_signup_in_cookie_mode_starts_a_cookie_session(client):
    c = new_client()
    res = c.post("/api/auth/signup", json={"email": "new@example.com", "password": PW, "role": "freelancer"}, headers=COOKIE_MODE)
    assert res.status_code == 200 and "token" not in res.json()
    assert c.get("/api/auth/me").json()["user"]["email"] == "new@example.com"


def test_no_cookie_or_garbage_cookie_is_unauthorized(account):
    c = new_client()
    assert c.get("/api/auth/me").status_code == 401
    c.cookies.set("autopilot_session", "not-a-jwt")
    assert c.get("/api/auth/me").status_code == 401
    c.cookies.clear()
    cookie_login(c)
    good = c.cookies.get("autopilot_session")
    c.cookies.delete("autopilot_session")
    c.cookies.set("autopilot_session", good[:-4] + "AAAA")      # tampered signature
    assert c.get("/api/auth/me").status_code == 401


def test_unsafe_requests_need_the_csrf_token(account):
    c = new_client()
    cookie_login(c)
    body = {"title": "Fix a bug", "description": "x"}
    assert c.post("/api/upwork/leads/import", json=body, headers={"Origin": ORIGIN}).status_code == 403
    assert c.post("/api/upwork/leads/import", json=body,
                  headers={"X-CSRF-Token": "0" * 64, "Origin": ORIGIN}).status_code == 403
    assert c.post("/api/upwork/leads/import", json=body, headers=csrf(c)).status_code == 200
    # Safe methods never need it.
    assert c.get("/api/upwork/leads").status_code == 200


def test_csrf_token_is_bound_to_its_own_session(account):
    a, b = new_client(), new_client()
    cookie_login(a), cookie_login(b)
    body = {"title": "Job", "description": "x"}
    cross = {"X-CSRF-Token": a.cookies.get("autopilot_csrf"), "Origin": ORIGIN}
    assert b.post("/api/upwork/leads/import", json=body, headers=cross).status_code == 403


def test_foreign_origin_is_blocked_even_with_a_valid_csrf_token(account):
    c = new_client()
    cookie_login(c)
    evil = {**csrf(c), "Origin": "https://evil.example.com"}
    assert c.post("/api/upwork/leads/import", json={"title": "x"}, headers=evil).status_code == 403
    assert c.get("/api/auth/me", headers={"Origin": "https://evil.example.com"}).status_code == 200  # reads are not state-changing


def test_login_from_a_foreign_origin_is_blocked(account):
    res = cookie_login(new_client(), extra={"Origin": "https://evil.example.com"})
    assert res.status_code == 403 and not set_cookie_headers(res)


def test_bearer_clients_are_unaffected_by_csrf_and_still_get_a_token(account):
    res = account.post("/api/auth/login", json={"email": "agency@example.com", "password": PW})
    token = res.json()["token"]
    ok = account.post("/api/upwork/leads/import", json={"title": "x"}, headers=bearer(token))
    assert ok.status_code == 200 and not set_cookie_headers(res)


def test_bearer_header_wins_over_a_cookie_and_needs_no_csrf(account):
    c = new_client()
    cookie_login(c)
    other = signup(account, email="other@example.com")["token"]
    res = c.post("/api/upwork/leads/import", json={"title": "x"}, headers=bearer(other))
    assert res.status_code == 200


def test_logout_requires_csrf_clears_cookies_and_revokes_the_session(account):
    c = new_client()
    cookie_login(c)
    stolen = c.cookies.get("autopilot_session")
    assert c.post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code == 403   # no CSRF token: not logged out
    assert c.get("/api/auth/me").status_code == 200
    res = c.post("/api/auth/logout", headers=csrf(c))
    assert res.status_code == 200
    cleared = " ".join(set_cookie_headers(res)).lower()
    assert "autopilot_session=" in cleared and "max-age=0" in cleared
    assert c.get("/api/auth/me").status_code == 401
    # A copy of the old cookie no longer works: the session was revoked server-side.
    replay = new_client()
    replay.cookies.set("autopilot_session", stolen)
    assert replay.get("/api/auth/me").status_code == 401
    assert replay.get("/api/auth/me").json()["detail"].startswith("Session ended")


def test_logout_is_harmless_when_not_signed_in_and_bearer_logout_revokes_the_token(account):
    assert new_client().post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code == 200
    token = account.post("/api/auth/login", json={"email": "agency@example.com", "password": PW}).json()["token"]
    assert account.get("/api/auth/me", headers=bearer(token)).status_code == 200
    assert account.post("/api/auth/logout", headers=bearer(token)).status_code == 200
    assert account.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_changing_the_password_ends_other_sessions_but_keeps_this_one(account):
    a, b = new_client(), new_client()
    cookie_login(a), cookie_login(b)
    res = a.post("/api/auth/change-password", json={"currentPassword": PW, "newPassword": "a-new-password"},
                 headers={**csrf(a), "X-Session-Mode": "cookie"})
    assert res.status_code == 200 and "token" not in res.json()
    assert b.get("/api/auth/me").status_code == 401                    # the other device is signed out
    assert a.get("/api/auth/me").status_code == 200                    # this one carries on (re-issued cookie)


def test_password_reset_ends_every_session(account):
    c = new_client()
    cookie_login(c)
    link = account.post("/api/auth/forgot-password", json={"email": "agency@example.com"}).json()["devResetLink"]
    assert account.post("/api/auth/reset-password", json={"token": link.split("token=")[1], "password": "totally-new-pass"}).status_code == 200
    assert c.get("/api/auth/me").status_code == 401


def test_expired_session_cookie_is_rejected(account, monkeypatch):
    monkeypatch.setattr(get_settings(), "access_token_expire_minutes", -1)
    expired = account.post("/api/auth/login", json={"email": "agency@example.com", "password": PW}).json()["token"]
    c = new_client()
    c.cookies.set("autopilot_session", expired)
    me = c.get("/api/auth/me")
    assert me.status_code == 401 and "expired" in me.json()["detail"].lower()


def test_deleted_or_replaced_account_cannot_keep_using_a_cookie(account):
    from app import db
    c = new_client()
    cookie_login(c)
    db._mem_users.clear()
    assert c.get("/api/auth/me").status_code == 401


def test_protected_routes_reject_unauthenticated_requests(client):
    for method, path in (("get", "/api/upwork/leads"), ("get", "/api/radar/jobs"), ("post", "/api/upwork/leads/import"),
                         ("get", "/api/auth/me"), ("get", "/api/orders/accounts"), ("get", "/api/automation/jobs")):
        assert getattr(client, method)(path).status_code == 401, path


def test_role_checks_still_apply_to_cookie_sessions(client):
    signup(client, email="free@example.com", role="freelancer")
    c = new_client()
    cookie_login(c, "free@example.com")
    assert c.get("/api/automation/jobs").status_code == 403               # admin-only route


def test_personal_api_keys_still_work_and_need_no_csrf(client):
    token = signup(client)["token"]
    made = client.post("/api/api-keys", json={"name": "ci", "scopes": ["read", "write"]}, headers=bearer(token)).json()
    key = {"Authorization": f"Bearer {made['secret']}"}
    assert client.get("/api/upwork/leads", headers=key).status_code == 200
    assert client.post("/api/upwork/leads/import", json={"title": "x"}, headers=key).status_code == 200


def test_cors_allows_only_the_configured_frontend_with_credentials(client):
    ok = client.options("/api/auth/login", headers={"Origin": ORIGIN, "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == ORIGIN
    assert ok.headers.get("access-control-allow-credentials") == "true"
    bad = client.options("/api/auth/login", headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers
