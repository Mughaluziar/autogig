"""Banking: Autopilot balances, linked bank accounts, transfers, statements,
the unified transaction history, linked crypto wallets, member-to-member
transfers and business-financing applications.

SIMULATED SETTLEMENT. Balances live in the capital ledger (`wallet:<user>`
in USD, `usdc:<user>` in USDC, both integer cents) and every transfer posts a
balanced entry against `external:bank` or `external:chain`. No bank or chain
is contacted: a licensed banking or stablecoin partner replaces those
postings before real money moves (docs/banking.md). Bank accounts keep only
the routing number and the last four digits of the account number.

Business financing is an application that a licensed lending partner would
review. The indicative range comes only from revenue the marketplaces' own
APIs verified; nothing here is a credit decision or an offer.
"""
import csv
import io
import re
import secrets
from datetime import datetime, timedelta, timezone

from .. import db, repo
from . import ledger, market, store
from .ledger import LedgerRejected, line
from .service import CapitalError, _notify_operators, _update, get_profile, investor_position

MAX_BANK_ACCOUNTS = 5
MAX_VERIFY_ATTEMPTS = 5
MIN_TRANSFER_CENTS = 1_00
MAX_TRANSFER_CENTS = 50_000_00
DAILY_DEPOSIT_CENTS = 50_000_00
# Kinds a user can start. "internal_receive" is created for the recipient of an internal_send only.
TRANSFER_KINDS = ("deposit", "withdraw", "to_usdc", "to_usd", "crypto_send", "crypto_receive", "internal_send")
CRYPTO_NETWORK = "Base (simulated)"
ADVANCE_PAYOUT_HOURS = 24
DAILY_CRYPTO_RECEIVE_CENTS = 50_000_00
DAILY_INTERNAL_SEND_CENTS = 10_000_00
MAX_CRYPTO_ADDRESSES = 10
NOTE_MAX = 140
ADDRESS_RE = re.compile(r"0x[0-9a-fA-F]{40}")
# Same answer whether the address is unknown or unverified, so the form can't be used to discover accounts.
RECIPIENT_REFUSED = ("We can't send to that email. Money can only go to another Autopilot account whose identity has "
                     "been verified.")

FINANCING_MIN_CENTS = 5_000_00
FINANCING_MAX_CENTS = 250_000_00
FINANCING_PRODUCTS = ("line_of_credit", "term_loan", "revenue_based")
FINANCING_OPEN = ("submitted", "in_review")
FINANCING_STATUSES = ("submitted", "in_review", "referred", "declined", "withdrawn")
# Indicative ceiling: a quarter of the last 12 months' verified revenue.
FINANCING_REVENUE_BPS = 2_500


def usdc(user_id: str) -> str:
    return f"usdc:{user_id}"


async def balances_for(user_id: str, bal: dict | None = None) -> dict:
    bal = bal if bal is not None else await ledger.balances()
    return {"usdCents": ledger.usd(bal, market.wallet(user_id)), "usdcCents": ledger.usd(bal, usdc(user_id))}


# --------------------------------------------------------------------------- #
# Bank accounts
# --------------------------------------------------------------------------- #
def valid_routing(routing: str) -> bool:
    """ABA routing-number checksum."""
    if not re.fullmatch(r"\d{9}", routing):
        return False
    d = [int(c) for c in routing]
    return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 == 0


async def add_bank_account(user_id: str, *, holder: str, nickname: str, routing: str, account_number: str,
                           kind: str) -> dict:
    holder = " ".join(holder.split())[:120]
    routing = re.sub(r"\D", "", routing)
    account_number = re.sub(r"\D", "", account_number)
    if len(holder) < 3:
        raise CapitalError("Enter the account holder's name as the bank shows it.")
    if not valid_routing(routing):
        raise CapitalError("That routing number isn't valid. It's the 9-digit number on the bottom left of a check.")
    if not 4 <= len(account_number) <= 17:
        raise CapitalError("Account numbers are 4 to 17 digits.")
    if kind not in ("checking", "savings"):
        raise CapitalError("Choose checking or savings.")
    existing = [a for a in await store.find("bank_accounts", {"user_id": user_id}) if a["status"] != "removed"]
    if len(existing) >= MAX_BANK_ACCOUNTS:
        raise CapitalError(f"You can link up to {MAX_BANK_ACCOUNTS} bank accounts.", 409)
    last4 = account_number[-4:]
    if any(a["routing"] == routing and a["last4"] == last4 for a in existing):
        raise CapitalError("This account is already linked.", 409)
    deposits = sorted(secrets.randbelow(99) + 1 for _ in range(2))
    account = await store.insert("bank_accounts", user_id, {
        "holder": holder, "nickname": " ".join(nickname.split())[:40] or f"{kind.title()} ••{last4}",
        "routing": routing, "last4": last4, "kind": kind, "status": "pending", "micro_deposits": deposits,
        "attempts": 0, "settlement": ledger.SETTLEMENT,
    })
    await repo.log_activity(user_id, "Banking", f"Linked bank account ••{last4} (pending verification)")
    return account


async def verify_bank_account(user_id: str, account_id: str, amounts: list[int]) -> dict:
    account = await store.get("bank_accounts", account_id, user_id=user_id)
    if account is None or account["status"] == "removed":
        raise CapitalError("Bank account not found.", 404)
    if account["status"] == "verified":
        return account
    if account["attempts"] >= MAX_VERIFY_ATTEMPTS:
        raise CapitalError("Too many attempts. Remove this account and link it again.", 429)
    if sorted(amounts) != sorted(account["micro_deposits"]):
        account = await _update("bank_accounts", account, {"attempts": account["attempts"] + 1})
        left = MAX_VERIFY_ATTEMPTS - account["attempts"]
        raise CapitalError(f"Those amounts don't match. {left} attempt{'s' if left != 1 else ''} left.")
    account = await _update("bank_accounts", account, {"status": "verified", "verified_at": store.now()})
    await repo.notify(user_id, "Bank account verified", f"{account['nickname']} can now send and receive money.", "success")
    return account


async def remove_bank_account(user_id: str, account_id: str) -> dict:
    account = await store.get("bank_accounts", account_id, user_id=user_id)
    if account is None or account["status"] == "removed":
        raise CapitalError("Bank account not found.", 404)
    return await _update("bank_accounts", account, {"status": "removed", "removed_at": store.now()})


# --------------------------------------------------------------------------- #
# Linked crypto wallets (the user's own addresses on Base)
# --------------------------------------------------------------------------- #
def _clean_address(address: str | None) -> str:
    address = (address or "").strip()
    if not ADDRESS_RE.fullmatch(address):
        raise CapitalError("Enter a wallet address on Base: 0x followed by 40 hex characters.")
    return address


async def crypto_addresses(user_id: str) -> list[dict]:
    return [a for a in await store.find("crypto_addresses", {"user_id": user_id}, limit=100) if a.get("live")]


async def add_crypto_address(user_id: str, *, label: str, address: str, source: str = "manual") -> dict:
    """Link one of the user's own wallets. Only the public address is stored: never a key or a signature."""
    address = _clean_address(address)
    label = " ".join((label or "").split())[:40] or f"Wallet {address[:6]}…{address[-4:]}"
    active = await crypto_addresses(user_id)
    if len(active) >= MAX_CRYPTO_ADDRESSES:
        raise CapitalError(f"You can link up to {MAX_CRYPTO_ADDRESSES} wallets. Remove one first.", 409)
    if any(a["address_lower"] == address.lower() for a in active):
        raise CapitalError("This wallet is already linked.", 409)
    try:
        record = await store.insert("crypto_addresses", user_id, {
            "label": label, "address": address, "address_lower": address.lower(), "network": CRYPTO_NETWORK,
            "source": source if source in ("manual", "browser_wallet") else "manual", "live": True,
            "settlement": ledger.SETTLEMENT})
    except store.Conflict:
        raise CapitalError("This wallet is already linked.", 409)
    await repo.log_activity(user_id, "Banking", f"Linked wallet {address[:6]}…{address[-4:]}")
    return record


async def remove_crypto_address(user_id: str, address_id: str) -> dict:
    record = await store.get("crypto_addresses", address_id, user_id=user_id)
    if record is None or not record.get("live"):
        raise CapitalError("Wallet not found.", 404)
    return await _update("crypto_addresses", record, {"live": False, "removed_at": store.now()})


# --------------------------------------------------------------------------- #
# Transfers
# --------------------------------------------------------------------------- #
def _lines(kind: str, user_id: str, amount: int, counterparty: str | None = None) -> list[dict]:
    w, u = market.wallet(user_id), usdc(user_id)
    if kind == "internal_send":
        return [line(w, -amount), line(market.wallet(counterparty), amount)]
    return {
        "deposit": [line(w, amount), line("external:bank", -amount)],
        "withdraw": [line(w, -amount), line("external:bank", amount)],
        "to_usdc": [line(w, -amount), line(u, amount)],
        "to_usd": [line(u, -amount), line(w, amount)],
        "crypto_send": [line(u, -amount), line("external:chain", amount)],
        "crypto_receive": [line(u, amount), line("external:chain", -amount)],
    }[kind]


def _source_account(kind: str, user_id: str) -> str | None:
    """The balance a transfer draws from (None: money comes in from outside)."""
    if kind in ("deposit", "crypto_receive"):
        return None
    return market.wallet(user_id) if kind in ("withdraw", "to_usdc", "internal_send") else usdc(user_id)


async def _sum_today(user_id: str, kind: str) -> int:
    since = store.now() - timedelta(days=1)
    return sum(t["amount_cents"] for t in await store.find("bank_transfers", {"user_id": user_id, "kind": kind}, limit=500)
               if t["status"] == "completed" and store.aware(t["created_at"]) >= since)


async def _recipient(sender_id: str, email: str | None) -> dict:
    email = (email or "").strip().lower()
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,255}", email):
        raise CapitalError("Enter the recipient's email address.")
    recipient = await db.find_user(email)
    if recipient is None or recipient.get("deleted_at"):
        raise CapitalError(RECIPIENT_REFUSED)
    if recipient["id"] == sender_id:
        raise CapitalError("You can't send money to yourself. Use Convert to move money between your balances.")
    if ((await store.profile(recipient["id"]) or {}).get("kyc") or {}).get("status") != "verified":
        raise CapitalError(RECIPIENT_REFUSED)
    return recipient


async def _ensure_receipt(record: dict) -> None:
    """The recipient's copy of a completed internal transfer. Idempotent (fixed key per transfer), so a retry
    of the sender's request, or a crash after the ledger entry, never shows the money twice or not at all."""
    if record["kind"] != "internal_send" or record["status"] != "completed" or not record.get("counterparty_id"):
        return
    key = f"recv-{record['id']}"
    if await store.find("bank_transfers", {"user_id": record["counterparty_id"], "idem": key}, limit=1):
        return
    await store.insert("bank_transfers", record["counterparty_id"], {
        "kind": "internal_receive", "amount_cents": record["amount_cents"], "status": "completed", "idem": key,
        "bank_account_id": None, "bank_label": None, "address": None, "network": None,
        "counterparty_id": record["user_id"], "counterparty_label": record.get("sender_label") or "An Autopilot member",
        "note": record.get("note"), "seq": record.get("seq"), "completed_at": record.get("completed_at"),
        "settlement": ledger.SETTLEMENT})
    amount = f"${record['amount_cents'] / 100:,.2f}"
    who = record.get("sender_label") or "An Autopilot member"
    await repo.notify(record["counterparty_id"], "Money received",
                      f"{who} sent you {amount} (simulated)." + (f" Note: {record['note']}" if record.get("note") else ""),
                      "success")


async def transfer(user_id: str, *, kind: str, amount_cents: int, idem: str, bank_account_id: str | None = None,
                   address: str | None = None, crypto_address_id: str | None = None,
                   recipient_email: str | None = None, note: str | None = None, sender_label: str | None = None) -> dict:
    """Move money in, out or between balances. Each kind needs its own counterparty: a verified bank account
    (deposit, withdraw), a wallet address or a linked wallet (crypto_send), a linked wallet (crypto_receive) or a
    verified member's email (internal_send). The idempotency key makes a retried request return the first result."""
    if kind not in TRANSFER_KINDS:
        raise CapitalError("Choose a transfer type.")
    if not MIN_TRANSFER_CENTS <= amount_cents <= MAX_TRANSFER_CENTS:
        raise CapitalError(f"Transfers must be between ${MIN_TRANSFER_CENTS / 100:,.2f} and ${MAX_TRANSFER_CENTS / 100:,.0f}.")
    existing = await store.find("bank_transfers", {"user_id": user_id, "idem": idem}, limit=1)
    if existing:
        await _ensure_receipt(existing[0])
        return existing[0]
    bank = linked = recipient = None
    if kind in ("deposit", "withdraw"):
        bank = await store.get("bank_accounts", bank_account_id or "", user_id=user_id)
        if bank is None or bank["status"] == "removed":
            raise CapitalError("Choose a linked bank account.", 404)
        if bank["status"] != "verified":
            raise CapitalError("Verify this bank account first.", 409)
    if kind in ("crypto_send", "crypto_receive") and crypto_address_id:
        linked = await store.get("crypto_addresses", crypto_address_id, user_id=user_id)
        if linked is None or not linked.get("live"):
            raise CapitalError("Choose one of your linked wallets.", 404)
        address = linked["address"]
    if kind == "crypto_receive" and linked is None:
        raise CapitalError("Choose the linked wallet the USDC comes from.")
    if kind == "crypto_send":
        address = _clean_address(address)
    note = " ".join((note or "").split())[:NOTE_MAX] or None
    if kind == "internal_send":
        if ((await store.profile(user_id) or {}).get("kyc") or {}).get("status") != "verified":
            raise CapitalError("Verify your identity (Capital, then Verification) before sending money to other members.", 403)
        recipient = await _recipient(user_id, recipient_email)
        if not sender_label:
            # Name and email together: a display name alone could impersonate someone else.
            sender = await db.find_user_by_id(user_id) or {}
            name = " ".join((sender.get("name") or "").split())[:60]
            sender_label = f"{name} ({sender.get('email')})" if name else sender.get("email")
    limits = {"deposit": (DAILY_DEPOSIT_CENTS, "Deposits"), "crypto_receive": (DAILY_CRYPTO_RECEIVE_CENTS, "USDC receipts"),
              "internal_send": (DAILY_INTERNAL_SEND_CENTS, "Transfers to other members")}
    if kind in limits:
        cap, what = limits[kind]
        if await _sum_today(user_id, kind) + amount_cents > cap:
            raise CapitalError(f"{what} are limited to ${cap / 100:,.0f} a day.", 409)
    crypto = kind in ("crypto_send", "crypto_receive")
    record = await store.insert("bank_transfers", user_id, {
        "kind": kind, "amount_cents": amount_cents, "status": "posting", "idem": idem,
        "bank_account_id": bank["id"] if bank else None, "bank_label": f"{bank['nickname']}" if bank else None,
        "address": address if crypto else None, "network": CRYPTO_NETWORK if crypto else None,
        "wallet_label": linked["label"] if linked else None,
        "counterparty_id": recipient["id"] if recipient else None,
        "counterparty_label": recipient["email"] if recipient else None,
        "sender_label": (sender_label or "")[:120] or None if recipient else None,
        "note": note if kind == "internal_send" else None, "settlement": ledger.SETTLEMENT,
    })
    source = _source_account(kind, user_id)
    refs = {"user_id": user_id, "transfer_id": record["id"]}
    if recipient:
        refs["users"] = [user_id, recipient["id"]]
    try:
        entry = await ledger.post(f"bank_{kind}", _lines(kind, user_id, amount_cents, recipient["id"] if recipient else None),
                                  memo=_memo(kind, record), refs=refs, idem=f"bank:{record['id']}",
                                  check=ledger.require_non_negative(source) if source else None)
    except LedgerRejected:
        await _update("bank_transfers", record, {"status": "failed", "reason": "Insufficient balance"})
        raise CapitalError("Not enough balance for that transfer.", 409)
    record = await _update("bank_transfers", record, {"status": "completed", "seq": entry["seq"],
                                                      "completed_at": store.now()})
    await _ensure_receipt(record)
    await repo.log_activity(user_id, "Banking", f"{_memo(kind, record)} (simulated)")
    return record


def _memo(kind: str, record: dict) -> str:
    amount = f"${record['amount_cents'] / 100:,.2f}"
    wallet = record.get("wallet_label") or (record.get("address") or "")[:10] + "…"
    return {
        "deposit": f"Added {amount} from {record.get('bank_label') or 'bank'}",
        "withdraw": f"Withdrew {amount} to {record.get('bank_label') or 'bank'}",
        "to_usdc": f"Converted {amount} to USDC",
        "to_usd": f"Converted {amount} USDC to USD",
        "crypto_send": f"Sent {amount} USDC to {wallet}",
        "crypto_receive": f"Received {amount} USDC from {wallet}",
        # The memo is visible to both members, so it names neither of them.
        "internal_send": f"Member transfer of {amount}",
    }[kind]


async def payout_advance(user_id: str, advance_id: str, currency: str) -> dict:
    """Receive an early payment in the Autopilot balance (USD or USDC)
    instead of the payout bank account. Allowed once, within a day of
    accepting it."""
    if currency not in ("usd", "usdc"):
        raise CapitalError("Choose USD or USDC.")
    adv = await store.get("capital_advances", advance_id, user_id=user_id)
    if adv is None:
        raise CapitalError("Early payment not found.", 404)
    if adv.get("payout_to"):
        raise CapitalError("This early payment was already paid out.", 409)
    if adv["status"] not in ("active", "overdue"):
        raise CapitalError(f"This early payment is {adv['status']}.", 409)
    accepted = store.aware(adv.get("accepted_at"))
    if accepted is None or store.now() - accepted > timedelta(hours=ADVANCE_PAYOUT_HOURS):
        raise CapitalError("Early payments can be moved to your balance only within a day of accepting them.", 409)
    principal = adv["principal_cents"]
    account = market.wallet(user_id) if currency == "usd" else usdc(user_id)
    await ledger.post("advance_payout_wallet", [line("clearing:advance_payouts", -principal), line(account, principal)],
                      memo=f"Early payment received in your {currency.upper()} balance",
                      refs={"user_id": user_id, "advance_id": advance_id}, idem=f"advance:{advance_id}:wallet")
    return await _update("capital_advances", adv, {"payout_to": f"{currency}_balance"})


# --------------------------------------------------------------------------- #
# Overview and statements
# --------------------------------------------------------------------------- #
async def overview(user_id: str) -> dict:
    bal = await ledger.balances()
    accounts = [a for a in await store.find("bank_accounts", {"user_id": user_id}) if a["status"] != "removed"]
    transfers = await store.find("bank_transfers", {"user_id": user_id}, limit=20)
    pool = await investor_position(user_id)
    folio = await market.portfolio(user_id)
    applications = await store.find("financing_applications", {"user_id": user_id}, limit=20)
    profile = await get_profile(user_id)
    return {
        "settlement": ledger.SETTLEMENT,
        "balances": await balances_for(user_id, bal),
        "pool": {"valueCents": pool["valueCents"], "shares": pool["shares"]},
        "marketplace": folio["totals"],
        "accounts": accounts, "transfers": [t for t in transfers if t["status"] != "posting"],
        "applications": applications, "kycStatus": profile["kyc"].get("status", "none"),
        "limits": {"minTransferCents": MIN_TRANSFER_CENTS, "maxTransferCents": MAX_TRANSFER_CENTS,
                   "dailyDepositCents": DAILY_DEPOSIT_CENTS, "network": CRYPTO_NETWORK},
    }


def _month_bounds(month: str) -> tuple[datetime, datetime]:
    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
        raise CapitalError("Use a month like 2026-11.")
    year, mon = int(month[:4]), int(month[5:])
    start = datetime(year, mon, 1, tzinfo=timezone.utc)
    end = datetime(year + (mon == 12), mon % 12 + 1, 1, tzinfo=timezone.utc)
    return start, end


async def statement(user_id: str, month: str) -> dict:
    start, end = _month_bounds(month)
    accounts = {market.wallet(user_id): "usd", usdc(user_id): "usdc"}
    opening = {"usd": 0, "usdc": 0}
    rows = []
    for entry in reversed(await ledger.entries(user_id=user_id, limit=5000)):
        delta = {"usd": 0, "usdc": 0}
        for item in entry["lines"]:
            if item["account"] in accounts and item["unit"] == "USD":
                delta[accounts[item["account"]]] += item["amount"]
        if not delta["usd"] and not delta["usdc"]:
            continue
        at = datetime.strptime(entry["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if at < start:
            opening = {k: opening[k] + delta[k] for k in opening}
        elif at < end:
            rows.append({"seq": entry["seq"], "at": entry["at"], "kind": entry["kind"], "memo": entry["memo"],
                         "usdCents": delta["usd"], "usdcCents": delta["usdc"]})
    closing = dict(opening)
    for r in rows:
        closing["usd"] += r["usdCents"]
        closing["usdc"] += r["usdcCents"]
    return {"month": month, "settlement": ledger.SETTLEMENT, "openingCents": opening, "closingCents": closing,
            "inCents": sum(max(0, r["usdCents"]) + max(0, r["usdcCents"]) for r in rows),
            "outCents": sum(min(0, r["usdCents"]) + min(0, r["usdcCents"]) for r in rows) * -1,
            "rows": rows}


# --------------------------------------------------------------------------- #
# Transaction history: every movement of the user's USD and USDC balances
# --------------------------------------------------------------------------- #
# Ledger entry kind -> category shown and filtered in the history. Unknown kinds land in "other".
CATEGORIES = ("bank", "crypto", "member", "card", "investing", "other")
_CATEGORY = {
    "bank_deposit": "bank", "bank_withdraw": "bank",
    "bank_to_usdc": "crypto", "bank_to_usd": "crypto", "bank_crypto_send": "crypto", "bank_crypto_receive": "crypto",
    "bank_internal_send": "member",
    "card_purchase": "card", "card_refund": "card",
    "investor_deposit": "investing", "investor_withdrawal": "investing", "advance_payout_wallet": "investing",
}
MAX_HISTORY_DAYS = 366


def category_of(kind: str) -> str:
    if kind in _CATEGORY:
        return _CATEGORY[kind]
    return "investing" if kind.startswith("market_") else "other"


def _day(value: str | None, field: str):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise CapitalError(f"Use a date like 2026-11-27 for {field}.")


async def wallet_activity(user_id: str) -> list[dict]:
    """Oldest first, with the running USD and USDC balances after each movement. Built from the ledger, the only
    source of truth, so it includes card spend, investments, distributions and transfers between members."""
    accounts = {market.wallet(user_id): "usd", usdc(user_id): "usdc"}
    running = {"usd": 0, "usdc": 0}
    rows = []
    for entry in reversed(await ledger.entries(user_id=user_id, limit=5000)):
        delta = {"usd": 0, "usdc": 0}
        for item in entry["lines"]:
            if item["account"] in accounts and item["unit"] == "USD":
                delta[accounts[item["account"]]] += item["amount"]
        if not delta["usd"] and not delta["usdc"]:
            continue
        running = {k: running[k] + delta[k] for k in running}
        rows.append({"seq": entry["seq"], "at": entry["at"], "kind": entry["kind"], "category": category_of(entry["kind"]),
                     "memo": entry["memo"], "usdCents": delta["usd"], "usdcCents": delta["usdc"],
                     "balanceUsdCents": running["usd"], "balanceUsdcCents": running["usdc"]})
    return rows


async def history(user_id: str, *, currency: str | None = None, direction: str | None = None,
                  category: str | None = None, start: str | None = None, end: str | None = None,
                  search: str | None = None) -> list[dict]:
    """Filtered history, newest first. Dates are inclusive UTC days."""
    if currency not in (None, "", "usd", "usdc"):
        raise CapitalError("Currency is usd or usdc.")
    if direction not in (None, "", "in", "out"):
        raise CapitalError("Direction is in or out.")
    if category not in (None, "", *CATEGORIES):
        raise CapitalError(f"Category is one of: {', '.join(CATEGORIES)}.")
    since, until = _day(start, "from"), _day(end, "to")
    if since and until and until < since:
        raise CapitalError("The end date is before the start date.")
    if since and until and (until - since).days > MAX_HISTORY_DAYS:
        raise CapitalError(f"Choose at most {MAX_HISTORY_DAYS} days.")
    until = until + timedelta(days=1) if until else None
    needle = " ".join((search or "").lower().split())[:80]
    out = []
    for row in reversed(await wallet_activity(user_id)):
        at = datetime.strptime(row["at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        amount = row["usdCents"] if currency == "usd" else row["usdcCents"] if currency == "usdc" else row["usdCents"] + row["usdcCents"]
        if currency and not amount:
            continue
        if direction == "in" and amount <= 0 or direction == "out" and amount >= 0:
            continue
        if category and row["category"] != category:
            continue
        if since and at < since or until and at >= until:
            continue
        if needle and needle not in row["memo"].lower():
            continue
        out.append(row)
    return out


async def transactions(user_id: str, *, before: int | None = None, limit: int = 50, **filters) -> dict:
    rows = await history(user_id, **filters)
    if before is not None:
        rows = [r for r in rows if r["seq"] < before]
    page = rows[:limit]
    return {"settlement": ledger.SETTLEMENT, "rows": page, "categories": list(CATEGORIES),
            "nextBefore": page[-1]["seq"] if len(rows) > limit else None,
            "inCents": sum(max(0, r["usdCents"]) + max(0, r["usdcCents"]) for r in rows),
            "outCents": -sum(min(0, r["usdCents"]) + min(0, r["usdcCents"]) for r in rows), "count": len(rows)}


def _cell(value) -> str:
    """Spreadsheet-safe text: a cell starting with = + - @ (or a tab/CR) would run as a formula in Excel/Sheets."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


async def transactions_csv(user_id: str, **filters) -> str:
    rows = await history(user_id, **filters)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(["Date", "Category", "Description", "USD", "USDC", "USD balance", "USDC balance", "Reference"])
    for r in rows:
        writer.writerow([r["at"], r["category"], _cell(r["memo"]), f"{r['usdCents'] / 100:.2f}", f"{r['usdcCents'] / 100:.2f}",
                         f"{r['balanceUsdCents'] / 100:.2f}", f"{r['balanceUsdcCents'] / 100:.2f}", r["seq"]])
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Business financing (applications for a licensed lending partner)
# --------------------------------------------------------------------------- #
async def financing_estimate(user_id: str) -> dict:
    record = await market.track_record(user_id)
    trailing = record["trailingYearCents"]
    ceiling = min(FINANCING_MAX_CENTS, trailing * FINANCING_REVENUE_BPS // 10_000 // 500_00 * 500_00)
    reasons = []
    if not record["verifiedOrders"]:
        reasons.append("Connect a marketplace account with API verification so your revenue can be verified.")
    elif ceiling < FINANCING_MIN_CENTS:
        reasons.append(f"About ${FINANCING_MIN_CENTS * 10_000 // FINANCING_REVENUE_BPS / 100:,.0f} of verified revenue "
                       "in the last 12 months is needed for an estimate.")
    return {
        "trackRecord": record, "verifiedTrailingYearCents": trailing,
        "estimate": {"lowCents": ceiling // 2 // 100 * 100, "highCents": ceiling} if not reasons else None,
        "reasons": reasons, "minCents": FINANCING_MIN_CENTS, "maxCents": FINANCING_MAX_CENTS,
        "products": list(FINANCING_PRODUCTS),
    }


async def apply_for_financing(user: dict, *, amount_cents: int, product: str, purpose: str, business_type: str,
                              years_in_business: str, team_size: int, monthly_revenue_cents: int, consent: bool) -> dict:
    if not FINANCING_MIN_CENTS <= amount_cents <= FINANCING_MAX_CENTS:
        raise CapitalError(f"Request between ${FINANCING_MIN_CENTS / 100:,.0f} and ${FINANCING_MAX_CENTS / 100:,.0f}.")
    if product not in FINANCING_PRODUCTS:
        raise CapitalError("Choose a financing type.")
    if business_type not in ("freelancer", "agency"):
        raise CapitalError("Choose freelancer or agency.")
    if years_in_business not in ("<1", "1-2", "3-5", "5+"):
        raise CapitalError("Choose how long you've been in business.")
    purpose = " ".join(purpose.split())[:600]
    if len(purpose) < 10:
        raise CapitalError("Tell us briefly what the money is for.")
    if not consent:
        raise CapitalError("Agree to share your verified business data with the lending partner.")
    open_apps = [a for a in await store.find("financing_applications", {"user_id": user["id"]}, limit=50)
                 if a["status"] in FINANCING_OPEN]
    if open_apps:
        raise CapitalError("You already have an application in review.", 409)
    estimate = await financing_estimate(user["id"])
    app = await store.insert("financing_applications", user["id"], {
        "amount_cents": amount_cents, "product": product, "purpose": purpose, "business_type": business_type,
        "years_in_business": years_in_business, "team_size": max(1, min(int(team_size or 1), 10_000)),
        "monthly_revenue_cents": max(0, min(int(monthly_revenue_cents or 0), 100_000_000_00)),
        "verified_trailing_year_cents": estimate["verifiedTrailingYearCents"], "estimate": estimate["estimate"],
        "grade": estimate["trackRecord"]["grade"], "status": "submitted", "email": user["email"],
        "history": [{"status": "submitted", "at": store.now()}],
    })
    await repo.notify(user["id"], "Financing application received",
                      "A lending partner reviews it, usually within a few business days. Nothing has been approved yet.",
                      "info")
    await repo.log_activity(user["id"], "Banking", f"Applied for ${amount_cents / 100:,.0f} business financing")
    await _notify_operators("Financing application", f"{user['email']} requested ${amount_cents / 100:,.0f}.")
    return app


async def withdraw_application(user_id: str, app_id: str) -> dict:
    app = await store.get("financing_applications", app_id, user_id=user_id)
    if app is None:
        raise CapitalError("Application not found.", 404)
    if app["status"] not in FINANCING_OPEN:
        raise CapitalError(f"This application is {app['status']}.", 409)
    return await _update("financing_applications", app, {
        "status": "withdrawn", "history": [*app.get("history", []), {"status": "withdrawn", "at": store.now()}]})


async def review_application(reviewer: dict, app_id: str, status: str, note: str) -> dict:
    if status not in ("in_review", "referred", "declined"):
        raise CapitalError("Choose in_review, referred or declined.")
    app = await store.get("financing_applications", app_id)
    if app is None:
        raise CapitalError("Application not found.", 404)
    if app["status"] not in FINANCING_OPEN:
        raise CapitalError(f"This application is {app['status']}.", 409)
    note = note.strip()[:300]
    app = await _update("financing_applications", app, {
        "status": status, "review_note": note, "reviewed_by": reviewer.get("email"),
        "history": [*app.get("history", []), {"status": status, "at": store.now(), "note": note}]})
    messages = {
        "in_review": "A lending partner is reviewing your financing application.",
        "referred": "Your application was referred to a lending partner. They'll contact you directly.",
        "declined": note or "Your financing application wasn't approved this time.",
    }
    await repo.notify(app["user_id"], "Financing application update", messages[status],
                      "warning" if status == "declined" else "info")
    return app

