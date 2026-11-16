"""Data rights: what Autopilot stores about a person, and how it is exported, deleted, anonymized or retained.

`DATA_MAP` classifies EVERY collection the app writes (a test fails when a new one is not listed). Each entry says
which rows belong to a user, whether they are exported, and what deletion does with them:

  delete  the rows are removed
  scrub   the rows are kept (another person's record, a ledger or a business record needs them) but the user's
          personal fields are replaced by a pseudonym and the row is stamped with `retain_until`
  keep    the rows are kept untouched (they hold no personal content: ids, counters, an append-only ledger)
  none    not personal data (transient or system state); never exported, never touched

Everything works the same on MongoDB and on the in-memory fallback used by tests. Docs: docs/data-lifecycle.md.
"""
import hashlib
import hmac
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from uuid import uuid4

from . import auth, db, repo, rights_store
from .access import store as access_store
from .capital import ledger as capital_ledger, store as capital_store
from .config import get_settings
from .orders import store as order_store
from .payments import store as payments_store, subscriptions as subscriptions_store
from .pool import store as pool_store

log = logging.getLogger("autopilot.datarights")

# Fields that never leave the server, in any collection.
NEVER_EXPORT = frozenset({"_id", "password_hash", "salt", "token_hash", "key_hash", "inbound_token_hash",
                          "reset", "verify", "email_change", "session_version", "totp_secret"})
NAME_KEYS = ("name", "display_name", "freelancer_name", "owner_name", "invited_by_name", "client_name", "holder",
             "nickname", "legal_name")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def pseudonym(user_id: str) -> str:
    """A stable label for a deleted person, so records they shared still read sensibly ("Deleted user 3fa9c1b2")
    without revealing who it was. Keyed with the server secret so it cannot be reversed by hashing guesses."""
    digest = hmac.new(get_settings().secret_key.encode(), user_id.encode(), hashlib.sha256).hexdigest()
    return f"Deleted user {digest[:8]}"


@dataclass(frozen=True)
class Coll:
    name: str
    owner: tuple = ()                        # ((field, kind), ...) kind: "id" | "email" | "key" (the _id / dict key)
    action: str = "none"                     # delete | scrub | keep | none
    why: str = ""
    export: bool = False
    mem: Callable[[], Any] | None = None     # returns the in-memory container (dict keyed by id, or list)
    scrub: tuple = ()                        # extra personal fields to replace in scrub mode (NAME_KEYS always)
    decide: Callable[[dict, dict], str] | None = None   # (row, ctx) -> action override per row
    exclude: tuple = ()                      # extra fields left out of the export
    names: dict | None = None                # owner field -> the name fields that describe THAT person (shared rows)


def _uid(field_name="user_id"):
    return ((field_name, "id"),)


def _bid_decision(row: dict, ctx: dict) -> str:
    return "scrub" if row.get("status") == "awarded" else "delete"


def _invite_decision(row: dict, ctx: dict) -> str:
    return "delete" if (row.get("team_id") == ctx["id"] or row.get("email") == ctx["email"]) else "scrub"


DATA_MAP: dict[str, Coll] = {c.name: c for c in (
    # --- the account itself ---------------------------------------------------------------------------------
    Coll("users", (("id", "id"),), "delete", "The account. Replaced by a tombstone (id and deletion time only) so the id "
         "is never reused; the email can sign up again.", True, lambda: db._mem_users),
    Coll("deleted_accounts", (("id", "id"),), "keep", "Tombstones: id and deletion date only.", False),
    Coll("oauth_identities", (("email", "email"),), "delete", "Links a Google/GitHub/... login to the account.", True,
         lambda: db._mem_identities),
    Coll("api_keys", _uid(), "delete", "Personal API keys (the export lists names and prefixes, never the key).", True,
         lambda: access_store._mem["keys"]),
    # --- the user's own working data (deleted) --------------------------------------------------------------
    Coll("workspaces", (("_id", "key"),), "delete", "Dashboard state: accounts, gigs, radar, growth.", True,
         lambda: repo._mem_docs["workspaces"]),
    Coll("settings", (("_id", "key"),), "delete", "Preferences.", True, lambda: repo._mem_docs["settings"]),
    Coll("notifications", _uid(), "delete", "In-app notifications.", True, lambda: repo._mem_lists["notifications"]),
    Coll("activity", _uid(), "delete", "The user's own activity feed.", True, lambda: repo._mem_lists["activity"]),
    Coll("automation_jobs", _uid(), "delete", "Automation queue.", True, lambda: repo._mem_lists["automation_jobs"]),
    Coll("campaigns", _uid(), "delete", "Outreach campaigns.", True, lambda: repo._mem_lists["campaigns"]),
    Coll("bids", _uid(), "delete", "The user's own saved bids/drafts.", True, lambda: repo._mem_lists["bids"]),
    Coll("messages", _uid(), "delete", "Forwarded alert emails and conversation messages (may name third parties).",
         True, lambda: repo._mem_lists["messages"]),
    Coll("proposals", _uid(), "delete", "Drafted proposals.", True, lambda: repo._mem_lists["proposals"]),
    Coll("upwork_leads", _uid(), "delete", "Leads parsed from forwarded Upwork alert emails.", True,
         lambda: repo._mem_lists["upwork_leads"]),
    Coll("orders", _uid(), "delete", "Marketplace orders the user tracks (client names are third-party data).", True,
         lambda: order_store._mem["orders"]),
    Coll("order_accounts", _uid(), "delete", "Connected marketplace accounts (inbound-address hash is not exported).",
         True, lambda: order_store._mem["order_accounts"], exclude=("connection",)),
    Coll("order_events", _uid(), "delete", "Order timeline.", True, lambda: order_store._mem["order_events"]),
    Coll("bid_daily_limits", _uid(), "delete", "Daily bid counters.", False, lambda: {}),
    Coll("waitlist", (("email", "email"),), "delete", "Early-access signups for this email.", True,
         lambda: repo._mem_docs["waitlist"]),
    Coll("beta_testers", (("email", "email"),), "delete", "Beta signup for this email.", True,
         lambda: repo._mem_docs["beta_testers"]),
    Coll("login_failures", (("key", "email"),), "delete", "Failed-login counters for this email.", False, lambda: {}),
    # --- teams ----------------------------------------------------------------------------------------------
    Coll("team_members", (("user_id", "id"), ("team_id", "id")), "delete",
         "Membership rows (the user's own, and for a team owner the roster they already manage).", True,
         lambda: access_store._mem["members"]),
    Coll("team_invites", (("team_id", "id"), ("email", "email"), ("invited_by", "id")), "scrub",
         "Invitations sent by or to the user. Rows for the user's own team or email are deleted; invitations the user "
         "sent on someone else's team keep their pseudonym.", True, lambda: access_store._mem["invites"],
         scrub=(), names={"team_id": ("owner_name", "owner_email"), "invited_by": ("invited_by_name",)},
         decide=_invite_decision, exclude=("token_hash",)),
    # --- the freelancer pool (shared with the counterparty: kept, personal fields replaced) -----------------
    Coll("pool_specs", (("owner_id", "id"),), "scrub", "Job specs an agency posted: other people bid on them, so the "
         "record stays (closed) with the owner shown as a pseudonym.", True, lambda: pool_store._mem["specs"],
         names={"owner_id": ("owner_name",)}),
    Coll("pool_bids", (("freelancer_id", "id"),), "scrub", "Bids. Awarded bids are part of a contract and are kept; "
         "all others are deleted.", True, lambda: pool_store._mem["bids"], decide=_bid_decision,
         names={"freelancer_id": ("freelancer_name",)}),
    Coll("pool_contracts", (("owner_id", "id"), ("freelancer_id", "id")), "scrub", "Contracts and milestones are "
         "retained for the counterparty and for financial records.", True, lambda: pool_store._mem["contracts"],
         names={"owner_id": ("owner_name",), "freelancer_id": ("freelancer_name",)}),
    Coll("pool_earnings", (("owner_id", "id"), ("freelancer_id", "id")), "scrub", "Recorded payouts (financial record).",
         True, lambda: pool_store._mem["earnings"],
         names={"owner_id": ("owner_name",), "freelancer_id": ("freelancer_name",)}),
    # --- money, simulated or recorded -----------------------------------------------------------------------
    Coll("billing", (("_id", "key"),), "keep", "Plan, credits, purchase history (financial record, no personal text).",
         True, lambda: repo._mem_docs["billing"]),
    Coll("subscriptions", (("_id", "key"),), "keep", "Stripe subscription state (off until Stripe is configured).", True,
         lambda: subscriptions_store._mem),
    Coll("pay_links", _uid(), "scrub", "Invoice pay links (financial record).", True, lambda: payments_store._mem,
         scrub=("client_name", "client_email", "email", "note")),
    Coll("capital_journal", (("refs.user_id", "id"), ("refs.users", "id")), "keep", "Append-only simulated ledger; "
         "never rewritten. It holds ids and amounts, no names.", True, lambda: capital_ledger._mem_journal),
    Coll("capital_head", (), "none", "Ledger head pointer (balances per account id).", False),
    Coll("capital_profiles", _uid(), "delete", "KYC profile (simulated verification).", True,
         lambda: capital_store._mem["capital_profiles"]),
    Coll("capital_advances", _uid(), "scrub", "Simulated advances (ledger consistency).", True,
         lambda: capital_store._mem["capital_advances"]),
    Coll("capital_coverages", _uid(), "scrub", "Simulated cover.", True, lambda: capital_store._mem["capital_coverages"]),
    Coll("capital_claims", _uid(), "scrub", "Simulated claims.", True, lambda: capital_store._mem["capital_claims"],
         scrub=("note", "review_note")),
    Coll("capital_cover_offers", _uid(), "scrub", "Simulated cover offers.", True,
         lambda: capital_store._mem["capital_cover_offers"]),
    Coll("token_wallets", _uid(), "delete", "Linked wallet address (token program is off by default).", True,
         lambda: capital_store._mem["token_wallets"]),
    Coll("token_subscriptions", _uid(), "scrub", "Token subscriptions.", True,
         lambda: capital_store._mem["token_subscriptions"], scrub=("wallet", "address")),
    Coll("token_proposals", _uid(), "keep", "Governance proposals.", True, lambda: capital_store._mem["token_proposals"]),
    Coll("token_alerts", (), "none", "System alerts.", False),
    Coll("token_state", (), "none", "Protocol state and short-lived challenges.", False),
    Coll("market_listings", _uid(), "scrub", "Simulated marketplace listings that investors reference.", True,
         lambda: capital_store._mem["market_listings"], scrub=("display_name",)),
    Coll("market_investments", _uid(), "scrub", "Simulated investments.", True,
         lambda: capital_store._mem["market_investments"]),
    Coll("market_agreements", _uid(), "scrub", "Simulated agreements.", True,
         lambda: capital_store._mem["market_agreements"]),
    Coll("market_distributions", (("investor_id", "id"),), "scrub", "Simulated distributions.", True,
         lambda: capital_store._mem["market_distributions"]),
    Coll("bank_accounts", _uid(), "delete", "Simulated bank account details.", True,
         lambda: capital_store._mem["bank_accounts"]),
    Coll("bank_transfers", _uid(), "scrub", "Simulated transfers (ledger consistency).", True,
         lambda: capital_store._mem["bank_transfers"], scrub=("address", "note")),
    Coll("financing_applications", _uid(), "scrub", "Simulated financing applications.", True,
         lambda: capital_store._mem["financing_applications"], scrub=("email",)),
    Coll("credit_contributions", _uid(), "scrub", "Simulated contributions to the demo credit pool.", True,
         lambda: capital_store._mem["credit_contributions"]),
    Coll("credit_applications", _uid(), "scrub", "Simulated project-credit applications.", True,
         lambda: capital_store._mem["credit_applications"], scrub=("applicant_name", "applicant_email", "description", "title")),
    Coll("credit_agreements", _uid(), "scrub", "Simulated credit agreements (ledger consistency).", True,
         lambda: capital_store._mem["credit_agreements"], scrub=("title",)),
    Coll("credit_documents", _uid(), "delete", "Private supporting documents uploaded with a credit application (the file contents are never exported).", True,
         lambda: capital_store._mem["credit_documents"], exclude=("data",)),
    Coll("credit_audit", _uid(), "keep", "Append-only audit trail of credit actions (ids and amounts, no personal text).", True,
         lambda: capital_store._mem["credit_audit"]),
    # --- records about the data rights themselves -----------------------------------------------------------
    Coll("terms_acceptances", _uid(), "keep", "Proof of which Terms/Privacy version was accepted and when "
         "(no personal content).", True, lambda: rights_store._mem["terms_acceptances"]),
    Coll("data_requests", _uid(), "keep", "Audit trail of export/deletion requests (counts, no content).", True,
         lambda: rights_store._mem["data_requests"]),
    # --- system / transient state: no personal data ----------------------------------------------------------
    Coll("rate_limits", (), "none", "Request counters keyed by network address, not by user; each expires about two minutes "
         "after its window. Not linkable to an account."),
    Coll("edge_nonces", (), "none", "Single-use request identifiers of the website proxy (replay protection); expire in about two minutes. No personal data."),
    Coll("revoked_sessions", (), "none", "Revoked session ids; expire on their own."),
    Coll("oauth_states", (), "none", "Single-use sign-in state; expires on its own."),
    Coll("oauth_handoffs", (), "none", "Single-use sign-in handoff; expires on its own."),
    Coll("app_state", (), "none", "Legacy single shared document; archived at startup if present."),
    Coll("app_state_backup", (), "none", "Archive of the legacy shared document: mixed data of every user from before "
         "per-user storage. The owner must review and drop it (docs/data-lifecycle.md)."),
)}


# --------------------------------------------------------------------------------------------------------------
# Row access: the same code for MongoDB and the in-memory fallback
# --------------------------------------------------------------------------------------------------------------
def _path(doc: dict, dotted: str):
    cur: Any = doc
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _ctx(user_doc: dict) -> dict:
    return {"id": user_doc["id"], "email": user_doc["email"].lower()}


def _mem_matches(key: Any, doc: dict, c: Coll, ctx: dict) -> bool:
    for fld, kind in c.owner:
        want = ctx["email"] if kind == "email" else ctx["id"]
        if kind == "key":
            if key == want or doc.get("_id") == want:
                return True
            continue
        value = _path(doc, fld)
        if value == want or (isinstance(value, list) and want in value):
            return True
    return False


async def rows(c: Coll, ctx: dict) -> list[dict]:
    """The user's live rows in collection `c` (references, not copies, in memory mode)."""
    if not c.owner:
        return []
    if db.enabled():
        clauses = []
        for fld, kind in c.owner:
            clauses.append({"_id": ctx["id"]} if kind == "key" else {fld: ctx["email"] if kind == "email" else ctx["id"]})
        return await db._get_db()[c.name].find({"$or": clauses}).to_list(None)
    if c.mem is None:
        return []
    box = c.mem()
    items = box.items() if isinstance(box, dict) else ((None, d) for d in box)
    return [d for k, d in items if isinstance(d, dict) and _mem_matches(k, d, c, ctx)]


async def _delete_rows(c: Coll, found: list[dict]) -> None:
    if not found:
        return
    if db.enabled():
        await db._get_db()[c.name].delete_many({"_id": {"$in": [d["_id"] for d in found]}})
        return
    box = c.mem()
    if isinstance(box, dict):
        for key in [k for k, d in box.items() if any(d is f for f in found)]:
            del box[key]
    else:
        box[:] = [d for d in box if not any(d is f for f in found)]


def _scrub_update(c: Coll, row: dict, ctx: dict, until: datetime) -> dict:
    """The field changes that remove THIS person from a retained row (only fields that exist; nothing is added).
    On rows shared with a counterparty only the name fields that belong to the deleted person are replaced."""
    label = pseudonym(ctx["id"])
    changes: dict = {"retain_until": until, "scrubbed_at": _now()}
    if c.names is None:
        name_fields = set(NAME_KEYS)
    else:
        name_fields = set()
        for fld, kind in c.owner:
            value = _path(row, fld)
            want = ctx["email"] if kind == "email" else ctx["id"]
            if value == want or (isinstance(value, list) and want in value):
                name_fields |= set(c.names.get(fld, ()))
    for key in name_fields:
        if row.get(key) not in (None, ""):
            changes[key] = label
    for key in c.scrub:
        if row.get(key) not in (None, ""):
            changes[key] = None
    return changes


async def _scrub_rows(c: Coll, found: list[dict], ctx: dict, until: datetime) -> None:
    for row in found:
        changes = _scrub_update(c, row, ctx, until)
        if db.enabled():
            await db._get_db()[c.name].update_one({"_id": row["_id"]}, {"$set": changes})
        else:
            row.update(changes)


def _action_for(c: Coll, row: dict, ctx: dict) -> str:
    return c.decide(row, ctx) if c.decide else c.action


# --------------------------------------------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------------------------------------------
def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _export_row(c: Coll, row: dict) -> dict:
    drop = NEVER_EXPORT | set(c.exclude)
    return _jsonable({k: v for k, v in row.items() if k not in drop})


async def build_export(user_doc: dict) -> dict:
    ctx = _ctx(user_doc)
    records: dict[str, list] = {}
    for c in DATA_MAP.values():
        if not c.export:
            continue
        found = await rows(c, ctx)
        if found:
            records[c.name] = [_export_row(c, d) for d in found]
    return {
        "format": "autopilot-export-1",
        "exportedAt": _jsonable(_now()),
        "account": {"id": ctx["id"], "email": ctx["email"]},
        "records": records,
        "notIncluded": [
            {"what": "Password hash, API key hashes, session and reset tokens, inbound-address hashes",
             "why": "Security secrets; they do not describe you and exporting them would weaken the account."},
            {"what": "Other people's own data (their workspaces, settings, notifications, bids)",
             "why": "Not yours. Contracts and teams you share show the other party only as you already see them in the app."},
            {"what": "The shared simulated ledger entries of other users",
             "why": "A ledger entry that involves several users is exported only to the users named in it."},
        ],
    }


# --------------------------------------------------------------------------------------------------------------
# Deletion
# --------------------------------------------------------------------------------------------------------------
async def blockers(user_doc: dict) -> list[str]:
    """Plain-language reasons the account cannot be deleted yet (empty = allowed)."""
    ctx = _ctx(user_doc)
    out: list[str] = []
    if auth.is_owner({"email": ctx["email"]}):
        out.append("Platform owner accounts can't be deleted here; remove the address from OWNER_EMAILS first.")
    members = [m for m in await rows(DATA_MAP["team_members"], ctx) if m.get("team_id") == ctx["id"] and m.get("user_id") != ctx["id"]]
    if members:
        out.append(f"Your team still has {len(members)} other member(s). Remove them or hand the team over first.")
    active = [r for r in await rows(DATA_MAP["pool_contracts"], ctx) if r.get("status") == "active"]
    if active:
        out.append(f"{len(active)} contract(s) are still active. Finish or end them first so nobody is left unpaid.")
    for name, label in (("capital_advances", "advance"), ("capital_coverages", "cover"), ("market_investments", "investment"),
                        ("market_listings", "listing"), ("financing_applications", "financing application"),
                        ("credit_applications", "credit application"), ("credit_agreements", "credit agreement")):
        open_rows = [r for r in await rows(DATA_MAP[name], ctx)
                     if r.get("status") in ("active", "open", "funding", "submitted", "in_review", "outstanding", "live", "offered", "late")]
        if open_rows:
            out.append(f"{len(open_rows)} simulated {label}(s) are still open. Close or settle them first.")
    return out


async def plan_deletion(user_doc: dict) -> dict:
    """Dry run: exactly what execute_deletion would do right now."""
    ctx = _ctx(user_doc)
    delete: dict[str, int] = {}
    scrub: dict[str, int] = {}
    keep: dict[str, int] = {}
    until = (_now() + timedelta(days=365 * get_settings().financial_retention_years)).strftime("%Y-%m-%d")
    for c in DATA_MAP.values():
        for row in await rows(c, ctx):
            act = _action_for(c, row, ctx)
            bucket = {"delete": delete, "scrub": scrub, "keep": keep}.get(act)
            if bucket is not None:
                bucket[c.name] = bucket.get(c.name, 0) + 1
    return {"blockers": await blockers(user_doc), "willDelete": delete, "willAnonymize": scrub,
            "willRetain": {k: {"n": n, "until": until if k in scrub else None} for k, n in keep.items()},
            "retentionYears": get_settings().financial_retention_years}


async def execute_deletion(user_doc: dict) -> dict:
    """Carry the deletion out. Idempotent: every step only touches what is still there, and the account row is
    removed last, so a crash half-way is finished by running it again."""
    ctx = _ctx(user_doc)
    until = _now() + timedelta(days=365 * get_settings().financial_retention_years)
    deleted: dict[str, int] = {}
    scrubbed: dict[str, int] = {}
    kept: dict[str, int] = {}
    for c in DATA_MAP.values():
        if c.name in ("users", "deleted_accounts"):
            continue
        found = await rows(c, ctx)
        by: dict[str, list] = {"delete": [], "scrub": [], "keep": []}
        for row in found:
            by.setdefault(_action_for(c, row, ctx), []).append(row)
        if by["delete"]:
            await _delete_rows(c, by["delete"])
            deleted[c.name] = len(by["delete"])
        if by["scrub"]:
            await _scrub_rows(c, by["scrub"], ctx, until)
            scrubbed[c.name] = len(by["scrub"])
        if by["keep"]:
            kept[c.name] = len(by["keep"])
    await _close_open_specs(ctx)
    auth._failures.pop(ctx["email"], None)                  # in-memory login counters (MongoDB rows handled above)
    for key in [k for k in repo._mem_bid_counters if k.startswith(ctx["id"] + ":")]:
        del repo._mem_bid_counters[key]
    await _remove_account(user_doc, until)
    deleted["users"] = 1
    return {"deleted": deleted, "anonymized": scrubbed, "retained": kept}


async def _close_open_specs(ctx: dict) -> None:
    """Specs the user posted that are still open are closed (other people's bids on them are rejected, not erased)."""
    for spec in await pool_store.find("specs", {"owner_id": ctx["id"], "status": "open"}):
        await pool_store.update("specs", spec["id"], {"status": "closed"}, expect={"status": "open"})
        for bid in await pool_store.find("bids", {"spec_id": spec["id"]}):
            if bid.get("status") == "submitted":
                await pool_store.update("bids", bid["id"], {"status": "rejected"})


async def _remove_account(user_doc: dict, until: datetime) -> None:
    tomb = {"_id": user_doc["id"], "id": user_doc["id"], "deleted_at": _now(), "retain_until": until}
    email = user_doc["email"].lower()
    if db.enabled():
        mdb = db._get_db()
        await mdb.deleted_accounts.replace_one({"_id": tomb["_id"]}, tomb, upsert=True)
        await mdb.users.delete_one({"_id": email, "id": user_doc["id"]})
    else:
        _mem_deleted[tomb["_id"]] = tomb
        if (db._mem_users.get(email) or {}).get("id") == user_doc["id"]:
            del db._mem_users[email]


_mem_deleted: dict[str, dict] = {}
DATA_MAP["deleted_accounts"] = Coll("deleted_accounts", (("id", "id"),), "keep",
                                    "Tombstones: id and deletion date only.", False, lambda: _mem_deleted)


async def purge_expired_retained(now: datetime | None = None) -> dict[str, int]:
    """Remove retained (scrubbed) rows whose retention period has ended. Run from the same scheduler as deletions."""
    now = now or _now()
    removed: dict[str, int] = {}
    for c in DATA_MAP.values():
        if c.action != "scrub":
            continue
        if db.enabled():
            res = await db._get_db()[c.name].delete_many({"retain_until": {"$lte": now}})
            n = res.deleted_count
        else:
            box = c.mem() if c.mem else []
            if isinstance(box, dict):
                gone = [k for k, d in box.items() if isinstance(d.get("retain_until"), datetime) and d["retain_until"] <= now]
                for k in gone:
                    del box[k]
            else:
                gone = [d for d in box if isinstance(d.get("retain_until"), datetime) and d["retain_until"] <= now]
                box[:] = [d for d in box if d not in gone]
            n = len(gone)
        if n:
            removed[c.name] = n
    return removed
