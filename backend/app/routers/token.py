"""Token program API (docs/token-program.md). Test networks only until the
launch gate passes; the backend never holds keys or moves funds.

Public:
GET  /api/token/transparency                 pool, treasury and token reconciliation (no personal data)
Signed in:
GET  /api/token/me                           program status, wallet, subscriptions, holding
POST /api/token/wallets/challenge            {address} → message to sign
POST /api/token/wallets                      {address, signature}
POST /api/token/subscriptions                {amountCents, idempotencyKey}
POST /api/token/subscriptions/{id}/cancel
Platform owners:
GET  /api/token/admin/overview               POST /api/token/admin/sync
POST /api/token/admin/gate/{key}             {done, evidence}
GET  /api/token/admin/proposals/{id}/safe-batch
POST /api/token/admin/proposals/{id}         {action: submitted | rejected, note}
POST /api/token/admin/alerts/{id}/resolve    {note}
GET  /api/token/admin/report?start=&end=     ISO dates
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..auth import current_user, require_owner
from ..capital import store
from ..capital.ledger import LedgerRejected
from ..routers.capital import _out
from ..token import chain, gate, indexer, service

public_router = APIRouter(prefix="/token", tags=["token"])
router = APIRouter(prefix="/token", tags=["token"])


def _fail(exc: service.TokenError):
    return JSONResponse(status_code=exc.status, content={"detail": str(exc), "reasons": exc.reasons})


async def _call(coro):
    try:
        return await coro
    except service.TokenError as exc:
        return _fail(exc)
    except LedgerRejected as exc:
        return _fail(service.TokenError(str(exc), 409))
    except chain.ChainError as exc:
        return _fail(service.TokenError(f"Can't read the chain right now: {exc}", 502))


def _record(doc: dict | None) -> dict | None:
    return _out(doc, drop=("version", "idem"))


@public_router.get("/transparency")
async def transparency():
    return _out(await service.transparency(), drop=())


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    data = await service.me(user)
    data["wallet"] = _record(data["wallet"])
    data["subscriptions"] = [_record(s) for s in data["subscriptions"]]
    return _out(data, drop=())


class ChallengeBody(BaseModel):
    address: str = Field(min_length=42, max_length=42)


class LinkBody(BaseModel):
    address: str = Field(min_length=42, max_length=42)
    signature: str = Field(min_length=132, max_length=140, pattern=r"^0x[0-9a-fA-F]+$")


class SubscribeBody(BaseModel):
    amount_cents: int = Field(alias="amountCents", gt=0)
    idempotency_key: str = Field(alias="idempotencyKey", min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


@router.post("/wallets/challenge")
async def wallet_challenge(body: ChallengeBody, user: dict = Depends(current_user)):
    result = await _call(service.wallet_challenge(user, body.address))
    return result if isinstance(result, JSONResponse) else _out(result, drop=())


@router.post("/wallets")
async def link_wallet(body: LinkBody, user: dict = Depends(current_user)):
    result = await _call(service.link_wallet(user, body.address, body.signature))
    return result if isinstance(result, JSONResponse) else _record(result)


@router.post("/subscriptions")
async def subscribe(body: SubscribeBody, user: dict = Depends(current_user)):
    result = await _call(service.subscribe(user, body.amount_cents, body.idempotency_key))
    return result if isinstance(result, JSONResponse) else _record(result)


@router.post("/subscriptions/{sub_id}/cancel")
async def cancel(sub_id: str, user: dict = Depends(current_user)):
    result = await _call(service.cancel_subscription(user, sub_id))
    return result if isinstance(result, JSONResponse) else _record(result)


# --------------------------------------------------------------------------- #
# Platform owners
# --------------------------------------------------------------------------- #
class GateBody(BaseModel):
    done: bool
    evidence: str = Field(default="", max_length=2000)


class ProposalBody(BaseModel):
    action: str = Field(pattern=r"^(submitted|rejected)$")
    note: str = Field(default="", max_length=500)


class ResolveBody(BaseModel):
    note: str = Field(min_length=3, max_length=500)


@router.get("/admin/overview")
async def admin_overview(owner: dict = Depends(require_owner)):
    data = await service.admin_overview()
    for key in ("proposals", "alerts", "subscriptions", "wallets"):
        data[key] = [_out(r, drop=("version", "idem")) for r in data[key]]
    return _out(data, drop=())


@router.post("/admin/gate/{key}")
async def admin_gate(key: str, body: GateBody, owner: dict = Depends(require_owner)):
    try:
        return _out(await gate.record(owner, key, body.done, body.evidence), drop=())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/admin/sync")
async def admin_sync(owner: dict = Depends(require_owner)):
    return await _call(indexer.sync())


@router.get("/admin/proposals/{proposal_id}/safe-batch")
async def admin_safe_batch(proposal_id: str, owner: dict = Depends(require_owner)):
    proposal = await store.get("token_proposals", proposal_id)
    if proposal is None:
        raise HTTPException(404, "Proposal not found.")
    return JSONResponse(service.safe_batch(proposal), headers={
        "Content-Disposition": f'attachment; filename="safe-batch-{proposal_id}.json"'})


@router.post("/admin/proposals/{proposal_id}")
async def admin_proposal(proposal_id: str, body: ProposalBody, owner: dict = Depends(require_owner)):
    if await store.get("token_proposals", proposal_id) is None:
        raise HTTPException(404, "Proposal not found.")
    await service.set_proposal(proposal_id, body.action, f"{owner['email']}: {body.note}".strip(": "))
    return _out(await store.get("token_proposals", proposal_id), drop=("version",))


@router.post("/admin/alerts/{alert_id}/resolve")
async def admin_resolve(alert_id: str, body: ResolveBody, owner: dict = Depends(require_owner)):
    result = await _call(service.resolve_alert(owner, alert_id, body.note))
    return result if isinstance(result, JSONResponse) else _out(result, drop=("version",))


def _date(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(422, "Dates must be ISO 8601, e.g. 2026-11-01.") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


@router.get("/admin/report")
async def admin_report(start: str = Query(max_length=40), end: str = Query(max_length=40),
                       owner: dict = Depends(require_owner)):
    return _out(await service.report(_date(start), _date(end)), drop=())
