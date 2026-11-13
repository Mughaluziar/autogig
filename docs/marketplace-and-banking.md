# Marketplace, banking and financing

_Built 2026-11-12. Status: **simulated settlement**, like the [capital program](capital-program.md). Every movement is posted to the capital ledger; no bank, card issuer or blockchain is contacted._

## What it does

| Area | Who | What |
|---|---|---|
| **Raises** (`/dashboard/marketplace/raise`) | Identity-verified freelancers and agencies with at least one API-verified order | Raise $500–$10,000 as **project funding** (repay principal + a flat return in 3–12 monthly installments) or a **revenue share** (2–20% of eligible revenue for 6–36 months, capped at 1.5× what investors put in). One open raise at a time; open 30 days. |
| **Investing** (`/dashboard/marketplace`, `/investor/marketplace`) | Investors who pass `capital.service.investor_check` (KYC verified, accredited attestation, risk acknowledged, allowed country) | Invest from the Autopilot USD balance into a raise's escrow, or into the **Platform Index**, which splits one amount evenly (min $25 a slice) across every open raise graded A or B. The existing early-payment pool is offered alongside as the other "invest in the platform" option. |
| **Portfolio** (`…/marketplace/portfolio`) | Investors | Positions, distributions received, outstanding and defaulted amounts, risk by grade and type, plus the pool position. |
| **Agreements** (`…/marketplace/agreements`) | Both sides | Schedule, payments and amount due. The business pays from its balance; each payment is split pro rata (largest remainder) into investors' balances. |
| **Get money** (`/dashboard/capital`, `/dashboard/marketplace/get-funded`) | Freelancers and agencies | Credit from verified projects (early payment), the same advance paid as **USDC** into the Autopilot balance, marketplace funding, business financing, then cash out. |
| **Banking** (`/dashboard/banking`, `/investor/banking`) | Everyone | USD and USDC balances, linked bank accounts (micro-deposit verification), transfers (add, withdraw, USD↔USDC, send USDC to a Base address), monthly statements with CSV export. |
| **Cards** (`/dashboard/banking/cards`) | Everyone | Debit waitlist and the personalized credit-card quiz, reusing `lib/landing.ts` (same launch date, `PLANNED_REWARDS`, `buildOffer`) and the public `/api/waitlist`. |
| **Financing** (`/dashboard/banking/financing`) | Everyone | An application for up to $250,000 (line of credit, term loan, revenue-based) for a licensed lending partner. The indicative range is a quarter of the last 12 months' **API-verified** revenue, rounded down to $500. Owners review in `/api/banking/admin/financing`. |

## Rules worth knowing

- **Risk grade** (`capital/market.py: track_record`): from verified orders only — completed value (40 pts), completed count (25), cancellation/refund rate (25), platform count (10). A ≥ 80, B ≥ 60, C ≥ 40, D ≥ 20, else E. Project-funding return by grade: A 6%, B 8%, C 10%, D 13%, E 16% flat.
- **Eligible revenue** for revenue shares is the value of orders a marketplace API verified and reported `completed`, dated inside the agreement. Self-recorded income never counts.
- **Closing a raise**: it disburses automatically when full; the owner can accept at 50% or more, otherwise every investor is refunded. Past the deadline, `run_jobs` does the same. A 2% origination fee goes to `platform:cash` at disbursement.
- **Late and default**: a project-funding agreement is `late` once an installment passes due, and `defaulted` after 60 days; investments are marked `defaulted` and investors are notified. A revenue share completes when its period ends and nothing more is owed.
- **Upfront USDC**: an active early payment can be paid into the USDC balance once, within 24 hours of acceptance (`clearing:advance_payouts` → `usdc:<user>`). Otherwise it is treated as paid to the user's bank.
- **Bank accounts** store the routing number and the last four digits only. While settlement is simulated, the two micro-deposit amounts are returned to the page (no real deposit is made).

## Ledger accounts (USD, integer cents)

`wallet:<user>`, `usdc:<user>`, `escrow:<listing>`, `external:bank`, `external:chain`, `clearing:advance_payouts`, plus the existing `platform:cash`. Entries that move several users' money list them in `refs.users`, so `ledger.entries(user_id=…)` returns them for statements. Every step is intent → idempotent post → mark done; `capital.service.run_jobs` (the scheduled capital job) now also runs `capital.market.run_jobs`, which finishes interrupted disbursements, refunds and repayments.

## Before real money moves

Everything in the capital program's go-live checklist applies, plus:

1. **Securities.** Marketplace investments (fixed-return notes and revenue-share agreements) are very likely securities. They need an exemption or a registered funding portal / broker-dealer partner (for example Reg CF or Reg D 506(c) with verified accreditation) before real money moves.
2. **Lending.** Project funding and business financing are commercial lending: a licensed lending partner must originate them; Autopilot refers applications.
3. **Banking.** Balances, bank links and transfers need a banking-as-a-service partner (pass-through FDIC insurance only through a partner bank) and a real account-verification provider (for example Plaid) in place of the simulated micro-deposits.
4. **Crypto.** USDC balances and sends need a licensed custody / payments partner; sends must screen addresses (sanctions) and post on confirmation.
5. **Cards.** Card programs need an issuing bank and program manager; reward rates in `lib/landing.ts` are planned targets until the bank sets them.

## Where things are

- Backend: `backend/app/capital/market.py`, `backend/app/capital/banking.py`, routers `backend/app/routers/marketplace.py` and `backend/app/routers/banking.py`. Records live in the capital store (`market_*`, `bank_*`, `financing_applications`).
- Frontend: `components/marketplace/**`, `components/banking/**`, `lib/marketplace.ts`, `lib/banking.ts`; routes under `app/dashboard/{marketplace,banking}` and `app/investor/{marketplace,banking}`.
- Tests: `backend/tests/test_marketplace.py` (books balance after every flow).
