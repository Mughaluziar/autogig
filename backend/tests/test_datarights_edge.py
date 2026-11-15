"""More data-rights edge cases: shared teams, tenant isolation, interplay with email change and open positions."""
import json
from datetime import datetime, timedelta, timezone

import pytest

from app import db, datarights
from app.routers.me import run_due_deletions
from conftest import bearer, run, signup

PW = "correct-horse"
CONFIRM = {"password": PW, "confirm": "DELETE MY ACCOUNT"}


def login(client, email, password=PW):
    return bearer(client.post("/api/auth/login", json={"email": email, "password": password}).json()["token"])


def execute_all(client):
    return run(client, run_due_deletions, datetime.now(timezone.utc) + timedelta(days=15))


@pytest.fixture
def team(client):
    owner = signup(client, email="owner-agency@example.com", role="admin", name="Olivia Owner", company="Northwind")
    member = signup(client, email="member@example.com", role="freelancer", name="Mark Member")
    bystander = signup(client, email="by@example.com", role="freelancer", name="Bea Bystander")
    h = {"owner": bearer(owner["token"]), "member": bearer(member["token"]), "by": bearer(bystander["token"])}
    sent = client.post("/api/team/invites", headers=h["owner"], json={"email": "member@example.com", "role": "member"}).json()
    assert client.post("/api/team/accept", headers=h["member"], json={"token": sent["link"].rsplit("/invite/", 1)[1]}).status_code == 200
    for k in h:
        client.put("/api/state", headers=h[k], json={"state": {"gigs": [{"id": "g", "title": f"private {k}"}]}, "version": 0})
    return h, {"owner": owner["user"]["id"], "member": member["user"]["id"], "by": bystander["user"]["id"]}


def test_a_team_owner_cannot_delete_while_members_remain_but_a_member_can_leave_by_deleting(client, team):
    h, ids = team
    blocked = client.post("/api/me/deletion", headers=h["owner"], json=CONFIRM)
    assert blocked.status_code == 409 and "member" in json.dumps(blocked.json())
    assert client.post("/api/me/deletion", headers=h["member"], json=CONFIRM).status_code == 200
    execute_all(client)
    roster = client.get("/api/team", headers=h["owner"]).json()["members"]
    assert roster == []                                                     # the membership went with the account
    assert client.post("/api/me/deletion", headers=h["owner"], json=CONFIRM).status_code == 200   # now allowed


def test_export_of_one_team_member_never_includes_the_owners_or_bystanders_private_data(client, team):
    h, ids = team
    text = json.dumps(client.post("/api/me/export", headers=h["member"], json={"password": PW}).json())
    for secret in ("private owner", "private by", "by@example.com", "Bea Bystander", ids["by"]):
        assert secret not in text
    assert "private member" in text
    owner_text = json.dumps(client.post("/api/me/export", headers=h["owner"], json={"password": PW}).json())
    assert "private member" not in owner_text and "private by" not in owner_text               # the roster shows who, not their data
    assert "member@example.com" in owner_text                                                  # the owner already sees the roster


def test_deleting_the_bystander_leaves_the_team_untouched(client, team):
    h, ids = team
    before = json.dumps(client.get("/api/team", headers=h["owner"]).json(), sort_keys=True)
    client.post("/api/me/deletion", headers=h["by"], json=CONFIRM)
    execute_all(client)
    assert json.dumps(client.get("/api/team", headers=h["owner"]).json(), sort_keys=True) == before


def test_invitations_to_a_deleted_address_do_not_survive(client, team):
    h, ids = team
    client.post("/api/team/invites", headers=h["owner"], json={"email": "by@example.com", "role": "viewer"})
    client.post("/api/me/deletion", headers=h["by"], json=CONFIRM)
    execute_all(client)
    invites = client.get("/api/team", headers=h["owner"]).json()["invites"]
    assert all(i["email"] != "by@example.com" for i in invites)


def test_open_simulated_positions_block_deletion_and_closed_ones_do_not(client, team):
    h, ids = team
    from app.capital import store as capital_store

    async def add(status):
        return await capital_store.insert("capital_advances", ids["by"], {"status": status, "principal_cents": 1000})
    row = run(client, add, "active")
    res = client.post("/api/me/deletion", headers=h["by"], json=CONFIRM)
    assert res.status_code == 409 and "advance" in json.dumps(res.json())
    async def close():
        mdb = db._get_db() if db.enabled() else None
        if mdb is not None:
            await mdb.capital_advances.update_one({"_id": row["id"]}, {"$set": {"status": "repaid"}})
        else:
            for d in capital_store._mem["capital_advances"]:
                if d["id"] == row["id"]:
                    d["status"] = "repaid"
    run(client, close)
    assert client.post("/api/me/deletion", headers=h["by"], json=CONFIRM).status_code == 200


def test_deleting_after_an_email_change_works_and_leaves_no_old_address_behind(client, team):
    h, ids = team
    code = client.post("/api/me/email/change", headers=h["by"], json={"newEmail": "bea2@example.com", "password": PW}).json()["devCode"]
    new = bearer(client.post("/api/me/email/confirm", headers=h["by"], json={"code": code}).json()["token"])
    assert client.post("/api/me/deletion", headers=new, json=CONFIRM).status_code == 200
    execute_all(client)
    for email in ("by@example.com", "bea2@example.com"):
        assert client.post("/api/auth/login", json={"email": email, "password": PW}).status_code == 401
    assert run(client, db.find_user_by_id, ids["by"]) is None


def test_the_export_is_stable_json_without_internal_fields(client, team):
    h, _ = team
    body = client.post("/api/me/export", headers=h["owner"], json={"password": PW}).json()
    text = json.dumps(body)
    def keys(node):
        if isinstance(node, dict):
            for k, v in node.items():
                yield k
                yield from keys(v)
        elif isinstance(node, list):
            for v in node:
                yield from keys(v)
    found = set(keys(body))
    for forbidden in ("_id", "password_hash", "session_version", "email_change", "token_hash", "code_hash", "key_hash"):
        assert forbidden not in found, forbidden
    assert "code_hash" not in text
