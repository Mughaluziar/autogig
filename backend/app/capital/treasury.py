"""Treasury and financial reporting for the simulated money programs. READ-ONLY and SIMULATED: every figure comes from
the capital ledger (ledger.py) and a few capital records; nothing here posts an entry or moves money.

  overview()               balances grouped by program, the figures an operator watches, and integrity checks
  report(start, end)       opening/closing balances by group, flows by entry kind, income and losses, external in/out
  journal_csv(start, end)  every ledger line in the period, safe to open in a spreadsheet

Accounts are classified by prefix (the part before the first ":"), so an account a new feature adds lands in its
program's group with no code change, and an unknown prefix lands in "other". Entry kinds are handled generically for
the same reason. Accounts that belong to one customer (wallet:<user>, usdc:<user>, escrow:<listing>, shares:<user>,
token:<address>) are only ever shown as a count and a total: an account is listed by name only when its group is a
platform program AND its suffix is a plain lowercase word (pool:cash, external:card_network). Generated ids
("u-3f2a…", uuid hex, 0x addresses) never match, so no customer id reaches the overview or the report. The CSV export
is the exception: it is the owner's full journal.

Ledger sign convention: debit positive. Assets and customer balances are positive, capital and income are negative,
and each unit sums to zero. Key figures flip signs so that they read naturally (income as a positive amount).
"""
import csv
import io
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from ..credit import service as credit_service
from . import ledger, store
from .service import DISPLAY_SHARE_UNITS

NOTICE = ("Simulated: internal demo-ledger figures. No real money is held, received or paid out, and none of these "
          "figures may be reported as real funds.")

# prefix -> (label, platform program). Platform programs list their plainly named accounts; the rest are aggregated.
GROUPS: dict[str, tuple[str, bool]] = {
    "pool": ("Investor pool", True),
    "protection": ("Protection fund", True),
    "platform": ("Platform", True),
    "credit": ("AutoGig credit prototype", True),
    "wallet": ("Customer USD balances", False),
    "usdc": ("Customer USDC balances", False),
    "escrow": ("Marketplace escrow", False),
    "external": ("External counterparties", True),
    "clearing": ("Clearing and in transit", True),
    "shares": ("Pool shares", True),
    "token": ("Token program", True),
}
OTHER, OTHER_LABEL = "other", "Other accounts"
_PLAIN = re.compile(r"[a-z][a-z_]{0,47}")
_UNIT_ORDER = {"USD": 0, "SHARE": 1}

# Accounts that may never go below zero: program cash, and money held for customers.
NON_NEGATIVE = ("pool:cash", "protection:cash", "credit:cash", "credit:reserved")
NON_NEGATIVE_PREFIXES = ("wallet:", "usdc:", "escrow:")
# Kinds that book a platform fee straight to platform:cash, with no platform:income line.
PLATFORM_FEE_KINDS = ("market_disbursed",)

MAX_DAYS = 366
EARLIEST, LATEST = date(2000, 1, 1), date(2100, 12, 31)
SCAN_LIMIT = 50_000                  # capital records read for exposure and claims; far above any demo volume
MAX_CSV_LINES = 250_000
CSV_HEADER = ("seq", "at", "kind", "memo", "settlement", "account", "unit", "amount")
_FORMULA_LEAD = ("=", "+", "-", "@", "\t", "\r", "\n")


class PeriodError(ValueError):
    """The requested reporting period is missing or invalid."""


# ------------------------------------------------------------------------------------------------------ classification
def group_of(account: str) -> str:
    prefix = account.split(":", 1)[0]
    return prefix if prefix in GROUPS else OTHER


def listable(account: str) -> bool:
    """True when the account may be shown by name: a platform program's plainly named account."""
    prefix, sep, rest = account.partition(":")
    return bool(sep) and prefix in GROUPS and GROUPS[prefix][1] and bool(_PLAIN.fullmatch(rest))


def safe_name(account: str) -> str:
    """The account's name, or its group with the id masked, for check details that must not name a customer."""
    return account if listable(account) else f"{group_of(account)}:…"


def _label(key: str) -> str:
    return GROUPS[key][0] if key in GROUPS else OTHER_LABEL


def _order(key_unit: tuple[str, str]) -> tuple[int, int, str]:
    key, unit = key_unit
    keys = list(GROUPS)
    return (keys.index(key) if key in keys else len(keys), _UNIT_ORDER.get(unit, 9), unit)


def _classify(bal: dict) -> dict[tuple[str, str], dict]:
    """(group, unit) -> total, listed accounts, and the count and total of the aggregated (customer) accounts."""
    out: dict[tuple[str, str], dict] = {}
    for unit, accounts in bal.items():
        for account, amount in accounts.items():
            bucket = out.setdefault((group_of(account), unit), {"total": 0, "accounts": {}, "count": 0, "agg": 0})
            bucket["total"] += amount
            if listable(account):
                bucket["accounts"][account] = amount
            else:
                bucket["agg"] += amount
                bucket["count"] += 1 if amount else 0
    return out


def group_balances(bal: dict) -> list[dict]:
    classes = _classify(bal)
    rows = []
    for key, unit in sorted(classes, key=_order):
        b = classes[(key, unit)]
        rows.append({"key": key, "label": _label(key), "unit": unit, "total": b["total"],
                     "accounts": [{"account": a, "balance": v} for a, v in sorted(b["accounts"].items())],
                     "aggregate": {"count": b["count"], "total": b["agg"]} if b["count"] or b["agg"] else None})
    return rows


def _add(bal: dict, lines: list[dict]) -> None:
    """In-place apply (ledger._apply copies the whole map per entry, which a full replay can't afford)."""
    for item in lines:
        unit = bal.setdefault(item["unit"], {})
        unit[item["account"]] = unit.get(item["account"], 0) + item["amount"]


def _nonzero(bal: dict) -> dict[tuple[str, str], int]:
    return {(unit, account): amount for unit, accounts in bal.items() for account, amount in accounts.items() if amount}


def _check(key: str, label: str, ok: bool, detail: str) -> dict:
    return {"key": key, "label": label, "ok": bool(ok), "detail": detail}


def _names(accounts, limit: int = 6) -> str:
    names = sorted({safe_name(a) for a in accounts})
    return ", ".join(names[:limit]) + (f" and {len(names) - limit} more" if len(names) > limit else "")


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------------------------------------------------ overview
async def _replay(upto_seq: int) -> dict:
    """One pass over the journal up to the head's seq: rebuilt balances, sequence gaps, unbalanced entries, and the
    all-time split of protection income (premiums vs. the fee share), which balances alone can't give."""
    bal: dict = {}
    expected, breaks, first_break, unbalanced, count, premiums, last = 1, 0, "", 0, 0, 0, 0
    async for entry in ledger.journal(upto_seq=upto_seq):
        seq = entry["seq"]
        if seq != expected:
            breaks += 1
            first_break = first_break or f"expected #{expected}, found #{seq}"
        expected, last, count = seq + 1, seq, count + 1
        sums: dict[str, int] = defaultdict(int)
        for item in entry["lines"]:
            sums[item["unit"]] += item["amount"]
            if item["account"] == "protection:income" and entry["kind"] == "protection_premium":
                premiums -= item["amount"]
        unbalanced += any(sums.values())
        _add(bal, entry["lines"])
    return {"balances": bal, "count": count, "last": last, "breaks": breaks, "first_break": first_break,
            "unbalanced": unbalanced, "premiums": premiums}


def integrity_checks(head: dict, replay: dict, credit_ok: bool) -> list[dict]:
    bal = head["balances"]
    checks = []

    sums = {unit: sum(accounts.values()) for unit, accounts in sorted(bal.items())}
    off = {u: s for u, s in sums.items() if s}
    checks.append(_check("zero_sum", "Every unit sums to zero", not off,
                         "Balances net to zero in " + (", ".join(sums) or "every unit") + "." if not off else
                         "Out of balance: " + ", ".join(f"{u} by {s}" for u, s in off.items()) + "."))

    cached, rebuilt = _nonzero(bal), _nonzero(replay["balances"])
    differ = {acct for (unit, acct) in set(cached) | set(rebuilt) if cached.get((unit, acct)) != rebuilt.get((unit, acct))}
    checks.append(_check("replay_matches_head", "Replaying the journal gives the cached balances", not differ,
                         f"A replay of {replay['count']} entries matches the cached balances at #{head['seq']}." if not differ else
                         f"{len(differ)} account(s) differ from a full replay: {_names(differ)}."))

    contiguous = replay["breaks"] == 0 and replay["count"] == head["seq"] and replay["last"] == head["seq"]
    checks.append(_check("journal_contiguous", "Journal sequence runs 1…N with no gaps", contiguous,
                         f"Entries #1 to #{head['seq']} are all present." if contiguous else
                         f"{replay['count']} entries read for a head at #{head['seq']}"
                         + (f"; first break: {replay['first_break']}" if replay["first_break"] else "") + "."))

    checks.append(_check("entries_balanced", "Every entry balances", replay["unbalanced"] == 0,
                         "Each entry's lines sum to zero in every unit." if not replay["unbalanced"] else
                         f"{replay['unbalanced']} entr{'y' if replay['unbalanced'] == 1 else 'ies'} do not balance."))

    usd = bal.get("USD") or {}
    negative = [a for a, v in usd.items() if v < 0 and (a in NON_NEGATIVE or a.startswith(NON_NEGATIVE_PREFIXES))]
    checks.append(_check("non_negative", "No negative cash or customer balance", not negative,
                         "Program cash, reserved funds, customer balances and escrow are all zero or more." if not negative else
                         f"{len(negative)} account(s) below zero: {_names(negative)}."))

    checks.append(_check("credit_ledger", "Credit records agree with the ledger", credit_ok,
                         "Credit cash, outstanding and committed funds match the contributions, agreements and offers."
                         if credit_ok else "Credit cash, outstanding or committed funds disagree with the credit records."))
    return checks


async def overview() -> dict:
    head = await ledger._head()        # pins the replay below: entries posted meanwhile are left out of both
    replay = await _replay(head["seq"])
    bal = head["balances"]
    usd = lambda account: ledger.usd(bal, account)  # noqa: E731
    classes = _classify(bal)
    agg = lambda key, unit="USD": classes.get((key, unit), {"total": 0, "count": 0, "agg": 0})  # noqa: E731

    covers = await store.find("capital_coverages", {"status": "active"}, limit=SCAN_LIMIT)
    exposure = sum(int(c.get("covered_cents") or 0) for c in covers)
    fund = usd("protection:cash")
    protection_income = -usd("protection:income")

    claims: dict[str, dict] = {}
    for c in await store.find("capital_claims", {}, limit=SCAN_LIMIT):
        row = claims.setdefault(c.get("status") or "unknown", {"count": 0, "amountCents": 0, "paidCents": 0})
        row["count"] += 1
        row["amountCents"] += int(c.get("amount_cents") or 0)
        row["paidCents"] += int(c.get("paid_cents") or 0)

    credit = await credit_service.treasury()
    issued = ledger.total_shares(bal)
    nav = ledger.nav_cents(bal)
    holders = agg("shares", "SHARE")
    wallets, usdc, escrow = agg("wallet"), agg("usdc"), agg("escrow")
    checks = integrity_checks(head, replay, bool(credit.get("ledgerCheck")))
    return {
        "settlement": ledger.SETTLEMENT, "notice": NOTICE, "asOf": _iso_now(), "seq": head["seq"],
        "kpis": {
            "pool": {"navCents": nav, "cashCents": usd("pool:cash"), "outstandingCents": usd("pool:advances"),
                     "capitalCents": -usd("pool:capital"), "feeIncomeCents": -usd("pool:income"),
                     "writtenOffCents": usd("pool:losses")},
            "protection": {"cashCents": fund, "incomeCents": protection_income, "premiumsCents": replay["premiums"],
                           "feeShareCents": protection_income - replay["premiums"], "payoutsCents": usd("protection:payouts"),
                           "activeCovers": len(covers), "activeExposureCents": exposure,
                           # integer basis points (10,000 = fully covered); None when nothing is covered
                           "coverageRatioBps": fund * 10_000 // exposure if exposure else None},
            "claims": dict(sorted(claims.items())),
            "platform": {"cashCents": usd("platform:cash"), "incomeCents": -usd("platform:income")},
            "credit": credit,
            "customers": {"usdCents": wallets["total"], "usdAccounts": wallets["count"],
                          "usdcCents": usdc["total"], "usdcAccounts": usdc["count"],
                          "totalCents": wallets["total"] + usdc["total"]},
            "escrow": {"totalCents": escrow["total"], "listings": escrow["count"]},
            "shares": {"issuedUnits": issued, "displayShares": issued / DISPLAY_SHARE_UNITS,
                       "sharePriceCents": nav * DISPLAY_SHARE_UNITS // issued if issued else 100,
                       "holderAccounts": holders["count"], "heldUnits": holders["agg"],
                       "tokenUnits": agg("token", "SHARE")["total"]},
        },
        "groups": group_balances(bal),
        "checks": checks,
        "ok": all(c["ok"] for c in checks),
    }


# -------------------------------------------------------------------------------------------------------------- period
def _day(text: str) -> date:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text or ""):
        raise PeriodError("Dates must be YYYY-MM-DD.")
    try:
        return date.fromisoformat(text)
    except ValueError:
        raise PeriodError(f"{text} is not a calendar date.") from None


def parse_period(start: str | None, end: str | None) -> tuple[date, date]:
    """Inclusive UTC dates, at most MAX_DAYS long."""
    if not start or not end:
        raise PeriodError("Give a start and an end date (YYYY-MM-DD).")
    first, last = _day(start), _day(end)
    if not (EARLIEST <= first and last <= LATEST):
        raise PeriodError(f"Dates must be between {EARLIEST} and {LATEST}.")
    if last < first:
        raise PeriodError("The end date is before the start date.")
    if (last - first).days + 1 > MAX_DAYS:
        raise PeriodError(f"Choose a period of at most {MAX_DAYS} days.")
    return first, last


def _bounds(first: date, last: date) -> tuple[str, str]:
    """[lo, hi) as ledger timestamps. Entry times are fixed-format UTC strings, so they compare as text."""
    return f"{first.isoformat()}T00:00:00Z", f"{(last + timedelta(days=1)).isoformat()}T00:00:00Z"


def _at(entry: dict) -> str:
    at = entry.get("at")
    if isinstance(at, datetime):
        return at.replace(tzinfo=at.tzinfo or timezone.utc).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return str(at or "")


async def report(first: date, last: date) -> dict:
    """Opening balances replay every entry before the period and closing balances every entry up to its end, each on
    its own; the period's net flow per group is summed from the period's lines. opening + netFlow == closing is
    therefore a real cross-check, not an identity. Entries are filtered by time, not by seq, because `at` follows seq
    only approximately when several writers post at once."""
    lo, hi = _bounds(first, last)
    opening: dict = {}
    closing: dict = {}
    flows: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    net: dict[tuple[str, str], int] = defaultdict(int)
    external: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    inc: dict[str, int] = defaultdict(int)
    count = 0
    async for entry in ledger.journal():
        at = _at(entry)
        if at >= hi:
            continue
        _add(closing, entry["lines"])
        if at < lo:
            _add(opening, entry["lines"])
            continue
        count += 1
        kind = entry["kind"]
        flows[kind][0] += 1
        for item in entry["lines"]:
            account, amount, unit = item["account"], item["amount"], item["unit"]
            net[(group_of(account), unit)] += amount
            if unit != "USD":
                continue
            flows[kind][1] += max(0, amount)        # gross = the entry's debits (= its credits, since it balances)
            if account == "pool:income":
                inc["pool_fees"] -= amount
            elif account == "protection:income":
                inc["premiums" if kind == "protection_premium" else "fee_share"] -= amount
            elif account == "platform:income":
                inc["platform"] -= amount
            elif account == "platform:cash" and kind in PLATFORM_FEE_KINDS:
                inc["market_fees"] += amount
            elif account == "credit:income":
                inc["credit_fees"] -= amount
            elif account == "pool:losses":
                inc["pool_writeoffs" if amount > 0 else "pool_recoveries"] += abs(amount)
            elif account == "credit:losses":
                inc["credit_writeoffs" if amount > 0 else "credit_recoveries"] += abs(amount)
            elif account == "protection:payouts":
                inc["payouts"] += amount
            elif group_of(account) == "external":
                # A credit to an external account is money coming in from outside; a debit is money going out.
                external[safe_name(account)][0 if amount < 0 else 1] += abs(amount)

    income = {"poolFeeIncomeCents": inc["pool_fees"], "protectionPremiumsCents": inc["premiums"],
              "protectionFeeShareCents": inc["fee_share"], "platformIncomeCents": inc["platform"],
              "marketplaceFeesCents": inc["market_fees"], "creditFeesCents": inc["credit_fees"]}
    income["totalCents"] = sum(income.values())
    losses = {"poolWriteOffsCents": inc["pool_writeoffs"], "poolRecoveriesCents": inc["pool_recoveries"],
              "creditWriteOffsCents": inc["credit_writeoffs"], "creditRecoveriesCents": inc["credit_recoveries"],
              "protectionPayoutsCents": inc["payouts"]}
    losses["totalCents"] = (inc["pool_writeoffs"] - inc["pool_recoveries"] + inc["credit_writeoffs"]
                            - inc["credit_recoveries"] + inc["payouts"])

    before, after = _classify(opening), _classify(closing)
    empty = {"total": 0, "accounts": {}, "count": 0, "agg": 0}
    groups = []
    for key, unit in sorted(set(before) | set(after) | set(net), key=_order):
        o, c = before.get((key, unit), empty), after.get((key, unit), empty)
        names = sorted(set(o["accounts"]) | set(c["accounts"]))
        has_agg = o["count"] or c["count"] or o["agg"] or c["agg"]
        groups.append({
            "key": key, "label": _label(key), "unit": unit,
            "opening": o["total"], "netFlow": net.get((key, unit), 0), "closing": c["total"],
            "accounts": [{"account": a, "opening": o["accounts"].get(a, 0), "closing": c["accounts"].get(a, 0)} for a in names],
            "aggregate": {"openingCount": o["count"], "closingCount": c["count"], "opening": o["agg"], "closing": c["agg"]}
            if has_agg else None,
        })
    return {
        "settlement": ledger.SETTLEMENT, "notice": NOTICE, "generatedAt": _iso_now(),
        "start": first.isoformat(), "end": last.isoformat(), "entries": count,
        "groups": groups,
        "flows": [{"kind": k, "count": v[0], "grossCents": v[1]} for k, v in sorted(flows.items(), key=lambda kv: (-kv[1][1], kv[0]))],
        "income": income, "losses": losses,
        "external": [{"account": a, "inCents": v[0], "outCents": v[1], "netInCents": v[0] - v[1]} for a, v in sorted(external.items())],
    }


# ----------------------------------------------------------------------------------------------------------------- CSV
def csv_cell(value):
    """Integers pass through (a signed amount is a number, not a formula). Text that a spreadsheet would read as a
    formula (= + - @, or a leading tab/CR/LF) gets a leading apostrophe; csv.writer handles quoting."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_LEAD) else text


class ExportTooLarge(Exception):
    """The period holds more ledger lines than one export may carry."""


async def journal_csv(first: date, last: date) -> str:
    lo, hi = _bounds(first, last)
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_HEADER)
    written = 0
    async for entry in ledger.journal():
        at = _at(entry)
        if not lo <= at < hi:
            continue
        for item in entry["lines"]:
            written += 1
            if written > MAX_CSV_LINES:
                raise ExportTooLarge(f"More than {MAX_CSV_LINES:,} ledger lines in this period; choose a shorter one.")
            writer.writerow([csv_cell(v) for v in (entry["seq"], at, entry["kind"], entry.get("memo"),
                                                   entry.get("settlement"), item["account"], item["unit"], item["amount"])])
    return buf.getvalue()
