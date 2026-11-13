# Payments: invoice pay links, plan trials and credit packs

_Built 2026-11-10, extended 2026-11-12. Status: **built and tested; online payment turns on when Stripe keys are set**. Without them, the pay page shows the invoice and says online payment isn't switched on, checkout says it isn't live yet, and nothing is charged._

Two things run on the same Stripe account and webhook:

1. **Invoice pay links**: freelancers get paid by their clients (below).
2. **Plans and credit packs**: users pay Autopilot (see [Plans, trials and credit packs](#plans-trials-and-credit-packs)).

## What it does

| Who | Can |
|---|---|
| **Freelancer** (Money → Invoices → New invoice) | Build an invoice from line items (quantity × rate), with an optional discount and tax rate and notes, and split the total into milestones (title, amount, due date). Choose how the client may pay: debit card, credit card, crypto (USDC). **Create & send** creates the pay link and opens a share sheet: copy the link, or have Autopilot email it to the client. Mark any milestone paid or unpaid by hand. Payments made through the link appear as paid milestones and income automatically, and on the invoice's timeline. |
| **Client** (`/pay/<token>`, no account) | See the invoice (line items, discount, tax, dates, notes), the payment schedule and what's left. Pick a milestone and a method, then pay on Stripe's hosted checkout. |
| **Owner** | Gets a notification and an activity-log entry for every payment. A second payment for a milestone that's already paid is flagged for refund. |

## How it works

```
Money page ──POST /api/pay-links (invoice snapshot)──► pay_links (token, milestones in cents)
client ──GET /api/pay/<token>──► invoice, milestones, accepted methods, live flags
client ──POST /api/pay/<token>/checkout {method, milestoneId}──► Stripe Checkout Session ──► Stripe page
Stripe ──POST /api/payments/stripe/webhook (signed)──► milestone marked paid ──► owner notified
Money page ──GET /api/pay-links (on load, focus, every 60 s)──► paid milestones become income
```

- **The amount always comes from the stored snapshot.** The checkout request names only a method and a milestone.
- **Debit and credit** both use Stripe's `card` method. Checkout can't restrict a card's funding type, so the choice is a preference. The webhook records the real funding type from the charge when Stripe reports it.
- **Crypto** uses Stripe's stablecoin payment method (`crypto`, USDC). It's offered only when `PAYMENTS_CRYPTO_ENABLED=true`.
- **A milestone counts as paid** only when Stripe's signed webhook says so (`checkout.session.completed` with `payment_status=paid`, or `checkout.session.async_payment_succeeded` for crypto, which settles later), or when the owner marks it paid by hand.
- **Paid online is final.** Refreshing the snapshot can't change the amount of, or remove, a milestone paid online (409). Milestones marked paid by hand follow the owner's latest choice, so marking one paid in the dashboard also stops the client paying it again.
- **Invoices without milestones** are one payable part with id `full`.
- **The line-item breakdown is for display.** The client is always charged the milestone amounts. When line items are sent, the server recomputes subtotal − discount + tax in whole cents and refuses (422) a snapshot whose milestones don't add up to that total (a cent of rounding drift per line is allowed).
- **Emailing the link** (`POST /api/pay-links/{invoiceId}/send`) uses the app's email provider (Resend or SMTP, see `backend/app/email.py`). Without one it returns 503 and the share sheet offers "open in your email app" instead. It's capped at 5 sends per invoice and 30 per user per hour, and everything the user typed is HTML-escaped.
- **Deleting an invoice** withdraws its link (`DELETE /api/pay-links/{invoiceId}`). The link then returns 404.
- In the **frontend-only demo** (no `NEXT_PUBLIC_API_URL`) pay links are off and the Money page says so. Invoices, milestones and manual tracking still work.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/pay-links` | session: create or refresh the link for one invoice |
| GET | `/api/pay-links` | session: `{live, cryptoLive, links[]}` |
| DELETE | `/api/pay-links/{invoiceId}` | session: withdraw the link |
| POST | `/api/pay-links/{invoiceId}/send` | session: `{email, message?}` email the link to the client; 503 without an email provider |
| GET | `/api/pay/{token}` | public: what the pay page shows (no owner id or email) |
| POST | `/api/pay/{token}/checkout` | public: `{method, milestoneId?}` → `{url}`; 503 when not live |
| POST | `/api/payments/stripe/webhook` | Stripe-Signature (pay links, plans and credit packs) |

## Plans, trials and credit packs

| Who | Can |
|---|---|
| **Any signed-in user** (`/checkout?plan=plus\|pro`, `/checkout?pack=bids\|profiles`) | See the plan, trial timeline and order summary, then continue to Stripe Checkout. Plans are monthly subscriptions paid by card (Apple Pay and Google Pay show up on Stripe's page when they're enabled on the account). Credit packs are one-off payments by card, or crypto when it's switched on. |
| **Visitor** (landing page pricing → `/checkout?plan=…`) | See the same page; the button sends them to sign up. The chosen plan is remembered in the browser session, and Money → Plan & credits offers to continue it. |
| **Subscriber** (Money → Plan & credits) | See trial end / renewal date, open Stripe's billing portal (card, invoices, cancel), cancel at period end or undo that. |

How it works:

- **One free trial per account** (3 days, `TRIAL_DAYS` in `routers/billing.py`). Checkout sends `trial_period_days` only if this account never had one. If the trial ends without a card on file, Stripe cancels the subscription.
- **Nothing changes until Stripe's signed webhook says so.** `checkout.session.completed` (metadata `kind=plan`) switches the plan and records a "Trial" or "Paid" purchase; `kind=pack` adds the credits once the payment is `paid` (crypto: on `async_payment_succeeded`) and covers the price. `invoice.paid` records each renewal and, on Plus, adds that month's 50 bids. `customer.subscription.updated/deleted` keeps status, trial end, renewal date and cancel-at-period-end in sync, and moves the user back to Basic when the subscription ends. An old subscription ending never downgrades a newer one.
- **Replays are no-ops.** Each applied session, invoice and event id is remembered per user (`subscriptions` collection, `backend/app/payments/subscriptions.py`).
- **Plus** adds 50 bids and 3 profile slots when it starts and 50 bids each paid month. **Pro** is unlimited (credits aren't spent).
- **Simulated purchases** (`POST /api/billing/upgrade`, `/api/billing/credits`) only work without Stripe and outside production, so the app can be tried end to end in development. With Stripe configured they return 409 (use checkout); in production without Stripe they return 403. The checkout page offers "Simulate" only when the server says simulation is allowed.

| Method | Path | Auth |
|---|---|---|
| GET | `/api/billing/checkout-config` | session: `{live, cryptoLive, simulated, trialDays, trialAvailable, plan, plans, packs, subscription}` |
| POST | `/api/billing/checkout` | session: `{plan}` or `{pack, method?}` → `{url}`; 503 when Stripe isn't set up, 409 when already on that plan |
| POST | `/api/billing/portal` | session: `{url}` of Stripe's billing portal; 404 without a paid plan |
| POST | `/api/billing/subscription/cancel` | session: `{cancel: bool}` cancel at period end, or undo |

## Settings

| Variable | Meaning |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…`. Unset means online payment is off (checkout returns 503 and charges nothing). |
| `STRIPE_WEBHOOK_SECRET` | The webhook endpoint's signing secret (`whsec_…`). Unset means the webhook rejects every call. |
| `PAYMENTS_CRYPTO_ENABLED` | `true` only after Stripe has enabled stablecoin payments on the account. |
| `PUBLIC_SITE_URL` | Frontend origin for Stripe's return URLs (`/pay/<token>?status=success`). Blank means the first `CORS_ORIGINS` entry. |

`NEXT_PUBLIC_PAYMENTS_LIVE` no longer gates upgrades: the checkout page asks the server whether Stripe is set up. The flag still decides whether free-plan profile limits are enforced in the frontend (`lib/demo-engine.ts`).

## Go-live checklist

1. **Stripe account** for the business that receives the money, fully activated (business details, bank account, identity checks).
2. **Decide who the merchant is.** As built, every pay link charges *one* Stripe account (the platform's). Paying each freelancer directly needs **Stripe Connect**: an onboarded connected account per freelancer, and `transfer_data[destination]` or the `Stripe-Account` header on each Checkout Session. Collecting clients' money on behalf of freelancers without Connect is money transmission in many jurisdictions. Don't take live payments for other people's invoices until this is settled.
3. **Webhook endpoint** in the Stripe Dashboard: `https://<backend>/api/payments/stripe/webhook`, with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.paid`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3a. **Billing portal:** turn on the customer portal in the Stripe Dashboard (Settings → Billing → Customer portal), allowing card updates, invoice history and cancellation, so "Manage billing" works.
4. **Test mode first:** `sk_test_…`, pay with Stripe test cards (for example `4242 4242 4242 4242` for credit, `4000 0566 5566 5556` for debit), and confirm that the milestone shows as paid on the pay page and in Money.
5. **Crypto:** request stablecoin payments in the Stripe Dashboard (availability depends on the account's country). Then set `PAYMENTS_CRYPTO_ENABLED=true`, and run a test-mode crypto payment end to end.
6. **Refunds and disputes** are handled in the Stripe Dashboard. The app doesn't reverse a paid milestone on refund yet. Add `charge.refunded` and `charge.dispute.*` handling before volume grows.
7. **Terms:** add payment terms and a privacy note for clients to the pay page (who the merchant is, refund policy).

## Security notes

- **Tokens** come from `secrets.token_urlsafe(16)` (128 bits) and are the only credential for the public page. The page sends `no-referrer` and is excluded from robots.
- **The public view** returns only what's printed on the invoice: business name, number, client, description, milestones and totals. It never returns the owner's id or email, or the internal invoice id.
- **Webhook signatures** are HMAC-SHA256 over `t.payload`, compared in constant time, with a 5-minute tolerance in either direction. Bodies over 256 KB are refused.
- **Idempotency.** Marking paid is a conditional update (only from `due`), so Stripe retries are no-ops. A different session paying an already-paid milestone is stored under `extra_payments` and flagged to the owner for refund.
- **Amount check.** A webhook whose amount or currency doesn't cover the milestone isn't counted. It notifies the owner to check it in Stripe.
- **Rate limit.** Checkout creation is capped at 10 per link per 10 minutes, on top of the global per-IP limit. When `API_KEY` is set, the checkout and webhook paths are exempt from it, because clients and Stripe can't send that key.

## Where things are

- Backend: `backend/app/payments/` (`store.py`, `stripe_api.py`, `subscriptions.py`), `backend/app/routers/payments.py` and `backend/app/routers/billing.py`.
- Frontend: `lib/ledger.ts` (line items, milestones, snapshot, `applyOnlinePayments`), `components/money/` (provider with pay-link sync and the share sheet, invoice builder and preview, charts), the Money pages under `app/dashboard/money/` (overview, invoices, invoice detail, builder, transactions, payments, plan), `app/pay/[token]/`, and checkout in `app/checkout/` + `components/checkout/`.
- Tests: `backend/tests/test_payments.py` and `backend/tests/test_billing_checkout.py`.
