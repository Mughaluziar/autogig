"""Messages between freelancers and agencies: who may start and read a thread, ordering and paging, exact unread
counts, one notification per burst, retries that don't duplicate, rate limits, and account deletion."""
from datetime import date, timedelta

import pytest

from app import datarights, db, repo
from app.config import get_settings
from conftest import bearer, run, signup

FUTURE = (date.today() + timedelta(days=30)).isoformat()


@pytest.fixture
def people(client):
    def make(email, role, name, **extra):
        data = signup(client, email=email, role=role, name=name, **extra)
        return {"h": bearer(data["token"]), "id": data["user"]["id"]}
    return {
        "agency": make("agency@example.com", "admin", "Ada Agency", company="Pixel Forge"),
        "agency2": make("agency2@example.com", "admin", "Other Agency"),
        "ann": make("ann@example.com", "freelancer", "Ann Dev"),
        "bob": make("bob@example.com", "freelancer", "Bob Dev"),
        "inv": make("inv@example.com", "investor", "Ivy Investor"),
    }


def spec(client, who, title="Build a dashboard"):
    res = client.post("/api/pool/admin/specs", headers=who["h"], json={"title": title, "estHours": 10, "deadline": FUTURE})
    assert res.status_code == 200, res.text
    return res.json()


def bid(client, who, spec_id):
    res = client.post(f"/api/pool/specs/{spec_id}/bid", headers=who["h"], json={"hours": 10, "rate": 30})
    assert res.status_code == 200, res.text
    return res.json()


def open_thread(client, who, spec_id, **body):
    return client.post("/api/pool/threads", headers=who["h"], json={"specId": spec_id, **body})


def send(client, who, thread_id, text, **extra):
    return client.post(f"/api/pool/threads/{thread_id}/messages", headers=who["h"], json={"body": text, **extra})


def page(client, who, thread_id, **params):
    res = client.get(f"/api/pool/threads/{thread_id}/messages", headers=who["h"], params=params)
    assert res.status_code == 200, res.text
    return res.json()


def unread(client, who):
    return client.get("/api/pool/threads/unread", headers=who["h"]).json()["unread"]


def message_notes(client, who):
    return [n for n in run(client, repo.list_for, "notifications", who["id"]) if n["title"] == "New message"]


# --------------------------------------------------------------------------- #
# Who may start, read and write
# --------------------------------------------------------------------------- #
def test_only_freelancers_and_agencies_with_a_session(client, people):
    s = spec(client, people["agency"])
    assert client.get("/api/pool/threads").status_code == 401
    assert client.get("/api/pool/threads", headers=people["inv"]["h"]).status_code == 403
    assert open_thread(client, people["inv"], s["id"]).status_code == 403


def test_freelancer_asks_about_an_open_spec_and_the_agency_sees_it(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    res = open_thread(client, ann, s["id"], message="Is the API already built?")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["created"] is True and body["message"]["fromMe"] is True and body["message"]["seq"] == 1
    assert body["thread"]["counterpart"] == {"name": "Pixel Forge", "role": "agency"}      # company name for an agency
    listed = client.get("/api/pool/threads", headers=agency["h"]).json()
    assert len(listed) == 1 and listed[0]["counterpart"] == {"name": "Ann Dev", "role": "freelancer"}
    assert listed[0]["unread"] == 1 and listed[0]["lastPreview"] == "Is the API already built?" and not listed[0]["lastFromMe"]
    assert unread(client, agency) == 1 and unread(client, ann) == 0
    assert len(message_notes(client, agency)) == 1
    # Opening it again returns the same thread, from either side.
    again = open_thread(client, ann, s["id"]).json()
    assert again["created"] is False and again["thread"]["id"] == body["thread"]["id"]
    from_agency = open_thread(client, agency, s["id"], freelancerId=ann["id"]).json()
    assert from_agency["thread"]["id"] == body["thread"]["id"]


def test_first_message_retry_uses_the_same_client_id(client, people):
    s = spec(client, people["agency"])
    first = open_thread(client, people["ann"], s["id"], message="Can we discuss the scope?", clientId="first-message-123")
    retry = open_thread(client, people["ann"], s["id"], message="Can we discuss the scope?", clientId="first-message-123")
    assert first.status_code == retry.status_code == 200
    assert first.json()["message"]["id"] == retry.json()["message"]["id"]
    assert len(page(client, people["ann"], first.json()["thread"]["id"])["messages"]) == 1
    assert open_thread(client, people["ann"], s["id"], message="Hi", clientId="bad!").status_code == 422


def test_freelancer_cannot_start_about_a_closed_spec_they_never_bid_on(client, people):
    agency, ann, bob = people["agency"], people["ann"], people["bob"]
    s = spec(client, agency)
    bid(client, ann, s["id"])
    assert client.post(f"/api/pool/admin/specs/{s['id']}/close", headers=agency["h"]).status_code == 200
    assert open_thread(client, bob, s["id"]).status_code == 404            # no relationship any more
    assert open_thread(client, ann, s["id"]).status_code == 200            # bid on it: may still ask why
    assert open_thread(client, ann, "no-such-spec").status_code == 404


def test_agency_can_only_start_with_its_own_bidders_and_contractors(client, people):
    agency, agency2, ann, bob = people["agency"], people["agency2"], people["ann"], people["bob"]
    s = spec(client, agency)
    assert open_thread(client, agency, s["id"]).status_code == 422                          # who?
    assert open_thread(client, agency, s["id"], freelancerId=bob["id"]).status_code == 404  # bob never bid
    bid(client, ann, s["id"])
    assert open_thread(client, agency2, s["id"], freelancerId=ann["id"]).status_code == 404  # not agency2's spec
    assert open_thread(client, agency, s["id"], freelancerId=ann["id"]).status_code == 200
    # A withdrawn bid is invisible to the agency, so it can't be used to start a thread.
    s2 = spec(client, agency, "Second spec")
    bid(client, bob, s2["id"])
    client.delete(f"/api/pool/specs/{s2['id']}/bid", headers=bob["h"])
    assert open_thread(client, agency, s2["id"], freelancerId=bob["id"]).status_code == 404


def test_nobody_else_can_read_write_or_mark_a_thread(client, people):
    agency, agency2, ann, bob = people["agency"], people["agency2"], people["ann"], people["bob"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"], message="hello").json()["thread"]["id"]
    for outsider in (bob, agency2):
        assert client.get(f"/api/pool/threads/{tid}/messages", headers=outsider["h"]).status_code == 404
        assert send(client, outsider, tid, "hi").status_code == 404
        assert client.post(f"/api/pool/threads/{tid}/read", headers=outsider["h"], json={"seq": 1}).status_code == 404
        assert client.get("/api/pool/threads", headers=outsider["h"]).json() == []


# --------------------------------------------------------------------------- #
# Ordering, paging, read state
# --------------------------------------------------------------------------- #
def test_messages_are_ordered_and_page_both_ways(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"]).json()["thread"]["id"]
    for i in range(1, 8):
        who = ann if i % 2 else agency
        assert send(client, who, tid, f"m{i}").json()["seq"] == i
    latest = page(client, ann, tid, limit=3)
    assert [m["body"] for m in latest["messages"]] == ["m5", "m6", "m7"] and latest["hasMore"] is True
    older = page(client, ann, tid, limit=3, before=5)
    assert [m["body"] for m in older["messages"]] == ["m2", "m3", "m4"] and older["hasMore"] is True
    oldest = page(client, ann, tid, limit=3, before=2)
    assert [m["body"] for m in oldest["messages"]] == ["m1"] and oldest["hasMore"] is False
    newer = page(client, ann, tid, after=5)
    assert [m["body"] for m in newer["messages"]] == ["m6", "m7"] and newer["hasMore"] is False
    assert page(client, ann, tid, after=7)["messages"] == []
    # Sender names and sides come from the thread.
    m = latest["messages"][1]                          # m6, from the agency
    assert m["senderRole"] == "agency" and m["senderName"] == "Pixel Forge" and m["fromMe"] is False
    # The first (non-polling) page carries where the work stands.
    assert latest["thread"]["context"] == {"specStatus": "open", "bidStatus": None, "contractId": None, "contractStatus": None}
    assert latest["thread"]["canSend"] is True


def test_unread_counts_are_exact_and_read_markers_only_move_forward(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"]).json()["thread"]["id"]
    for text in ("one", "two", "three"):
        send(client, ann, tid, text)
    assert unread(client, agency) == 3 and unread(client, ann) == 0      # your own messages are never unread
    # Fetching does not mark anything read; /read does, up to what was shown.
    page(client, agency, tid)
    assert unread(client, agency) == 3
    res = client.post(f"/api/pool/threads/{tid}/read", headers=agency["h"], json={"seq": 2}).json()
    assert res == {"readSeq": 2, "unread": 1}
    assert client.post(f"/api/pool/threads/{tid}/read", headers=agency["h"], json={"seq": 1}).json()["readSeq"] == 2
    assert client.post(f"/api/pool/threads/{tid}/read", headers=agency["h"], json={"seq": 999}).json() == {"readSeq": 3, "unread": 0}
    # Replying counts as having read the thread, and the other side can see how far you read.
    send(client, ann, tid, "four")
    send(client, agency, tid, "reply")
    assert unread(client, agency) == 0 and unread(client, ann) == 1
    assert client.get("/api/pool/threads", headers=ann["h"]).json()[0]["theirReadSeq"] == 5


def test_one_notification_per_unread_burst(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"], message="first").json()["thread"]["id"]
    send(client, ann, tid, "second")
    send(client, ann, tid, "third")
    notes = message_notes(client, agency)
    assert len(notes) == 1 and "Ann Dev" in notes[0]["body"] and "Build a dashboard" in notes[0]["body"]
    assert "first" not in notes[0]["body"]                                 # the notification carries no message text
    client.post(f"/api/pool/threads/{tid}/read", headers=agency["h"], json={"seq": 3})
    send(client, ann, tid, "fourth")
    assert len(message_notes(client, agency)) == 2


def test_thread_list_is_ordered_by_latest_activity(client, people):
    agency, ann, bob = people["agency"], people["ann"], people["bob"]
    s1, s2 = spec(client, agency, "Spec one"), spec(client, agency, "Spec two")
    t1 = open_thread(client, ann, s1["id"], message="a").json()["thread"]["id"]
    open_thread(client, bob, s2["id"], message="b")
    send(client, ann, t1, "newest")
    titles = [t["title"] for t in client.get("/api/pool/threads", headers=agency["h"]).json()]
    assert titles == ["Spec one", "Spec two"]


# --------------------------------------------------------------------------- #
# Input, retries and limits
# --------------------------------------------------------------------------- #
def test_message_validation_and_cleaning(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"]).json()["thread"]["id"]
    assert send(client, ann, tid, "").status_code == 422
    assert send(client, ann, tid, "   \n\t ").status_code == 422
    assert send(client, ann, tid, "x" * 4001).status_code == 422
    assert send(client, ann, tid, "ok", clientId="bad id!").status_code == 422
    res = send(client, ann, tid, "  line one\r\nline\x00 two\x07  ")
    assert res.status_code == 200 and res.json()["body"] == "line one\nline two"


def test_a_retried_send_does_not_duplicate(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"]).json()["thread"]["id"]
    first = send(client, ann, tid, "only once", clientId="c-1234567890").json()
    again = send(client, ann, tid, "only once", clientId="c-1234567890").json()
    assert first["id"] == again["id"] and first["clientId"] == "c-1234567890"
    assert len(page(client, agency, tid)["messages"]) == 1 and unread(client, agency) == 1


def test_failed_message_insert_does_not_leave_a_false_preview(client, people, monkeypatch):
    from app.pool import store

    agency, ann = people["agency"], people["ann"]
    tid = open_thread(client, ann, spec(client, agency)["id"]).json()["thread"]["id"]
    original_insert = store.insert

    async def interrupted(coll, fields):
        if coll == "messages":
            raise RuntimeError("simulated message write failure")
        return await original_insert(coll, fields)

    with monkeypatch.context() as patch:
        patch.setattr(store, "insert", interrupted)
        assert send(client, ann, tid, "this did not arrive").status_code == 500
    listed = client.get("/api/pool/threads", headers=agency["h"]).json()[0]
    assert listed["lastPreview"] == "" and listed["lastMessageAt"] is None
    assert unread(client, agency) == 0 and page(client, agency, tid)["messages"] == []


def test_sending_is_rate_limited_per_user(client, people, monkeypatch):
    monkeypatch.setattr(get_settings(), "pool_message_rate_per_minute", 3)
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"]).json()["thread"]["id"]
    for i in range(3):
        assert send(client, ann, tid, f"m{i}").status_code == 200
    res = send(client, ann, tid, "too many")
    assert res.status_code == 429 and int(res.headers["Retry-After"]) >= 1
    assert send(client, agency, tid, "the agency has its own budget").status_code == 200


# --------------------------------------------------------------------------- #
# Starting points and context
# --------------------------------------------------------------------------- #
def test_options_list_what_each_side_can_start(client, people):
    agency, ann, bob = people["agency"], people["ann"], people["bob"]
    open_spec, bid_spec, won_spec = spec(client, agency, "Open one"), spec(client, agency, "Bid one"), spec(client, agency, "Won one")
    bid(client, ann, bid_spec["id"])
    won_bid = bid(client, ann, won_spec["id"])
    client.post(f"/api/pool/admin/specs/{won_spec['id']}/award", headers=agency["h"], json={"bidId": won_bid["id"]})
    bid(client, bob, bid_spec["id"])
    tid = open_thread(client, ann, bid_spec["id"]).json()["thread"]["id"]

    mine = {o["title"]: o for o in client.get("/api/pool/threads/options", headers=ann["h"]).json()}
    assert mine["Won one"]["context"] == "contract" and mine["Bid one"]["context"] == "bid" and mine["Open one"]["context"] == "open"
    assert mine["Bid one"]["threadId"] == tid and mine["Open one"]["threadId"] is None
    assert [o["context"] for o in client.get("/api/pool/threads/options", headers=ann["h"]).json()] == ["contract", "bid", "open"]

    theirs = client.get("/api/pool/threads/options", headers=agency["h"]).json()
    pairs = {(o["title"], o["freelancerName"], o["context"]) for o in theirs}
    assert pairs == {("Won one", "Ann Dev", "contract"), ("Bid one", "Ann Dev", "bid"), ("Bid one", "Bob Dev", "bid")}
    assert client.get("/api/pool/threads/options", headers=people["agency2"]["h"]).json() == []

    detail = page(client, ann, open_thread(client, ann, won_spec["id"]).json()["thread"]["id"])["thread"]["context"]
    assert detail["specStatus"] == "awarded" and detail["bidStatus"] == "awarded" and detail["contractStatus"] == "active"


# --------------------------------------------------------------------------- #
# Account deletion and export
# --------------------------------------------------------------------------- #
def test_export_contains_both_sides_of_your_own_conversations(client, people):
    agency, ann, bob = people["agency"], people["ann"], people["bob"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"], message="from ann").json()["thread"]["id"]
    send(client, agency, tid, "from agency")
    open_thread(client, bob, s["id"], message="from bob")
    doc = run(client, db.find_user_by_id, ann["id"])
    records = run(client, datarights.build_export, doc)["records"]
    assert [t["id"] for t in records["pool_threads"]] == [tid]
    assert sorted(m["body"] for m in records["pool_messages"]) == ["from agency", "from ann"]


def test_deleting_an_account_removes_its_words_but_not_the_other_persons(client, people):
    agency, ann = people["agency"], people["ann"]
    s = spec(client, agency)
    tid = open_thread(client, ann, s["id"], message="from ann").json()["thread"]["id"]
    send(client, agency, tid, "from agency")
    doc = run(client, db.find_user_by_id, agency["id"])
    result = run(client, datarights.execute_deletion, doc)
    assert result["anonymized"]["pool_threads"] == 1 and result["anonymized"]["pool_messages"] == 1
    assert result["retained"]["pool_messages"] == 1

    view = page(client, ann, tid)
    by_me = {m["fromMe"]: m for m in view["messages"]}
    assert by_me[True]["body"] == "from ann" and by_me[True]["removed"] is False
    assert by_me[False]["removed"] is True and by_me[False]["body"] == ""
    assert view["thread"]["counterpart"]["name"].startswith("Deleted user ")
    assert view["thread"]["lastPreview"] == "" and view["thread"]["canSend"] is False
    assert send(client, ann, tid, "anyone there?").status_code == 409
