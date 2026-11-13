"""Team & invites: inviting, accepting with the invited email, roles, seats,
resend/revoke, and leaving."""
import pytest

from conftest import memory_only, bearer, signup
from app import auth
from app.access import store as access_store
from app.routers import team as team_router


@pytest.fixture(autouse=True)
def fresh_access_store():
    access_store.reset_memory()
    yield
    access_store.reset_memory()


def account(client, email, role="admin", **extra):
    """Sign up and return headers for a verified session (verification is
    covered by the auth tests)."""
    data = signup(client, email=email, role=role, **extra)
    return bearer(auth.create_access_token(data["user"]))


def token_of(link: str) -> str:
    return link.rsplit("/invite/", 1)[1]


def invite(client, headers, email, role="member", **extra):
    res = client.post("/api/team/invites", json={"email": email, "role": role, **extra}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_owner_invites_and_invitee_accepts(client):
    owner = account(client, "owner@agency.test", company="Northwind Studio")
    sent = invite(client, owner, "Dev@Example.test", "member")
    assert sent["invite"]["email"] == "dev@example.test"
    assert sent["invite"]["status"] == "pending"
    assert sent["emailed"] is False  # no email provider in tests — the UI shows the link instead
    assert "/invite/" in sent["link"]

    preview = client.post("/api/team/invite-preview", json={"token": token_of(sent["link"])})
    assert preview.status_code == 200
    body = preview.json()
    assert body["teamName"] == "Northwind Studio"
    assert body["role"] == "member"
    assert body["email"].startswith("d") and "dev@" not in body["email"]  # masked

    dev = account(client, "dev@example.test", role="freelancer")
    accepted = client.post("/api/team/accept", json={"token": token_of(sent["link"])}, headers=dev)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["teamName"] == "Northwind Studio"

    overview = client.get("/api/team", headers=owner).json()
    assert overview["team"]["myRole"] == "owner"
    assert [m["email"] for m in overview["members"]] == ["dev@example.test"]
    assert overview["invites"][0]["status"] == "accepted"
    assert overview["seats"] == {"used": 1, "limit": team_router.MAX_SEATS}

    mine = client.get("/api/team", headers=dev).json()
    assert mine["memberships"][0]["teamName"] == "Northwind Studio"
    assert mine["memberships"][0]["role"] == "member"

    # The link is single use.
    again = client.post("/api/team/accept", json={"token": token_of(sent["link"])}, headers=dev)
    assert again.status_code == 410


def test_only_the_invited_email_can_accept(client):
    owner = account(client, "owner@agency.test")
    sent = invite(client, owner, "dev@example.test")
    stranger = account(client, "someone@else.test")
    res = client.post("/api/team/accept", json={"token": token_of(sent["link"])}, headers=stranger)
    assert res.status_code == 403
    assert "dev@" not in res.json()["detail"]
    assert client.post("/api/team/accept", json={"token": "nope"}, headers=stranger).status_code == 404


def test_invite_validation_and_duplicates(client):
    owner = account(client, "owner@agency.test")
    assert client.post("/api/team/invites", json={"email": "bad"}, headers=owner).status_code == 422
    assert client.post("/api/team/invites", json={"email": "a@b.test", "role": "owner"}, headers=owner).status_code == 422
    assert client.post("/api/team/invites", json={"email": "owner@agency.test"}, headers=owner).status_code == 409
    invite(client, owner, "dev@example.test")
    dup = client.post("/api/team/invites", json={"email": "dev@example.test"}, headers=owner)
    assert dup.status_code == 409


def test_seat_limit(client, monkeypatch):
    monkeypatch.setattr(team_router, "MAX_SEATS", 2)
    owner = account(client, "owner@agency.test")
    invite(client, owner, "a@example.test")
    invite(client, owner, "b@example.test")
    full = client.post("/api/team/invites", json={"email": "c@example.test"}, headers=owner)
    assert full.status_code == 409
    assert "full" in full.json()["detail"]


def test_resend_replaces_the_link_and_revoke_kills_it(client):
    owner = account(client, "owner@agency.test")
    first = invite(client, owner, "dev@example.test")
    resent = client.post(f"/api/team/invites/{first['invite']['id']}/resend", headers=owner)
    assert resent.status_code == 200
    assert resent.json()["invite"]["sendCount"] == 2
    old, new = token_of(first["link"]), token_of(resent.json()["link"])
    assert old != new
    assert client.post("/api/team/invite-preview", json={"token": old}).status_code == 404

    revoked = client.delete(f"/api/team/invites/{first['invite']['id']}", headers=owner)
    assert revoked.status_code == 200
    assert revoked.json()["invite"]["status"] == "revoked"
    dev = account(client, "dev@example.test")
    res = client.post("/api/team/accept", json={"token": new}, headers=dev)
    assert res.status_code == 410
    # A revoked invite frees the email for a new invite.
    invite(client, owner, "dev@example.test")


@memory_only
def test_expired_invite_cannot_be_accepted(client):
    owner = account(client, "owner@agency.test")
    sent = invite(client, owner, "dev@example.test")
    stored = access_store._mem["invites"][sent["invite"]["id"]]
    stored["expires_at"] = access_store.now().replace(year=2000)
    dev = account(client, "dev@example.test")
    res = client.post("/api/team/accept", json={"token": token_of(sent["link"])}, headers=dev)
    assert res.status_code == 410
    assert "expired" in res.json()["detail"]
    assert client.get("/api/team", headers=owner).json()["invites"][0]["status"] == "expired"


def join(client, owner, email, role):
    sent = invite(client, owner, email, role)
    headers = account(client, email)
    assert client.post("/api/team/accept", json={"token": token_of(sent["link"])}, headers=headers).status_code == 200
    return headers


def test_roles_limit_who_manages_whom(client):
    owner = account(client, "owner@agency.test")
    owner_id = client.get("/api/team", headers=owner).json()["team"]["id"]
    admin = join(client, owner, "admin@example.test", "admin")
    viewer = join(client, owner, "viewer@example.test", "viewer")

    # Viewers see the roster but not the invites, and can't invite.
    seen = client.get(f"/api/team?team={owner_id}", headers=viewer).json()
    assert seen["team"]["myRole"] == "viewer" and seen["canManage"] is False and seen["invites"] == []
    assert client.post("/api/team/invites", json={"email": "x@example.test", "team": owner_id},
                       headers=viewer).status_code == 403

    # Admins invite members but can't grant admin.
    ok = client.post("/api/team/invites", json={"email": "m@example.test", "role": "member", "team": owner_id},
                     headers=admin)
    assert ok.status_code == 200
    assert client.post("/api/team/invites", json={"email": "a2@example.test", "role": "admin", "team": owner_id},
                       headers=admin).status_code == 403

    members = {m["email"]: m for m in client.get("/api/team", headers=owner).json()["members"]}
    viewer_id, admin_id = members["viewer@example.test"]["id"], members["admin@example.test"]["id"]
    # Admin promotes the viewer to member, but not to admin, and can't touch the other admin role.
    assert client.patch(f"/api/team/members/{viewer_id}", json={"role": "member", "team": owner_id},
                        headers=admin).status_code == 200
    assert client.patch(f"/api/team/members/{viewer_id}", json={"role": "admin", "team": owner_id},
                        headers=admin).status_code == 403
    assert client.patch(f"/api/team/members/{admin_id}", json={"role": "viewer", "team": owner_id},
                        headers=admin).status_code == 403
    # The owner can.
    assert client.patch(f"/api/team/members/{admin_id}", json={"role": "member"}, headers=owner).status_code == 200

    # Someone else's team isn't visible.
    outsider = account(client, "out@example.test")
    assert client.get(f"/api/team?team={owner_id}", headers=outsider).status_code == 404


def test_remove_and_leave(client):
    owner = account(client, "owner@agency.test")
    owner_id = client.get("/api/team", headers=owner).json()["team"]["id"]
    member = join(client, owner, "m@example.test", "member")
    other = join(client, owner, "o@example.test", "member")
    members = {m["email"]: m["id"] for m in client.get("/api/team", headers=owner).json()["members"]}

    assert client.delete(f"/api/team/members/{members['m@example.test']}", headers=owner).status_code == 200
    assert client.get("/api/team", headers=member).json()["memberships"] == []

    assert client.post("/api/team/leave", json={"team": owner_id}, headers=other).status_code == 200
    assert client.get("/api/team", headers=owner).json()["members"] == []
    assert client.post("/api/team/leave", json={"team": owner_id}, headers=other).status_code == 404


def test_team_routes_need_a_session(client):
    assert client.get("/api/team").status_code == 401
    assert client.post("/api/team/invites", json={"email": "a@b.test"}).status_code == 401
