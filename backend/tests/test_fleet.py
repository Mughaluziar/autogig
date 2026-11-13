"""Agent Fleet Copilot: free-form commands become one validated action."""
import pytest

from conftest import bearer, signup
from app import llm
from app.routers import fleet

CONTEXT = {
    "agents": [
        {"id": "scout", "name": "Scout", "kind": "scout", "state": "running", "autonomy": "approve"},
        {"id": "writer", "name": "Writer", "kind": "writer", "state": "paused", "autonomy": "approve",
         "lastStatus": "error", "lastError": "Proposal service unreachable"},
    ],
    "pendingApprovals": 2,
    "dailyCap": 30,
}


def _ask(client, token, message, context=CONTEXT):
    return client.post("/api/fleet/copilot", json={"message": message, "context": context}, headers=bearer(token))


def test_copilot_requires_a_session(client):
    assert client.post("/api/fleet/copilot", json={"message": "hi"}).status_code == 401


def test_copilot_without_llm_says_so(client):
    token = signup(client)["token"]
    res = _ask(client, token, "please look after my fleet")
    assert res.status_code == 200
    assert res.json() == {"reply": None, "action": None, "aiGenerated": False}


def _fake_llm(monkeypatch, text):
    monkeypatch.setattr(llm, "enabled", lambda: True)

    async def fake_achat(messages, **kwargs):
        assert "Fleet context" in messages[1]["content"]
        return text
    monkeypatch.setattr(llm, "achat", fake_achat)


def test_copilot_returns_a_validated_action(client, monkeypatch):
    _fake_llm(monkeypatch, '```json\n{"reply": "Running Scout for Shopify now.", '
                           '"action": {"type": "run", "id": "scout", "query": "shopify"}}\n```')
    token = signup(client)["token"]
    body = _ask(client, token, "hunt down some shopify work").json()
    assert body["aiGenerated"] is True
    assert body["reply"] == "Running Scout for Shopify now."
    assert body["action"] == {"type": "run", "id": "scout", "dryRun": False, "query": "shopify"}


def test_copilot_drops_actions_on_unknown_agents(client, monkeypatch):
    _fake_llm(monkeypatch, '{"reply": "Done.", "action": {"type": "stop", "ids": ["someone-elses-agent"]}}')
    token = signup(client)["token"]
    body = _ask(client, token, "stop the other one").json()
    assert body["action"] is None
    assert body["reply"] == "Done."


def test_copilot_handles_non_json_output(client, monkeypatch):
    _fake_llm(monkeypatch, "Sure! I paused everything.")
    token = signup(client)["token"]
    assert _ask(client, token, "pause it").json() == {"reply": None, "action": None, "aiGenerated": False}


def test_copilot_rejects_oversized_context(client):
    token = signup(client)["token"]
    agents = [{"id": f"a{i}", "name": f"A{i}", "kind": "scout", "state": "running", "autonomy": "auto"} for i in range(21)]
    assert _ask(client, token, "status", {"agents": agents}).status_code == 422


@pytest.mark.parametrize("raw, expected", [
    ({"type": "pause", "ids": "all"}, {"type": "pause", "ids": "all"}),
    ({"type": "stop", "ids": "all"}, None),
    ({"type": "resume", "ids": ["writer", "nope"]}, {"type": "resume", "ids": ["writer"]}),
    ({"type": "kill", "on": "yes"}, None),
    ({"type": "autonomy", "id": "writer", "level": "auto"}, {"type": "autonomy", "id": "writer", "level": "auto"}),
    ({"type": "autonomy", "id": "writer", "level": "yolo"}, None),
    ({"type": "cap", "value": 20}, {"type": "cap", "value": 20}),
    ({"type": "cap", "value": 0}, None),
    ({"type": "cap", "value": True}, None),
    ({"type": "quiet", "start": "23:00", "end": "07:00"}, {"type": "quiet", "start": "23:00", "end": "07:00"}),
    ({"type": "quiet", "start": "25:00", "end": "07:00"}, None),
    ({"type": "digest"}, {"type": "digest"}),
    ({"type": "send_money"}, None),
    ("pause", None),
])
def test_action_validation(raw, expected):
    assert fleet._valid_action(raw, {"scout", "writer"}) == expected


DRAFT = {"jobId": "j1", "jobTitle": "Build a Shopify storefront", "jobDescription": "Need a theme.",
         "jobUrl": "https://example.com/j1", "platform": "Remotive", "matchScore": 82,
         "skills": "shopify, liquid", "tone": "concise", "instructions": "Mention I can start Monday."}


def test_draft_without_llm_uses_template_and_saves(client):
    token = signup(client)["token"]
    res = client.post("/api/fleet/draft", json=DRAFT, headers=bearer(token))
    assert res.status_code == 200
    body = res.json()
    assert body["aiGenerated"] is False
    assert "Build a Shopify storefront" in body["proposal"]
    saved = client.get("/api/radar/proposals", headers=bearer(token)).json()
    assert [p["id"] for p in saved] == [body["proposalId"]]
    assert saved[0]["status"] == "draft" and saved[0]["source"] == "Agent Fleet"


def test_draft_passes_the_users_rules_to_the_llm(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(llm, "enabled", lambda: True)

    async def fake_achat(messages, **kwargs):
        seen["system"] = messages[0]["content"]
        return "I can start Monday on your Shopify storefront."
    monkeypatch.setattr(llm, "achat", fake_achat)
    token = signup(client)["token"]
    body = client.post("/api/fleet/draft", json=DRAFT, headers=bearer(token)).json()
    assert body == {**body, "aiGenerated": True, "proposal": "I can start Monday on your Shopify storefront."}
    assert "Mention I can start Monday." in seen["system"]
    assert "concise" in seen["system"]


def test_draft_is_per_user(client):
    a = signup(client)["token"]
    b = signup(client, email="other@example.com")["token"]
    client.post("/api/fleet/draft", json=DRAFT, headers=bearer(a))
    assert client.get("/api/radar/proposals", headers=bearer(b)).json() == []
