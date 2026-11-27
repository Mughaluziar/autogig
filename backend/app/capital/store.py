"""Capital program records — MongoDB with the usual in-memory fallback.

  capital_profiles   one per user: identity verification + investor status
  capital_advances   early payments; `open` is True while repayable, and a
                     partial unique index allows one open advance per order
  capital_coverages  protection cover (with an advance, or bought alone)
  capital_claims     protection claims and their review
  capital_cover_offers  new-order protection prompts the freelancer dismissed
  token_wallets      investor wallets linked by signature (one per user)
  token_subscriptions  USDC subscriptions for pool-share tokens
  token_proposals    Safe transactions drafted for the treasury signers
  token_alerts       chain events that need an operator (unmatched payments…)
  market_listings    marketplace raises: project funding or revenue sharing
  market_investments one per investment in a raise (direct or via the index)
  market_agreements  a funded raise's repayment terms and payments
  market_distributions  repayments paid out to each investment
  bank_accounts      linked bank accounts (last four digits only)
  bank_transfers     deposits, withdrawals, conversions, crypto sends
  financing_applications  business-financing applications for partner review
  crypto_addresses   the user's own external wallets (Base) for USDC sends and receipts
  debit_cards        simulated virtual debit cards on the Autopilot USD balance
  card_transactions  card authorizations (approved, declined, refunded)
  credit_*           AutoGig project-credit prototype (contributions, contribution withdrawals, applications,
                     agreements, private documents, append-only audit)

Every update is compare-and-set on `version`, like the orders store.
"""
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from pymongo import ASCENDING, DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import db

COLLECTIONS = ("capital_profiles", "capital_advances", "capital_coverages", "capital_claims", "capital_cover_offers",
               "token_wallets", "token_subscriptions", "token_proposals", "token_alerts",
               "market_listings", "market_investments", "market_agreements", "market_distributions",
               "bank_accounts", "bank_transfers", "financing_applications",
               "crypto_addresses", "debit_cards", "card_transactions",
               "credit_contributions", "credit_withdrawals", "credit_applications", "credit_agreements", "credit_audit", "credit_documents")
_mem: dict[str, list[dict]] = {c: [] for c in COLLECTIONS}


class Conflict(Exception):
    """A unique constraint (one open advance per order) or a lost race."""


def reset_memory() -> None:
    for rows in _mem.values():
        rows.clear()
    # Derived views and counters over these records and the ledger share this lifecycle.
    from . import activity, limits
    activity.reset_memory()
    limits.reset_memory()


def now() -> datetime:
    return datetime.now(timezone.utc)


def aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _clean(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return deepcopy({k: aware(v) for k, v in doc.items() if k != "_id"})


async def ensure_indexes() -> None:
    if not db.enabled():
        return
    from . import activity, limits
    await activity.ensure_indexes()
    await limits.ensure_indexes()
    mdb = db._get_db()
    await mdb.capital_profiles.create_index("user_id", unique=True)
    await mdb.capital_profiles.create_index([("kyc.status", ASCENDING)])
    await mdb.capital_advances.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.capital_advances.create_index(
        [("user_id", ASCENDING), ("order_id", ASCENDING)], unique=True,
        name="one_open_advance_per_order", partialFilterExpression={"open": True})
    await mdb.capital_advances.create_index([("status", ASCENDING), ("due_at", ASCENDING)])
    await mdb.capital_coverages.create_index([("user_id", ASCENDING), ("order_id", ASCENDING)])
    await mdb.capital_coverages.create_index("status")
    await mdb.capital_claims.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.capital_claims.create_index(
        "coverage_id", unique=True, name="one_live_claim_per_coverage",
        partialFilterExpression={"live": True})
    await mdb.capital_cover_offers.create_index([("user_id", ASCENDING), ("order_id", ASCENDING)], unique=True)
    await mdb.token_wallets.create_index("address", unique=True)
    await mdb.token_wallets.create_index("user_id", unique=True)
    await mdb.token_subscriptions.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.token_subscriptions.create_index([("status", ASCENDING), ("wallet", ASCENDING)])
    await mdb.token_proposals.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.token_alerts.create_index([("resolved", ASCENDING), ("created_at", DESCENDING)])
    await mdb.market_listings.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.market_listings.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.market_investments.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.market_investments.create_index([("listing_id", ASCENDING), ("status", ASCENDING)])
    await mdb.market_investments.create_index([("user_id", ASCENDING), ("idem", ASCENDING)], unique=True)
    await mdb.market_agreements.create_index("listing_id", unique=True)
    await mdb.market_agreements.create_index([("user_id", ASCENDING), ("status", ASCENDING)])
    await mdb.market_distributions.create_index([("investment_id", ASCENDING), ("payment_id", ASCENDING)], unique=True)
    await mdb.market_distributions.create_index([("investor_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.bank_accounts.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.bank_transfers.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.financing_applications.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.financing_applications.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.bank_transfers.create_index("counterparty_id", sparse=True)
    # One transfer per request key, so two simultaneous copies of a request can't both post.
    await mdb.bank_transfers.create_index([("user_id", ASCENDING), ("idem", ASCENDING)], unique=True,
                                          name="one_transfer_per_request", partialFilterExpression={"idem": {"$type": "string"}})
    await mdb.crypto_addresses.create_index([("user_id", ASCENDING), ("address_lower", ASCENDING)], unique=True,
                                            name="one_active_link_per_address", partialFilterExpression={"live": True})
    await mdb.debit_cards.create_index("user_id", unique=True, name="one_live_card_per_user",
                                       partialFilterExpression={"live": True})
    await mdb.card_transactions.create_index([("user_id", ASCENDING), ("idem", ASCENDING)], unique=True)
    await mdb.card_transactions.create_index([("card_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.credit_withdrawals.create_index([("user_id", ASCENDING), ("idem", ASCENDING)], unique=True)
    await mdb.credit_withdrawals.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.credit_contributions.create_index([("user_id", ASCENDING), ("idem", ASCENDING)], unique=True)
    await mdb.credit_contributions.create_index("ledger_seq")
    await mdb.credit_applications.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await mdb.credit_applications.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await mdb.credit_applications.create_index("user_id", unique=True, name="one_open_credit_application_per_user",
                                               partialFilterExpression={"open": True})
    await mdb.credit_agreements.create_index("application_id", unique=True)
    await mdb.credit_agreements.create_index([("user_id", ASCENDING), ("status", ASCENDING)])
    await mdb.credit_agreements.create_index([("status", ASCENDING), ("ledger_reconciled", ASCENDING)])
    await mdb.credit_applications.create_index([("status", ASCENDING), ("reservation", ASCENDING)])
    await mdb.credit_audit.create_index([("created_at", DESCENDING)])
    await mdb.credit_documents.create_index([("application_id", ASCENDING), ("slot", ASCENDING)], unique=True)
    await mdb.credit_documents.create_index("user_id")


async def insert(coll: str, user_id: str, fields: dict) -> dict:
    doc = {"id": uuid4().hex, **fields, "user_id": user_id, "version": 1, "created_at": now()}
    doc["_id"] = doc["id"]
    if not db.enabled():
        rows = _mem[coll]
        if coll == "capital_advances" and doc.get("open") and any(
                r["user_id"] == user_id and r.get("order_id") == doc.get("order_id") and r.get("open") for r in rows):
            raise Conflict("This order already has an open early payment.")
        if coll == "capital_claims" and doc.get("live") and any(
                r.get("coverage_id") == doc.get("coverage_id") and r.get("live") for r in rows):
            raise Conflict("This cover already has an open claim.")
        if coll == "capital_profiles" and any(r["user_id"] == user_id for r in rows):
            raise Conflict("Profile already exists.")
        if coll == "token_wallets" and any(r["address"] == doc["address"] or r["user_id"] == user_id for r in rows):
            raise Conflict("This wallet, or a wallet for this account, is already linked.")
        if coll == "market_investments" and any(r["user_id"] == user_id and r.get("idem") == doc.get("idem") for r in rows):
            raise Conflict("This investment was already submitted.")
        if coll == "credit_contributions" and any(r["user_id"] == user_id and r.get("idem") == doc.get("idem") for r in rows):
            raise Conflict("This contribution was already submitted.")
        if coll in ("card_transactions", "credit_withdrawals", "bank_transfers") and doc.get("idem") and any(
                r["user_id"] == user_id and r.get("idem") == doc.get("idem") for r in rows):
            raise Conflict("This request was already submitted.")
        if coll == "crypto_addresses" and doc.get("live") and any(
                r["user_id"] == user_id and r.get("live") and r.get("address_lower") == doc.get("address_lower") for r in rows):
            raise Conflict("This wallet is already linked.")
        if coll == "debit_cards" and doc.get("live") and any(r["user_id"] == user_id and r.get("live") for r in rows):
            raise Conflict("You already have a card.")
        if coll == "credit_applications" and doc.get("open") and any(r["user_id"] == user_id and r.get("open") for r in rows):
            raise Conflict("You already have an open application.")
        if coll == "credit_documents" and any(r.get("application_id") == doc.get("application_id") and r.get("slot") == doc.get("slot") for r in rows):
            raise Conflict("That document slot is taken.")
        if coll == "credit_agreements" and any(r.get("application_id") == doc.get("application_id") for r in rows):
            raise Conflict("This application already has an agreement.")
        if coll == "market_agreements" and any(r.get("listing_id") == doc.get("listing_id") for r in rows):
            raise Conflict("This raise already has an agreement.")
        if coll == "market_distributions" and any(
                r.get("investment_id") == doc.get("investment_id") and r.get("payment_id") == doc.get("payment_id")
                for r in rows):
            raise Conflict("This distribution was already recorded.")
        rows.insert(0, deepcopy(doc))
        return _clean(doc)
    try:
        await db._get_db()[coll].insert_one(doc)
    except DuplicateKeyError as exc:
        raise Conflict("A matching open record already exists.") from exc
    return _clean(doc)


async def get(coll: str, record_id: str, *, user_id: str | None = None) -> dict | None:
    """By id; scoped to `user_id` unless None (operator/scheduler reads)."""
    if not db.enabled():
        return _clean(next((r for r in _mem[coll] if r["id"] == record_id
                            and (user_id is None or r["user_id"] == user_id)), None))
    query = {"_id": record_id}
    if user_id is not None:
        query["user_id"] = user_id
    return _clean(await db._get_db()[coll].find_one(query))


async def find(coll: str, query: dict, *, limit: int = 500) -> list[dict]:
    """Equality / `$in` / `$lte` queries only, so both backends agree."""
    if not db.enabled():
        def ok(row: dict) -> bool:
            for key, cond in query.items():
                value = row
                for part in key.split("."):
                    value = value.get(part) if isinstance(value, dict) else None
                if isinstance(cond, dict):
                    if "$in" in cond and value not in cond["$in"]:
                        return False
                    if "$lte" in cond and (value is None or aware(value) > cond["$lte"]):
                        return False
                elif value != cond:
                    return False
            return True
        return [_clean(r) for r in _mem[coll] if ok(r)][:limit]
    cursor = db._get_db()[coll].find(query).sort("created_at", DESCENDING).limit(limit)
    return [_clean(d) async for d in cursor]


async def update(coll: str, record_id: str, fields: dict, *, expect_version: int) -> dict | None:
    if not db.enabled():
        for r in _mem[coll]:
            if r["id"] == record_id:
                if r.get("version") != expect_version:
                    return None
                if coll == "capital_advances" and fields.get("open") and any(
                        o is not r and o["user_id"] == r["user_id"] and o.get("order_id") == r.get("order_id")
                        and o.get("open") for o in _mem[coll]):
                    raise Conflict("This order already has an open early payment.")
                r.update(deepcopy(fields))
                r["version"] = expect_version + 1
                return _clean(r)
        return None
    try:
        doc = await db._get_db()[coll].find_one_and_update(
            {"_id": record_id, "version": expect_version},
            {"$set": fields, "$inc": {"version": 1}}, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError as exc:
        raise Conflict("A matching open record already exists.") from exc
    return _clean(doc)


async def delete(coll: str, record_id: str) -> None:
    if not db.enabled():
        _mem[coll][:] = [r for r in _mem[coll] if r["id"] != record_id]
        return
    await db._get_db()[coll].delete_one({"_id": record_id})


async def profile(user_id: str) -> dict | None:
    rows = await find("capital_profiles", {"user_id": user_id}, limit=1)
    return rows[0] if rows else None
