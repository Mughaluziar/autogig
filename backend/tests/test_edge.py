"""Edge proof (R1): only requests signed by our own website proxy get their client address trusted, and with
REQUIRE_EDGE_PROOF the public API address cannot be used to get around the website."""
import time
import uuid

import pytest

from app import edge, security
from app.config import get_settings
from conftest import bearer, signup

SECRET = "s" * 40
OLD = "o" * 40


@pytest.fixture(autouse=True)
def configured(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "edge_shared_secret", SECRET)
    monkeypatch.setattr(s, "edge_shared_secret_previous", None)
    monkeypatch.setattr(s, "require_edge_proof", False)
    monkeypatch.setattr(s, "trusted_proxy_hops", 1)


def signed(method="GET", path="/api/auth/me", ip="203.0.113.7", secret=SECRET, ts=None, nonce=None):
    ts = str(int(time.time()) if ts is None else ts)
    nonce = nonce or uuid.uuid4().hex
    return {"x-edge-ts": ts, "x-edge-ip": ip, "x-edge-nonce": nonce, "x-edge-sig": edge.sign(secret, ts, method, path, ip, nonce)}


_tokens: dict = {}


def whoami(client, headers):
    if id(client) not in _tokens:
        _tokens.clear()
        _tokens[id(client)] = signup(client, email="owner@example.com")["token"]
    h = {**bearer(_tokens[id(client)]), **headers}
    return client.get("/api/diag/request", headers=h)


def test_a_valid_signature_makes_the_signed_address_the_client(client):
    res = whoami(client, {**signed(path="/api/diag/request"), "x-forwarded-for": "1.2.3.4, 9.9.9.9"})
    body = res.json()
    assert body["edgeProof"] == "verified" and body["clientIp"] == "203.0.113.7" and body["edgeIp"] == "203.0.113.7"


def test_forged_or_missing_proof_is_treated_as_direct(client):
    forged = {"x-edge-ts": str(int(time.time())), "x-edge-ip": "198.51.100.99", "x-edge-nonce": uuid.uuid4().hex, "x-edge-sig": "0" * 64}
    body = whoami(client, {**forged, "x-forwarded-for": "6.6.6.6, 5.5.5.5"}).json()
    assert body["edgeProof"] == "invalid signature" and body["clientIp"] == "5.5.5.5" and body["edgeIp"] is None   # rightmost XFF (hops=1), not the forged ip
    assert whoami_again(client, {"x-forwarded-for": "6.6.6.6, 5.5.5.5"})["edgeProof"] == "absent"


def whoami_again(client, headers):
    return whoami(client, headers).json()


@pytest.mark.parametrize("tamper", ["method", "path", "ip", "ts", "nonce"])
def test_the_signature_is_bound_to_method_path_ip_and_time(client, tamper):
    good = signed(method="GET", path="/api/diag/request")
    if tamper == "method":
        good = signed(method="POST", path="/api/diag/request")
    elif tamper == "path":
        good = signed(path="/api/something/else")
    elif tamper == "ip":
        good = {**good, "x-edge-ip": "198.51.100.1"}
    elif tamper == "nonce":
        good = {**good, "x-edge-nonce": "z" * 32}
    else:
        good = {**good, "x-edge-ts": str(int(good["x-edge-ts"]) + 1)}
    assert whoami(client, good).json()["edgeProof"] == "invalid signature"


@pytest.mark.parametrize("offset", [-120, 120])      # margin: the request may be handled seconds after signing on a busy machine
def test_old_and_future_timestamps_are_rejected(client, offset):
    headers = signed(path="/api/diag/request", ts=int(time.time()) + offset)
    assert whoami(client, headers).json()["edgeProof"] == "expired"


def test_bad_timestamp_and_oversized_ip(client):
    assert whoami(client, {"x-edge-ts": "abc", "x-edge-ip": "1.1.1.1", "x-edge-nonce": "n" * 20, "x-edge-sig": "00"}).json()["edgeProof"] == "invalid timestamp"
    long_ip = "1" * 80
    assert whoami(client, signed(path="/api/diag/request", ip=long_ip)).json()["edgeProof"] == "invalid"


def test_previous_secret_is_accepted_for_rotation(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "edge_shared_secret", "n" * 40)
    monkeypatch.setattr(get_settings(), "edge_shared_secret_previous", OLD)
    assert whoami(client, signed(path="/api/diag/request", secret=OLD)).json()["edgeProof"] == "verified"
    assert whoami(client, signed(path="/api/diag/request", secret="n" * 40)).json()["edgeProof"] == "verified"
    assert whoami(client, signed(path="/api/diag/request", secret=SECRET)).json()["edgeProof"] == "invalid signature"


def test_not_configured_means_direct_handling(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "edge_shared_secret", None)
    body = whoami(client, signed(path="/api/diag/request")).json()
    assert body["edgeProof"] == "not configured" and body["edgeIp"] is None


def test_requirement_blocks_direct_requests_but_not_signed_ones(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "require_edge_proof", True)
    direct = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 12})
    assert direct.status_code == 403 and "website" in direct.json()["detail"]
    ok = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 12}, headers=signed("POST", "/api/auth/login"))
    assert ok.status_code == 401                                   # reached the login handler: wrong credentials
    assert client.get("/health").status_code == 200                # health check stays open
    assert client.options("/api/auth/login").status_code != 403    # CORS preflight is not blocked here


def test_machine_callers_and_api_keys_are_exempt(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "require_edge_proof", True)
    for path in ("/api/inbox/inbound", "/api/payments/stripe/webhook", "/api/orders/webhooks/nango"):
        assert client.post(path, json={}).status_code != 403, path
    callback = client.get("/api/auth/oauth/google/callback", follow_redirects=False)
    assert "website" not in callback.text                         # not the edge refusal (the route answers for itself)
    assert client.get("/api/notifications", headers={"Authorization": "Bearer apk_notarealkey"}).status_code == 401   # key checked, not edge
    assert client.get("/api/notifications", headers={"Authorization": "Bearer not-a-key"}).status_code == 403


def test_signed_ip_drives_the_per_ip_limits(client, monkeypatch):
    """Two different signed addresses have separate budgets; a forged X-Forwarded-For adds nothing."""
    monkeypatch.setattr(get_settings(), "require_edge_proof", True)
    body = lambda: {"email": "z@example.com", "password": "wrong-wrong"}
    for i in range(security._AUTH_RATE_MAX):
        assert client.post("/api/auth/login", json=body(), headers={**signed("POST", "/api/auth/login", ip="203.0.113.50"),
                                                                    "x-forwarded-for": f"10.0.0.{i}"}).status_code in (401, 429)
    limited = client.post("/api/auth/login", json=body(), headers={**signed("POST", "/api/auth/login", ip="203.0.113.50"), "x-forwarded-for": "10.9.9.9"})
    assert limited.status_code == 429
    other = client.post("/api/auth/login", json={"email": "y@example.com", "password": "wrong-wrong"},
                        headers=signed("POST", "/api/auth/login", ip="203.0.113.51"))
    assert other.status_code == 401


def test_production_requires_a_real_secret(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "environment", "production")
    monkeypatch.setattr(s, "require_edge_proof", True)
    monkeypatch.setattr(s, "edge_shared_secret", None)
    assert any("EDGE_SHARED_SECRET" in p for p in s.production_problems())
    monkeypatch.setattr(s, "edge_shared_secret", "short")
    assert any("at least 32" in p for p in s.production_problems())
    monkeypatch.setattr(s, "edge_shared_secret", SECRET)
    assert not any("EDGE_SHARED_SECRET" in p for p in s.production_problems())
    monkeypatch.setattr(s, "require_edge_proof", False)
    assert any("REQUIRE_EDGE_PROOF is off" in w for w in s.production_warnings())
    monkeypatch.setattr(s, "edge_shared_secret", None)
    assert any("No EDGE_SHARED_SECRET" in w for w in s.production_warnings())


def test_signature_matches_the_javascript_implementation():
    """lib/edge-sign.test.mjs asserts the same vector; the two sides must agree byte for byte."""
    assert edge.sign("s" * 40, "1760000000", "POST", "/api/auth/login", "203.0.113.7", "n" * 32) == "8e59b114015e3636f22308e735ff0f2b48bdc71df88c360b9f9f8d84dfb8479c"


def test_diag_sleep_is_owner_only_off_by_default_and_capped(client, monkeypatch):
    owner = bearer(signup(client, email="owner@example.com")["token"])
    other = bearer(signup(client, email="other@example.com")["token"])
    assert client.get("/api/diag/sleep?seconds=0", headers=owner).status_code == 404            # disabled by default
    monkeypatch.setattr(get_settings(), "enable_diag_sleep", True)
    assert client.get("/api/diag/sleep?seconds=0", headers=other).status_code == 403
    assert client.get("/api/diag/sleep?seconds=0", headers=owner).json() == {"slept": 0}
    assert client.get("/api/diag/sleep?seconds=-5", headers=owner).json() == {"slept": 0}
    monkeypatch.setattr(get_settings(), "environment", "production")
    assert any("ENABLE_DIAG_SLEEP" in p for p in get_settings().production_problems())


def test_skew_boundary_is_exactly_the_configured_window():
    from starlette.requests import Request

    def req(ts):
        h = signed(path="/x", ts=ts)
        scope = {"type": "http", "method": "GET", "path": "/x", "headers": [(k.encode(), v.encode()) for k, v in h.items()]}
        return Request(scope)
    base = 1_800_000_000
    assert edge.verify(req(base), now=base + 60)[0] is True
    assert edge.verify(req(base), now=base + 61) == (False, "expired")
    assert edge.verify(req(base), now=base - 60)[0] is True
    assert edge.verify(req(base), now=base - 61) == (False, "expired")


def test_a_replayed_signed_request_is_refused(client, monkeypatch):
    """Capturing a valid signed request and sending it again (same nonce) must not be trusted a second time."""
    monkeypatch.setattr(get_settings(), "require_edge_proof", True)
    headers = signed("POST", "/api/auth/login", ip="203.0.113.60")
    body = {"email": "r@example.com", "password": "wrong-wrong-1"}
    first = client.post("/api/auth/login", json=body, headers=headers)
    assert first.status_code == 401                                     # accepted as a website request (wrong password)
    again = client.post("/api/auth/login", json=body, headers=headers)
    assert again.status_code == 403 and "website" in again.json()["detail"]


def test_replay_is_reported_in_diagnostics_and_a_fresh_nonce_works(client):
    h = signed(path="/api/diag/request")
    assert whoami(client, h).json()["edgeProof"] == "verified"
    assert whoami(client, h).json()["edgeProof"] == "replayed"          # same nonce, same signature
    assert whoami(client, signed(path="/api/diag/request")).json()["edgeProof"] == "verified"


def test_a_missing_or_short_nonce_is_not_accepted(client):
    h = signed(path="/api/diag/request")
    no_nonce = {k: v for k, v in h.items() if k != "x-edge-nonce"}
    assert whoami(client, no_nonce).json()["edgeProof"] == "absent"
    ts = str(int(time.time()))
    short = {"x-edge-ts": ts, "x-edge-ip": "1.1.1.1", "x-edge-nonce": "abc", "x-edge-sig": edge.sign(SECRET, ts, "GET", "/api/diag/request", "1.1.1.1", "abc")}
    assert whoami(client, short).json()["edgeProof"] == "invalid"


def test_nonces_expire_so_the_store_does_not_grow(client):
    async def go():
        assert await edge.claim_nonce("a" * 20, now=1000.0)
        assert not await edge.claim_nonce("a" * 20, now=1010.0)
        assert await edge.claim_nonce("b" * 20, now=1000.0 + 500)           # the old one has expired and is pruned
        return len(edge._seen)
    assert client.portal.call(go) == 1
