"""Data export and account deletion: authorization, confirmation, what is deleted/anonymized/retained, audit."""
import json
from datetime import date, timedelta

import pytest

from app import datarights, rights_store
from conftest import bearer, run, signup

FUTURE = (date.today() + timedelta(days=30)).isoformat()
PW = "correct-horse"


def requests(client, user_id, kind):
    async def fetch():
        return await rights_store.list_for("data_requests", user_id, type=kind)
    return client.portal.call(fetch)


def login(client, email, password=PW):
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return bearer(res.json()["token"])


def run_contract(client, agency, freelancer, spec_title="Dashboard", finish=True):
    """Agency posts a spec, the freelancer wins it; optionally finish and record the payout."""
    s = client.post("/api/pool/admin/specs", headers=agency, json={
        "title": spec_title, "summary": "private brief", "estHours": 10, "deadline": FUTURE}).json()
    b = client.post(f"/api/pool/specs/{s['id']}/bid", headers=freelancer, json={"hours": 10, "rate": 50}).json()
    c = client.post(f"/api/pool/admin/specs/{s['id']}/award", headers=agency, json={"bidId": b["id"]}).json()
    if finish:
        mid = c["milestones"][0]["id"]
        client.post(f"/api/pool/contracts/{c['id']}/milestones/{mid}/deliver", headers=freelancer, json={"note": "done"})
        done = client.post(f"/api/pool/admin/contracts/{c['id']}/milestones/{mid}/approve", headers=agency).json()
        assert done["status"] == "completed"
    return s, c


@pytest.fixture
def world(client):
    users = {
        "agency": ("agency@example.com", "admin", "Acme Agency"),
        "ann": ("ann@example.com", "freelancer", "Ann Dev"),
        "bob": ("bob@example.com", "freelancer", "Bob Other"),
        "inv": ("inv@example.com", "investor", "Ivy Investor"),
    }
    h = {}
    ids = {}
    for key, (email, role, name) in users.items():
        res = signup(client, email=email, role=role, name=name)
        h[key] = bearer(res["token"])
        ids[key] = res["user"]["id"]
        # personal working data for everyone
        client.put("/api/state", headers=h[key], json={"state": {"gigs": [{"id": "g1", "title": f"{name} private gig"}]}, "version": 0})
        client.patch("/api/settings", headers=h[key], json={"matchThreshold": 77})
        run(client, __import__("app.repo", fromlist=["x"]).notify, res["user"]["id"], f"Hello {name}", "private note", "info")
        client.post("/api/api-keys", headers=h[key], json={"name": f"{name} key", "scopes": ["read"], "expiresInDays": 30})
    return {"h": h, "ids": ids, "users": users}


# ---------------------------------------------------------------------------------------------- export
def test_export_contains_own_data_and_nothing_of_other_users(client, world):
    h = world["h"]
    run_contract(client, h["agency"], h["ann"])
    res = client.post("/api/me/export", headers=h["ann"], json={"password": PW})
    assert res.status_code == 200
    assert "attachment" in res.headers["content-disposition"] and res.headers["cache-control"] == "no-store"
    body = res.json()
    text = json.dumps(body)
    assert body["account"]["email"] == "ann@example.com"
    assert {"users", "workspaces", "notifications", "pool_bids", "pool_contracts"} <= set(body["records"])
    # Bob and the investor never appear, in any form: their ids, emails, names or private text.
    for other in ("bob", "inv"):
        email, _, name = world["users"][other]
        assert world["ids"][other] not in text and email not in text and name not in text
    # The agency's private data stays out; only the counterparty's id on the shared contract is visible.
    assert "agency@example.com" not in text and "Acme Agency private gig" not in text


def test_export_excludes_secrets(client, world):
    h = world["h"]
    secret = client.post("/api/api-keys", headers=h["ann"], json={"name": "extra", "scopes": ["read"], "expiresInDays": 30}).json()["secret"]
    text = client.post("/api/me/export", headers=h["ann"], json={"password": PW}).text
    for needle in ("password_hash", "$argon2", "key_hash", "token_hash", "session_version", secret):
        assert needle not in text
    assert "prefix" in text                                                   # key metadata is exported


def test_export_requires_authentication_and_password(client, world):
    h = world["h"]
    assert client.post("/api/me/export", json={}).status_code == 401
    assert client.post("/api/me/export", headers=h["ann"], json={}).status_code == 403
    assert client.post("/api/me/export", headers=h["ann"], json={"password": "wrong-password"}).status_code == 403


def test_personal_api_keys_cannot_export_or_delete(client, world):
    h = world["h"]
    secret = client.post("/api/api-keys", headers=h["ann"], json={"name": "w", "scopes": ["read", "write"], "expiresInDays": 30}).json()["secret"]
    key = bearer(secret)
    assert client.post("/api/me/export", headers=key, json={"password": PW}).status_code == 403
    assert client.post("/api/me/deletion", headers=key, json={"password": PW, "confirm": "DELETE MY ACCOUNT"}).status_code == 403


def test_export_is_rate_limited_and_audited_without_content(client, world):
    h = world["h"]
    for _ in range(3):
        assert client.post("/api/me/export", headers=h["ann"], json={"password": PW}).status_code == 200
    assert client.post("/api/me/export", headers=h["ann"], json={"password": PW}).status_code == 429
    rows = requests(client, world["ids"]["ann"], "export")
    assert len(rows) == 3 and all("counts" in r and "records" not in r for r in rows)
    assert "ann@example.com" not in json.dumps(rows, default=str)


def test_social_only_account_needs_a_fresh_sign_in(client, world):
    from app import db
    run(client, db.update_user, "ann@example.com", {}, ("password_hash",))
    assert client.post("/api/me/export", headers=world["h"]["ann"], json={}).status_code == 200   # token was just issued


# ---------------------------------------------------------------------------------------------- deletion
CONFIRM = {"password": PW, "confirm": "DELETE MY ACCOUNT"}


def test_deletion_requires_auth_password_and_exact_confirmation(client, world):
    h = world["h"]
    assert client.post("/api/me/deletion", json=CONFIRM).status_code == 401
    assert client.post("/api/me/deletion", headers=h["bob"], json={"password": PW, "confirm": "delete my account"}).status_code == 422
    assert client.post("/api/me/deletion", headers=h["bob"], json={"password": "nope-nope-nope", "confirm": "DELETE MY ACCOUNT"}).status_code == 403
    assert client.get("/api/me/deletion", headers=h["bob"]).json() == {"status": "none"}


def test_preview_lists_what_will_happen_and_matches_execution(client, world):
    h = world["h"]
    run_contract(client, h["agency"], h["ann"])
    preview = client.get("/api/me/deletion/preview", headers=h["ann"]).json()
    assert preview["blockers"] == []
    assert preview["willDelete"]["workspaces"] == 1 and preview["willDelete"]["users"] == 1
    assert preview["willAnonymize"]["pool_contracts"] == 1 and preview["willAnonymize"]["pool_earnings"] == 1
    assert "billing" not in preview["willDelete"]                                          # financial records are kept
    assert client.post("/api/me/deletion", headers=h["ann"], json=CONFIRM).status_code == 200
    doc = run(client, __import__("app.db", fromlist=["x"]).find_user_by_id, world["ids"]["ann"])
    preview = run(client, datarights.plan_deletion, doc)               # the same dry run, just before executing
    result = run(client, datarights.execute_deletion, doc)
    assert result["deleted"] == preview["willDelete"] and result["anonymized"] == preview["willAnonymize"]


def test_scheduled_account_is_locked_until_cancelled(client, world):
    h = world["h"]
    res = client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM)
    assert res.status_code == 200 and res.json()["status"] == "scheduled"
    assert client.get("/api/auth/me", headers=h["bob"]).status_code == 401                 # old sessions are signed out
    again = login(client, "bob@example.com")                                                  # sign-in still works...
    assert client.get("/api/settings", headers=again).status_code == 403                    # ...but nothing else
    assert client.get("/api/me/deletion", headers=again).json()["status"] == "scheduled"
    assert client.delete("/api/me/deletion", headers=again).status_code == 200
    assert client.get("/api/settings", headers=login(client, "bob@example.com")).status_code == 200      # unlocked again


def test_cancelled_deletion_is_never_executed(client, world):
    h = world["h"]
    client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM)
    client.delete("/api/me/deletion", headers=login(client, "bob@example.com"))
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    far = datetime.now(timezone.utc) + timedelta(days=400)
    assert run(client, run_due_deletions, far) == {"completed": 0, "blocked": 0}
    assert login(client, "bob@example.com")


def test_grace_period_then_execution_removes_every_login_path(client, world):
    h = world["h"]
    secret = client.post("/api/api-keys", headers=h["bob"], json={"name": "k", "scopes": ["read"], "expiresInDays": 30}).json()["secret"]
    assert client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM).status_code == 200
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    assert run(client, run_due_deletions) == {"completed": 0, "blocked": 0}                    # grace period not over
    later = datetime.now(timezone.utc) + timedelta(days=15)
    assert run(client, run_due_deletions, later) == {"completed": 1, "blocked": 0}
    assert client.post("/api/auth/login", json={"email": "bob@example.com", "password": PW}).status_code == 401
    assert client.get("/api/notifications", headers=h["bob"]).status_code == 401              # old session
    assert client.get("/api/notifications", headers=bearer(secret)).status_code == 401        # API key
    assert client.post("/api/auth/forgot-password", json={"email": "bob@example.com"}).status_code in (200, 202)
    # The tombstone holds nothing but ids and dates.
    tomb = datarights._mem_deleted.get(world["ids"]["bob"]) if not rights_store.db.enabled() else None
    if tomb is not None:
        assert set(tomb) <= {"_id", "id", "deleted_at", "retain_until"}
    # The address can sign up again as a brand-new account.
    again = signup(client, email="bob@example.com", role="freelancer", name="Bob Again")
    assert again["user"]["id"] != world["ids"]["bob"]
    assert client.get("/api/notifications", headers=h["bob"]).status_code == 401              # old token never matches the new account


def test_deletion_never_touches_other_users(client, world):
    h = world["h"]
    run_contract(client, h["agency"], h["ann"])
    before = {k: client.post("/api/me/export", headers=h[k], json={"password": PW}).json()["records"] for k in ("agency", "inv", "bob")}
    client.post("/api/me/deletion", headers=h["ann"], json=CONFIRM)
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    run(client, run_due_deletions, datetime.now(timezone.utc) + timedelta(days=15))
    after = {k: client.post("/api/me/export", headers=h[k], json={"password": PW}).json()["records"] for k in ("agency", "inv", "bob")}
    for k in ("inv", "bob"):
        def strip(recs):
            out = {c: rows for c, rows in recs.items() if c != "data_requests"}
            out["activity"] = [a for a in out.get("activity", []) if a["action"] != "Exported own data"]
            return out
        assert strip(before[k]) == strip(after[k])
    # The agency keeps its contract and earnings, with the deleted freelancer shown only as a pseudonym.
    contracts = client.get("/api/pool/admin/contracts", headers=h["agency"]).json()
    assert len(contracts) == 1 and contracts[0]["freelancerName"].startswith("Deleted user ")
    assert "Ann Dev" not in json.dumps(after["agency"]) and "ann@example.com" not in json.dumps(after["agency"])
    earnings = client.get("/api/pool/admin/earnings", headers=h["agency"]).json()
    assert earnings["owed"] == 500.0 and earnings["entries"][0]["freelancerName"].startswith("Deleted user ")


def test_deleting_a_freelancer_does_not_rename_the_agency_or_other_parties(client, world):
    h = world["h"]
    run_contract(client, h["agency"], h["ann"])
    client.post("/api/me/deletion", headers=h["agency"], json=CONFIRM)
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    run(client, run_due_deletions, datetime.now(timezone.utc) + timedelta(days=15))
    contract = client.get("/api/pool/my-contracts", headers=h["ann"]).json()[0]
    assert contract["freelancerName"] == "Ann Dev"                                              # her own name untouched


def test_blockers_stop_deletion(client, world):
    h = world["h"]
    run_contract(client, h["agency"], h["ann"], finish=False)                                   # active contract
    for who in ("agency", "ann"):
        res = client.post("/api/me/deletion", headers=h[who], json=CONFIRM)
        assert res.status_code == 409 and "active" in json.dumps(res.json())
        assert client.get("/api/me/deletion", headers=h[who]).json() == {"status": "none"}
    # A team owner with another member is blocked too.
    client.post("/api/team/invites", headers=h["agency"], json={"email": "inv@example.com", "role": "member"})


def test_platform_owner_cannot_self_delete(client):
    tok = bearer(signup(client, email="owner@example.com", role="admin")["token"])
    res = client.post("/api/me/deletion", headers=tok, json=CONFIRM)
    assert res.status_code == 409 and "owner" in json.dumps(res.json()).lower()


def test_double_request_and_cancel_without_request(client, world):
    h = world["h"]
    assert client.delete("/api/me/deletion", headers=h["bob"]).status_code == 404
    assert client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM).status_code == 200
    assert client.post("/api/me/deletion", headers=login(client, "bob@example.com"), json=CONFIRM).status_code == 409


def test_execution_is_idempotent_and_audit_has_counts_only(client, world):
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    h = world["h"]
    client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM)
    later = datetime.now(timezone.utc) + timedelta(days=15)
    assert run(client, run_due_deletions, later)["completed"] == 1
    assert run(client, run_due_deletions, later) == {"completed": 0, "blocked": 0}
    rows = requests(client, world["ids"]["bob"], "deletion")
    assert rows[0]["status"] == "completed" and rows[0]["counts"]["deleted"] >= 5
    blob = json.dumps(rows, default=str)
    assert "bob@example.com" not in blob and "Bob Other" not in blob


def test_resumes_after_a_crash_midway(client, world, monkeypatch):
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    h = world["h"]
    client.post("/api/me/deletion", headers=h["bob"], json=CONFIRM)
    later = datetime.now(timezone.utc) + timedelta(days=15)
    real = datarights._remove_account

    async def boom(*a, **k):
        raise RuntimeError("crash before the account row is removed")
    monkeypatch.setattr(datarights, "_remove_account", boom)
    with pytest.raises(RuntimeError):
        run(client, run_due_deletions, later)
    monkeypatch.setattr(datarights, "_remove_account", real)
    assert run(client, run_due_deletions, later)["completed"] == 1
    assert client.post("/api/auth/login", json={"email": "bob@example.com", "password": PW}).status_code == 401


def test_retained_rows_expire(client, world):
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    h = world["h"]
    run_contract(client, h["agency"], h["ann"])
    client.post("/api/me/deletion", headers=h["ann"], json=CONFIRM)
    run(client, run_due_deletions, datetime.now(timezone.utc) + timedelta(days=15))
    assert run(client, datarights.purge_expired_retained) == {}
    gone = run(client, datarights.purge_expired_retained, datetime.now(timezone.utc) + timedelta(days=366 * 8))
    assert gone.get("pool_contracts") == 1 and gone.get("pool_earnings") == 1


def test_non_awarded_bids_and_open_specs_are_handled(client, world):
    h = world["h"]
    s = client.post("/api/pool/admin/specs", headers=h["agency"], json={"title": "Open one", "summary": "x", "estHours": 5, "deadline": FUTURE}).json()
    client.post(f"/api/pool/specs/{s['id']}/bid", headers=h["bob"], json={"hours": 5, "rate": 30})
    client.post("/api/me/deletion", headers=h["agency"], json=CONFIRM)
    from datetime import datetime, timezone
    from app.routers.me import run_due_deletions
    run(client, run_due_deletions, datetime.now(timezone.utc) + timedelta(days=15))
    mine = client.get("/api/pool/my-bids", headers=h["bob"]).json()
    assert [b["status"] for b in mine] == ["rejected"]                                          # Bob's bid survives, rejected
