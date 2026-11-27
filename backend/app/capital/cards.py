"""Autopilot Debit: a virtual debit card that spends the Autopilot USD balance. SIMULATED.

No card network or issuing bank is contacted, and no card number exists: a card is a record with the last four
digits, an expiry month and the holder's verified legal name, never a full number or security code. Purchases are
authorizations the holder simulates (merchant, amount, channel), checked exactly as an issuer would check them:

  card state      cancelled, frozen or expired cards decline
  channel         online and ATM use can each be switched off
  limits          per-transaction and rolling daily limits
  balance         the ledger's serialised balance check (the wallet can never go negative)

An approved purchase posts wallet:<user> -> external:card_network; a merchant refund posts it back. Declines are
recorded but move nothing. A licensed issuing partner replaces these postings before any real card exists.

Concurrency: the daily limit is reserved on the card record with a compare-and-set on `version` before money moves,
so two simultaneous purchases can't both slip under the limit; the balance check runs inside the ledger's
serialised write. Each step has a fixed idempotency key, so a retried request returns the first outcome and a
purchase interrupted between its two writes is finished when the same request is sent again.
"""
import re
import secrets
from datetime import datetime, timezone

from .. import repo
from . import ledger, market, store
from .ledger import LedgerRejected, line
from .service import CapitalError, _update, get_profile

NETWORK_ACCOUNT = "external:card_network"
CHANNELS = ("online", "in_person", "atm")
CATEGORIES = ("software", "advertising", "office", "travel", "meals", "cash", "other")
MIN_LIMIT_CENTS = 10_00
MAX_PER_TRANSACTION_CENTS = 5_000_00
MAX_DAILY_CENTS = 10_000_00
DEFAULT_PER_TRANSACTION_CENTS = 1_000_00
DEFAULT_DAILY_CENTS = 2_500_00
MAX_PURCHASE_CENTS = MAX_PER_TRANSACTION_CENTS
VALID_YEARS = 3

DECLINE_TEXT = {
    "card_cancelled": "The card is cancelled.",
    "card_frozen": "The card is frozen. Unfreeze it to use it.",
    "card_expired": "The card has expired.",
    "online_disabled": "Online purchases are switched off for this card.",
    "atm_disabled": "ATM withdrawals are switched off for this card.",
    "over_transaction_limit": "The amount is over the card's per-purchase limit.",
    "over_daily_limit": "The amount would go over the card's daily limit.",
    "insufficient_funds": "Not enough in your Autopilot USD balance.",
}


def _today() -> str:
    return store.now().strftime("%Y-%m-%d")


def _expired(card: dict) -> bool:
    now = store.now()
    return (now.year, now.month) > (card["exp_year"], card["exp_month"])


def spent_today(card: dict) -> int:
    return card.get("spend_cents", 0) if card.get("spend_day") == _today() else 0


async def current(user_id: str) -> dict | None:
    """The user's card that isn't cancelled, if any (one at a time)."""
    rows = await store.find("debit_cards", {"user_id": user_id, "live": True}, limit=1)
    return rows[0] if rows else None


async def _card(user_id: str, card_id: str) -> dict:
    card = await store.get("debit_cards", card_id, user_id=user_id)
    if card is None:
        raise CapitalError("Card not found.", 404)
    return card


async def issue(user_id: str) -> dict:
    profile = await get_profile(user_id)
    if profile["kyc"].get("status") != "verified":
        raise CapitalError("Verify your identity first (Capital, then Verification). Cards are issued only to verified "
                           "account holders.", 403)
    if await current(user_id):
        raise CapitalError("You already have a card. Cancel it to get a new one.", 409)
    now = store.now()
    name = re.sub(r"[^A-Za-z .'-]", "", profile["kyc"].get("legal_name") or "").upper()[:26].strip() or "AUTOPILOT MEMBER"
    try:
        card = await store.insert("debit_cards", user_id, {
            "last4": f"{secrets.randbelow(10_000):04d}", "exp_month": now.month, "exp_year": now.year + VALID_YEARS,
            "name_on_card": name, "status": "active", "live": True, "funding": "usd",
            "per_transaction_limit_cents": DEFAULT_PER_TRANSACTION_CENTS, "daily_limit_cents": DEFAULT_DAILY_CENTS,
            "online_enabled": True, "atm_enabled": False, "spend_day": None, "spend_cents": 0,
            "settlement": ledger.SETTLEMENT,
        })
    except store.Conflict:
        raise CapitalError("You already have a card. Cancel it to get a new one.", 409)
    await repo.log_activity(user_id, "Banking", f"Issued virtual debit card ••{card['last4']} (simulated)")
    await repo.notify(user_id, "Your virtual debit card is ready",
                      f"Card ••{card['last4']} spends your Autopilot USD balance (simulated: no real card exists).", "success")
    return card


async def set_status(user_id: str, card_id: str, action: str) -> dict:
    card = await _card(user_id, card_id)
    if card["status"] == "cancelled":
        raise CapitalError("This card is cancelled.", 409)
    if action == "freeze":
        if card["status"] == "frozen":
            return card
        card = await _update("debit_cards", card, {"status": "frozen", "frozen_at": store.now()})
    elif action == "unfreeze":
        if card["status"] == "active":
            return card
        card = await _update("debit_cards", card, {"status": "active"})
    elif action == "cancel":
        card = await _update("debit_cards", card, {"status": "cancelled", "live": False, "cancelled_at": store.now()})
    else:
        raise CapitalError("Choose freeze, unfreeze or cancel.")
    verb = {"freeze": "Froze", "unfreeze": "Unfroze", "cancel": "Cancelled"}[action]
    await repo.log_activity(user_id, "Banking", f"{verb} debit card ••{card['last4']}")
    return card


async def update_controls(user_id: str, card_id: str, *, per_transaction_cents: int | None = None,
                          daily_cents: int | None = None, online: bool | None = None, atm: bool | None = None) -> dict:
    card = await _card(user_id, card_id)
    if card["status"] == "cancelled":
        raise CapitalError("This card is cancelled.", 409)
    per = card["per_transaction_limit_cents"] if per_transaction_cents is None else per_transaction_cents
    daily = card["daily_limit_cents"] if daily_cents is None else daily_cents
    if not MIN_LIMIT_CENTS <= per <= MAX_PER_TRANSACTION_CENTS:
        raise CapitalError(f"The per-purchase limit is between ${MIN_LIMIT_CENTS / 100:,.0f} and "
                           f"${MAX_PER_TRANSACTION_CENTS / 100:,.0f}.")
    if not MIN_LIMIT_CENTS <= daily <= MAX_DAILY_CENTS:
        raise CapitalError(f"The daily limit is between ${MIN_LIMIT_CENTS / 100:,.0f} and ${MAX_DAILY_CENTS / 100:,.0f}.")
    if per > daily:
        raise CapitalError("The per-purchase limit can't be higher than the daily limit.")
    fields = {"per_transaction_limit_cents": per, "daily_limit_cents": daily}
    if online is not None:
        fields["online_enabled"] = bool(online)
    if atm is not None:
        fields["atm_enabled"] = bool(atm)
    return await _update("debit_cards", card, fields)


def _decline_reason(card: dict, channel: str, amount: int) -> str | None:
    if card["status"] == "cancelled":
        return "card_cancelled"
    if card["status"] == "frozen":
        return "card_frozen"
    if _expired(card):
        return "card_expired"
    if channel == "online" and not card.get("online_enabled"):
        return "online_disabled"
    if channel == "atm" and not card.get("atm_enabled"):
        return "atm_disabled"
    if amount > card["per_transaction_limit_cents"]:
        return "over_transaction_limit"
    if spent_today(card) + amount > card["daily_limit_cents"]:
        return "over_daily_limit"
    return None


async def _reserve_daily(card_id: str, user_id: str, channel: str, amount: int) -> str | None:
    """Re-check the card and count the amount against today's limit in one compare-and-set.
    Returns a decline reason, or None once the amount is reserved."""
    for _ in range(8):
        card = await _card(user_id, card_id)
        reason = _decline_reason(card, channel, amount)
        if reason:
            return reason
        updated = await store.update("debit_cards", card_id, {"spend_day": _today(), "spend_cents": spent_today(card) + amount},
                                     expect_version=card["version"])
        if updated is not None:
            return None
    raise CapitalError("The card is busy. Try again.", 409)


async def _release_daily(card_id: str, user_id: str, amount: int, day: str) -> None:
    for _ in range(8):
        card = await _card(user_id, card_id)
        if card.get("spend_day") != day:
            return
        updated = await store.update("debit_cards", card_id, {"spend_cents": max(0, card.get("spend_cents", 0) - amount)},
                                     expect_version=card["version"])
        if updated is not None:
            return


def _clean_merchant(merchant: str) -> str:
    merchant = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", merchant or "").split())[:40]
    if len(merchant) < 2:
        raise CapitalError("Enter the merchant's name.")
    return merchant


async def _finish(txn: dict) -> dict:
    """Post an authorization whose daily limit is reserved, then mark it approved (or declined for balance)."""
    amount = txn["amount_cents"]
    what = "ATM withdrawal" if txn["channel"] == "atm" else f"Card purchase at {txn['merchant']}"
    try:
        entry = await ledger.post("card_purchase", [line(market.wallet(txn["user_id"]), -amount), line(NETWORK_ACCOUNT, amount)],
                                  memo=f"{what} (card ••{txn['last4']})",
                                  refs={"user_id": txn["user_id"], "card_id": txn["card_id"], "card_txn_id": txn["id"]},
                                  idem=f"card:{txn['id']}:auth",
                                  check=ledger.require_non_negative(market.wallet(txn["user_id"])))
    except LedgerRejected:
        await _release_daily(txn["card_id"], txn["user_id"], amount, txn["day"])
        txn = await _update("card_transactions", txn, {"status": "declined", "decline_reason": "insufficient_funds"})
        await repo.notify(txn["user_id"], "Card purchase declined",
                          f"{txn['merchant']} ${amount / 100:,.2f}: {DECLINE_TEXT['insufficient_funds']}", "warning")
        return txn
    return await _update("card_transactions", txn, {"status": "approved", "seq": entry["seq"], "approved_at": store.now()})


async def authorize(user_id: str, card_id: str, *, merchant: str, category: str, channel: str, amount_cents: int,
                    idem: str) -> dict:
    """Simulate a purchase on the card. Returns the transaction, approved or declined; a decline is an outcome, not
    an error."""
    existing = await store.find("card_transactions", {"user_id": user_id, "idem": idem}, limit=1)
    if existing:
        txn = existing[0]
        return await _continue(txn) if txn["status"] == "pending" else txn
    if channel not in CHANNELS:
        raise CapitalError("Choose online, in person or ATM.")
    if category not in CATEGORIES:
        raise CapitalError("Choose a category.")
    if not 1 <= amount_cents <= MAX_PURCHASE_CENTS:
        raise CapitalError(f"Enter an amount up to ${MAX_PURCHASE_CENTS / 100:,.0f}.")
    merchant = "ATM" if channel == "atm" else _clean_merchant(merchant)
    card = await _card(user_id, card_id)
    try:
        txn = await store.insert("card_transactions", user_id, {
            "card_id": card_id, "last4": card["last4"], "merchant": merchant, "category": "cash" if channel == "atm" else category,
            "channel": channel, "amount_cents": amount_cents, "status": "pending", "idem": idem, "day": _today(),
            "reserved": False, "settlement": ledger.SETTLEMENT})
    except store.Conflict:
        return (await store.find("card_transactions", {"user_id": user_id, "idem": idem}, limit=1))[0]
    return await _continue(txn)


async def _continue(txn: dict) -> dict:
    """Intent -> reserve the daily limit -> post. Each step is recorded, so a retry resumes where it stopped (a crash
    between the reservation and recording it can only count an amount twice against the limit, never move money twice)."""
    if not txn.get("reserved"):
        reason = await _reserve_daily(txn["card_id"], txn["user_id"], txn["channel"], txn["amount_cents"])
        if reason:
            txn = await _update("card_transactions", txn, {"status": "declined", "decline_reason": reason})
            if reason in ("card_frozen", "card_cancelled"):
                await repo.notify(txn["user_id"], "Card purchase declined",
                                  f"{txn['merchant']} ${txn['amount_cents'] / 100:,.2f}: {DECLINE_TEXT[reason]}", "warning")
            return txn
        txn = await _update("card_transactions", txn, {"reserved": True, "day": _today()})
    return await _finish(txn)


async def refund(user_id: str, txn_id: str) -> dict:
    """A merchant refund of an approved purchase, in full and once. The daily limit isn't given back (issuers don't)."""
    txn = await store.get("card_transactions", txn_id, user_id=user_id)
    if txn is None:
        raise CapitalError("Card transaction not found.", 404)
    if txn["status"] == "refunded":
        return txn
    if txn["status"] != "approved":
        raise CapitalError(f"Only approved purchases can be refunded; this one is {txn['status']}.", 409)
    if txn["channel"] == "atm":
        raise CapitalError("ATM withdrawals can't be refunded.", 409)
    amount = txn["amount_cents"]
    entry = await ledger.post("card_refund", [line(NETWORK_ACCOUNT, -amount), line(market.wallet(user_id), amount)],
                              memo=f"Refund from {txn['merchant']} (card ••{txn['last4']})",
                              refs={"user_id": user_id, "card_id": txn["card_id"], "card_txn_id": txn["id"]},
                              idem=f"card:{txn['id']}:refund")
    txn = await _update("card_transactions", txn, {"status": "refunded", "refund_seq": entry["seq"], "refunded_at": store.now()})
    await repo.notify(user_id, "Card refund received", f"{txn['merchant']} refunded ${amount / 100:,.2f} (simulated).", "success")
    return txn


async def transactions_for(user_id: str, limit: int = 100) -> list[dict]:
    return [t for t in await store.find("card_transactions", {"user_id": user_id}, limit=limit) if t["status"] != "pending"]


def expires_label(card: dict) -> str:
    return datetime(card["exp_year"], card["exp_month"], 1, tzinfo=timezone.utc).strftime("%m/%y")
