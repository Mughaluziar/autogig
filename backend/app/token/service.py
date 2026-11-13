"""Token program: pool shares as a permissioned ERC-3643 token.
See docs/token-program.md. TEST NETWORKS ONLY until the launch gate passes.

Flow (the backend reads the chain and drafts Safe transactions; the
treasury signers execute them, so the server never holds a key):
  1. The investor links one wallet by signing a challenge (no funds move).
  2. Once the investor passes the capital program's checks, a Safe proposal
     creates their on-chain identity (IdFactory.createIdentity). When the
     indexer sees it, a second proposal registers it in the identity
     registry with their country. When isVerified() is true, the wallet is
     "registered".
  3. A subscription quotes an exact USDC amount to send from that wallet to
     the Safe. The indexer matches the confirmed transfer, posts the deposit
     to the capital ledger at NAV, and proposes mint + freeze (the lock-up).
  4. The indexer sees the mint and moves the shares to the wallet's
     account. When the lock-up ends it proposes the unfreeze.

Ledger SHARE accounts (beside the existing shares:issued / shares:<user>):
  token:pending:<user_id>  allocated at NAV, mint not yet confirmed
  token:<address>          mirror of an on-chain balance
  token:unreconciled       mints/burns the platform didn't expect; any
                           balance here pauses new subscriptions
"""
import secrets
from datetime import datetime, timedelta
from urllib.parse import urlparse

from eth_account import Account
from eth_account.messages import encode_defunct

from .. import repo
from ..capital import ledger, store
from ..capital import service as capital
from ..capital.ledger import line
from ..config import get_settings
from . import countries, gate, state
from .chain import CHAINS, USDC_UNITS_PER_CENT, calldata, norm

CHALLENGE_TTL = timedelta(minutes=10)
SUBSCRIPTION_TTL = timedelta(hours=72)
OPEN_SUBSCRIPTION = ("awaiting_payment", "minting")
TOKEN_DECIMALS = 6  # one raw token unit = one ledger share unit

SIG_CREATE_IDENTITY = "createIdentity(address,string)"
SIG_REGISTER_IDENTITY = "registerIdentity(address,address,uint16)"
SIG_MINT = "mint(address,uint256)"
SIG_FREEZE = "freezePartialTokens(address,uint256)"
SIG_UNFREEZE = "unfreezePartialTokens(address,uint256)"


class TokenError(Exception):
    def __init__(self, message: str, status: int = 400, reasons: list[str] | None = None):
        super().__init__(message)
        self.status = status
        self.reasons = reasons or []


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
_ADDRESS_SETTINGS = {
    "token": "token_address", "identityRegistry": "token_identity_registry", "idFactory": "token_id_factory",
    "safe": "token_safe_address", "usdc": "token_usdc_address",
}


def addresses() -> dict[str, str | None]:
    s = get_settings()
    out = {}
    for key, attr in _ADDRESS_SETTINGS.items():
        try:
            out[key] = norm(getattr(s, attr)) if getattr(s, attr) else None
        except ValueError:
            out[key] = None
    return out


def missing_config() -> list[str]:
    missing = [f"TOKEN_{attr.removeprefix('token_').upper()}" for key, attr in _ADDRESS_SETTINGS.items()
               if addresses()[key] is None]
    return (["TOKEN_RPC_URL"] if not get_settings().token_rpc_url else []) + missing


def chain_info() -> dict:
    cid = get_settings().token_chain_id
    meta = CHAINS.get(cid) or {"name": f"Chain {cid}", "mainnet": False, "explorer": None}
    return {"chainId": cid, **meta}


def settlement_label() -> str:
    info = chain_info()
    return f"{'onchain' if info['mainnet'] else 'testnet'}:{info['chainId']}"


async def require_ready() -> dict[str, str]:
    s = get_settings()
    if not s.token_program_enabled:
        raise TokenError("The token program is off.", 503)
    missing = missing_config()
    if missing:
        raise TokenError(f"The token program isn't configured: {', '.join(missing)}.", 503)
    try:
        await gate.check_chain(s.token_chain_id)
    except gate.GateClosed as exc:
        raise TokenError(str(exc), 423) from exc
    return addresses()  # type: ignore[return-value]


async def _notify(title: str, body: str) -> None:
    await capital._notify_operators(title, body)


# --------------------------------------------------------------------------- #
# Safe proposals and operator alerts
# --------------------------------------------------------------------------- #
async def propose(kind: str, user_id: str, title: str, txs: list[dict], refs: dict) -> dict:
    proposal = await store.insert("token_proposals", user_id, {
        "kind": kind, "status": "pending", "title": title, "chain_id": get_settings().token_chain_id,
        "safe": addresses()["safe"], "transactions": txs, "refs": refs})
    await _notify("Safe transaction to review", title)
    return proposal


async def set_proposal(proposal_id: str | None, status: str, note: str = "") -> None:
    if not proposal_id:
        return
    for _ in range(3):
        current = await store.get("token_proposals", proposal_id)
        if current is None or current["status"] == status:
            return
        fields = {"status": status, f"{status}_at": store.now()}
        if note:
            fields["note"] = note[:500]
        if await store.update("token_proposals", proposal_id, fields, expect_version=current["version"]):
            return


def safe_batch(proposal: dict) -> dict:
    """A Safe{Wallet} Transaction Builder batch file. Load it in the Safe app
    (Apps → Transaction Builder → drag the file in); signers review each
    call before signing. Executed as one MultiSend, so it's all-or-nothing."""
    created = proposal["created_at"]
    return {
        "version": "1.0",
        "chainId": str(proposal["chain_id"]),
        "createdAt": int(created.timestamp() * 1000),
        "meta": {"name": proposal["title"][:100],
                 "description": f"Token program proposal {proposal['id']} ({proposal['kind']})",
                 "txBuilderVersion": "1.16.5", "createdFromSafeAddress": proposal["safe"],
                 "createdFromOwnerAddress": ""},
        "transactions": [{"to": tx["to"], "value": "0", "data": tx["data"],
                          "contractMethod": None, "contractInputsValues": None}
                         for tx in proposal["transactions"]],
    }


async def alert(kind: str, detail: str, refs: dict) -> dict:
    record = await store.insert("token_alerts", "system", {"kind": kind, "detail": detail[:500], "refs": refs,
                                                           "resolved": False})
    await _notify("Token program needs attention", detail)
    return record


async def resolve_alert(owner: dict, alert_id: str, note: str) -> dict:
    current = await store.get("token_alerts", alert_id)
    if current is None:
        raise TokenError("Alert not found.", 404)
    if current["resolved"]:
        return current
    saved = await store.update("token_alerts", alert_id, {"resolved": True, "resolved_by": owner["email"],
                                                          "resolved_at": store.now(), "note": note[:500]},
                               expect_version=current["version"])
    if saved is None:
        raise TokenError("Alert changed; reload and try again.", 409)
    return saved


# --------------------------------------------------------------------------- #
# Wallets
# --------------------------------------------------------------------------- #
async def wallet_of(user_id: str) -> dict | None:
    rows = await store.find("token_wallets", {"user_id": user_id}, limit=1)
    return rows[0] if rows else None


async def wallet_by_address(address: str) -> dict | None:
    rows = await store.find("token_wallets", {"address": address}, limit=1)
    return rows[0] if rows else None


def _domain() -> str:
    origins = get_settings().cors_origin_list
    return (urlparse(origins[0]).netloc if origins else "") or "localhost"


async def wallet_challenge(user: dict, address: str) -> dict:
    await require_ready()
    try:
        addr = norm(address)
    except ValueError as exc:
        raise TokenError(str(exc)) from exc
    now = store.now()
    expires = now + CHALLENGE_TTL
    domain = _domain()
    nonce = secrets.token_hex(12)
    # EIP-4361 (Sign-In with Ethereum) message layout.
    message = (
        f"{domain} wants you to sign in with your Ethereum account:\n{addr}\n\n"
        "Link this wallet to your investor account. Signing does not move funds or approve any transaction.\n\n"
        f"URI: https://{domain}\nVersion: 1\nChain ID: {get_settings().token_chain_id}\nNonce: {nonce}\n"
        f"Issued At: {now.strftime('%Y-%m-%dT%H:%M:%SZ')}\nExpiration Time: {expires.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )
    await state.put(f"challenge:{user['id']}", {"address": addr, "message": message, "expires_at": expires})
    return {"message": message, "expiresAt": expires}


async def link_wallet(user: dict, address: str, signature: str) -> dict:
    await require_ready()
    try:
        addr = norm(address)
    except ValueError as exc:
        raise TokenError(str(exc)) from exc
    key = f"challenge:{user['id']}"
    challenge = await state.get(key)
    if not challenge or challenge["address"] != addr or store.aware(challenge["expires_at"]) < store.now():
        raise TokenError("The signing request expired or doesn't match this wallet. Start again.")
    try:
        signer = Account.recover_message(encode_defunct(text=challenge["message"]), signature=signature)
    except Exception as exc:  # malformed signature bytes
        raise TokenError("That signature isn't valid.") from exc
    await state.delete(key)  # single use, whatever the outcome
    if signer != addr:
        raise TokenError("The signature wasn't made by this wallet.")

    current = await wallet_of(user["id"])
    if current and current["address"] == addr:
        return current
    if current and current["status"] != "linked":
        raise TokenError("Your wallet is already being registered on-chain. Contact support to change it.", 409)
    owner = await wallet_by_address(addr)
    if owner and owner["user_id"] != user["id"]:
        raise TokenError("This wallet is linked to another account.", 409)
    if current:
        saved = await store.update("token_wallets", current["id"], {"address": addr, "linked_at": store.now()},
                                   expect_version=current["version"])
    else:
        try:
            saved = await store.insert("token_wallets", user["id"], {
                "address": addr, "status": "linked", "linked_at": store.now(), "identity": None,
                "country_code": None, "create_proposal_id": None, "register_proposal_id": None})
        except store.Conflict as exc:
            raise TokenError(str(exc), 409) from exc
    await repo.log_activity(user["id"], "Token", f"Linked wallet {addr[:6]}…{addr[-4:]}")
    return await onboard(saved) or saved


async def onboard(wallet: dict) -> dict | None:
    """Draft the identity-creation proposal once the investor is eligible."""
    if wallet["status"] != "linked":
        return None
    profile = await capital.get_profile(wallet["user_id"])
    if capital.investor_check(profile):
        return None
    country = countries.numeric(profile["kyc"].get("country"))
    if country is None:
        await alert("unknown_country", f"No ISO numeric code for country {profile['kyc'].get('country')!r}.",
                    {"user_id": wallet["user_id"]})
        return None
    addrs = addresses()
    proposal = await propose("create_identity", wallet["user_id"], f"Create on-chain identity for {wallet['address']}", [{
        "to": addrs["idFactory"], "data": calldata(SIG_CREATE_IDENTITY, [wallet["address"], f"pool-{wallet['user_id']}"]),
        "description": f"IdFactory.createIdentity({wallet['address']})"}], {"wallet": wallet["address"]})
    return await store.update("token_wallets", wallet["id"], {
        "status": "identity_pending", "country_code": country, "create_proposal_id": proposal["id"]},
        expect_version=wallet["version"])


async def propose_registration(wallet: dict, identity: str) -> dict | None:
    proposal = await propose("register_identity", wallet["user_id"], f"Register {wallet['address']} in the identity registry", [{
        "to": addresses()["identityRegistry"],
        "data": calldata(SIG_REGISTER_IDENTITY, [wallet["address"], identity, wallet["country_code"]]),
        "description": f"IdentityRegistry.registerIdentity({wallet['address']}, {identity}, {wallet['country_code']})"}],
        {"wallet": wallet["address"]})
    await set_proposal(wallet.get("create_proposal_id"), "executed")
    return await store.update("token_wallets", wallet["id"], {
        "status": "registration_pending", "identity": identity, "register_proposal_id": proposal["id"]},
        expect_version=wallet["version"])


# --------------------------------------------------------------------------- #
# Subscriptions
# --------------------------------------------------------------------------- #
async def subscribe(user: dict, amount_cents: int, idem: str) -> dict:
    addrs = await require_ready()
    existing = await store.find("token_subscriptions", {"user_id": user["id"], "idem": idem}, limit=1)
    if existing:
        return existing[0]
    reasons = capital.investor_check(await capital.get_profile(user["id"]))
    wallet = await wallet_of(user["id"])
    if not wallet:
        reasons.append("Link a wallet first.")
    elif wallet["status"] != "registered":
        reasons.append("Your wallet is waiting for on-chain registration by the treasury signers.")
    if reasons:
        raise TokenError("You can't subscribe yet.", 403, reasons)
    if not capital.MIN_DEPOSIT_CENTS <= amount_cents <= capital.MAX_DEPOSIT_CENTS:
        raise TokenError(f"Subscriptions must be between ${capital.MIN_DEPOSIT_CENTS / 100:,.0f} "
                         f"and ${capital.MAX_DEPOSIT_CENTS / 100:,.0f}.")
    paused = await subscriptions_paused()
    if paused:
        raise TokenError(paused, 423)
    if await store.find("token_subscriptions", {"user_id": user["id"], "status": "awaiting_payment"}, limit=1):
        raise TokenError("You already have a subscription waiting for payment. Pay or cancel it first.", 409)
    sub = await store.insert("token_subscriptions", user["id"], {
        "status": "awaiting_payment", "wallet": wallet["address"], "amount_cents": amount_cents,
        "usdc_units": amount_cents * USDC_UNITS_PER_CENT, "pay_to": addrs["safe"], "usdc": addrs["usdc"],
        "chain_id": get_settings().token_chain_id, "expires_at": store.now() + SUBSCRIPTION_TTL, "idem": idem,
        "share_units": None, "payment": None, "mint_proposal_id": None, "lockup_until": None,
        "unfreeze_proposal_id": None})
    await repo.log_activity(user["id"], "Token", f"Subscription for ${amount_cents / 100:,.2f} opened")
    return sub


async def cancel_subscription(user: dict, sub_id: str) -> dict:
    sub = await store.get("token_subscriptions", sub_id, user_id=user["id"])
    if sub is None:
        raise TokenError("Subscription not found.", 404)
    if sub["status"] != "awaiting_payment":
        raise TokenError("Only a subscription that is still waiting for payment can be cancelled.", 409)
    saved = await store.update("token_subscriptions", sub_id, {"status": "cancelled"}, expect_version=sub["version"])
    if saved is None:
        raise TokenError("The subscription changed; reload and try again.", 409)
    return saved


async def subscriptions_paused() -> str | None:
    rec = await state.get("reconcile")
    if rec and not rec.get("ok"):
        return "New subscriptions are paused while the treasury reconciles on-chain balances with the ledger."
    return None


# --------------------------------------------------------------------------- #
# Read models
# --------------------------------------------------------------------------- #
def units_to_tokens(units: int) -> float:
    return units / 10 ** TOKEN_DECIMALS


async def me(user: dict) -> dict:
    s = get_settings()
    profile = await capital.get_profile(user["id"])
    wallet = await wallet_of(user["id"])
    subs = await store.find("token_subscriptions", {"user_id": user["id"]}, limit=50)
    bal = await ledger.balances()
    held = ledger.shares(bal, f"token:{wallet['address']}") if wallet else 0
    pending = ledger.shares(bal, f"token:pending:{user['id']}")
    rec = await state.get("reconcile") or {}
    return {
        "enabled": s.token_program_enabled, "missingConfig": missing_config() if s.token_program_enabled else [],
        "chain": chain_info(), "addresses": addresses(), "settlement": settlement_label(),
        "lockupDays": s.token_lockup_days, "reasons": capital.investor_check(profile),
        "pausedReason": await subscriptions_paused(), "wallet": wallet,
        "subscriptions": subs,
        "holding": {"tokens": units_to_tokens(held), "pendingTokens": units_to_tokens(pending),
                    "valueCents": ledger.value_of_shares(bal, held + pending),
                    "onchainTokens": (units_to_tokens(rec["balances"][wallet["address"]])
                                      if wallet and wallet["address"] in (rec.get("balances") or {}) else None),
                    "reconciledAt": rec.get("at")},
    }


_transparency_cache: dict = {}


async def transparency() -> dict:
    """Public, read-only and free of personal data. Cached for a minute so the
    page can't be used to load the database or the RPC provider."""
    cached = _transparency_cache.get("value")
    if cached and store.now() - _transparency_cache["at"] < timedelta(seconds=60):
        return cached
    s = get_settings()
    pool = await capital.pool_summary()
    rec = await state.get("reconcile") or {}
    gate_status = await gate.status()
    value = {
        "enabled": s.token_program_enabled, "chain": chain_info(), "addresses": addresses(),
        "settlement": settlement_label() if s.token_program_enabled else pool["settlement"],
        "pool": {k: pool[k] for k in ("navCents", "cashCents", "outstandingCents", "reserveCents", "realisedYieldCents",
                                      "writtenOffCents", "sharePriceCents", "totalShares", "protectionFundCents",
                                      "protectionPaidCents", "advances", "defaultRate")},
        "feeSplit": {k: pool["policy"][k] for k in ("investorShareBps", "protectionShareBps", "platformShareBps")},
        "token": {"onchainSupply": units_to_tokens(rec["onchainSupply"]) if "onchainSupply" in rec else None,
                  "ledgerSupply": units_to_tokens(rec["ledgerSupply"]) if "ledgerSupply" in rec else None,
                  "reconciled": rec.get("ok"), "reconciledAt": rec.get("at"), "block": rec.get("block"),
                  "safeUsdcCents": rec["safeUsdcUnits"] // USDC_UNITS_PER_CENT if "safeUsdcUnits" in rec else None},
        "launchGate": {"passed": gate_status["passed"], "done": sum(i["done"] for i in gate_status["items"]),
                       "total": len(gate_status["items"]),
                       "items": [{"label": i["label"], "done": i["done"]} for i in gate_status["items"]]},
    }
    _transparency_cache.update(value=value, at=store.now())
    return value


async def admin_overview() -> dict:
    s = get_settings()
    return {
        "enabled": s.token_program_enabled, "missingConfig": missing_config(), "chain": chain_info(),
        "addresses": addresses(), "lockupDays": s.token_lockup_days, "confirmations": s.token_confirmations,
        "gate": await gate.status(), "reconcile": await state.get("reconcile"), "cursor": await state.get("cursor"),
        "pausedReason": await subscriptions_paused(),
        "proposals": await store.find("token_proposals", {"status": "pending"}, limit=100),
        "alerts": await store.find("token_alerts", {"resolved": False}, limit=100),
        "subscriptions": await store.find("token_subscriptions", {}, limit=50),
        "wallets": await store.find("token_wallets", {}, limit=200),
    }


async def report(start, end) -> dict:
    """Ledger movements between two dates, totalled by entry kind and account.
    The basis for the monthly transparency report."""
    by_kind: dict[str, dict] = {}
    totals: dict[str, int] = {}
    for entry in await ledger.entries(limit=100_000):
        at = datetime.fromisoformat(entry["at"].replace("Z", "+00:00"))
        if not start <= at < end:
            continue
        row = by_kind.setdefault(entry["kind"], {"count": 0, "usd": {}})
        row["count"] += 1
        for item in entry["lines"]:
            if item["unit"] != "USD":
                continue
            row["usd"][item["account"]] = row["usd"].get(item["account"], 0) + item["amount"]
            totals[item["account"]] = totals.get(item["account"], 0) + item["amount"]
    return {"start": start, "end": end, "byKind": by_kind, "netByAccount": totals}


async def post_subscription_payment(sub: dict, cents: int, idem: str, tx: str) -> dict:
    """Ledger entry for a confirmed USDC payment: cash into the pool, shares
    allocated at NAV to token:pending:<user> until the mint is confirmed."""
    uid = sub["user_id"]

    def lines(bal: dict) -> list[dict]:
        units = ledger.shares_for_deposit(bal, cents)
        if units <= 0:
            raise ledger.LedgerRejected("The payment is too small to buy a share at the current price.")
        return [line("pool:cash", cents), line("pool:capital", -cents),
                line(f"token:pending:{uid}", units, "SHARE"), line("shares:issued", -units, "SHARE")]

    return await ledger.post("token_subscription", lines, memo=f"Token subscription {cents / 100:,.2f} USD",
                             refs={"user_id": uid, "subscription_id": sub["id"], "tx": tx}, idem=idem,
                             settlement=settlement_label())
