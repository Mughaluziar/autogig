"""Freelancer pool: specs -> blind bids -> award -> milestones -> earnings. Authorization first."""
from datetime import date, timedelta

import pytest

from conftest import bearer, signup

FUTURE = (date.today() + timedelta(days=30)).isoformat()


@pytest.fixture
def people(client):
    agency = bearer(signup(client, email="agency@example.com", role="admin")["token"])
    other_agency = bearer(signup(client, email="agency2@example.com", role="admin")["token"])
    ann = bearer(signup(client, email="ann@example.com", role="freelancer", name="Ann Dev")["token"])
    bob = bearer(signup(client, email="bob@example.com", role="freelancer", name="Bob Dev")["token"])
    investor = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    return agency, other_agency, ann, bob, investor


def spec(client, agency, **over):
    body = {"title": "Build a dashboard", "summary": "React + charts", "stack": ["React", "TypeScript"],
            "estHours": 80, "deadline": FUTURE, **over}
    res = client.post("/api/pool/admin/specs", headers=agency, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def bid(client, who, spec_id, hours=60, rate=28.5, **over):
    return client.post(f"/api/pool/specs/{spec_id}/bid", headers=who, json={"hours": hours, "rate": rate, **over})


def test_roles_are_enforced_on_every_pool_route(client, people):
    agency, _, ann, _, investor = people
    s = spec(client, agency)
    # Freelancer-only routes reject agencies and investors.
    for who in (agency, investor):
        assert client.get("/api/pool/specs", headers=who).status_code == 403
        assert bid(client, who, s["id"]).status_code == 403
        assert client.get("/api/pool/my-bids", headers=who).status_code == 403
        assert client.get("/api/pool/my-contracts", headers=who).status_code == 403
        assert client.get("/api/pool/earnings", headers=who).status_code == 403
    # Agency-only routes reject freelancers and investors.
    for who in (ann, investor):
        assert client.post("/api/pool/admin/specs", headers=who, json={"title": "x" * 5, "estHours": 5, "deadline": FUTURE}).status_code == 403
        assert client.get("/api/pool/admin/specs", headers=who).status_code == 403
        assert client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=who, json={"bidId": "x"}).status_code == 403
        assert client.get("/api/pool/admin/contracts", headers=who).status_code == 403
        assert client.get("/api/pool/admin/earnings", headers=who).status_code == 403
    assert client.get("/api/pool/specs").status_code == 401


def test_spec_validation(client, people):
    agency = people[0]
    bad = [{"title": "ab"}, {"estHours": 0}, {"deadline": "2020-01-01"}, {"deadline": "not-a-date"},
           {"maxRate": -1}, {"maxRate": 0.001}, {"maxRate": 1.005}, {"estHours": 99999}]
    for over in bad:
        body = {"title": "Valid title", "estHours": 10, "deadline": FUTURE, **over}
        assert client.post("/api/pool/admin/specs", headers=agency, json=body).status_code in (422,), over


def test_open_specs_show_bid_counts_but_never_other_freelancers_bids(client, people):
    agency, _, ann, bob, _ = people
    s = spec(client, agency)
    assert bid(client, ann, s["id"], 50, 30).status_code == 200
    assert bid(client, bob, s["id"], 70, 25).status_code == 200
    seen = client.get("/api/pool/specs", headers=ann).json()
    mine = next(x for x in seen if x["id"] == s["id"])
    assert mine["bidsIn"] == 2 and mine["myBid"]["hours"] == 50 and mine["myBid"]["rate"] == 30.0
    assert "bids" not in mine and 25 not in mine["myBid"].values()           # Bob's rate is not visible (compare values: a timestamp may contain "25")
    assert [b["spec"] for b in client.get("/api/pool/my-bids", headers=bob).json()] == ["Build a dashboard"]
    assert client.get("/api/pool/my-bids", headers=bob).json()[0]["total"] == 1750.0
    # The agency sees every bid with names.
    full = client.get("/api/pool/admin/specs", headers=agency).json()[0]
    assert {b["freelancerName"] for b in full["bids"]} == {"Ann Dev", "Bob Dev"}


def test_bid_rules_update_withdraw_and_max_rate(client, people):
    agency, _, ann, _, _ = people
    s = spec(client, agency, maxRate=40)
    assert bid(client, ann, s["id"], rate=55).status_code == 422                       # above the cap
    assert bid(client, ann, s["id"], hours=0).status_code == 422
    assert bid(client, ann, s["id"], rate=0).status_code == 422
    assert bid(client, ann, s["id"], rate=0.001).status_code == 422
    assert bid(client, ann, s["id"], rate=1.005).status_code == 422
    first = bid(client, ann, s["id"], 40, 30).json()
    again = bid(client, ann, s["id"], 45, 31).json()                                    # edit, not duplicate
    assert again["id"] == first["id"] and again["updated"] is True and again["hours"] == 45
    assert len(client.get("/api/pool/my-bids", headers=ann).json()) == 1
    assert client.delete(f"/api/pool/specs/{s['id']}/bid", headers=ann).status_code == 200
    assert client.get("/api/pool/my-bids", headers=ann).json() == []
    assert client.get("/api/pool/specs", headers=ann).json()[0]["bidsIn"] == 0
    assert bid(client, ann, s["id"], 20, 20).status_code == 200                         # can bid again after withdrawing
    assert bid(client, ann, "nope").status_code == 404


def test_award_creates_a_contract_rejects_other_bids_and_closes_the_spec(client, people):
    agency, _, ann, bob, _ = people
    s = spec(client, agency)
    a = bid(client, ann, s["id"], 50, 30).json()
    b = bid(client, bob, s["id"], 60, 20).json()
    res = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency, json={"bidId": a["id"]})
    assert res.status_code == 200
    contract = res.json()
    assert contract["value"] == 1500.0 and contract["milestonesTotal"] == 1 and contract["freelancerName"] == "Ann Dev"
    assert client.get("/api/pool/my-contracts", headers=ann).json()[0]["id"] == contract["id"]
    assert client.get("/api/pool/my-contracts", headers=bob).json() == []
    assert [x["status"] for x in client.get("/api/pool/my-bids", headers=bob).json()] == ["rejected"]
    assert client.get("/api/pool/specs", headers=bob).json() == []                      # no longer open
    assert bid(client, bob, s["id"]).status_code == 404
    # A second award on the same spec cannot win.
    assert client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency, json={"bidId": b["id"]}).status_code in (404, 409)


def test_award_with_milestones_must_add_up(client, people):
    agency, _, ann, _, _ = people
    s = spec(client, agency)
    a = bid(client, ann, s["id"], 10, 100).json()                                       # $1000
    wrong = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency,
                        json={"bidId": a["id"], "milestones": [{"title": "A", "amount": 400}, {"title": "B", "amount": 500}]})
    assert wrong.status_code == 422
    assert client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency,
                       json={"bidId": a["id"], "milestones": [
                           {"title": "A", "amount": 400.005}, {"title": "B", "amount": 599.995}]}).status_code == 422
    ok = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency,
                     json={"bidId": a["id"], "milestones": [{"title": "A", "amount": 400}, {"title": "B", "amount": 600}]})
    assert ok.status_code == 200 and ok.json()["milestonesTotal"] == 2


def test_interrupted_award_recovers_one_contract_with_original_terms(client, people, monkeypatch):
    from app.pool import store

    agency, _, ann, bob, _ = people
    posted = spec(client, agency)
    chosen = bid(client, ann, posted["id"], 10, 100).json()
    bid(client, bob, posted["id"], 10, 90)
    original_insert = store.insert
    failed = False

    async def interrupted(coll, fields):
        nonlocal failed
        if coll == "contracts" and not failed:
            failed = True
            raise RuntimeError("simulated process interruption")
        return await original_insert(coll, fields)

    with monkeypatch.context() as patch:
        patch.setattr(store, "insert", interrupted)
        failed_response = client.post(f"/api/pool/admin/specs/{posted['id']}/award", headers=agency,
                                      json={"bidId": chosen["id"], "milestones": [
                                          {"title": "First", "amount": 400}, {"title": "Second", "amount": 600}]})
        assert failed_response.status_code == 500

    recovered = client.post(f"/api/pool/admin/specs/{posted['id']}/award", headers=agency,
                            json={"bidId": chosen["id"], "milestones": []})
    assert recovered.status_code == 200, recovered.text
    assert [m["amount"] for m in recovered.json()["milestones"]] == [400, 600]
    assert len(client.get("/api/pool/admin/contracts", headers=agency).json()) == 1
    assert client.get("/api/pool/my-bids", headers=bob).json()[0]["status"] == "rejected"
    assert client.post(f"/api/pool/admin/specs/{posted['id']}/award", headers=agency,
                       json={"bidId": chosen["id"]}).status_code == 409


def test_interrupted_earning_is_repaired_without_duplicate_or_paid_reset(client, people, monkeypatch):
    from app.pool import store

    agency, _, ann, _, _ = people
    posted = spec(client, agency)
    chosen = bid(client, ann, posted["id"], 10, 100).json()
    contract = client.post(f"/api/pool/admin/specs/{posted['id']}/award", headers=agency,
                           json={"bidId": chosen["id"]}).json()
    milestone = contract["milestones"][0]["id"]
    assert client.post(f"/api/pool/contracts/{contract['id']}/milestones/{milestone}/deliver",
                       headers=ann, json={}).status_code == 200
    original_insert = store.insert
    failed = False

    async def interrupted(coll, fields):
        nonlocal failed
        if coll == "earnings" and not failed:
            failed = True
            raise RuntimeError("simulated process interruption")
        return await original_insert(coll, fields)

    with monkeypatch.context() as patch:
        patch.setattr(store, "insert", interrupted)
        failed_response = client.post(f"/api/pool/admin/contracts/{contract['id']}/milestones/{milestone}/approve",
                                      headers=agency)
        assert failed_response.status_code == 500
    # Listing the agency's specs repairs missing records if a process stopped after approval.
    assert client.get("/api/pool/admin/specs", headers=agency).status_code == 200
    entries = client.get("/api/pool/admin/earnings", headers=agency).json()["entries"]
    assert len(entries) == 1 and entries[0]["amount"] == 1000
    assert client.post(f"/api/pool/admin/earnings/{entries[0]['id']}/mark-paid", headers=agency).status_code == 200
    assert client.get("/api/pool/admin/specs", headers=agency).status_code == 200
    entries = client.get("/api/pool/admin/earnings", headers=agency).json()["entries"]
    assert len(entries) == 1 and entries[0]["status"] == "paid"


def test_agencies_cannot_touch_each_others_specs_contracts_or_earnings(client, people):
    agency, other, ann, _, _ = people
    s = spec(client, agency)
    a = bid(client, ann, s["id"]).json()
    assert client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=other, json={"bidId": a["id"]}).status_code == 404
    assert client.post(f"/api/pool/admin/specs/{s['id']}/close", headers=other).status_code == 404
    assert client.get("/api/pool/admin/specs", headers=other).json() == []
    c = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency, json={"bidId": a["id"]}).json()
    m = c["milestones"][0]["id"]
    assert client.post(f"/api/pool/contracts/{c['id']}/milestones/{m}/deliver", headers=ann, json={}).status_code == 200
    assert client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{m}/approve", headers=other).status_code == 404
    assert client.get("/api/pool/admin/contracts", headers=other).json() == []


def test_full_loop_deliver_approve_earn_and_record_payout(client, people):
    agency, _, ann, bob, _ = people
    s = spec(client, agency)
    a = bid(client, ann, s["id"], 20, 50).json()                                        # $1000
    c = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency,
                    json={"bidId": a["id"], "milestones": [{"title": "Design", "amount": 400}, {"title": "Build", "amount": 600}]}).json()
    m1, m2 = c["milestones"][0]["id"], c["milestones"][1]["id"]
    deliver = lambda who, mid, note="done": client.post(f"/api/pool/contracts/{c['id']}/milestones/{mid}/deliver", headers=who, json={"note": note})
    assert client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{m1}/approve", headers=agency).status_code == 409   # not delivered yet
    assert deliver(bob, m1).status_code == 404                                           # not Bob's contract
    assert deliver(ann, m1).status_code == 200
    assert deliver(ann, m1).status_code == 409                                           # already delivered
    sent_back = client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{m1}/reject", headers=agency, json={"reason": "Add tests"})
    assert sent_back.json()["milestones"][0]["status"] == "pending" and sent_back.json()["milestones"][0]["rejectionNote"] == "Add tests"
    assert deliver(ann, m1, "tests added").status_code == 200
    assert client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{m1}/approve", headers=agency).json()["milestonesDone"] == 1
    earnings = client.get("/api/pool/earnings", headers=ann).json()
    assert earnings["summary"]["pendingPayout"] == 400.0 and earnings["summary"]["paid"] == 0.0 and len(earnings["entries"]) == 1
    assert "does not transfer money" in earnings["payoutsNote"]
    assert client.get("/api/pool/earnings", headers=bob).json()["entries"] == []

    assert deliver(ann, m2).status_code == 200
    done = client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{m2}/approve", headers=agency).json()
    assert done["status"] == "completed"
    assert deliver(ann, m2).status_code == 409                                           # contract completed

    owed = client.get("/api/pool/admin/earnings", headers=agency).json()
    assert owed["owed"] == 1000.0 and "does not move money" in owed["note"]
    eid = owed["entries"][0]["id"]
    paid = client.post(f"/api/pool/admin/earnings/{eid}/mark-paid", headers=agency)
    assert paid.status_code == 200 and paid.json()["status"] == "paid" and paid.json()["recordedOnly"] is True
    assert client.post(f"/api/pool/admin/earnings/{eid}/mark-paid", headers=agency).status_code == 409
    summary = client.get("/api/pool/earnings", headers=ann).json()["summary"]
    assert summary["paid"] == 400.0 or summary["paid"] == 600.0
    assert summary["totalEarned"] == 1000.0 and summary["pendingPayout"] == 1000.0 - summary["paid"]
    assert client.post(f"/api/pool/admin/earnings/{eid}/mark-paid", headers=bearer(signup(client, email="z@example.com")["token"])).status_code == 404


def test_close_spec_rejects_bids_and_blocks_new_ones(client, people):
    agency, _, ann, _, _ = people
    s = spec(client, agency)
    bid(client, ann, s["id"])
    assert client.post(f"/api/pool/admin/specs/{s['id']}/close", headers=agency).status_code == 200
    assert client.post(f"/api/pool/admin/specs/{s['id']}/close", headers=agency).status_code == 409
    assert [b["status"] for b in client.get("/api/pool/my-bids", headers=ann).json()] == ["rejected"]
    assert bid(client, ann, s["id"]).status_code == 404


def test_notifications_reach_the_other_party(client, people):
    agency, _, ann, _, _ = people
    s = spec(client, agency)
    bid(client, ann, s["id"])
    titles = lambda who: [n["title"] for n in client.get("/api/notifications", headers=who).json()]
    assert "New bid" in titles(agency)
    a = client.get("/api/pool/admin/specs", headers=agency).json()[0]["bids"][0]
    client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency, json={"bidId": a["id"]})
    assert "You won a spec" in titles(ann)
