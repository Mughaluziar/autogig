# Capital program: investor pool, early payment, protection fund

_Built 2026-11-09. Status: **simulated settlement**. The ledger records every movement, and no money moves._

## What it does

| Who | Can | Gate |
|---|---|---|
| **Freelancer** | Get up to 70% of a fixed-price order early, for a flat 3% fee, repaid within 30 days (15-day grace). Buy protection on an order within 24 hours of it arriving (4% of cover, up to 80% of the order value, capped at $2,000). | Identity verified by an operator. The order is **verified by the platform API** (Upwork or Freelancer.com; Fiverr email orders never qualify), fixed-price, USD, active or delivered, and confirmed by the API within 24 h. No advance in default. At most $5,000 outstanding and $2,500 per advance. |
| **Investor** | Deposit into, and withdraw from, a pool priced at its net asset value (NAV); earn 70% of every fee. | Identity verified, accredited/professional status attested, risk disclosure acknowledged, country allowlisted (`CAPITAL_INVESTOR_JURISDICTIONS`). |
| **Platform owner** (`OWNER_EMAILS`) | Review identities and protection claims, run jobs, read the ledger. | Owner only. |

Every limit is in `backend/app/capital/policy.py`.

## How money flows (all simulated)

```
investor deposit ─► pool cash ─► early payment ─► freelancer
                       ▲                              │ repays principal + fee
                       │◄─────────────────────────────┘
     fee split:  70% pool (investor yield) · 20% protection fund · 10% platform
     platform-reported cancellation/refund ─► protection fund repays the pool (claim, operator approval)
     unpaid after due + grace ─► written off against the pool (investors share the loss)
```

- **Ledger** (`capital/ledger.py`): append-only and double-entry, with integer cents. Each entry claims the next sequence number through a unique index, so concurrent postings serialize without MongoDB transactions, and cached balances rebuild from the journal. Invariants such as no negative cash and no over-redeemed shares are checked inside that serialized step.
- **Investor shares** are minted and burned at NAV (pool cash plus outstanding advances). Rounding always favours the pool.
- **Paying from the Autopilot balance:** `POST /api/capital/investor/deposit` takes `source: "wallet"` (pays from `wallet:<user>`, refused with 409 if the balance is short, checked inside the ledger's serialised write) and `/investor/withdraw` takes `destination: "wallet"`. The other side is `clearing:pool_funding`, so the pool's own accounts stay self-balancing. The default (`external`) behaves exactly as before.
- **Each money-moving step** records its intent, then posts an idempotent ledger entry, then marks the step done. `run_jobs()` finishes any step interrupted between those writes.

## Order insurance (backed by the protection fund)

- **24-hour window.** Standalone cover can be bought only in the first 24 hours after an order arrives, so nobody buys cover once an order already looks troubled. An order *arrives* (`orders.arrived_at`) when it's first detected as live work, or when an offer becomes an order. Orders imported quietly when an account is first connected never arrive, so they can't be covered. When an order arrives, a pop-up in the dashboard (`components/capital/cover-offer-prompt.tsx`, backed by `GET /api/capital/coverages/offers`) offers cover with a countdown. Orders that can't be covered, such as Fiverr orders detected by email, get the same pop-up with the reasons. Cover bought with an early payment is automatic and has no window.
- A claim is eligible only if the **platform API** reported the order as `cancelled` or `refunded` after cover started. An email, or the user's own word, is never enough. A `disputed` order waits for the outcome.
- An operator approves each claim. Payouts are capped at the fund's balance, and any shortfall is shown to the freelancer.
- For an early payment, the fund repays the pool on the freelancer's behalf and the fee is waived.
- The UI sells this as **order insurance**. The terms and disclosures state that the protection fund backs it, **not a licensed insurer**. Selling insurance to the public needs a licensed carrier (see go-live item 5).

## Before real money moves (go-live checklist)

Each item needs a licensed partner or legal sign-off. None of it is code-complete here.

1. **Securities counsel.** Pool shares are very likely securities.
   - In the US, Reg D 506(c) requires *verifying* accredited status (for example, a third-party verification letter). Self-attestation, which is what the app collects today, is not enough.
   - Decide the offering exemption, investor caps and required disclosures for each target country. Then set `CAPITAL_INVESTOR_JURISDICTIONS`.
2. **Lending or receivables licensing.** Early payments are repaid by the freelancer, not assigned receivables, because Upwork and Fiverr pay the freelancer's own account. Confirm in each jurisdiction whether this is commercial lending, a merchant cash advance or factoring, and which licences or usury limits apply.
3. **Regulated KYC/KYB provider** (for example Persona, Onfido or Sumsub) to replace operator review. Add sanctions and PEP screening plus ongoing AML monitoring.
4. **Settlement partner.** Choose either a stablecoin custody/payments provider (for example Circle) or a banking partner. Swap the `settlement: "simulated"` posting for real transfers at the same points: deposit, withdrawal, disbursement, repayment and payout.
5. **Order insurance.** The product is labelled "insurance" while a discretionary fund backs it. In most jurisdictions, offering insurance without a licence is prohibited, and that includes using the word. Before real money moves, place the product with a licensed carrier or MGA, or get a legal opinion for each market. Without either, rename the product.
6. **Marketplace terms.** Confirm that Upwork's and Freelancer.com's API terms allow using order data for underwriting. Upwork forbids caching API data longer than 24 h, which the 24 h freshness rule respects.
7. **Tax and reporting.** Plan investor tax forms (for example 1099s) and the books for platform fee revenue. Get the ledger audited.
8. **Collections policy** for defaulted advances. Today they are only written off and paused.

## Where things are

- Backend: `backend/app/capital/` (policy, ledger, store, service) and `backend/app/routers/capital.py`. The scheduled job is `queue.scheduled_capital_jobs`.
- Frontend: `/dashboard/capital` (early payment, protection, invest, operator) and the `/investor` portal. Investors sign up at `/signup/investor`.
- Tests: `backend/tests/test_capital.py`. Ledger balance is asserted after each flow, and the tests also run against MongoDB through `TEST_MONGODB_URI`.
- Treasury and financial reporting across every program on this ledger (grouped balances, integrity checks, period reports, journal CSV) is at `/dashboard/treasury`: see [treasury-reporting.md](treasury-reporting.md).
- The investment marketplace (raises, Platform Index, agreements), banking (balances, bank accounts, transfers, statements), upfront USDC payouts and financing applications share this ledger and scheduled job: see [marketplace-and-banking.md](marketplace-and-banking.md).
