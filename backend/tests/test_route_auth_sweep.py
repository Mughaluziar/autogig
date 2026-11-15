"""Security sweep: every route the API exposes must refuse an anonymous caller (401/403), except a short, reviewed
allowlist of public endpoints. A new route that forgets its guard fails here instead of shipping open.
Each public entry is authorised some other way: a token in the URL/body, a provider signature or secret, or it serves
no personal data."""
import re

import pytest

from app.main import app

PUBLIC = {
    ("GET", "/health"),
    ("GET", "/api/plans"), ("GET", "/api/legal/versions"), ("GET", "/api/token/transparency"), ("GET", "/api/auth/providers"),
    ("POST", "/api/auth/signup"), ("POST", "/api/auth/forgot-password"), ("POST", "/api/auth/reset-password"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/oauth/{provider}/start"), ("GET", "/api/auth/oauth/{provider}/callback"),
    ("POST", "/api/auth/oauth/{provider}/callback"), ("POST", "/api/auth/oauth/exchange"),
    ("POST", "/api/beta-testers"), ("POST", "/api/waitlist"),
    ("GET", "/api/pay/{token}"), ("POST", "/api/pay/{token}/checkout"),          # invoice link token
    ("POST", "/api/team/invite-preview"),                                          # invite token
    ("POST", "/api/inbox/inbound"), ("POST", "/api/orders/webhooks/nango"), ("POST", "/api/payments/stripe/webhook"),  # secrets/signatures
}


def _routes():
    for path, ops in app.openapi()["paths"].items():
        for method in ops:
            if method.upper() in ("GET", "POST", "PUT", "PATCH", "DELETE"):
                yield method.upper(), path


def test_every_route_refuses_anonymous_callers_except_the_reviewed_public_set(client):
    open_ = []
    for method, path in sorted(_routes()):
        if (method, path) in PUBLIC:
            continue
        url = re.sub(r"\{[^}]+\}", "x", path)
        resp = client.request(method, url, json={} if method not in ("GET", "DELETE") else None)
        if resp.status_code not in (401, 403):
            open_.append((method, path, resp.status_code))
    assert not open_, f"routes answering an anonymous caller without 401/403: {open_}"


@pytest.mark.parametrize("method,path", sorted(PUBLIC - {("GET", "/health")}))
def test_public_allowlist_has_no_stale_entries(method, path):
    assert (method, path) in set(_routes()), f"{method} {path} no longer exists; remove it from PUBLIC"


def test_public_webhooks_reject_unsigned_calls(client):
    assert client.post("/api/inbox/inbound", json={"from": "a@b.c", "subject": "s", "text": "t"}).status_code in (401, 403, 503, 422)
    assert client.post("/api/payments/stripe/webhook", content=b"{}").status_code in (400, 401, 403, 503)
    assert client.post("/api/orders/webhooks/nango", json={}).status_code in (400, 401, 403, 503)
