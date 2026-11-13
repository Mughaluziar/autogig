"""Freelancer pool — the agency-to-freelancer fulfilment loop (README §1, step 3-5).

An agency (role admin) broadcasts a spec. Freelancers bid hours x rate blind: a
freelancer sees how many bids there are, never anyone else's bid. The agency
awards one bid, which creates a contract with milestones. The freelancer marks
a milestone delivered, the agency approves it, and an earning is recorded. The
agency then records the payout.

What this does NOT do: move money. "Paid" is the agency recording that it paid
the freelancer outside the app. There is no Stripe Connect transfer yet, and the
UI says so.

Authorization: every agency action checks the spec/contract belongs to the
caller; every freelancer action checks the bid/contract is theirs. A freelancer
cannot see another freelancer's bid.
"""
import logging
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, repo
from ..auth import current_user, require_roles
from ..pool import store

log = logging.getLogger("autopilot.pool")
router = APIRouter(tags=["pool"])

freelancer_only = require_roles("freelancer")
agency_only = require_roles("admin")
MAX_MILESTONES = 12


def _usd(cents: int | None) -> float | None:
    return None if cents is None else round(cents / 100, 2)


def _cents(amount: float) -> int:
    return int(round(amount * 100))


# --------------------------------------------------------------------------- #
# Output shapes
# --------------------------------------------------------------------------- #
def spec_out(spec: dict, *, bids_in: int, my_bid: dict | None = None, bids: list[dict] | None = None) -> dict:
    out = {
        "id": spec["id"], "title": spec["title"], "summary": spec.get("summary", ""), "stack": spec.get("stack", []),
        "estHours": spec["est_hours"], "deadline": spec["deadline"], "maxRate": _usd(spec.get("max_rate_cents")),
        "status": spec["status"], "bidsIn": bids_in, "createdAt": spec.get("created_at"),
    }
    if my_bid is not None:
        out["myBid"] = bid_out(my_bid, spec["title"])
    if bids is not None:
        out["bids"] = [bid_out(b, spec["title"], with_freelancer=True) for b in bids]
    return out


def bid_out(bid: dict, spec_title: str = "", *, with_freelancer: bool = False) -> dict:
    out = {
        "id": bid["id"], "specId": bid["spec_id"], "spec": spec_title or bid.get("spec_title", ""),
        "hours": bid["hours"], "rate": _usd(bid["rate_cents"]), "total": _usd(bid["hours"] * bid["rate_cents"]),
        "note": bid.get("note", ""), "status": bid["status"], "submitted": bid.get("created_at"),
    }
    if with_freelancer:
        out["freelancerId"] = bid["freelancer_id"]
        out["freelancerName"] = bid.get("freelancer_name", "")
    return out


def contract_out(contract: dict) -> dict:
    milestones = contract.get("milestones", [])
    done = sum(1 for m in milestones if m["status"] == "approved")
    return {
        "id": contract["id"], "specId": contract["spec_id"], "title": contract["title"],
        "hours": contract["hours"], "rate": _usd(contract["rate_cents"]), "value": _usd(contract["total_cents"]),
        "status": contract["status"], "milestonesDone": done, "milestonesTotal": len(milestones),
        "freelancerId": contract["freelancer_id"], "freelancerName": contract.get("freelancer_name", ""),
        "createdAt": contract.get("created_at"),
        "milestones": [{"id": m["id"], "title": m["title"], "amount": _usd(m["amount_cents"]), "status": m["status"],
                        "deliveryNote": m.get("delivery_note", ""), "rejectionNote": m.get("rejection_note", "")}
                       for m in milestones],
    }


def earning_out(row: dict) -> dict:
    return {"id": row["id"], "contractId": row["contract_id"], "contract": row["contract_title"],
            "milestone": row["milestone_title"], "amount": _usd(row["amount_cents"]), "status": row["status"],
            "approvedAt": row.get("created_at"), "paidAt": row.get("paid_at"),
            "freelancerId": row["freelancer_id"], "freelancerName": row.get("freelancer_name", "")}


# --------------------------------------------------------------------------- #
# Freelancer
# --------------------------------------------------------------------------- #
@router.get("/pool/specs")
async def open_specs(user: dict = Depends(freelancer_only)):
    """Open specs. Each shows how many bids are in, and the caller's own bid: never anyone else's."""
    specs = await store.find("specs", {"status": "open"})
    mine = {b["spec_id"]: b for b in await store.find("bids", {"freelancer_id": user["id"]})}
    out = []
    for spec in specs:
        out.append(spec_out(spec, bids_in=await store.count("bids", {"spec_id": spec["id"], "status": "submitted"}),
                            my_bid=mine.get(spec["id"]) if mine.get(spec["id"]) and mine[spec["id"]]["status"] != "withdrawn" else None))
    return out


class BidBody(BaseModel):
    hours: int = Field(ge=1, le=5000)
    rate: float = Field(gt=0, le=2000)
    note: str = Field(default="", max_length=1000)


@router.post("/pool/specs/{spec_id}/bid")
async def place_bid(spec_id: str, body: BidBody, user: dict = Depends(freelancer_only)):
    spec = await store.get("specs", spec_id[:64])
    if not spec or spec["status"] != "open":
        raise HTTPException(404, "This spec isn't open for bids.")
    rate_cents = _cents(body.rate)
    if spec.get("max_rate_cents") and rate_cents > spec["max_rate_cents"]:
        raise HTTPException(422, f"The agency's maximum rate for this spec is ${_usd(spec['max_rate_cents'])}/h.")
    account = await db.find_user(user["email"]) or {}
    fields = {"spec_id": spec["id"], "spec_title": spec["title"], "freelancer_id": user["id"],
              "freelancer_name": account.get("name") or user["email"].split("@")[0], "hours": body.hours,
              "rate_cents": rate_cents, "note": body.note.strip(), "status": "submitted"}
    existing = next(iter(await store.find("bids", {"spec_id": spec["id"], "freelancer_id": user["id"]})), None)
    if existing:
        if existing["status"] not in ("submitted", "withdrawn"):
            raise HTTPException(409, "Your bid on this spec was already decided.")
        bid = await store.update("bids", existing["id"], {k: fields[k] for k in ("hours", "rate_cents", "note", "status")},
                                 expect={"status": existing["status"]})
        if not bid:
            raise HTTPException(409, "Your bid changed at the same time. Reload and try again.")
    else:
        bid = await store.insert("bids", fields)
        if not bid:
            raise HTTPException(409, "You already have a bid on this spec.")
    # The spec may have been awarded while we wrote: the bid then stays 'submitted' for a closed spec, so recheck.
    fresh = await store.get("specs", spec["id"])
    if not fresh or fresh["status"] != "open":
        await store.update("bids", bid["id"], {"status": "rejected"})
        raise HTTPException(409, "This spec was just closed. Your bid wasn't accepted.")
    await repo.notify(spec["owner_id"], "New bid", f"A bid arrived on \"{spec['title']}\".", "info")
    return {**bid_out(bid, spec["title"]), "updated": bool(existing)}


@router.delete("/pool/specs/{spec_id}/bid")
async def withdraw_bid(spec_id: str, user: dict = Depends(freelancer_only)):
    bid = next(iter(await store.find("bids", {"spec_id": spec_id[:64], "freelancer_id": user["id"]})), None)
    if not bid or bid["status"] != "submitted":
        raise HTTPException(404, "You have no open bid on this spec.")
    done = await store.update("bids", bid["id"], {"status": "withdrawn"}, expect={"status": "submitted"})
    if not done:
        raise HTTPException(409, "Your bid was just decided and can't be withdrawn.")
    return {"ok": True}


@router.get("/pool/my-bids")
async def my_bids(user: dict = Depends(freelancer_only)):
    return [bid_out(b) for b in await store.find("bids", {"freelancer_id": user["id"]}) if b["status"] != "withdrawn"]


@router.get("/pool/my-contracts")
async def my_contracts(user: dict = Depends(freelancer_only)):
    return [contract_out(c) for c in await store.find("contracts", {"freelancer_id": user["id"]})]


async def _mutate_contract(contract_id: str, mutate) -> dict:
    """Read-modify-write with an optimistic version check, so two simultaneous
    changes to one contract's milestones cannot overwrite each other."""
    for _ in range(4):
        contract = await store.get("contracts", contract_id[:64])
        if not contract:
            raise HTTPException(404, "Contract not found.")
        fields = mutate(contract)
        saved = await store.update("contracts", contract["id"], {**fields, "version": contract.get("version", 0) + 1},
                                   expect={"version": contract.get("version", 0)})
        if saved:
            return saved
    raise HTTPException(409, "The contract changed at the same time. Try again.")


def _milestone(contract: dict, milestone_id: str) -> dict:
    found = next((m for m in contract.get("milestones", []) if m["id"] == milestone_id), None)
    if not found:
        raise HTTPException(404, "Milestone not found.")
    return found


class DeliverBody(BaseModel):
    note: str = Field(default="", max_length=2000)


@router.post("/pool/contracts/{contract_id}/milestones/{milestone_id}/deliver")
async def deliver_milestone(contract_id: str, milestone_id: str, body: DeliverBody, user: dict = Depends(freelancer_only)):
    mine = await store.get("contracts", contract_id[:64])
    if not mine or mine["freelancer_id"] != user["id"]:
        raise HTTPException(404, "Contract not found.")

    def mutate(contract):
        if contract["status"] != "active":
            raise HTTPException(409, f"This contract is {contract['status']}.")
        m = _milestone(contract, milestone_id)
        if m["status"] != "pending":
            raise HTTPException(409, f"This milestone is already {m['status']}.")
        m.update({"status": "delivered", "delivery_note": body.note.strip(), "rejection_note": ""})
        return {"milestones": contract["milestones"]}
    saved = await _mutate_contract(contract_id, mutate)
    await repo.notify(saved["owner_id"], "Milestone delivered", f"\"{saved['title']}\": a milestone is ready for review.", "info")
    return contract_out(saved)


@router.get("/pool/earnings")
async def my_earnings(user: dict = Depends(freelancer_only)):
    rows = await store.find("earnings", {"freelancer_id": user["id"]})
    approved = sum(r["amount_cents"] for r in rows if r["status"] == "approved")
    paid = sum(r["amount_cents"] for r in rows if r["status"] == "paid")
    this_month = datetime.now(timezone.utc).strftime("%Y-%m")
    month = sum(r["amount_cents"] for r in rows if str(r.get("created_at", ""))[:7] == this_month)
    return {"summary": {"totalEarned": _usd(approved + paid), "pendingPayout": _usd(approved), "paid": _usd(paid),
                        "thisMonth": _usd(month)},
            "entries": [earning_out(r) for r in rows],
            "payoutsNote": "Payouts are recorded by your agency. Autopilot does not transfer money yet."}


# --------------------------------------------------------------------------- #
# Agency
# --------------------------------------------------------------------------- #
class SpecBody(BaseModel):
    title: str = Field(min_length=3, max_length=160)
    summary: str = Field(default="", max_length=4000)
    stack: list[str] = Field(default_factory=list, max_length=15)
    estHours: int = Field(ge=1, le=5000)
    deadline: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    maxRate: float | None = Field(default=None, gt=0, le=2000)


@router.post("/pool/admin/specs")
async def create_spec(body: SpecBody, user: dict = Depends(agency_only)):
    try:
        due = date.fromisoformat(body.deadline)
    except ValueError:
        raise HTTPException(422, "Enter a valid deadline.")
    if due < date.today():
        raise HTTPException(422, "The deadline can't be in the past.")
    spec = await store.insert("specs", {
        "owner_id": user["id"], "title": body.title.strip(), "summary": body.summary.strip(),
        "stack": [s.strip()[:40] for s in body.stack if s.strip()], "est_hours": body.estHours, "deadline": body.deadline,
        "max_rate_cents": _cents(body.maxRate) if body.maxRate else None, "status": "open"})
    await repo.log_activity(user["id"], "Freelancer pool", f"Broadcast spec \"{spec['title']}\"")
    return spec_out(spec, bids_in=0)


async def _own_spec(spec_id: str, user: dict) -> dict:
    spec = await store.get("specs", spec_id[:64])
    if not spec or spec["owner_id"] != user["id"]:
        raise HTTPException(404, "Spec not found.")
    return spec


@router.get("/pool/admin/specs")
async def agency_specs(user: dict = Depends(agency_only)):
    out = []
    for spec in await store.find("specs", {"owner_id": user["id"]}):
        bids = [b for b in await store.find("bids", {"spec_id": spec["id"]}) if b["status"] != "withdrawn"]
        out.append(spec_out(spec, bids_in=sum(1 for b in bids if b["status"] == "submitted"), bids=bids))
    return out


class AwardMilestone(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    amount: float = Field(gt=0, le=10_000_000)


class AwardBody(BaseModel):
    bidId: str = Field(max_length=64)
    milestones: list[AwardMilestone] = Field(default_factory=list, max_length=MAX_MILESTONES)


@router.post("/pool/admin/specs/{spec_id}/award")
async def award(spec_id: str, body: AwardBody, user: dict = Depends(agency_only)):
    spec = await _own_spec(spec_id, user)
    bid = await store.get("bids", body.bidId)
    if not bid or bid["spec_id"] != spec["id"] or bid["status"] != "submitted":
        raise HTTPException(404, "That bid isn't available to award.")
    total = bid["hours"] * bid["rate_cents"]
    if body.milestones:
        amounts = [_cents(m.amount) for m in body.milestones]
        if sum(amounts) != total:
            raise HTTPException(422, f"Milestones must add up to the bid total (${_usd(total):,.2f}).")
        milestones = [{"id": f"m{i + 1}", "title": m.title.strip(), "amount_cents": a, "status": "pending"}
                      for i, (m, a) in enumerate(zip(body.milestones, amounts))]
    else:
        milestones = [{"id": "m1", "title": "Delivery", "amount_cents": total, "status": "pending"}]
    # Claim the spec atomically: only one award can win.
    claimed = await store.update("specs", spec["id"], {"status": "awarded", "awarded_bid_id": bid["id"]},
                                 expect={"status": "open"})
    if not claimed:
        raise HTTPException(409, f"This spec is already {spec['status']}.")
    contract = await store.insert("contracts", {
        "spec_id": spec["id"], "bid_id": bid["id"], "owner_id": user["id"], "freelancer_id": bid["freelancer_id"],
        "freelancer_name": bid.get("freelancer_name", ""), "title": spec["title"], "hours": bid["hours"],
        "rate_cents": bid["rate_cents"], "total_cents": total, "status": "active", "milestones": milestones, "version": 0})
    await store.update("bids", bid["id"], {"status": "awarded"})
    for other in await store.find("bids", {"spec_id": spec["id"]}):
        if other["id"] != bid["id"] and other["status"] == "submitted":
            await store.update("bids", other["id"], {"status": "rejected"})
    await store.update("specs", spec["id"], {"contract_id": contract["id"]})
    await repo.notify(bid["freelancer_id"], "You won a spec", f"Your bid on \"{spec['title']}\" was awarded.", "success")
    await repo.log_activity(user["id"], "Freelancer pool", f"Awarded \"{spec['title']}\"")
    return contract_out(contract)


@router.post("/pool/admin/specs/{spec_id}/close")
async def close_spec(spec_id: str, user: dict = Depends(agency_only)):
    spec = await _own_spec(spec_id, user)
    if not await store.update("specs", spec["id"], {"status": "closed"}, expect={"status": "open"}):
        raise HTTPException(409, f"This spec is already {spec['status']}.")
    for bid in await store.find("bids", {"spec_id": spec["id"]}):
        if bid["status"] == "submitted":
            await store.update("bids", bid["id"], {"status": "rejected"})
    return {"ok": True}


@router.get("/pool/admin/contracts")
async def agency_contracts(user: dict = Depends(agency_only)):
    return [contract_out(c) for c in await store.find("contracts", {"owner_id": user["id"]})]


async def _own_contract(contract_id: str, user: dict) -> dict:
    contract = await store.get("contracts", contract_id[:64])
    if not contract or contract["owner_id"] != user["id"]:
        raise HTTPException(404, "Contract not found.")
    return contract


@router.post("/pool/admin/contracts/{contract_id}/milestones/{milestone_id}/approve")
async def approve_milestone(contract_id: str, milestone_id: str, user: dict = Depends(agency_only)):
    await _own_contract(contract_id, user)
    approved: dict = {}

    def mutate(contract):
        m = _milestone(contract, milestone_id)
        if m["status"] != "delivered":
            raise HTTPException(409, "Only a delivered milestone can be approved.")
        m["status"] = "approved"
        approved.update(m)
        fields: dict = {"milestones": contract["milestones"]}
        if all(x["status"] == "approved" for x in contract["milestones"]):
            fields["status"] = "completed"
        return fields
    saved = await _mutate_contract(contract_id, mutate)
    await store.insert("earnings", {
        "contract_id": saved["id"], "owner_id": saved["owner_id"], "freelancer_id": saved["freelancer_id"],
        "freelancer_name": saved.get("freelancer_name", ""), "contract_title": saved["title"],
        "milestone_id": milestone_id, "milestone_title": approved["title"], "amount_cents": approved["amount_cents"],
        "status": "approved"})
    await repo.notify(saved["freelancer_id"], "Milestone approved", f"\"{saved['title']}\": {approved['title']} was approved.", "success")
    return contract_out(saved)


class RejectBody(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


@router.post("/pool/admin/contracts/{contract_id}/milestones/{milestone_id}/reject")
async def reject_milestone(contract_id: str, milestone_id: str, body: RejectBody, user: dict = Depends(agency_only)):
    await _own_contract(contract_id, user)

    def mutate(contract):
        m = _milestone(contract, milestone_id)
        if m["status"] != "delivered":
            raise HTTPException(409, "Only a delivered milestone can be sent back.")
        m.update({"status": "pending", "rejection_note": body.reason.strip()})
        return {"milestones": contract["milestones"]}
    saved = await _mutate_contract(contract_id, mutate)
    await repo.notify(saved["freelancer_id"], "Milestone sent back", f"\"{saved['title']}\": changes were requested.", "warning")
    return contract_out(saved)


@router.get("/pool/admin/earnings")
async def agency_earnings(user: dict = Depends(agency_only)):
    rows = await store.find("earnings", {"owner_id": user["id"]})
    return {"entries": [earning_out(r) for r in rows],
            "owed": _usd(sum(r["amount_cents"] for r in rows if r["status"] == "approved")),
            "note": "Marking an earning paid only records that you paid the freelancer. Autopilot does not move money."}


@router.post("/pool/admin/earnings/{earning_id}/mark-paid")
async def mark_paid(earning_id: str, user: dict = Depends(agency_only)):
    row = await store.get("earnings", earning_id[:64])
    if not row or row["owner_id"] != user["id"]:
        raise HTTPException(404, "Earning not found.")
    saved = await store.update("earnings", row["id"], {"status": "paid", "paid_at": store.now()}, expect={"status": "approved"})
    if not saved:
        raise HTTPException(409, "This earning is already marked paid.")
    await repo.notify(row["freelancer_id"], "Payout recorded", f"Your agency recorded a payout for \"{row['contract_title']}\".", "success")
    return {**earning_out(saved), "recordedOnly": True}
