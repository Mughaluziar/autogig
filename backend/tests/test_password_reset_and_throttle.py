"""Password reset (emailed single-use link), persistent login lockout, and the per-IP credential budget."""
import time

from app import db, security
from conftest import run, signup


def _request_reset(client, email="agency@example.com"):
    res = client.post("/api/auth/forgot-password", json={"email": email})
    assert res.status_code == 200
    return res.json()


def _token(link: str) -> str:
    return link.split("token=")[1]


def test_reset_flow_end_to_end_and_single_use(client):
    signup(client)
    link = _request_reset(client)["devResetLink"]
    token = _token(link)
    res = client.post("/api/auth/reset-password", json={"token": token, "password": "brand-new-pass"})
    assert res.status_code == 200
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "correct-horse"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "brand-new-pass"}).status_code == 200
    # The same link cannot be used twice.
    again = client.post("/api/auth/reset-password", json={"token": token, "password": "another-new-pass"})
    assert again.status_code == 400


def test_unknown_email_gets_the_same_answer_and_no_link(client):
    signup(client)
    known = _request_reset(client)
    unknown = _request_reset(client, "nobody@example.com")
    assert known["message"] == unknown["message"]
    assert "devResetLink" not in unknown


def test_reset_token_is_stored_hashed_only(client):
    signup(client)
    token = _token(_request_reset(client)["devResetLink"])
    doc = run(client, db.find_user, "agency@example.com")
    assert token not in str(doc)
    assert len(doc["reset"]["hash"]) == 64


def test_expired_reset_token_is_rejected(client):
    signup(client)
    token = _token(_request_reset(client)["devResetLink"])
    run(client, db.update_user, "agency@example.com", {"reset": {**run(client, db.find_user, "agency@example.com")["reset"], "expires_at": time.time() - 1}})
    res = client.post("/api/auth/reset-password", json={"token": token, "password": "brand-new-pass"})
    assert res.status_code == 400


def test_reset_enforces_password_length_and_garbage_tokens(client):
    signup(client)
    token = _token(_request_reset(client)["devResetLink"])
    assert client.post("/api/auth/reset-password", json={"token": token, "password": "short"}).status_code == 422
    assert client.post("/api/auth/reset-password", json={"token": "x" * 40, "password": "long-enough-pass"}).status_code == 400


def test_reset_request_has_a_cooldown(client):
    signup(client)
    first = _request_reset(client)
    second = _request_reset(client)
    assert "devResetLink" in first and "devResetLink" not in second


def test_reset_clears_a_login_lockout(client):
    signup(client)
    for _ in range(5):
        client.post("/api/auth/login", json={"email": "agency@example.com", "password": "wrong-password"})
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "correct-horse"}).status_code == 429
    token = _token(_request_reset(client)["devResetLink"])
    client.post("/api/auth/reset-password", json={"token": token, "password": "brand-new-pass"})
    assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "brand-new-pass"}).status_code == 200


def test_lockout_after_five_failures_is_per_email(client):
    signup(client)
    for _ in range(5):
        assert client.post("/api/auth/login", json={"email": "agency@example.com", "password": "nope-nope"}).status_code == 401
    locked = client.post("/api/auth/login", json={"email": "agency@example.com", "password": "correct-horse"})
    assert locked.status_code == 429 and locked.headers["Retry-After"]
    assert client.post("/api/auth/login", json={"email": "someone-else@example.com", "password": "x"}).status_code == 401


def test_credential_endpoints_have_a_tight_per_ip_budget(client):
    codes = [client.post("/api/auth/login", json={"email": f"u{i}@example.com", "password": "x"}).status_code
             for i in range(security._AUTH_RATE_MAX + 3)]
    assert codes[:security._AUTH_RATE_MAX] == [401] * security._AUTH_RATE_MAX
    assert set(codes[security._AUTH_RATE_MAX:]) == {429}
    # Ordinary API reads are not affected by the credential budget.
    assert client.get("/health").status_code == 200
