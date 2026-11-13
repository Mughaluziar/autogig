"""Team & invites — who works with you, and in what role.

A team belongs to the account that owns it (team id = owner's user id). The
owner invites people by email with a role; the invitee opens the link, signs
in with that email, and accepts. Membership records the person and their
role. Shared access to the owner's workspace data is not part of membership
yet — every member keeps working in their own workspace.

GET    /api/team                       -> the caller's team (or ?team=<id> for one they joined)
POST   /api/team/invites               {email, role, team?} -> {invite, link, emailed}
POST   /api/team/invites/{id}/resend   -> new link (the old one stops working)
DELETE /api/team/invites/{id}          -> revoke a pending invite
PATCH  /api/team/members/{id}          {role, team?}
DELETE /api/team/members/{id}          ?team=<id>
POST   /api/team/leave                 {team}
POST   /api/team/accept                {token}   (signed in, invited email)
POST   /api/team/invite-preview        {token}   (public — what the link is for)

Roles: owner (implicit) > admin > member > viewer. The owner manages everyone;
admins manage members and viewers; only the owner grants or changes admin.
"""
import hashlib
import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, email as mail, repo
from ..access import store
from ..auth import current_user
from ..config import get_settings

router = APIRouter(prefix="/team", tags=["team"])
public_router = APIRouter(prefix="/team", tags=["team"])

ROLES = ("admin", "member", "viewer")
MAX_SEATS = 10          # members + pending invites, owner not counted
INVITE_TTL = timedelta(days=7)
MAX_SENDS = 5           # first send + 4 resends
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _iso(value) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def _mask(email: str) -> str:
    local, _, domain = email.partition("@")
    return f"{local[:1]}{'•' * max(2, min(len(local) - 1, 6))}@{domain}"


def _status(invite: dict) -> str:
    if invite["status"] == "pending" and invite["expires_at"] <= store.now():
        return "expired"
    return invite["status"]


def _invite_view(i: dict) -> dict:
    return {
        "id": i["id"], "email": i["email"], "role": i["role"], "status": _status(i),
        "invitedBy": i.get("invited_by_name", ""), "createdAt": _iso(i["created_at"]),
        "expiresAt": _iso(i["expires_at"]), "lastSentAt": _iso(i.get("last_sent_at")),
        "sendCount": i.get("send_count", 1), "acceptedAt": _iso(i.get("accepted_at")),
    }


def _member_view(m: dict) -> dict:
    return {
        "id": m["id"], "userId": m["user_id"], "email": m["email"], "name": m.get("name", ""),
        "role": m["role"], "joinedAt": _iso(m["created_at"]),
    }


async def _account(email: str) -> dict:
    doc = await db.find_user(email)
    if not doc:
        raise HTTPException(401, "This account no longer exists.")
    return doc


async def _context(user: dict, team_id: str | None) -> dict:
    """The team the caller is acting on and their role in it."""
    if not team_id or team_id == user["id"]:
        me = await _account(user["email"])
        name = me.get("company") or f"{me['name']}'s team"
        return {"team_id": user["id"], "role": "owner", "team_name": name,
                "owner_name": me["name"], "owner_email": me["email"], "me": me}
    membership = await store.find_membership(team_id, user["id"])
    if not membership:
        raise HTTPException(404, "Team not found.")
    return {"team_id": team_id, "role": membership["role"], "team_name": membership.get("team_name", "Team"),
            "owner_name": membership.get("owner_name", ""), "owner_email": membership.get("owner_email", ""),
            "me": await _account(user["email"])}


def _can_manage(ctx: dict) -> bool:
    return ctx["role"] in ("owner", "admin")


def _can_assign(ctx: dict, role: str) -> bool:
    """Owner assigns any role; admins can't grant admin."""
    return ctx["role"] == "owner" or (ctx["role"] == "admin" and role != "admin")


async def _seats_used(team_id: str) -> int:
    members = await store.list_members(team_id)
    pending = [i for i in await store.list_invites(team_id) if _status(i) == "pending"]
    return len(members) + len(pending)


def _link(token: str) -> str:
    return f"{get_settings().site_url}/invite/{token}"


async def _send_invite_email(to: str, ctx: dict, role: str, link: str) -> bool:
    if not mail.enabled():
        return False
    inviter = ctx["me"]["name"]
    subject = f"{inviter} invited you to {ctx['team_name']} on Autopilot"
    html = mail._wrap(
        f"Join {ctx['team_name']}",
        f"""
<p><b>{_esc(inviter)}</b> invited you to join <b>{_esc(ctx['team_name'])}</b> on Autopilot as a <b>{role}</b>.</p>
<p><a href="{link}" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 18px;
   border-radius:8px;text-decoration:none">Accept invite</a></p>
<p>Sign in or create an account with <b>{_esc(to)}</b> to accept. The link expires in 7 days.</p>
<p style="color:#6b7280">If you weren't expecting this, you can ignore this email.</p>""",
    )
    return await mail.send_email(to, subject, html)


def _esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# --------------------------------------------------------------------------- #
# Overview
# --------------------------------------------------------------------------- #
@router.get("")
async def team_overview(team: str | None = None, user: dict = Depends(current_user)):
    ctx = await _context(user, team)
    members = await store.list_members(ctx["team_id"])
    invites = await store.list_invites(ctx["team_id"])
    memberships = await store.list_memberships(user["id"])
    pending = [i for i in invites if _status(i) == "pending"]
    return {
        "team": {"id": ctx["team_id"], "name": ctx["team_name"], "ownerName": ctx["owner_name"],
                 "ownerEmail": ctx["owner_email"], "myRole": ctx["role"]},
        "members": [_member_view(m) for m in members],
        "invites": [_invite_view(i) for i in invites] if _can_manage(ctx) else [],
        "seats": {"used": len(members) + len(pending), "limit": MAX_SEATS},
        "canManage": _can_manage(ctx),
        "emailEnabled": mail.enabled(),
        "memberships": [{
            "memberId": m["id"], "teamId": m["team_id"], "teamName": m.get("team_name", "Team"),
            "ownerName": m.get("owner_name", ""), "role": m["role"], "joinedAt": _iso(m["created_at"]),
        } for m in memberships],
    }


# --------------------------------------------------------------------------- #
# Invites
# --------------------------------------------------------------------------- #
class InviteBody(BaseModel):
    email: str
    role: str = "member"
    team: str | None = None


@router.post("/invites")
async def create_invite(body: InviteBody, user: dict = Depends(current_user)):
    ctx = await _context(user, body.team)
    if not _can_manage(ctx):
        raise HTTPException(403, "Only the team owner and admins can invite people.")
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(422, "Enter a valid email address.")
    if body.role not in ROLES:
        raise HTTPException(422, "Choose admin, member or viewer.")
    if not _can_assign(ctx, body.role):
        raise HTTPException(403, "Only the team owner can invite admins.")
    if email == ctx["owner_email"].lower():
        raise HTTPException(409, "That's the team owner.")
    members = await store.list_members(ctx["team_id"])
    if any(m["email"] == email for m in members):
        raise HTTPException(409, "This person is already on the team.")
    invites = await store.list_invites(ctx["team_id"])
    if any(i["email"] == email and _status(i) == "pending" for i in invites):
        raise HTTPException(409, "There's already a pending invite for this email — resend it instead.")
    if await _seats_used(ctx["team_id"]) >= MAX_SEATS:
        raise HTTPException(409, f"Your team is full ({MAX_SEATS} seats). Remove someone or revoke an invite first.")
    token = secrets.token_urlsafe(32)
    stamp = store.now()
    invite = await store.create_invite(ctx["team_id"], _hash(token), {
        "email": email, "role": body.role, "status": "pending",
        "invited_by": user["id"], "invited_by_name": ctx["me"]["name"],
        "team_name": ctx["team_name"], "owner_name": ctx["owner_name"], "owner_email": ctx["owner_email"],
        "expires_at": stamp + INVITE_TTL, "last_sent_at": stamp, "send_count": 1,
    })
    link = _link(token)
    emailed = await _send_invite_email(email, ctx, body.role, link)
    await repo.log_activity(user["id"], "Team", f"Invited {email} as {body.role}")
    return {"invite": _invite_view(invite), "link": link, "emailed": emailed}


@router.post("/invites/{invite_id}/resend")
async def resend_invite(invite_id: str, team: str | None = None, user: dict = Depends(current_user)):
    ctx = await _context(user, team)
    if not _can_manage(ctx):
        raise HTTPException(403, "Only the team owner and admins can resend invites.")
    invite = await store.get_invite(ctx["team_id"], invite_id)
    if not invite or invite["status"] != "pending":
        raise HTTPException(404, "No pending invite found.")
    if not _can_assign(ctx, invite["role"]):
        raise HTTPException(403, "Only the team owner can manage admin invites.")
    if invite.get("send_count", 1) >= MAX_SENDS:
        raise HTTPException(429, "This invite was sent too many times. Revoke it and invite again.")
    token = secrets.token_urlsafe(32)
    stamp = store.now()
    updated = await store.update_invite(invite_id, {
        "token_hash": _hash(token), "expires_at": stamp + INVITE_TTL, "last_sent_at": stamp,
        "send_count": invite.get("send_count", 1) + 1,
    }, expect_status="pending")
    if not updated:
        raise HTTPException(409, "This invite changed — refresh and try again.")
    link = _link(token)
    emailed = await _send_invite_email(invite["email"], ctx, invite["role"], link)
    await repo.log_activity(user["id"], "Team", f"Resent the invite to {invite['email']}")
    return {"invite": _invite_view(updated), "link": link, "emailed": emailed}


@router.delete("/invites/{invite_id}")
async def revoke_invite(invite_id: str, team: str | None = None, user: dict = Depends(current_user)):
    ctx = await _context(user, team)
    if not _can_manage(ctx):
        raise HTTPException(403, "Only the team owner and admins can revoke invites.")
    invite = await store.get_invite(ctx["team_id"], invite_id)
    if not invite:
        raise HTTPException(404, "Invite not found.")
    if not _can_assign(ctx, invite["role"]):
        raise HTTPException(403, "Only the team owner can manage admin invites.")
    updated = await store.update_invite(invite_id, {"status": "revoked", "revoked_at": store.now()},
                                        expect_status="pending")
    if not updated:
        raise HTTPException(409, "Only a pending invite can be revoked.")
    await repo.log_activity(user["id"], "Team", f"Revoked the invite to {invite['email']}")
    return {"invite": _invite_view(updated)}


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
class RoleBody(BaseModel):
    role: str
    team: str | None = None


@router.patch("/members/{member_id}")
async def change_role(member_id: str, body: RoleBody, user: dict = Depends(current_user)):
    ctx = await _context(user, body.team)
    if not _can_manage(ctx):
        raise HTTPException(403, "Only the team owner and admins can change roles.")
    if body.role not in ROLES:
        raise HTTPException(422, "Choose admin, member or viewer.")
    member = await store.get_member(ctx["team_id"], member_id)
    if not member:
        raise HTTPException(404, "Member not found.")
    if member["user_id"] == user["id"]:
        raise HTTPException(403, "You can't change your own role.")
    if not _can_assign(ctx, member["role"]) or not _can_assign(ctx, body.role):
        raise HTTPException(403, "Only the team owner can grant or change the admin role.")
    updated = await store.update_member(ctx["team_id"], member_id, {"role": body.role})
    await repo.log_activity(user["id"], "Team", f"Changed {member['email']} to {body.role}")
    await repo.notify(member["user_id"], "Your team role changed",
                      f"You're now a {body.role} on {ctx['team_name']}.", "info")
    return {"member": _member_view(updated)}


@router.delete("/members/{member_id}")
async def remove_member(member_id: str, team: str | None = None, user: dict = Depends(current_user)):
    ctx = await _context(user, team)
    if not _can_manage(ctx):
        raise HTTPException(403, "Only the team owner and admins can remove people.")
    member = await store.get_member(ctx["team_id"], member_id)
    if not member:
        raise HTTPException(404, "Member not found.")
    if member["user_id"] == user["id"]:
        raise HTTPException(403, "Use Leave team to remove yourself.")
    if not _can_assign(ctx, member["role"]):
        raise HTTPException(403, "Only the team owner can remove an admin.")
    await store.delete_member(ctx["team_id"], member_id)
    await repo.log_activity(user["id"], "Team", f"Removed {member['email']} from the team")
    await repo.notify(member["user_id"], "Removed from a team", f"You're no longer on {ctx['team_name']}.", "warning")
    return {"ok": True}


class LeaveBody(BaseModel):
    team: str


@router.post("/leave")
async def leave_team(body: LeaveBody, user: dict = Depends(current_user)):
    membership = await store.find_membership(body.team, user["id"])
    if not membership:
        raise HTTPException(404, "You're not on that team.")
    await store.delete_member(body.team, membership["id"])
    await repo.log_activity(user["id"], "Team", f"Left {membership.get('team_name', 'a team')}")
    await repo.notify(body.team, "A teammate left", f"{membership['email']} left your team.", "info")
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Accepting
# --------------------------------------------------------------------------- #
class TokenBody(BaseModel):
    token: str


async def _live_invite(token: str) -> dict:
    invite = await store.find_invite_by_hash(_hash(token.strip())) if token.strip() else None
    if not invite:
        raise HTTPException(404, "This invite link isn't valid. Ask for a new one.")
    return invite


@public_router.post("/invite-preview")
async def invite_preview(body: TokenBody):
    invite = await _live_invite(body.token)
    return {
        "teamName": invite.get("team_name", "a team"), "invitedBy": invite.get("invited_by_name", ""),
        "role": invite["role"], "email": _mask(invite["email"]), "status": _status(invite),
        "expiresAt": _iso(invite["expires_at"]),
    }


@router.post("/accept")
async def accept_invite(body: TokenBody, user: dict = Depends(current_user)):
    invite = await _live_invite(body.token)
    status = _status(invite)
    if status != "pending":
        raise HTTPException(410, {"expired": "This invite has expired. Ask for a new one.",
                                  "revoked": "This invite was revoked.",
                                  "accepted": "This invite was already used."}.get(status, "This invite is no longer valid."))
    if invite["email"] != user["email"].lower():
        raise HTTPException(403, f"This invite was sent to {_mask(invite['email'])}. Sign in with that email to accept it.")
    if invite["team_id"] == user["id"]:
        raise HTTPException(409, "You own this team.")
    me = await _account(user["email"])
    claimed = await store.update_invite(invite["id"], {"status": "accepted", "accepted_at": store.now(),
                                                        "accepted_by": user["id"]}, expect_status="pending")
    if not claimed:
        raise HTTPException(410, "This invite is no longer valid.")
    member = await store.add_member(invite["team_id"], {
        "user_id": user["id"], "email": me["email"], "name": me["name"], "role": invite["role"],
        "team_name": invite.get("team_name", "Team"), "owner_name": invite.get("owner_name", ""),
        "owner_email": invite.get("owner_email", ""), "invite_id": invite["id"],
    })
    if member is None:
        raise HTTPException(409, "You're already on this team.")
    await repo.log_activity(user["id"], "Team", f"Joined {invite.get('team_name', 'a team')} as {invite['role']}")
    await repo.log_activity(invite["team_id"], "Team", f"{me['email']} accepted your invite ({invite['role']})")
    await repo.notify(invite["team_id"], "Invite accepted", f"{me['name']} joined your team as {invite['role']}.")
    return {"ok": True, "teamId": invite["team_id"], "teamName": invite.get("team_name", "Team"), "role": invite["role"]}
