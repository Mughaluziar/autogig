"""Your own data and agreements.

GET    /api/legal/versions            public: the current Terms/Privacy versions
GET    /api/me/terms                  -> {needsAcceptance, current, accepted, history}
POST   /api/me/terms/accept           {terms, privacy} (the versions shown to the user)
POST   /api/me/export                 {password?} -> a JSON download of your own data (3 per hour)
GET    /api/me/deletion/preview       -> exactly what deleting the account would delete, anonymize and retain
GET    /api/me/deletion               -> {status, scheduledFor, ...}
POST   /api/me/deletion               {password?, confirm: "DELETE MY ACCOUNT"} -> schedules deletion
DELETE /api/me/deletion               -> cancels a pending deletion
POST   /api/admin/deletions/run       platform owner: carry out the deletions whose grace period has ended

Personal API keys can't call any of these (security.py blocks /me for keys)."""
import json
import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import auth, datarights, db, repo, rights_store, session as sessions, terms
from ..access import store as access_store
from ..auth import current_user, require_owner
from ..config import get_settings

router = APIRouter(tags=["me"])
public_router = APIRouter(tags=["me"])

CONFIRM_PHRASE = "DELETE MY ACCOUNT"
EXPORTS_PER_HOUR = 3
FRESH_LOGIN_SECONDS = 600


async def _account(user: dict) -> dict:
    doc = await db.find_user(user["email"])
    if not doc or doc["id"] != user["id"]:
        raise HTTPException(401, "This account no longer exists.")
    return doc


def _reauth(doc: dict, password: str | None, request: Request) -> None:
    """Exports and deletion need proof it is really the account owner at the keyboard: the password, or (for accounts
    that only use social sign-in and have no password) a sign-in within the last 10 minutes."""
    if doc.get("password_hash"):
        if not password or not auth.verify_password(doc, password):
            raise HTTPException(403, "Enter your current password to continue.")
        return
    issued = (getattr(request.state, "claims", None) or {}).get("iat", 0)
    if time.time() - issued > FRESH_LOGIN_SECONDS:
        raise HTTPException(403, "Sign in again to continue: this action needs a sign-in from the last 10 minutes.")


# --------------------------------------------------------------------------------------------------------------
# Terms
# --------------------------------------------------------------------------------------------------------------
@public_router.get("/legal/versions")
async def legal_versions():
    return {**terms.current(), "required": terms.required()}


class AcceptBody(BaseModel):
    terms: str = Field(max_length=80)
    privacy: str = Field(max_length=80)


@router.get("/me/terms")
async def my_terms(user: dict = Depends(current_user)):
    doc = await _account(user)
    history = await rights_store.list_for("terms_acceptances", user["id"])
    return {"needsAcceptance": terms.needs_acceptance(doc), "current": terms.current(),
            "history": [{"terms": h["terms_version"], "privacy": h["privacy_version"], "acceptedAt": _iso(h["accepted_at"]),
                         "method": h["method"]} for h in history]}


@router.post("/me/terms/accept")
async def accept_terms(body: AcceptBody, user: dict = Depends(current_user)):
    doc = await _account(user)
    if not terms.versions_match({"terms": body.terms, "privacy": body.privacy}):
        raise HTTPException(409, "The Terms or Privacy Policy changed while this page was open. Reload and read the new version.")
    row = await terms.record(doc, "reaccept", terms.current())
    return {"ok": True, "acceptedAt": _iso(row["accepted_at"])}


def _iso(value) -> str | None:
    return db._iso(value)


# --------------------------------------------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------------------------------------------
class ReauthBody(BaseModel):
    password: str | None = Field(default=None, max_length=200)


@router.post("/me/export")
async def export_my_data(body: ReauthBody, request: Request, user: dict = Depends(current_user)):
    doc = await _account(user)
    _reauth(doc, body.password, request)
    cutoff = rights_store.now() - timedelta(hours=1)
    recent = [r for r in await rights_store.list_for("data_requests", user["id"], type="export")
              if r["requested_at"] >= cutoff]
    if len(recent) >= EXPORTS_PER_HOUR:
        raise HTTPException(429, f"You can export your data {EXPORTS_PER_HOUR} times an hour. Try again later.",
                            headers={"Retry-After": "3600"})
    payload = await datarights.build_export(doc)
    counts = {name: len(items) for name, items in payload["records"].items()}
    await rights_store.add("data_requests", {"user_id": user["id"], "type": "export", "status": "completed",
                                             "requested_at": rights_store.now(), "completed_at": rights_store.now(),
                                             "counts": counts})
    await repo.log_activity(user["id"], "Account", "Exported own data")
    return JSONResponse(payload, headers={"Content-Disposition": 'attachment; filename="autopilot-export.json"',
                                          "Cache-Control": "no-store"})


# --------------------------------------------------------------------------------------------------------------
# Deletion
# --------------------------------------------------------------------------------------------------------------
async def _pending(user_id: str) -> dict | None:
    rows = await rights_store.list_for("data_requests", user_id, type="deletion", status="scheduled")
    return rows[0] if rows else None


def _status(row: dict | None) -> dict:
    if not row:
        return {"status": "none"}
    return {"status": row["status"], "requestedAt": _iso(row["requested_at"]), "scheduledFor": _iso(row["scheduled_for"])}


@router.get("/me/deletion/preview")
async def deletion_preview(user: dict = Depends(current_user)):
    doc = await _account(user)
    return await datarights.plan_deletion(doc)


@router.get("/me/deletion")
async def deletion_status(user: dict = Depends(current_user)):
    return _status(await _pending(user["id"]))


class DeleteBody(BaseModel):
    password: str | None = Field(default=None, max_length=200)
    confirm: str = Field(default="", max_length=40)


@router.post("/me/deletion")
async def request_deletion(body: DeleteBody, request: Request, response: Response, user: dict = Depends(current_user)):
    doc = await _account(user)
    if body.confirm.strip() != CONFIRM_PHRASE:
        raise HTTPException(422, f'Type "{CONFIRM_PHRASE}" exactly to confirm.')
    _reauth(doc, body.password, request)
    if await _pending(user["id"]):
        raise HTTPException(409, "Deletion is already scheduled. Cancel it first if you changed your mind.")
    problems = await datarights.blockers(doc)
    if problems:
        raise HTTPException(409, {"message": "Your account can't be deleted yet.", "blockers": problems})
    when = rights_store.now() + timedelta(days=get_settings().deletion_grace_days)
    row = await rights_store.add("data_requests", {"user_id": user["id"], "type": "deletion", "status": "scheduled",
                                                   "requested_at": rights_store.now(), "scheduled_for": when})
    # Lock the account: every session signs out, API keys stop working, and until the date only cancelling works.
    for key in await access_store.list_keys(user["id"]):
        if not key.get("revoked_at"):
            await access_store.revoke_key(user["id"], key["id"])
    await db.update_user(doc["email"], {"deletion_scheduled_for": when,
                                        "session_version": doc.get("session_version", 0) + 1})
    await repo.log_activity(user["id"], "Account", "Account deletion scheduled")
    sessions.clear_session_cookies(request, response)
    return {"ok": True, **_status(row)}


@router.delete("/me/deletion")
async def cancel_deletion(user: dict = Depends(current_user)):
    doc = await _account(user)
    row = await _pending(user["id"])
    if not row:
        raise HTTPException(404, "No deletion is scheduled.")
    await rights_store.update("data_requests", row["id"], {"status": "cancelled", "completed_at": rights_store.now()})
    await db.update_user(doc["email"], {}, unset=("deletion_scheduled_for",))
    await repo.log_activity(user["id"], "Account", "Account deletion cancelled")
    return {"ok": True, "status": "cancelled"}


async def run_due_deletions(at=None) -> dict:
    """Carry out every deletion whose grace period has ended. Safe to run repeatedly (also from a scheduler)."""
    at = at or rights_store.now()
    done, blocked = 0, 0
    for row in await rights_store.due_deletions(at):
        doc = await db.find_user_by_id(row["user_id"])
        if doc is None:                       # already removed (a crash after the last step): just close the request
            await rights_store.update("data_requests", row["id"], {"status": "completed", "completed_at": at})
            done += 1
            continue
        problems = await datarights.blockers(doc)
        if problems:
            await rights_store.update("data_requests", row["id"], {"status": "blocked", "completed_at": at,
                                                                   "blockers": problems})
            await db.update_user(doc["email"], {}, unset=("deletion_scheduled_for",))
            blocked += 1
            continue
        result = await datarights.execute_deletion(doc)
        counts = {k: sum(v.values()) for k, v in result.items()}
        await rights_store.update("data_requests", row["id"], {"status": "completed", "completed_at": at,
                                                               "counts": counts, "detail": result})
        done += 1
    return {"completed": done, "blocked": blocked}


@router.post("/admin/deletions/run")
async def run_deletions(user: dict = Depends(require_owner)):
    return await run_due_deletions()


class SimulatedAccessBody(BaseModel):
    enabled: bool


@router.post("/admin/users/{user_id}/simulated-access")
async def set_simulated_access(user_id: str, body: SimulatedAccessBody, owner: dict = Depends(require_owner)):
    """Platform owner: let one account open (or stop opening) the simulated money modules (SIMULATED_MODULES=invited)."""
    target = await db.find_user_by_id(user_id[:64])
    if not target:
        raise HTTPException(404, "No such account.")
    await db.update_user(target["email"], {"simulated_access": body.enabled})
    await repo.log_activity(owner["id"], "Security",
                            f"Simulated modules {'granted to' if body.enabled else 'removed from'} account {target['id']}")
    await repo.log_activity(target["id"], "Security", f"Simulated modules {'enabled' if body.enabled else 'disabled'} by an owner")
    return {"ok": True, "userId": target["id"], "simulatedAccess": body.enabled}


async def housekeeping_loop(interval_seconds: int = 3600) -> None:
    """Background job started with the API: due deletions, then expired retained rows. Never raises."""
    import asyncio
    import logging
    log = logging.getLogger("autopilot.datarights")
    while True:
        try:
            result = await run_due_deletions()
            purged = await datarights.purge_expired_retained()
            if result["completed"] or result["blocked"] or purged:
                log.info("data rights housekeeping: deletions %s, retained rows purged %s", result, purged)
        except asyncio.CancelledError:
            raise
        except Exception:                       # noqa: BLE001 - the next run retries; one bad row must not stop the loop
            log.exception("data rights housekeeping failed")
        await asyncio.sleep(interval_seconds)
