"""Client IP for per-IP limits behind reverse proxies, and the owner-only request diagnostic.

Each proxy hop appends the address it saw to X-Forwarded-For, so only entries from the RIGHT are
trustworthy. uvicorn's --forwarded-allow-ips='*' trusts the leftmost (client-chosen) entry, which let
anyone dodge the per-IP rate limits by sending a made-up header; the app now picks the entry itself.
"""
import pytest
from starlette.requests import Request

from app import security
from app.config import get_settings
from conftest import bearer, signup


def req(xff=None, peer="10.0.0.1"):
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1234)})


@pytest.fixture
def hops(monkeypatch):
    def set_hops(n):
        monkeypatch.setattr(get_settings(), "trusted_proxy_hops", n)
    return set_hops


def test_zero_hops_ignores_the_header_entirely(hops):
    hops(0)
    assert security.client_ip(req("1.2.3.4")) == "10.0.0.1"


def test_one_proxy_trusts_only_the_last_entry(hops):
    hops(1)
    assert security.client_ip(req("203.0.113.9")) == "203.0.113.9"
    assert security.client_ip(req("6.6.6.6, 203.0.113.9")) == "203.0.113.9"           # client-chosen prefix ignored
    assert security.client_ip(req("6.6.6.6, 7.7.7.7, 203.0.113.9")) == "203.0.113.9"


def test_two_proxies_trust_the_second_from_the_end(hops):
    hops(2)                                                                              # Vercel -> Render
    assert security.client_ip(req("198.51.100.7, 76.76.21.21")) == "198.51.100.7"
    assert security.client_ip(req("6.6.6.6, 198.51.100.7, 76.76.21.21")) == "198.51.100.7"


def test_a_shorter_chain_than_expected_falls_back_to_the_socket_peer(hops):
    hops(2)
    assert security.client_ip(req("203.0.113.9")) == "10.0.0.1"
    assert security.client_ip(req(None)) == "10.0.0.1"
    hops(1)
    assert security.client_ip(req(None)) == "10.0.0.1"


def test_blank_entries_and_oversized_values_are_handled(hops):
    hops(1)
    assert security.client_ip(req(" , ")) == "10.0.0.1"
    assert len(security.client_ip(req("x" * 500))) <= 64


def test_rotating_a_spoofed_prefix_cannot_dodge_the_rate_limit(client, hops, monkeypatch):
    hops(1)
    monkeypatch.setattr(get_settings(), "rate_limit_per_minute", 5)
    codes = [client.get("/health", headers={"X-Forwarded-For": f"10.9.9.{i}, 203.0.113.9"}).status_code for i in range(8)]
    assert codes[:5] == [200] * 5 and set(codes[5:]) == {429}
    # A different real client (the entry the proxy appended) has its own budget.
    assert client.get("/health", headers={"X-Forwarded-For": "10.9.9.1, 198.51.100.50"}).status_code == 200


def test_credential_budget_is_per_real_client_not_per_spoofed_header(client, hops):
    hops(1)
    codes = [client.post("/api/auth/login", json={"email": f"u{i}@example.com", "password": "x"},
                         headers={"X-Forwarded-For": f"1.1.1.{i}, 203.0.113.9"}).status_code
             for i in range(security._AUTH_RATE_MAX + 2)]
    assert codes[:security._AUTH_RATE_MAX] == [401] * security._AUTH_RATE_MAX and set(codes[security._AUTH_RATE_MAX:]) == {429}


def test_diag_endpoint_is_owner_only_and_reports_the_derived_ip(client, hops):
    hops(1)
    owner = bearer(signup(client, email="owner@example.com", role="admin")["token"])
    agency = bearer(signup(client, email="agency@example.com", role="admin")["token"])
    assert client.get("/api/diag/request").status_code == 401
    assert client.get("/api/diag/request", headers=agency).status_code == 403
    res = client.get("/api/diag/request", headers={**owner, "X-Forwarded-For": "6.6.6.6, 203.0.113.9",
                                                    "X-Forwarded-Proto": "https", "Origin": "http://localhost:3000"})
    body = res.json()
    assert res.status_code == 200
    assert body["clientIp"] == "203.0.113.9" and body["trustedProxyHops"] == 1 and body["secureCookies"] is True
    assert body["xForwardedFor"] == "6.6.6.6, 203.0.113.9"
