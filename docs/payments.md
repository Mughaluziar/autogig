# Payments: invoice pay links, plan trials and credit packs

_Built 2026-11-10, extended 2026-11-12; refunds, disputes, the webhook event log and the readiness check added 2026-11-27. Status: **built and tested; online payment turns on when Stripe keys are set**. Without them, the pay page shows the invoice and says online payment isn't switched on, checkout says it isn't live yet, and nothing is charged._

Two things run on the same Stripe account and webhook:

1. **Invoice pay links**: freelancers get paid by their clients (below).
2. **Plans and credit packs**: users pay Autopilot (see [Plans, trials and credit packs](#plans-trials-and-credit-packs)).

## What it does

| Who | Can |
|---|---|
| **Freelancer** (Money → Invoices → New invoice) | Build an invoice from line items (quantity × rate), with an optional discount and tax rate and notes, and split the total into milestones (title, amount, due date). Choose how the client may pay: debit card, credit card, crypto (USDC). **Create & send** creates the pay link and opens a share sheet: copy the link, or have Autopilot email it to the client. Mark any milestone paid or unpaid by hand. Payments made through the link appear as paid milestones and income automatically, and on the invoice's timeline. |
| **Client** (`/pay/<token>`, no account) | See the invoice (line items, discount, tax, dates, notes), the payment schedule and what's left. Pick a milestone and a method, then pay on Stripe's hosted checkout. |
| **Owner** | Gets a notification and an activity-log entry for every payment, refund and dispute. A second payment for a milestone that's already paid is flagged for refund. A fully refunded milestone can be re-opened for payment from the invoice ("Ask to pay again"). |
| **Platform owner** (Integrations → Stripe readiness) | Sees whether Stripe is set up correctly (keys, mode, webhook secret, return address, crypto switch), runs a live check against Stripe (account activation, webhook endpoint and its events), and sees the recent webhook deliveries and what the app did with each. |

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
- **Paid online is final for the owner.** Refreshing the snapshot can't change the amount of, or remove, a milestone paid online (409). Only Stripe's refund and dispute events change it (see [Refunds and disputes](#refunds-and-disputes)). Milestones marked paid by hand follow the owner's latest choice, so marking one paid in the dashboard also stops the client paying it again.
- **Invoices without milestones** are one payable part with id `full`.
- **The line-item breakdown is for display.** The client is always charged the milestone amounts. When line items are sent, the server recomputes subtotal − discount + tax in whole cents and refuses (422) a snapshot whose milestones don't add up to that total (a cent of rounding drift per line is allowed).
- **Emailing the link** (`POST /api/pay-links/{invoiceId}/send`) uses the app's email provider (Resend or SMTP, see `backend/app/email.py`). Without one it returns 503 and the share sheet offers "open in your email app" instead. It's capped at 5 sends per invoice and 30 per user per hour, and everything the user typed is HTML-escaped.
- **Deleting an invoice** withdraws its link (`DELETE /api/pay-links/{invoiceId}`). The link then returns 404.
- In the **frontend-only demo** (no `NEXT_PUBLIC_API_URL`) pay links are off and the Money page says so. Invoices, milestones and manual tracking still work.

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/pay-links` | session: create or refresh the link for one invoice; `reopen: [milestoneId]` re-opens refunded milestones for payment |
| GET | `/api/pay-links` | session: `{live, cryptoLive, links[]}`; each link has `total, paid, remaining, refunded, extraPayments` and milestones with `status` (`due`/`paid`/`refunded`), `refunded`, `refundedOn` and `dispute` (`{status, reason, amount, openedOn, respondBy, closedOn}` or null) |
| DELETE | `/api/pay-links/{invoiceId}` | session: withdraw the link |
| POST | `/api/pay-links/{invoiceId}/send` | session: `{email, message?}` email the link to the client; 503 without an email provider |
| GET | `/api/pay/{token}` | public: what the pay page shows (no owner id or email). Milestones carry `status`, `refunded`, `refundedOn` and `disputed` (true while a dispute is open; no reason, amount or Stripe ids) |
| POST | `/api/pay/{token}/checkout` | public: `{method, milestoneId?}` → `{url}`; 503 when not live |
| POST | `/api/payments/stripe/webhook` | Stripe-Signature (pay links, plans and credit packs) |
| GET | `/api/payments/stripe/readiness?probe=false\|true` | platform owner: readiness checks (see [Stripe readiness](#stripe-readiness)); 401 anonymous, 403 for anyone else |
| GET | `/api/payments/stripe/events?limit=50` | platform owner: recent webhook deliveries from the event log |

## Refunds and disputes

Refunds and disputes are started in the Stripe Dashboard (or by the client's bank). The webhook keeps the app in step. Each milestone paid online stores its Stripe PaymentIntent id. A charge carries its PaymentIntent's metadata (`pay_token`, `milestone_id`), and a dispute names the PaymentIntent, so every event finds its payment. Rules (code: `backend/app/payments/reversals.py`):

| Event | Milestone | Totals | Client can pay it online? | Owner is told |
|---|---|---|---|---|
| `charge.refunded`, partial | stays **paid**; `refunded` = amount refunded so far | counts as paid; `refunded` shows the amount | no (it's paid) | "Partial refund" |
| `charge.refunded`, full | becomes **refunded** | counts as **unpaid** (`remaining` includes it) | **no**, until the owner re-opens it | "Payment refunded" |
| `charge.dispute.created` | stays paid; `dispute` recorded (status, reason, amount, respond-by date) | unchanged | no | "Payment disputed", with the date to respond by in Stripe |
| `charge.dispute.updated` | `dispute.status` updated | unchanged | no | not told (activity log only) |
| `charge.dispute.closed`, won / inquiry closed | stays paid; dispute closed | unchanged | no | "Dispute won" / "Payment inquiry closed" |
| `charge.dispute.closed`, lost | becomes **refunded**, exactly as a full refund (`refunded` = the amount paid) | counts as unpaid | no, until re-opened | "Dispute lost" |

- **Re-opening.** A refunded milestone stays refunded through every snapshot refresh, so neither the dashboard's automatic sync nor an edit makes it payable by accident. The owner decides what happens next. **Re-open it** (`POST /api/pay-links` with `reopen: ["<milestoneId>"]`, the "Ask to pay again" button on the invoice) and it is due again, with a fresh amount if the snapshot changes it. **Mark it paid by hand** (they were paid another way), or **remove it** from the invoice. Until then its amount can't change (409). In each case the refunded payment moves to the link's `extra_payments` with `retired: reopened|paid_by_hand|removed`, so a later event for that charge still finds it and never touches the re-opened milestone.
- **Duplicates.** Refunding a payment kept under `extra_payments` (a client who paid twice) records the refund there and leaves the milestone paid. `extraPayments` in `GET /api/pay-links` counts only duplicates that haven't been refunded yet, so the "paid twice" warning clears once the duplicate is refunded.
- **A payment for a refunded milestone** (a checkout started before the refund) isn't counted. It's kept under `extra_payments` and the owner is told to refund it or mark the part paid by hand.
- **The Money ledger** follows the server: a refunded milestone goes back to "due" in the browser ledger, its income entry is removed and the timeline says it was refunded. A partial refund is shown on the milestone ("$X refunded"), and the income entry keeps the full amount. An open dispute marks the milestone "Disputed" with the date to respond by.
- **Idempotent and order-proof.** Stripe sends a charge's cumulative `amount_refunded`, and the stored refunded amount only ever goes up, so a replay or an older event arriving late changes nothing. A closed dispute never reopens. Writes use the pay link's compare-and-set `version`, so they can't overwrite an owner's refresh made at the same moment (and vice versa).
- **Not matched.** Payments made before PaymentIntent ids were stored are matched by the charge's `milestone_id` metadata. Disputes on those can't be matched (a dispute carries no metadata), and neither can disputes on plan or credit-pack payments. They show as `ignored` in the event log. Handle them in the Stripe Dashboard.

## Plans, trials and credit packs

| Who | Can |
|---|---|
| **Any signed-in user** (`/checkout?plan=plus\|pro`, `/checkout?pack=bids\|profiles`) | See the plan, trial timeline and order summary, then continue to Stripe Checkout. Plans are monthly subscriptions paid by card (Apple Pay and Google Pay show up on Stripe's page when they're enabled on the account). Credit packs are one-off payments by card, or crypto when it's switched on. |
| **Visitor** (landing page pricing → `/checkout?plan=…`) | See the same page; the button sends them to sign up. The chosen plan is remembered in the browser session, and Money → Plan & credits offers to continue it. |
| **Subscriber** (Money → Plan & credits) | See trial end / renewal date, open Stripe's billing portal (card, invoices, cancel), cancel at period end or undo that. |

How it works:

- **One free trial per account** (3 days, `TRIAL_DAYS` in `routers/billing.py`). Checkout sends `trial_period_days` only if this account never had one. If the trial ends without a card on file, Stripe cancels the subscription.
- **Nothing changes until Stripe's signed webhook says so.** `checkout.session.completed` (metadata `kind=plan`) switches the plan and records a "Trial" or "Paid" purchase; `kind=pack` adds the credits once the payment is `paid` (crypto: on `async_payment_succeeded`) and covers the price. `invoice.paid` records each renewal and, on Plus, adds that month's 50 bids. `customer.subscription.updated/deleted` keeps status, trial end, renewal date and cancel-at-period-end in sync, and moves the user back to Basic when the subscription ends. An old subscription ending never downgrades a newer one.
- **Replays are no-ops.** Each applied session, invoice and event id is remembered per user (`subscriptions` collection, `backend/app/payments/subscriptions.py`), on top of the webhook event log.
- **Credit-pack refunds** (`charge.refunded` on a pack payment): every refund adds a **"Refunded"** line to the billing history (a negative amount) and notifies the user. A **partial** refund keeps the credits: it's treated as a goodwill refund. A **full** refund takes the pack's credits back, but only the ones still unused: the balance never goes below zero, so credits already spent on bids stay spent, and the history line says how many were removed. Each pack payment's refunded total is stored with the pack (`packs` in the `subscriptions` document), only ever goes up, and the credits are taken back once.
- **Plan refunds** don't change the plan. Cancel the subscription in Stripe to end it (`customer.subscription.deleted` does the rest).
- **Failed renewals** (`invoice.payment_failed`): the subscription becomes `past_due`, the plan page says "Payment failed · update your card", and the user gets a notification telling them to update the card with Manage billing (Stripe's billing portal). The plan stays while Stripe retries. `invoice.paid` makes it `active` again, and `customer.subscription.deleted` ends it if every retry fails. One notification per failed attempt.
- **Plus** adds 50 bids and 3 profile slots when it starts and 50 bids each paid month. **Pro** is unlimited (credits aren't spent).
- **Freelancer accounts** use the same plans, prices, trial and checkout. Their bid credits pay for bids in the freelancer pool (`backend/app/pool/credits.py`): the first bid on a spec spends one credit; editing it, withdrawing it and bidding again on the same spec are free; Pro spends nothing; the credit comes back when the agency closes the spec without hiring (or the agency's account is deleted), not when another bid wins. `checkout-config` describes the plans in those terms, offers only the bids pack (profile slots are agency-only, refused with 422) and returns `planPage: "/freelancer/billing"`, which is also where Stripe's billing portal returns them. `POOL_BID_CREDITS=false` makes pool bidding free.
- **Receipts.** `GET /api/billing/receipts/{purchaseId}` builds a receipt from the server's own purchase record (only the caller's own; 404 otherwise). It says plainly when nothing was charged (trial, simulated purchase, plan ended); for Stripe payments Stripe's own receipt and invoice are in the billing portal. The freelancer billing page shows it and downloads it as a self-contained HTML file.
- **Simulated purchases** (`POST /api/billing/upgrade`, `/api/billing/credits`) only work without Stripe and outside production, so the app can be tried end to end in development. With Stripe configured they return 409 (use checkout); in production without Stripe they return 403. The checkout page offers "Simulate" only when the server says simulation is allowed.

| Method | Path | Auth |
|---|---|---|
| GET | `/api/billing/checkout-config` | session: `{live, cryptoLive, simulated, trialDays, trialAvailable, plan, plans, packs, subscription, planPage}` (plans and packs described for the account type) |
| GET | `/api/billing/receipts/{purchaseId}` | session: a receipt for one of the caller's purchases; 404 for anyone else's |
| GET | `/api/pool/bid-credits` | freelancer: `{enabled, plan, unlimited, left, used[], rules}`: what bidding costs and which bids used a credit |
| POST | `/api/billing/checkout` | session: `{plan}` or `{pack, method?}` → `{url}`; 503 when Stripe isn't set up, 409 when already on that plan |
| POST | `/api/billing/portal` | session: `{url}` of Stripe's billing portal; 404 without a paid plan |
| POST | `/api/billing/subscription/cancel` | session: `{cancel: bool}` cancel at period end, or undo |

## Webhook events

Subscribe the endpoint to exactly these events (`REQUIRED_EVENTS` in `backend/app/payments/readiness.py`; the readiness check compares the registered endpoint against it, and a test keeps every event the webhook handles in it):

`checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

**Event log.** Every signed event with an id is recorded in `stripe_events` (`backend/app/payments/events.py`). Each row holds the event id, type, livemode, when it arrived, the outcome (`applied`, `duplicate`, `ignored`, `rejected-amount` or `error`), how many times it ran, how many re-deliveries were answered from the log, and the ids of the Stripe objects involved (session, PaymentIntent, charge, subscription, invoice). It has no names, emails, amounts or user ids, and rows expire after 90 days (TTL index). A repeated event id is answered `{"received": true, "duplicate": true}` without running anything again. The exception is an earlier attempt that failed (`error`, the webhook answered 500 so Stripe retries) or never finished: then the retry runs it. The handlers are idempotent on their own as well, because Stripe can describe one change in two different events.

## Stripe readiness

`GET /api/payments/stripe/readiness` (platform owners only; the "Stripe readiness" card on Integrations) returns `{summary, mode, key, environment, webhookUrl, requiredEvents, probed, checks[], account, endpoints}`. Each check is `{id, label, status: pass|warn|fail, detail}`:

| Check | Pass | Warn / fail |
|---|---|---|
| `secret_key` | `STRIPE_SECRET_KEY` set with a secret-key prefix | fail: unset (checkout is off), or not `sk_`/`rk_` (a publishable key can't create payments) |
| `mode` | test key (`sk_test_`) | warn: restricted test key (`rk_test_`), check its permissions. Fail: live key, refused by the production guard (`config.production_problems`) for this release |
| `webhook_secret` | `STRIPE_WEBHOOK_SECRET` set and `whsec_…` | fail: unset (every call refused) or not a signing secret |
| `site_url` | `PUBLIC_SITE_URL` is an https origin | warn: blank (falls back to the first CORS origin). Fail: not an https origin |
| `webhook_url` | `PUBLIC_API_URL` known: the exact URL to register | warn: blank (the live check matches by path) or not https |
| `crypto` | `PAYMENTS_CRYPTO_ENABLED=false` | fail: on, refused by the production guard for this release |

With `probe=true` (the "Run live check" button) it also makes two read-only calls with the secret key:

| Check | From | Pass | Warn / fail |
|---|---|---|---|
| `charges`, `payouts`, `details`, `currency` | `GET /v1/account` | charges and payouts enabled, details submitted, USD | charges off: fail with a live key, warn in test mode (test payments still work). Payouts off or details missing: warn. Another default currency: warn (Stripe converts for payout) |
| `endpoint` | `GET /v1/webhook_endpoints` | an enabled endpoint for our webhook URL in this mode | fail: none, or disabled. Warn (`endpoint_count`): more than one, since each has its own secret and only one can match |
| `events` | same | subscribed to every required event (or `*`) | fail: lists the missing events |

Only the account flags (`chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`, `country`, `defaultCurrency`) and the matching endpoints (`id, url, status, livemode, allEvents, missingEvents`) are returned. **No secret is ever returned.** Keys show as their prefix and last four characters (`sk_test_…WXYZ`), or the prefix alone for short values, and Stripe's error text (which can echo part of a key) is replaced by the HTTP status. A restricted key needs read access to Account and Webhook Endpoints for the live check.

`GET /api/payments/stripe/events` lists the newest webhook deliveries from the event log (`limit` 1–200, default 50).

## Settings

| Variable | Meaning |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…`. Unset means online payment is off (checkout returns 503 and charges nothing). |
| `STRIPE_WEBHOOK_SECRET` | The webhook endpoint's signing secret (`whsec_…`). Unset means the webhook rejects every call. |
| `PAYMENTS_CRYPTO_ENABLED` | `true` only after Stripe has enabled stablecoin payments on the account. |
| `PUBLIC_SITE_URL` | Frontend origin for Stripe's return URLs (`/pay/<token>?status=success`). Blank means the first `CORS_ORIGINS` entry. |
| `POOL_BID_CREDITS` | Application default `true`: a freelancer's first bid on a spec spends a bid credit. Demo Render blueprint sets `false` so bidding is free without Stripe. Set `true` only after deciding to activate paid-credit use; balances and accounting remain in place. |

`NEXT_PUBLIC_PAYMENTS_LIVE` no longer gates upgrades: the checkout page asks the server whether Stripe is set up. The flag still decides whether free-plan profile limits are enforced in the frontend (`lib/demo-engine.ts`).

## Go-live checklist

1. **Stripe account** for the business that receives the money, fully activated (business details, bank account, identity checks).
2. **Decide who the merchant is.** As built, every pay link charges *one* Stripe account (the platform's). Paying each freelancer directly needs **Stripe Connect**: an onboarded connected account per freelancer, and `transfer_data[destination]` or the `Stripe-Account` header on each Checkout Session. Collecting clients' money on behalf of freelancers without Connect is money transmission in many jurisdictions. Don't take live payments for other people's invoices until this is settled.
3. **Webhook endpoint** in the Stripe Dashboard: `https://<backend>/api/payments/stripe/webhook`, subscribed to every event in [Webhook events](#webhook-events). Put its signing secret in `STRIPE_WEBHOOK_SECRET`, set `PUBLIC_API_URL`, and confirm with **Integrations → Stripe readiness → Run live check** (every check passes, or only expected warnings remain).
3a. **Billing portal:** turn on the customer portal in the Stripe Dashboard (Settings → Billing → Customer portal), allowing card updates, invoice history and cancellation, so "Manage billing" works.
4. **Test mode first:** `sk_test_…`, pay with Stripe test cards (for example `4242 4242 4242 4242` for credit, `4000 0566 5566 5556` for debit), and confirm that the milestone shows as paid on the pay page and in Money.
5. **Crypto:** request stablecoin payments in the Stripe Dashboard (availability depends on the account's country). Then set `PAYMENTS_CRYPTO_ENABLED=true`, and run a test-mode crypto payment end to end.
6. **Refunds and disputes: done.** Issue refunds and answer disputes in the Stripe Dashboard. The app follows them through `charge.refunded` and `charge.dispute.*` (see [Refunds and disputes](#refunds-and-disputes)). In test mode, refund a test payment (fully and partially) and create a dispute with Stripe's dispute test card (`4000 0000 0000 0259`). Then check that the milestone, the owner's notification and the event log follow.
7. **Terms:** add payment terms and a privacy note for clients to the pay page (who the merchant is, refund policy).

## Security notes

- **Tokens** come from `secrets.token_urlsafe(16)` (128 bits) and are the only credential for the public page. The page sends `no-referrer` and is excluded from robots.
- **The public view** returns only what's printed on the invoice: business name, number, client, description, milestones and totals. It never returns the owner's id or email, or the internal invoice id.
- **Webhook signatures** are HMAC-SHA256 over `t.payload`, compared in constant time, with a 5-minute tolerance in either direction. Bodies over 256 KB are refused.
- **Idempotency.** Every event id is claimed in the event log first, so a re-delivery runs nothing. Marking paid is a conditional update (only from `due`). Refunds and disputes only move forward (cumulative refunded amount, closed disputes stay closed) and are written with compare-and-set. A different session paying an already-paid milestone is stored under `extra_payments` and flagged to the owner for refund.
- **Owner-only diagnostics.** The readiness check and the event log need a platform-owner session (`OWNER_EMAILS`). They never return keys or signing secrets, nor anything personal from the events.
- **Amount check.** A webhook whose amount or currency doesn't cover the milestone isn't counted. It notifies the owner to check it in Stripe.
- **Rate limit.** Checkout creation is capped at 10 per link per 10 minutes, on top of the global per-IP limit. When `API_KEY` is set, the checkout and webhook paths are exempt from it, because clients and Stripe can't send that key.

## Where things are

- Backend: `backend/app/payments/` (`store.py`, `stripe_api.py`, `subscriptions.py`, `reversals.py` for refund/dispute rules, `events.py` for the webhook event log, `readiness.py` for `REQUIRED_EVENTS` and the readiness checks), `backend/app/routers/payments.py` and `backend/app/routers/billing.py`.
- Frontend: `lib/ledger.ts` (line items, milestones, snapshot, `applyOnlinePayments`, which also applies full refunds), `components/dashboard/stripe-readiness.tsx` (the owner's readiness card on Integrations), `components/money/` (provider with pay-link sync and the share sheet, invoice builder and preview, charts), the Money pages under `app/dashboard/money/` (overview, invoices, invoice detail, builder, transactions, payments, plan), `app/pay/[token]/`, and checkout in `app/checkout/` + `components/checkout/`.
- Tests: `backend/tests/test_payments.py`, `backend/tests/test_billing_checkout.py` and `backend/tests/test_stripe_readiness.py` (refunds, disputes, pack refunds, failed renewals, event log, readiness).
