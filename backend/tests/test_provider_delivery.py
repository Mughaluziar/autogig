import asyncio
import json

import httpx
import pytest

from app import email, llm
from app.config import get_settings
from conftest import bearer, signup


@pytest.mark.parametrize("outcome", ["success", "throttle", "timeout", "malformed"])
@pytest.mark.parametrize(("path", "role", "body"), [
    ("/api/upwork/proposal/prepare", "admin", {"title": "Mongo migration"}),
    ("/api/radar/proposal", "freelancer", {"jobTitle": "Mongo migration", "platform": "Upwork"}),
])
def test_proposal_routes_use_groq_or_fall_back(client, monkeypatch, outcome, path, role, body):
    monkeypatch.setattr(get_settings(), "groq_api_key", "mock-groq-key")
    real_client = httpx.Client
    calls = []
    draft = "I can review your migration plan and deliver a tested account-storage upgrade."

    def respond(request):
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer mock-groq-key"
        assert request.url.host == "api.groq.com"
        assert "Mongo migration" in json.loads(request.content)["messages"][1]["content"]
        if outcome == "timeout":
            raise httpx.ReadTimeout("mock timeout", request=request)
        if outcome == "throttle":
            return httpx.Response(429, headers={"Retry-After": "10"})
        if outcome == "malformed":
            return httpx.Response(200, json={"choices": []})
        return httpx.Response(200, json={"choices": [{"message": {"content": draft}}]})

    monkeypatch.setattr(llm.httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    account = signup(client, role=role)
    result = client.post(path, headers=bearer(account["token"]), json={"jobId": "mock", **body})
    if path == "/api/radar/proposal":
        assert result.json()["manualSubmitOnly"] is True
    assert result.status_code == 200
    assert result.json()["aiGenerated"] is (outcome == "success")
    assert (result.json()["proposal"] == draft) is (outcome == "success")
    assert len(calls) == 1


@pytest.mark.parametrize("status", [201, 429, 500])
def test_resend_delivery_and_smtp_fallback(monkeypatch, status):
    settings = get_settings()
    monkeypatch.setattr(settings, "resend_api_key", "mock-resend-key")
    for attr in ("smtp_host", "smtp_user", "smtp_password"):
        monkeypatch.setattr(settings, attr, "mock")
    smtp_calls = []

    async def respond(self, request, **kwargs):
        assert request.url.host == "api.resend.com"
        assert request.headers["Authorization"] == "Bearer mock-resend-key"
        assert json.loads(request.content)["to"] == ["recipient@example.com"]
        return httpx.Response(status)

    monkeypatch.setattr(httpx.AsyncClient, "send", respond)
    monkeypatch.setattr(email, "_smtp_send_sync", lambda *args: smtp_calls.append(args) or True)
    assert asyncio.run(email.send_email("recipient@example.com", "Subject", "<p>Message</p>"))
    assert bool(smtp_calls) is (status != 201)
