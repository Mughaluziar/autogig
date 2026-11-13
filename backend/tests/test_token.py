"""Token program: launch gate, wallet linking, subscriptions, chain indexer,
reconciliation and the public transparency report. The chain is a fake: the
indexer's three read calls (block_number, get_logs, call) are replaced."""
from datetime import timedelta
from uuid import uuid4

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak

from conftest import bearer, run, signup
from app.capital import ledger, store as cstore
from app.config import get_settings
from app.token import chain, gate, indexer, service, state
from test_capital import investor, uid

ADDR = {"token": "0x" + "11" * 20, "identityRegistry": "0x" + "22" * 20, "idFactory": "0x" + "33" * 20,
        "safe": "0x" + "44" * 20, "usdc": "0x" + "55" * 20}
ADDR = {k: chain.norm(v) for k, v in ADDR.items()}


class FakeChain:
    def __init__(self):
        self.block = 100
        self.logs: list[dict] = []
        self.identities: dict[str, str] = {}
        self.verified: set[str] = set()
        self.balances: dict[str, int] = {}
        self.frozen: dict[str, int] = {}
        self.usdc: dict[str, int] = {}
        self._tx = 0

    def _log(self, contract, sender, receiver, value):
        self._tx += 1
        self.block += 1
        self.logs.append({"address": contract.lower(), "blockNumber": hex(self.block), "logIndex": hex(0),
                          "transactionHash": "0x" + f"{self._tx:064x}", "data": hex(value),
                          "topics": [chain.TRANSFER_TOPIC, chain.topic_address(sender), chain.topic_address(receiver)]})

    def pay(self, sender, cents):
        units = cents * chain.USDC_UNITS_PER_CENT
        self.usdc[ADDR["safe"]] = self.usdc.get(ADDR["safe"], 0) + units
        self._log(ADDR["usdc"], sender, ADDR["safe"], units)

    def transfer(self, sender, receiver, units):
        if sender != chain.ZERO_ADDRESS:
            self.balances[sender] -= units
        if receiver != chain.ZERO_ADDRESS:
            self.balances[receiver] = self.balances.get(receiver, 0) + units
        self._log(ADDR["token"], sender, receiver, units)

    def confirm(self, n=20):
        self.block += n

    # The indexer's read interface -------------------------------------------
    async def block_number(self):
        return self.block

    async def get_logs(self, address, topics, start, end):
        out = []
        for item in self.logs:
            if item["address"] != address.lower() or not start <= int(item["blockNumber"], 16) <= end:
                continue
            if len(topics) > 2 and topics[2] and item["topics"][2] != topics[2]:
                continue
            out.append(item)
        return out

    async def call(self, to, signature, args, out_types, block=None):
        if signature == "getIdentity(address)":
            return self.identities.get(args[0], chain.ZERO_ADDRESS)
        if signature == "isVerified(address)":
            return args[0] in self.verified
        if signature == "totalSupply()":
            return sum(self.balances.values())
        if signature == "balanceOf(address)":
            return self.usdc.get(args[0], 0) if to == ADDR["usdc"] else self.balances.get(args[0], 0)
        if signature == "getFrozenTokens(address)":
            return self.frozen.get(args[0], 0)
        raise AssertionError(f"unexpected call {signature}")


@pytest.fixture
def fake(monkeypatch):
    settings = get_settings()
    for key, attr in service._ADDRESS_SETTINGS.items():
        monkeypatch.setattr(settings, attr, ADDR[key])
    monkeypatch.setattr(settings, "token_program_enabled", True)
    monkeypatch.setattr(settings, "token_rpc_url", "http://rpc.invalid")
    monkeypatch.setattr(settings, "token_chain_id", 84532)
    monkeypatch.setattr(settings, "token_start_block", 100)
    fc = FakeChain()
    monkeypatch.setattr(chain, "block_number", fc.block_number)
    monkeypatch.setattr(chain, "get_logs", fc.get_logs)
    monkeypatch.setattr(chain, "call", fc.call)
    return fc


@pytest.fixture
def owner(client):
    return bearer(signup(client, email="owner@example.com")["token"])


def link(client, headers, acct=None):
    acct = acct or Account.create()
    challenge = client.post("/api/token/wallets/challenge", headers=headers, json={"address": acct.address})
    assert challenge.status_code == 200, challenge.text
    sig = Account.sign_message(encode_defunct(text=challenge.json()["message"]), acct.key).signature.to_0x_hex()
    return acct, client.post("/api/token/wallets", headers=headers, json={"address": acct.address, "signature": sig})


def sync(client, owner):
    res = client.post("/api/token/admin/sync", headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def registered_investor(client, owner, fake, email="inv@example.com"):
    """An eligible investor whose wallet the Safe has registered on-chain."""
    headers = investor(client, owner, email=email, deposit_cents=0)
    acct, res = link(client, headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "identity_pending"
    identity = chain.norm("0x" + uuid4().hex[:40].rjust(40, "a"))
    fake.identities[acct.address] = identity
    sync(client, owner)
    fake.verified.add(acct.address)
    sync(client, owner)
    me = client.get("/api/token/me", headers=headers).json()
    assert me["wallet"]["status"] == "registered"
    return headers, acct


def proposals(client, owner):
    return client.get("/api/token/admin/overview", headers=owner).json()["proposals"]


# --------------------------------------------------------------------------- #
# Launch gate
# --------------------------------------------------------------------------- #
def test_program_is_off_by_default(client, owner):
    headers = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    me = client.get("/api/token/me", headers=headers).json()
    assert me["enabled"] is False
    res = client.post("/api/token/wallets/challenge", headers=headers, json={"address": "0x" + "ab" * 20})
    assert res.status_code == 503
    assert sync(client, owner) == {"status": "not_configured"}


def test_mainnet_needs_the_flag_and_every_gate_item(client, owner, fake, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "token_chain_id", 8453)
    headers = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    res = client.post("/api/token/wallets/challenge", headers=headers, json={"address": "0x" + "ab" * 20})
    assert res.status_code == 423 and "TOKEN_MAINNET_ENABLED" in res.json()["detail"]

    monkeypatch.setattr(settings, "token_mainnet_enabled", True)
    res = client.post("/api/token/wallets/challenge", headers=headers, json={"address": "0x" + "ab" * 20})
    assert res.status_code == 423 and "launch gate" in res.json()["detail"]

    assert client.post("/api/token/admin/gate/audit", headers=owner, json={"done": True, "evidence": "x"}).status_code == 422
    assert client.post("/api/token/admin/gate/nope", headers=owner, json={"done": True, "evidence": "x" * 20}).status_code == 422
    assert client.post("/api/token/admin/gate/audit", headers=headers,
                       json={"done": True, "evidence": "x" * 20}).status_code == 403
    for key in gate.KEYS:
        res = client.post(f"/api/token/admin/gate/{key}", headers=owner, json={"done": True, "evidence": f"Ref {key} doc"})
        assert res.status_code == 200
    assert res.json()["passed"] is True
    res = client.post("/api/token/wallets/challenge", headers=headers, json={"address": "0x" + "ab" * 20})
    assert res.status_code == 200


def test_unknown_chain_is_refused(client, fake, monkeypatch):
    monkeypatch.setattr(get_settings(), "token_chain_id", 1)
    headers = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    res = client.post("/api/token/wallets/challenge", headers=headers, json={"address": "0x" + "ab" * 20})
    assert res.status_code == 423


# --------------------------------------------------------------------------- #
# Wallet linking
# --------------------------------------------------------------------------- #
def test_wallet_link_requires_the_wallets_own_signature(client, owner, fake):
    headers = investor(client, owner, deposit_cents=0)
    acct, other = Account.create(), Account.create()
    challenge = client.post("/api/token/wallets/challenge", headers=headers, json={"address": acct.address}).json()
    assert acct.address in challenge["message"] and "does not move funds" in challenge["message"]
    forged = Account.sign_message(encode_defunct(text=challenge["message"]), other.key).signature.to_0x_hex()
    res = client.post("/api/token/wallets", headers=headers, json={"address": acct.address, "signature": forged})
    assert res.status_code == 400
    # The challenge is single-use, so a correct signature now needs a new one.
    good = Account.sign_message(encode_defunct(text=challenge["message"]), acct.key).signature.to_0x_hex()
    res = client.post("/api/token/wallets", headers=headers, json={"address": acct.address, "signature": good})
    assert res.status_code == 400
    _, res = link(client, headers, acct)
    assert res.status_code == 200 and res.json()["address"] == acct.address


def test_expired_challenge_is_rejected(client, owner, fake):
    headers = investor(client, owner, deposit_cents=0)
    acct = Account.create()
    message = client.post("/api/token/wallets/challenge", headers=headers, json={"address": acct.address}).json()["message"]
    key = f"challenge:{uid(client, 'inv@example.com')}"
    doc = run(client, state.get, key)
    doc["expires_at"] = cstore.now() - timedelta(seconds=1)
    run(client, state.put, key, doc)
    sig = Account.sign_message(encode_defunct(text=message), acct.key).signature.to_0x_hex()
    res = client.post("/api/token/wallets", headers=headers, json={"address": acct.address, "signature": sig})
    assert res.status_code == 400


def test_a_wallet_belongs_to_one_account(client, owner, fake):
    first = investor(client, owner, email="a@example.com", deposit_cents=0)
    second = investor(client, owner, email="b@example.com", deposit_cents=0)
    acct, res = link(client, first)
    assert res.status_code == 200
    _, res = link(client, second, acct)
    assert res.status_code == 409


def test_onboarding_drafts_identity_then_registration(client, owner, fake):
    headers = investor(client, owner, deposit_cents=0)
    acct, res = link(client, headers)
    create = [p for p in proposals(client, owner) if p["kind"] == "create_identity"]
    assert len(create) == 1
    data = create[0]["transactions"][0]["data"]
    assert data.startswith("0x" + chain.selector("createIdentity(address,string)").hex())
    assert create[0]["transactions"][0]["to"] == ADDR["idFactory"]

    fake.identities[acct.address] = chain.norm("0x" + "ee" * 20)
    sync(client, owner)
    pending = proposals(client, owner)
    register = [p for p in pending if p["kind"] == "register_identity"]
    assert len(register) == 1 and not [p for p in pending if p["kind"] == "create_identity"]
    expected = chain.calldata("registerIdentity(address,address,uint16)", [acct.address, "0x" + "ee" * 20, 840])
    assert register[0]["transactions"][0]["data"] == expected

    batch = client.get(f"/api/token/admin/proposals/{register[0]['id']}/safe-batch", headers=owner).json()
    assert batch["chainId"] == "84532" and batch["meta"]["createdFromSafeAddress"] == ADDR["safe"]
    assert batch["transactions"][0] == {"to": ADDR["identityRegistry"], "value": "0", "data": expected,
                                        "contractMethod": None, "contractInputsValues": None}


def test_ineligible_investor_gets_no_identity_proposal(client, owner, fake):
    headers = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    _, res = link(client, headers)
    assert res.status_code == 200 and res.json()["status"] == "linked"
    assert proposals(client, owner) == []


# --------------------------------------------------------------------------- #
# Subscriptions and the indexer
# --------------------------------------------------------------------------- #
def subscribe(client, headers, cents=100_000):
    return client.post("/api/token/subscriptions", headers=headers,
                       json={"amountCents": cents, "idempotencyKey": uuid4().hex})


def test_subscription_needs_a_registered_wallet(client, owner, fake):
    headers = investor(client, owner, deposit_cents=0)
    res = subscribe(client, headers)
    assert res.status_code == 403 and "Link a wallet first." in res.json()["reasons"]
    link(client, headers)
    res = subscribe(client, headers)
    assert res.status_code == 403 and "on-chain registration" in res.json()["reasons"][0]


def test_full_subscription_flow_mirrors_the_chain(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    res = subscribe(client, headers, 100_000)
    assert res.status_code == 200, res.text
    sub = res.json()
    assert sub["status"] == "awaiting_payment" and sub["payTo"] == ADDR["safe"]
    assert sub["usdcUnits"] == 1_000 * 10 ** 6
    assert subscribe(client, headers).status_code == 409  # one open subscription at a time

    fake.pay(acct.address, 100_000)
    fake.confirm()
    sync(client, owner)
    me = client.get("/api/token/me", headers=headers).json()
    assert me["subscriptions"][0]["status"] == "minting"
    units = me["subscriptions"][0]["shareUnits"]
    assert units == 100_000 * ledger.SHARE_SCALE  # empty pool: $1 = one token
    assert me["holding"]["pendingTokens"] == 1_000
    bal = run(client, ledger.balances)
    assert ledger.usd(bal, "pool:cash") == 100_000
    entry = [e for e in run(client, ledger.entries) if e["kind"] == "token_subscription"][0]
    assert entry["settlement"] == "testnet:84532"

    mint = [p for p in proposals(client, owner) if p["kind"] == "mint"][0]
    assert [t["data"][:10] for t in mint["transactions"]] == [
        "0x" + chain.selector("mint(address,uint256)").hex(), "0x" + chain.selector("freezePartialTokens(address,uint256)").hex()]
    assert mint["transactions"][0]["data"] == chain.calldata("mint(address,uint256)", [acct.address, units])

    # Re-reading the same blocks must not post twice.
    run(client, state.put, "cursor", {"block": 100})
    sync(client, owner)
    assert ledger.usd(run(client, ledger.balances), "pool:cash") == 100_000
    assert len([p for p in proposals(client, owner) if p["kind"] == "mint"]) == 1

    fake.transfer(chain.ZERO_ADDRESS, acct.address, units)
    fake.frozen[acct.address] = units
    fake.confirm()
    result = sync(client, owner)
    assert result["reconciled"] is True
    me = client.get("/api/token/me", headers=headers).json()
    assert me["subscriptions"][0]["status"] == "minted"
    assert me["holding"] == {**me["holding"], "tokens": 1_000, "pendingTokens": 0, "onchainTokens": 1_000,
                             "valueCents": 100_000}
    assert not [p for p in proposals(client, owner) if p["kind"] == "mint"]  # marked executed


def test_lockup_end_drafts_unfreeze_and_detects_it(client, owner, fake, monkeypatch):
    headers, acct = registered_investor(client, owner, fake)
    subscribe(client, headers, 50_000)
    fake.pay(acct.address, 50_000)
    fake.confirm()
    sync(client, owner)
    units = 50_000 * ledger.SHARE_SCALE
    fake.transfer(chain.ZERO_ADDRESS, acct.address, units)
    fake.frozen[acct.address] = units
    fake.confirm()
    monkeypatch.setattr(get_settings(), "token_lockup_days", 0)
    sync(client, owner)
    unfreeze = [p for p in proposals(client, owner) if p["kind"] == "unfreeze"]
    assert len(unfreeze) == 1
    assert unfreeze[0]["transactions"][0]["data"] == chain.calldata("unfreezePartialTokens(address,uint256)",
                                                                    [acct.address, units])
    fake.frozen[acct.address] = 0
    sync(client, owner)
    me = client.get("/api/token/me", headers=headers).json()
    assert me["subscriptions"][0]["status"] == "unlocked"


def test_unmatched_payment_raises_an_alert_and_posts_nothing(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    subscribe(client, headers, 100_000)
    fake.pay(acct.address, 99_999)  # wrong amount
    fake.pay(Account.create().address, 100_000)  # unknown wallet
    fake.confirm()
    sync(client, owner)
    sync(client, owner)
    alerts = client.get("/api/token/admin/overview", headers=owner).json()["alerts"]
    assert len(alerts) == 2 and {a["kind"] for a in alerts} == {"unmatched_payment"}
    assert ledger.usd(run(client, ledger.balances), "pool:cash") == 0
    res = client.post(f"/api/token/admin/alerts/{alerts[0]['id']}/resolve", headers=owner, json={"note": "Refunded"})
    assert res.status_code == 200 and res.json()["resolved"] is True


def test_unexpected_mint_pauses_subscriptions(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    fake.transfer(chain.ZERO_ADDRESS, acct.address, 5 * 10 ** 6)
    fake.confirm()
    result = sync(client, owner)
    assert result["reconciled"] is False  # supply matches, but token:unreconciled is non-zero
    res = subscribe(client, headers)
    assert res.status_code == 423
    alerts = client.get("/api/token/admin/overview", headers=owner).json()["alerts"]
    assert any(a["kind"] == "unreconciled_supply" for a in alerts)


def test_onchain_drift_is_detected(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    subscribe(client, headers, 10_000)
    fake.pay(acct.address, 10_000)
    fake.confirm()
    sync(client, owner)
    units = 10_000 * ledger.SHARE_SCALE
    fake.transfer(chain.ZERO_ADDRESS, acct.address, units)
    fake.confirm()
    assert sync(client, owner)["reconciled"] is True
    fake.balances[acct.address] -= 1  # state the indexer never saw
    assert sync(client, owner)["reconciled"] is False
    overview = client.get("/api/token/admin/overview", headers=owner).json()
    assert overview["reconcile"]["mismatches"][0]["address"] == acct.address
    assert overview["pausedReason"]


def test_transfers_between_registered_wallets_are_mirrored(client, owner, fake):
    a_headers, a = registered_investor(client, owner, fake, email="a@example.com")
    _, b = registered_investor(client, owner, fake, email="b@example.com")
    subscribe(client, a_headers, 20_000)
    fake.pay(a.address, 20_000)
    fake.confirm()
    sync(client, owner)
    units = 20_000 * ledger.SHARE_SCALE
    fake.transfer(chain.ZERO_ADDRESS, a.address, units)
    fake.transfer(a.address, b.address, units // 4)
    fake.confirm()
    assert sync(client, owner)["reconciled"] is True
    bal = run(client, ledger.balances)
    assert ledger.shares(bal, f"token:{b.address}") == units // 4
    assert ledger.shares(bal, f"token:{a.address}") == units - units // 4


def test_unpaid_subscriptions_expire(client, owner, fake):
    headers, _ = registered_investor(client, owner, fake)
    sub = subscribe(client, headers).json()
    record = run(client, cstore.get, "token_subscriptions", sub["id"])

    async def backdate():
        await cstore.update("token_subscriptions", sub["id"], {"expires_at": cstore.now() - timedelta(minutes=1)},
                            expect_version=record["version"])
    run(client, backdate)
    sync(client, owner)
    assert client.get("/api/token/me", headers=headers).json()["subscriptions"][0]["status"] == "expired"


def test_cancel_only_while_awaiting_payment(client, owner, fake):
    headers, _ = registered_investor(client, owner, fake)
    sub = subscribe(client, headers).json()
    assert client.post(f"/api/token/subscriptions/{sub['id']}/cancel", headers=headers).json()["status"] == "cancelled"
    assert client.post(f"/api/token/subscriptions/{sub['id']}/cancel", headers=headers).status_code == 409
    other = bearer(signup(client, email="x@example.com", role="investor")["token"])
    assert client.post(f"/api/token/subscriptions/{sub['id']}/cancel", headers=other).status_code == 404


# --------------------------------------------------------------------------- #
# Transparency, reports, access
# --------------------------------------------------------------------------- #
def test_transparency_is_public_and_has_no_personal_data(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    res = client.get("/api/token/transparency")
    assert res.status_code == 200
    body = res.text
    assert acct.address not in body and "inv@example.com" not in body
    data = res.json()
    assert data["addresses"]["safe"] == ADDR["safe"]
    assert data["launchGate"]["passed"] is False and data["launchGate"]["total"] == len(gate.ITEMS)
    assert data["feeSplit"] == {"investorShareBps": 7000, "protectionShareBps": 2000, "platformShareBps": 1000}


def test_report_totals_ledger_movements(client, owner, fake):
    headers, acct = registered_investor(client, owner, fake)
    subscribe(client, headers, 30_000)
    fake.pay(acct.address, 30_000)
    fake.confirm()
    sync(client, owner)
    start = (cstore.now() - timedelta(days=1)).date().isoformat()
    end = (cstore.now() + timedelta(days=1)).date().isoformat()
    report = client.get(f"/api/token/admin/report?start={start}&end={end}", headers=owner).json()
    assert report["byKind"]["token_subscription"]["count"] == 1
    assert report["netByAccount"]["pool:cash"] == 30_000
    assert client.get("/api/token/admin/report?start=nope&end=x", headers=owner).status_code == 422


def test_admin_routes_are_owner_only(client, fake):
    headers = bearer(signup(client, email="inv@example.com", role="investor")["token"])
    for method, path in (("get", "/api/token/admin/overview"), ("post", "/api/token/admin/sync"),
                         ("get", "/api/token/admin/report?start=2026-01-01&end=2026-02-01")):
        assert getattr(client, method)(path, headers=headers).status_code == 403
    assert client.get("/api/token/me").status_code == 401


def test_selectors_match_the_erc3643_signatures():
    # From the compiled T-REX 4.1.6 / ONCHAINID ABIs (contracts/, `npm run selectors`).
    expected = {
        service.SIG_MINT: "40c10f19", service.SIG_FREEZE: "125c4a33", service.SIG_UNFREEZE: "1fe56f7d",
        service.SIG_CREATE_IDENTITY: "8e952bfe", service.SIG_REGISTER_IDENTITY: "454a03e0",
        "getIdentity(address)": "2fea7b81", "isVerified(address)": "b9209e33", "getFrozenTokens(address)": "158b1a57",
        "totalSupply()": "18160ddd", "balanceOf(address)": "70a08231",
    }
    assert {sig: chain.selector(sig).hex() for sig in expected} == expected
    assert chain.TRANSFER_TOPIC == "0x" + keccak(text="Transfer(address,address,uint256)").hex()
    assert chain.TRANSFER_TOPIC == "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
