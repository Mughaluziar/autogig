"""Platform wallet, crypto wallet and debit card: member transfers, linked wallets, USDC receipts, the unified
transaction history (filters, paging, CSV), the virtual debit card (issue, controls, authorizations, refunds) and pool
deposits paid from the Autopilot balance. Everything is simulated settlement; the books must balance after each flow."""
import csv
import io

import pytest

from conftest import bearer, run, signup
from app import datarights, db
from app.capital import banking, cards, ledger, store as cstore
from test_capital import assert_books_balance, key, owner, uid, verify  # noqa: F401  (owner is a fixture)
from test_marketplace import balances, fund_wallet

WALLET = "0x" + "ab" * 20
OTHER = "0x" + "cd" * 20


def member(client, owner, email, *, verified=True, cents=0, role="freelancer"):
    headers = bearer(signup(client, email=email, role=role, name=email.split("@")[0].title())["token"])
    if verified:
        verify(client, owner, headers, email, roles=("investor",) if role == "investor" else ("freelancer",))
    if cents:
        fund_wallet(client, headers, cents)
    return headers


def send(client, headers, **body):
    body = {"kind": "internal_send", "idempotencyKey": key(), **body}
    return client.post("/api/banking/transfers", headers=headers, json=body)


def notes(client, headers):
    return [n["title"] for n in client.get("/api/notifications", headers=headers).json()]


# --------------------------------------------------------------------------- #
# Member-to-member transfers
# --------------------------------------------------------------------------- #
def test_member_transfer_moves_money_once_and_both_sides_see_it(client, owner):
    a = member(client, owner, "alice@example.com", cents=500_00)
    b = member(client, owner, "bob@example.com")
    k = key()
    first = send(client, a, amountCents=120_00, recipientEmail="BOB@example.com ", note="Milestone 2", idempotencyKey=k)
    again = send(client, a, amountCents=120_00, recipientEmail="bob@example.com", note="Milestone 2", idempotencyKey=k)
    assert first.status_code == 200, first.text
    assert first.json()["transfer"]["id"] == again.json()["transfer"]["id"]
    out = first.json()["transfer"]
    assert out["kind"] == "internal_send" and out["counterpartyLabel"] == "bob@example.com"
    assert "counterpartyId" not in out and "senderLabel" not in out
    assert balances(client, a) == {"usdCents": 380_00, "usdcCents": 0}
    assert balances(client, b) == {"usdCents": 120_00, "usdcCents": 0}

    received = [t for t in client.get("/api/banking/transfers", headers=b).json() if t["kind"] == "internal_receive"]
    assert len(received) == 1 and received[0]["amountCents"] == 120_00 and received[0]["note"] == "Milestone 2"
    assert received[0]["counterpartyLabel"] == "Alice (alice@example.com)"
    assert "Money received" in notes(client, b)
    hist_b = client.get("/api/banking/transactions", headers=b).json()
    assert [r["category"] for r in hist_b["rows"]] == ["member"] and hist_b["rows"][0]["usdCents"] == 120_00
    assert_books_balance(client)


def test_member_transfer_rules(client, owner):
    a = member(client, owner, "alice@example.com", cents=100_00)
    member(client, owner, "bob@example.com")
    member(client, owner, "unverified@example.com", verified=False)
    unverified_sender = member(client, owner, "carol@example.com", verified=False, cents=50_00)

    # Unknown and unverified recipients get the same answer, so the form can't be used to find accounts.
    unknown = send(client, a, amountCents=10_00, recipientEmail="nobody@example.com")
    not_verified = send(client, a, amountCents=10_00, recipientEmail="unverified@example.com")
    assert unknown.status_code == not_verified.status_code == 422
    assert unknown.json()["detail"] == not_verified.json()["detail"]
    assert send(client, a, amountCents=10_00, recipientEmail="alice@example.com").status_code == 422
    assert send(client, unverified_sender, amountCents=10_00, recipientEmail="bob@example.com").status_code == 403
    too_much = send(client, a, amountCents=200_00, recipientEmail="bob@example.com")
    assert too_much.status_code == 409
    assert balances(client, a)["usdCents"] == 100_00
    assert_books_balance(client)


def test_member_transfers_have_a_daily_limit(client, owner, monkeypatch):
    from app.capital import banking
    monkeypatch.setattr(banking, "DAILY_INTERNAL_SEND_CENTS", 150_00)
    a = member(client, owner, "alice@example.com", cents=1_000_00)
    member(client, owner, "bob@example.com")
    assert send(client, a, amountCents=100_00, recipientEmail="bob@example.com").status_code == 200
    over = send(client, a, amountCents=60_00, recipientEmail="bob@example.com")
    assert over.status_code == 409 and "a day" in over.json()["detail"]


def test_deleting_a_member_removes_their_name_from_the_other_side(client, owner):
    a = member(client, owner, "alice@example.com", cents=100_00)
    b = member(client, owner, "bob@example.com")
    assert send(client, a, amountCents=25_00, recipientEmail="bob@example.com", note="for you").status_code == 200
    alice = run(client, db.find_user, "alice@example.com")
    run(client, datarights.execute_deletion, alice)
    received = [t for t in client.get("/api/banking/transfers", headers=b).json() if t["kind"] == "internal_receive"][0]
    assert received["counterpartyLabel"].startswith("Deleted user") and received["note"] is None
    assert balances(client, b)["usdCents"] == 25_00          # the money and the ledger are untouched


# --------------------------------------------------------------------------- #
# Linked crypto wallets, USDC receipts and sends
# --------------------------------------------------------------------------- #
def test_linked_wallets_receive_and_send_usdc(client, owner):
    h = member(client, owner, "c@example.com")
    bad = client.post("/api/banking/crypto/addresses", headers=h, json={"address": "0x123"})
    assert bad.status_code == 422
    linked = client.post("/api/banking/crypto/addresses", headers=h,
                         json={"label": "My MetaMask", "address": WALLET, "source": "browser_wallet"})
    assert linked.status_code == 200, linked.text
    w = linked.json()
    assert w["label"] == "My MetaMask" and w["source"] == "browser_wallet" and "addressLower" not in w
    dup = client.post("/api/banking/crypto/addresses", headers=h, json={"address": WALLET.upper().replace("0X", "0x")})
    assert dup.status_code == 409

    # A receipt must name one of the user's linked wallets; a raw address isn't enough.
    raw = client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_receive", "amountCents": 50_00, "idempotencyKey": key(), "address": OTHER})
    assert raw.status_code == 422
    got = client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_receive", "amountCents": 300_00, "idempotencyKey": key(), "cryptoAddressId": w["id"]})
    assert got.status_code == 200, got.text
    assert got.json()["transfer"]["address"] == WALLET and got.json()["balances"] == {"usdCents": 0, "usdcCents": 300_00}

    to_linked = client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_send", "amountCents": 100_00, "idempotencyKey": key(), "cryptoAddressId": w["id"]})
    assert to_linked.status_code == 200 and to_linked.json()["transfer"]["walletLabel"] == "My MetaMask"
    to_raw = client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_send", "amountCents": 50_00, "idempotencyKey": key(), "address": OTHER})
    assert to_raw.status_code == 200
    assert balances(client, h) == {"usdCents": 0, "usdcCents": 150_00}

    other = member(client, owner, "d@example.com")
    assert client.post("/api/banking/transfers", headers=other, json={
        "kind": "crypto_receive", "amountCents": 10_00, "idempotencyKey": key(), "cryptoAddressId": w["id"]}).status_code == 404
    assert client.delete(f"/api/banking/crypto/addresses/{w['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/banking/crypto/addresses/{w['id']}", headers=h).status_code == 200
    assert client.get("/api/banking/crypto/addresses", headers=h).json() == []
    assert client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_receive", "amountCents": 10_00, "idempotencyKey": key(), "cryptoAddressId": w["id"]}).status_code == 404
    overview = client.get("/api/banking/overview", headers=h).json()
    assert overview["cryptoAddresses"] == [] and overview["card"] is None
    assert_books_balance(client)


# --------------------------------------------------------------------------- #
# Unified transaction history
# --------------------------------------------------------------------------- #
def test_transaction_history_filters_pages_and_exports(client, owner):
    h = member(client, owner, "t@example.com", cents=1_000_00)
    w = client.post("/api/banking/crypto/addresses", headers=h, json={"label": "=HYPERLINK(\"x\")", "address": WALLET}).json()
    for kind, cents in (("to_usdc", 200_00), ("to_usd", 50_00)):
        assert client.post("/api/banking/transfers", headers=h,
                           json={"kind": kind, "amountCents": cents, "idempotencyKey": key()}).status_code == 200
    assert client.post("/api/banking/transfers", headers=h, json={
        "kind": "crypto_send", "amountCents": 25_00, "idempotencyKey": key(), "cryptoAddressId": w["id"]}).status_code == 200

    page = client.get("/api/banking/transactions?limit=2", headers=h).json()
    assert page["count"] == 4 and len(page["rows"]) == 2 and page["nextBefore"] == page["rows"][-1]["seq"]
    rest = client.get(f"/api/banking/transactions?limit=2&before={page['nextBefore']}", headers=h).json()
    assert len(rest["rows"]) == 2 and rest["nextBefore"] is None
    newest_first = [r["seq"] for r in page["rows"] + rest["rows"]]
    assert newest_first == sorted(newest_first, reverse=True)
    oldest = rest["rows"][-1]
    assert oldest["kind"] == "bank_deposit" and oldest["balanceUsdCents"] == 1_000_00
    latest = page["rows"][0]
    assert (latest["balanceUsdCents"], latest["balanceUsdcCents"]) == (850_00, 125_00)

    usdc_out = client.get("/api/banking/transactions?currency=usdc&direction=out", headers=h).json()["rows"]
    assert {r["kind"] for r in usdc_out} == {"bank_to_usd", "bank_crypto_send"}
    assert [r["kind"] for r in client.get("/api/banking/transactions?category=bank", headers=h).json()["rows"]] == ["bank_deposit"]
    assert client.get("/api/banking/transactions?q=converted", headers=h).json()["count"] == 2
    today = cstore.now().strftime("%Y-%m-%d")
    assert client.get(f"/api/banking/transactions?from={today}&to={today}", headers=h).json()["count"] == 4
    assert client.get("/api/banking/transactions?from=2001-01-01&to=2001-01-02", headers=h).json()["count"] == 0
    assert client.get("/api/banking/transactions?from=2026-02-30", headers=h).status_code == 422
    assert client.get("/api/banking/transactions?from=2026-05-01&to=2026-04-01", headers=h).status_code == 422
    assert client.get("/api/banking/transactions?category=nope", headers=h).status_code == 422

    res = client.get("/api/banking/transactions.csv", headers=h)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(res.text)))
    assert rows[0][:3] == ["Date", "Category", "Description"] and len(rows) == 5
    send_row = next(r for r in rows if r[1] == "crypto" and r[4] == "-25.00")
    assert send_row[2].startswith("Sent $25.00 USDC to =HYPERLINK")       # user text never starts a cell
    assert [banking._cell(v) for v in ("=SUM(A1)", "+1", "-2", "@x", "\tx", "ok")] == ["'=SUM(A1)", "'+1", "'-2", "'@x", "'\tx", "ok"]
    assert client.get("/api/banking/transactions", headers=member(client, owner, "x@example.com")).json()["count"] == 0


# --------------------------------------------------------------------------- #
# Virtual debit card
# --------------------------------------------------------------------------- #
def card_state(client, headers):
    return client.get("/api/banking/cards", headers=headers).json()


def buy(client, headers, card_id, cents, **body):
    payload = {"merchant": "Figma", "category": "software", "channel": "online", "amountCents": cents,
               "idempotencyKey": key(), **body}
    res = client.post(f"/api/banking/cards/{card_id}/simulate", headers=headers, json=payload)
    assert res.status_code == 200, res.text
    return res.json()["transaction"]


def test_card_needs_verified_identity_and_one_live_card(client, owner):
    unverified = member(client, owner, "u@example.com", verified=False)
    assert client.post("/api/banking/cards", headers=unverified).status_code == 403
    h = member(client, owner, "card@example.com")
    issued = client.post("/api/banking/cards", headers=h)
    assert issued.status_code == 200, issued.text
    card = issued.json()
    assert len(card["last4"]) == 4 and card["status"] == "active" and card["nameOnCard"] == "TEST PERSON"
    assert not {"number", "pan", "cvc", "cvv"} & {k.lower() for k in card}
    assert card["onlineEnabled"] is True and card["atmEnabled"] is False and card["spentTodayCents"] == 0
    assert client.post("/api/banking/cards", headers=h).status_code == 409
    assert client.post(f"/api/banking/cards/{card['id']}/status", headers=h, json={"action": "cancel"}).json()["status"] == "cancelled"
    assert card_state(client, h)["card"] is None
    assert client.post("/api/banking/cards", headers=h).status_code == 200          # a replacement after cancelling


def test_card_purchases_follow_balance_limits_and_controls(client, owner):
    h = member(client, owner, "card@example.com", cents=3_000_00)
    card = client.post("/api/banking/cards", headers=h).json()
    cid = card["id"]
    ok = buy(client, h, cid, 400_00)
    assert ok["status"] == "approved" and ok["seq"]
    assert balances(client, h)["usdCents"] == 2_600_00

    assert buy(client, h, cid, 1_200_00)["declineReason"] == "over_transaction_limit"
    assert buy(client, h, cid, 50_00, channel="atm")["declineReason"] == "atm_disabled"
    controls = client.post(f"/api/banking/cards/{cid}/controls", headers=h,
                           json={"perTransactionLimitCents": 2_000_00, "dailyLimitCents": 2_000_00, "onlineEnabled": False, "atmEnabled": True})
    assert controls.status_code == 200 and controls.json()["onlineEnabled"] is False
    assert buy(client, h, cid, 10_00)["declineReason"] == "online_disabled"
    atm = buy(client, h, cid, 100_00, channel="atm", merchant="")
    assert atm["status"] == "approved" and atm["merchant"] == "ATM" and atm["category"] == "cash"
    over_daily = buy(client, h, cid, 1_600_00, channel="in_person")
    assert over_daily["declineReason"] == "over_daily_limit"             # 400 + 100 already spent today
    assert card_state(client, h)["card"]["spentTodayCents"] == 500_00

    bad = client.post(f"/api/banking/cards/{cid}/controls", headers=h, json={"perTransactionLimitCents": 3_000_00, "dailyLimitCents": 2_000_00})
    assert bad.status_code == 422

    assert client.post(f"/api/banking/cards/{cid}/status", headers=h, json={"action": "freeze"}).json()["status"] == "frozen"
    frozen = buy(client, h, cid, 10_00, channel="in_person")
    assert frozen["declineReason"] == "card_frozen" and "Card purchase declined" in notes(client, h)
    client.post(f"/api/banking/cards/{cid}/status", headers=h, json={"action": "unfreeze"})

    # Insufficient funds is decided inside the ledger's balance check, and the limit is given back.
    client.post(f"/api/banking/cards/{cid}/controls", headers=h, json={"perTransactionLimitCents": 5_000_00, "dailyLimitCents": 10_000_00})
    broke = buy(client, h, cid, 4_000_00, channel="in_person")
    assert broke["declineReason"] == "insufficient_funds" and broke["declineText"]
    assert card_state(client, h)["card"]["spentTodayCents"] == 500_00
    assert balances(client, h)["usdCents"] == 2_500_00
    assert_books_balance(client)


def test_card_purchase_is_idempotent_and_refunds_once(client, owner):
    h = member(client, owner, "card@example.com", cents=1_000_00)
    cid = client.post("/api/banking/cards", headers=h).json()["id"]
    k = key()
    first = buy(client, h, cid, 250_00, idempotencyKey=k)
    again = buy(client, h, cid, 250_00, idempotencyKey=k)
    assert first["id"] == again["id"] and balances(client, h)["usdCents"] == 750_00
    refunded = client.post(f"/api/banking/cards/transactions/{first['id']}/refund", headers=h)
    assert refunded.status_code == 200 and refunded.json()["transaction"]["status"] == "refunded"
    assert client.post(f"/api/banking/cards/transactions/{first['id']}/refund", headers=h).status_code == 200
    assert balances(client, h)["usdCents"] == 1_000_00
    declined = buy(client, h, cid, 5_000_00)
    assert client.post(f"/api/banking/cards/transactions/{declined['id']}/refund", headers=h).status_code == 409
    other = member(client, owner, "other@example.com")
    assert client.post(f"/api/banking/cards/transactions/{first['id']}/refund", headers=other).status_code == 404
    assert client.post(f"/api/banking/cards/{cid}/simulate", headers=other, json={
        "merchant": "Shop", "amountCents": 1_00, "idempotencyKey": key()}).status_code == 404
    history = client.get("/api/banking/transactions?category=card", headers=h).json()["rows"]
    assert [r["kind"] for r in history] == ["card_refund", "card_purchase"]
    assert run(client, ledger.balances)["USD"][cards.NETWORK_ACCOUNT] == 0
    assert_books_balance(client)


def test_concurrent_card_purchases_cannot_beat_the_daily_limit(client, owner):
    import asyncio
    h = member(client, owner, "card@example.com", cents=5_000_00)
    cid = client.post("/api/banking/cards", headers=h).json()["id"]
    user_id = uid(client, "card@example.com")

    async def burst():
        return await asyncio.gather(*[cards.authorize(user_id, cid, merchant="Shop", category="other", channel="online",
                                                      amount_cents=600_00, idem=key()) for _ in range(8)])
    results = run(client, burst)
    approved = [t for t in results if t["status"] == "approved"]
    assert len(approved) == 4                                         # 4 x 600 = 2,400 of the 2,500 daily limit
    assert balances(client, h)["usdCents"] == 5_000_00 - 2_400_00
    assert_books_balance(client)


def test_a_live_card_blocks_account_deletion_until_cancelled(client, owner):
    h = member(client, owner, "card@example.com")
    cid = client.post("/api/banking/cards", headers=h).json()["id"]
    user = run(client, db.find_user, "card@example.com")
    assert any("debit card" in b for b in run(client, datarights.blockers, user))
    client.post(f"/api/banking/cards/{cid}/status", headers=h, json={"action": "cancel"})
    assert not any("debit card" in b for b in run(client, datarights.blockers, user))


# --------------------------------------------------------------------------- #
# Investor pool funded from the Autopilot balance
# --------------------------------------------------------------------------- #
def test_pool_deposit_and_withdrawal_through_the_wallet(client, owner):
    inv = member(client, owner, "inv@example.com", role="investor", cents=1_000_00)
    short = client.post("/api/capital/investor/deposit", headers=inv,
                        json={"amountCents": 2_000_00, "idempotencyKey": key(), "source": "wallet"})
    assert short.status_code == 409 and balances(client, inv)["usdCents"] == 1_000_00
    assert client.post("/api/capital/investor/deposit", headers=inv,
                       json={"amountCents": 1_00_00, "idempotencyKey": key(), "source": "card"}).status_code == 422
    dep = client.post("/api/capital/investor/deposit", headers=inv,
                      json={"amountCents": 600_00, "idempotencyKey": key(), "source": "wallet"})
    assert dep.status_code == 200, dep.text
    assert dep.json()["position"]["valueCents"] == 600_00 and balances(client, inv)["usdCents"] == 400_00
    out = client.post("/api/capital/investor/withdraw", headers=inv,
                      json={"amountCents": 250_00, "idempotencyKey": key(), "destination": "wallet"})
    assert out.status_code == 200, out.text
    assert balances(client, inv)["usdCents"] == 650_00
    bal = run(client, ledger.balances)
    assert ledger.usd(bal, "clearing:pool_funding") == 350_00
    kinds = [r["kind"] for r in client.get("/api/banking/transactions?category=investing", headers=inv).json()["rows"]]
    assert kinds == ["investor_withdrawal", "investor_deposit"]
    # The default (no source) still behaves exactly as before: nothing leaves the wallet.
    client.post("/api/capital/investor/deposit", headers=inv, json={"amountCents": 100_00, "idempotencyKey": key()})
    assert balances(client, inv)["usdCents"] == 650_00
    assert_books_balance(client)


@pytest.mark.parametrize("path", ["/api/banking/cards", "/api/banking/transactions", "/api/banking/crypto/addresses"])
def test_new_banking_reads_need_a_session(client, path):
    assert client.get(path).status_code == 401
