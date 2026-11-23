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


def test_general_rate_limit_is_configurable_and_per_ip(client, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 5)
    codes = [client.get("/health").status_code for _ in range(8)]
    assert codes[:5] == [200] * 5 and set(codes[5:]) == {429}
    assert client.get("/health", headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 429  # headers alone can't dodge it
    # The shipped default leaves room for a chatty single-page app (about 25 calls per page load).
    assert get_settings().__class__.model_fields["rate_limit_per_minute"].default >= 600


def test_concurrent_password_reset_only_consumes_once(client):
    from concurrent.futures import ThreadPoolExecutor

    signup(client)
    token = _token(_request_reset(client)["devResetLink"])

    def redeem(password):
        return client.post("/api/auth/reset-password", json={"token": token, "password": password}).status_code

    with ThreadPoolExecutor(max_workers=2) as workers:
        outcomes = list(workers.map(redeem, ["parallel-reset-one", "parallel-reset-two"]))
    assert sorted(outcomes) == [200, 400]


def test_production_reset_delivery_keeps_account_existence_private(client, monkeypatch):
    from app import email
    from app.config import get_settings

    signup(client)
    delivered = []

    async def deliver(to, subject, html):
        delivered.append(to)
        return True

    monkeypatch.setattr(get_settings(), "environment", "production")
    monkeypatch.setattr(email, "enabled", lambda: True)
    monkeypatch.setattr(email, "send_email", deliver)
    assert _request_reset(client) == _request_reset(client, "unknown@example.com")
    assert delivered == ["agency@example.com"]
