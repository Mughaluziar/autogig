"""End-to-end: the token program against the real T-REX contracts on a local
Hardhat node. Skipped unless run through contracts/scripts/e2e-local.sh,
which starts the node, deploys the suite and sets:

  TOKEN_E2E_RPC_URL      e.g. http://127.0.0.1:8545
  TOKEN_E2E_DEPLOYMENT   path to contracts/deployments/localhost.json

The backend runs unmodified over JSON-RPC. Wherever the treasury signers
would execute a Safe proposal, the test sends the same calldata from the
stand-in Safe account (Hardhat's unlocked account #1).
"""
import json
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from conftest import bearer, signup
from app.config import get_settings
from app.token import chain
from test_capital import verify

RPC = os.environ.get("TOKEN_E2E_RPC_URL", "")
DEPLOYMENT = os.environ.get("TOKEN_E2E_DEPLOYMENT", "")
pytestmark = pytest.mark.skipif(not (RPC and DEPLOYMENT), reason="needs contracts/scripts/e2e-local.sh")

_REAL_SEND = httpx.AsyncClient.send  # captured before conftest blocks outbound HTTP
USDC = 10 ** 6


class Node:
    """Synchronous JSON-RPC to the Hardhat node (accounts there are unlocked)."""

    def __init__(self, url: str):
        self.http = httpx.Client(base_url=url, timeout=30)

    def rpc(self, method: str, params: list):
        body = self.http.post("", json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).json()
        assert "error" not in body, body["error"]
        return body["result"]

    def send(self, sender: str, to: str, data: str) -> dict:
        tx = self.rpc("eth_sendTransaction", [{"from": sender, "to": to, "data": data, "gas": hex(5_000_000)}])
        receipt = self.rpc("eth_getTransactionReceipt", [tx])
        assert receipt and receipt["status"] == "0x1", f"reverted: {receipt}"
        return receipt

    def call(self, to: str, signature: str, args: list, out: str):
        from eth_abi import decode
        raw = self.rpc("eth_call", [{"to": to, "data": chain.calldata(signature, args)}, "latest"])
        return decode([out], bytes.fromhex(raw[2:]))[0]

    def impersonate(self, address: str) -> None:
        self.rpc("hardhat_impersonateAccount", [address])
        self.rpc("hardhat_setBalance", [address, hex(10 ** 20)])


@pytest.fixture
def e2e(monkeypatch):
    monkeypatch.setattr(httpx.AsyncClient, "send", _REAL_SEND)
    dep = json.loads(Path(DEPLOYMENT).read_text())
    settings = get_settings()
    for attr, value in {
        "token_program_enabled": True, "token_chain_id": 31337, "token_rpc_url": RPC,
        "token_address": dep["token"], "token_identity_registry": dep["identityRegistry"],
        "token_id_factory": dep["idFactory"], "token_safe_address": dep["safe"], "token_usdc_address": dep["usdc"],
        "token_start_block": dep["deployBlock"], "token_confirmations": 0, "token_lockup_days": 0,
    }.items():
        monkeypatch.setattr(settings, attr, value)
    return Node(RPC), dep


def execute_pending(client, owner, node, safe, kind=None) -> list[dict]:
    """Do what the Safe signers do: run every call in each pending proposal."""
    pending = client.get("/api/token/admin/overview", headers=owner).json()["proposals"]
    done = [p for p in pending if kind is None or p["kind"] == kind]
    for proposal in done:
        batch = client.get(f"/api/token/admin/proposals/{proposal['id']}/safe-batch", headers=owner).json()
        for tx in batch["transactions"]:
            node.send(safe, tx["to"], tx["data"])
    return done


def sync(client, owner) -> dict:
    res = client.post("/api/token/admin/sync", headers=owner)
    assert res.status_code == 200, res.text
    return res.json()


def onboard(client, owner, node, safe, email):
    headers = bearer(signup(client, email=email, role="investor")["token"])
    verify(client, owner, headers, email, roles=("investor",), country="US")
    acct = Account.create()
    message = client.post("/api/token/wallets/challenge", headers=headers, json={"address": acct.address}).json()["message"]
    signature = Account.sign_message(encode_defunct(text=message), acct.key).signature.to_0x_hex()
    res = client.post("/api/token/wallets", headers=headers, json={"address": acct.address, "signature": signature})
    assert res.status_code == 200 and res.json()["status"] == "identity_pending", res.text
    node.impersonate(acct.address)
    return headers, acct.address


def test_full_lifecycle_on_real_contracts(client, e2e):
    node, dep = e2e
    safe, token, usdc = dep["safe"], dep["token"], dep["usdc"]
    owner = bearer(signup(client, email="owner@example.com")["token"])

    # 1. Onboarding: identity creation, then registration, both by the Safe.
    a_headers, a = onboard(client, owner, node, safe, "a@example.com")
    _, b = onboard(client, owner, node, safe, "b@example.com")
    assert len(execute_pending(client, owner, node, safe, "create_identity")) == 2
    sync(client, owner)
    assert len(execute_pending(client, owner, node, safe, "register_identity")) == 2
    sync(client, owner)
    for wallet in (a, b):
        assert node.call(dep["identityRegistry"], "isVerified(address)", [wallet], "bool") is True
    assert client.get("/api/token/me", headers=a_headers).json()["wallet"]["status"] == "registered"

    # 2. Subscription: A pays exactly 1,000 USDC into the Safe.
    sub = client.post("/api/token/subscriptions", headers=a_headers,
                      json={"amountCents": 100_000, "idempotencyKey": uuid4().hex})
    assert sub.status_code == 200, sub.text
    node.send(a, usdc, chain.calldata("mint(address,uint256)", [a, 1_000 * USDC]))
    node.send(a, usdc, chain.calldata("transfer(address,uint256)", [safe, 1_000 * USDC]))
    sync(client, owner)
    me = client.get("/api/token/me", headers=a_headers).json()
    assert me["subscriptions"][0]["status"] == "minting"
    units = me["subscriptions"][0]["shareUnits"]

    # 3. The Safe mints and freezes (lock-up); the indexer mirrors the mint.
    assert len(execute_pending(client, owner, node, safe, "mint")) == 1
    assert node.call(token, "balanceOf(address)", [a], "uint256") == units
    assert node.call(token, "getFrozenTokens(address)", [a], "uint256") == units
    result = sync(client, owner)
    assert result["reconciled"] is True, client.get("/api/token/admin/overview", headers=owner).json()["reconcile"]
    me = client.get("/api/token/me", headers=a_headers).json()
    assert me["holding"]["tokens"] == me["holding"]["onchainTokens"] == 1_000
    assert me["holding"]["valueCents"] == 100_000

    # 4. Lock-up (0 days here) ends: the Safe unfreezes; the indexer sees it.
    assert len(execute_pending(client, owner, node, safe, "unfreeze")) == 1
    assert node.call(token, "getFrozenTokens(address)", [a], "uint256") == 0
    sync(client, owner)
    assert client.get("/api/token/me", headers=a_headers).json()["subscriptions"][0]["status"] == "unlocked"

    # 5. Transfers between registered investors once the Safe unpauses the token.
    node.send(safe, token, chain.calldata("unpause()", []))
    node.send(a, token, chain.calldata("transfer(address,uint256)", [b, units // 4]))
    result = sync(client, owner)
    assert result["reconciled"] is True
    rec = client.get("/api/token/admin/overview", headers=owner).json()["reconcile"]
    assert rec["onchainSupply"] == rec["ledgerSupply"] == units
    assert rec["safeUsdcUnits"] == 1_000 * USDC

    # 6. The public report reflects the chain.
    public = client.get("/api/token/transparency").json()
    assert public["token"]["onchainSupply"] == 1_000 and public["token"]["reconciled"] is True
    assert public["token"]["safeUsdcCents"] == 100_000

    # 7. A burn outside any platform flow is caught: subscriptions pause and
    # the owners get an alert.
    node.send(safe, token, chain.calldata("burn(address,uint256)", [b, 1]))
    assert sync(client, owner)["reconciled"] is False
    overview = client.get("/api/token/admin/overview", headers=owner).json()
    assert overview["pausedReason"] and any(x["kind"] == "unreconciled_supply" for x in overview["alerts"])
