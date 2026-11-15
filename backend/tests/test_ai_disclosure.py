"""AI-drafted replies carry a disclosure line; the wording is editable but cannot be removed or made untrue."""
import pytest

from app import disclosure
from conftest import bearer, signup


def message(client, h):
    """An inbound marketplace message for the user (via the paste/forward path used elsewhere)."""
    from app import repo
    from conftest import run
    uid = client.get("/api/auth/me", headers=h).json()["user"]["id"]
    return run(client, repo.add, "messages", uid, {"direction": "inbound", "platform": "Upwork", "sender": "Client X",
                                                    "subject": "Question", "body": "Can you start Monday?"})["id"]


@pytest.fixture
def user(client):
    return bearer(signup(client, email="fl@example.com", role="freelancer", name="Fay Lance")["token"])


def test_a_drafted_reply_says_it_is_ai_assisted_and_includes_the_disclosure_line(client, user):
    mid = message(client, user)
    res = client.post("/api/inbox/reply-draft", headers=user, json={"messageId": mid, "tone": "professional"})
    assert res.status_code == 200
    body = res.json()
    assert body["aiAssisted"] is True and body["disclosure"] == disclosure.DEFAULT and "AI" in body["disclosure"]
    assert body["reply"] and body["disclosure"] not in body["reply"]          # the body stays editable; the line is added when copied
    assert body.get("sent") is None or body["sent"] is False


def test_the_wording_can_be_customised_but_must_still_say_ai(client, user):
    ok = client.patch("/api/settings", headers=user, json={"aiDisclosure": "Written with AI help and checked by me, Fay."})
    assert ok.status_code == 200
    mid = message(client, user)
    assert client.post("/api/inbox/reply-draft", headers=user, json={"messageId": mid, "tone": "friendly"}).json()["disclosure"] == "Written with AI help and checked by me, Fay."


@pytest.mark.parametrize("bad", ["", "   ", "Written by me personally", "Human written", "x", "AI" * 200])
def test_a_disclosure_that_is_empty_untrue_or_oversized_is_refused(client, user, bad):
    assert client.patch("/api/settings", headers=user, json={"aiDisclosure": bad}).status_code == 422


def test_an_invalid_stored_value_falls_back_to_the_default(client, user):
    from app import repo
    from conftest import run
    uid = client.get("/api/auth/me", headers=user).json()["user"]["id"]
    run(client, repo.update_settings_doc, uid, {"aiDisclosure": "nothing to see"}, {})      # bypassing the route
    assert run(client, disclosure.line_for, uid) == disclosure.DEFAULT


def test_append_is_idempotent_and_keeps_the_body():
    text = disclosure.append("Hello there.", disclosure.DEFAULT)
    assert text == f"Hello there.\n\n{disclosure.DEFAULT}"
    assert disclosure.append(text, disclosure.DEFAULT) == text


def test_persona_messages_in_the_demo_conversation_always_carry_the_disclosure(monkeypatch):
    """The demo router is mounted only with SEED_DEMO_DATA (never in production), so call its handlers directly."""
    from app import store
    from app.routers import operations
    monkeypatch.setitem(store.DB, "conversations", [{"id": "cv-test", "contact": "Client", "channel": "email"}])
    monkeypatch.setitem(store.DB, "chat_messages", [])
    body = operations.send_message("cv-test", operations.SendMessage(text="Happy to help.", persona="Sarah (PM)"))
    assert body["aiAssisted"] is True and body["text"].startswith("Happy to help.") and disclosure.DEFAULT in body["text"]
    draft = operations.auto_reply("cv-test", operations.AutoReplyBody())
    assert draft["sent"] is False and draft["aiAssisted"] is True and draft["disclosure"] == disclosure.DEFAULT
