# Treasury and financial reporting

_Status: **simulated**. Every figure is a balance in Autopilot's internal double-entry ledger. No real money is held, received or paid out, and none of these figures may be reported as real funds._

Platform owners (`OWNER_EMAILS`) open it at `/dashboard/treasury`. It is linked from the Capital page's Operator tab and from the credit admin page (`/dashboard/credit/admin`); it is not in the sidebar.

The service is `backend/app/capital/treasury.py`, the API is `backend/app/routers/treasury.py`, and the page is `components/treasury/*` with `lib/treasury.ts`. Everything is read-only: no treasury code posts a ledger entry.

## Endpoints

Every route needs a platform owner session **and** passes the simulated-modules gate (`modules_gate.require_simulated_access`). Anonymous callers get 401, signed-in non-owners get 403.

| Route | Returns |
|---|---|
| `GET /api/treasury/overview` | `kpis`, `groups` (balances by program), `checks` (integrity), `ok` (every check passed), `seq` (journal head), `asOf` |
| `GET /api/treasury/report?start=YYYY-MM-DD&end=YYYY-MM-DD` | `groups` (opening, net flow and closing by program), `flows` (by entry kind), `income`, `losses`, `external` (money in and out), `entries` |
| `GET /api/treasury/journal.csv?start=YYYY-MM-DD&end=YYYY-MM-DD` | CSV download, one row per ledger line |

**Periods.** `start` and `end` are required, inclusive, and read as UTC days: the report covers entries from `start` 00:00:00 UTC up to, but not including, the day after `end`. The period is at most **366 days**, `end` can't be before `start`, and dates must fall between 2000-01-01 and 2100-12-31. Anything else is a 422 with a plain-language `detail`.

## How accounts are grouped

Accounts are classified by their prefix (the text before the first `:`), so an account a new feature adds appears in the right group with no code change. New entry kinds are handled generically for the same reason.

| Group | Prefix | Shown as |
|---|---|---|
| Investor pool | `pool:` | each account |
| Protection fund | `protection:` | each account |
| Platform | `platform:` | each account |
| AutoGig credit prototype | `credit:` | each account |
| Customer USD balances | `wallet:<user>` | count and total only |
| Customer USDC balances | `usdc:<user>` | count and total only |
| Marketplace escrow | `escrow:<listing>` | count and total only |
| External counterparties | `external:` (bank, chain, card network…) | each account |
| Clearing and in transit | `clearing:` (advance payouts, pool funding…) | each account |
| Pool shares (SHARE unit) | `shares:` | `shares:issued`, then holders as a count and total |
| Token program | `token:` | named accounts such as `token:unreconciled`; holders as a count and total |
| Other | any other prefix | count and total only |

**No customer ids in the overview or report.** An account is listed by name only when its group is a platform program **and** the part after the prefix is a plain lowercase word (`pool:cash`, `external:card_network`). Generated ids (`u-3f2a…`, uuid hex, `0x…` addresses) never match, so they are always folded into a count and total, and check details mask them as `wallet:…`. A count is the number of those accounts with a non-zero balance.

**Signs.** Group balances use the ledger's own convention: debit positive, credit negative. Assets and customer balances are positive; capital and income are negative; every unit sums to zero. Key figures flip signs where needed so that they read naturally: income is shown as a positive amount.

## Key figures (overview)

| Figure | Meaning |
|---|---|
| Pool NAV | `pool:cash` + `pool:advances`, the value investor shares are priced on |
| Pool cash / outstanding | uncommitted pool cash; early payments not yet repaid |
| Pool capital, fee income, written off | net investor capital (deposits less withdrawals); the investors' share of fees; principal written off net of recoveries |
| Protection fund cash | `protection:cash`, what claims can be paid from |
| Premiums and fee share | all-time credits to `protection:income`, split by replaying the journal: `protection_premium` entries are premiums, every other credit is the protection share of early-payment fees |
| Payouts | `protection:payouts`, claims paid |
| Active cover exposure | the sum of `covered_cents` over coverages whose status is `active` (standalone cover and cover attached to an open early payment) |
| Coverage ratio | fund cash ÷ active cover exposure, returned as integer basis points (`coverageRatioBps`, 10,000 = 1.00×), `null` when nothing is covered. Below 1.00× the fund could not pay every active cover in full at once; claims are always capped at the fund's balance |
| Claims by status | count, claimed amount and paid amount for each claim status |
| Platform | `platform:cash` and income from `platform:income` |
| Credit treasury | `credit.service.treasury()` unchanged, including its own `ledgerCheck` |
| Customer liabilities | the totals (and counts) of `wallet:*` (USD) and `usdc:*` (USDC) balances the platform holds for customers |
| Marketplace escrow | the total of `escrow:*`, investments held until a raise closes, and how many raises hold any |
| Share supply | shares issued (`-shares:issued`), share price, holder count, units held by holders, units in the token program |

## Integrity checks

Each check is `{key, label, ok, detail}` and runs on every overview load. `ok` at the top level is true only when all pass. A failing check means the figures should not be trusted until it is explained.

| Key | Passes when |
|---|---|
| `zero_sum` | every unit's cached balances sum to zero (double entry holds) |
| `replay_matches_head` | replaying the whole journal from entry #1 gives exactly the cached head balances (`capital_head`; memory mode `_mem_head`). Catches a cached balance edited or lost outside the ledger |
| `journal_contiguous` | the journal's sequence numbers run 1, 2, … N with no gap or repeat, and N is the head's sequence |
| `entries_balanced` | every entry's lines sum to zero in each unit |
| `non_negative` | none of `pool:cash`, `protection:cash`, `credit:cash`, `credit:reserved`, `wallet:*`, `usdc:*`, `escrow:*` is below zero |
| `credit_ledger` | the credit prototype's `ledgerCheck`: its cash, outstanding and committed funds agree with contributions, agreements and open offers |

The replay is pinned to the head read at the start of the request, so entries posted while the check runs can't cause a false failure.

## Period report

- **Opening and closing balances by group** are each rebuilt by replay: opening from every entry before `start`, closing from every entry up to the end of `end`. The **net flow** per group is summed separately from the period's own lines, so `opening + netFlow = closing` is a genuine cross-check (the tests assert it). Entries are selected by time, not by sequence.
- **Flows by entry kind**: for each kind, the number of entries and the gross USD moved (the sum of an entry's debits, which equals its credits). Largest first.
- **Income**: pool fee income (`pool:income`), protection premiums and protection fee share (`protection:income`, split by kind), platform income (`platform:income`), marketplace fees (origination fees that `market_disbursed` books straight to `platform:cash` with no income line), and credit fees (`credit:income`).
- **Losses**: pool write-offs and recoveries (`pool:losses` debits and credits), credit write-offs and recoveries (`credit:losses`), and protection payouts. The total is write-offs less recoveries plus payouts. A payout that repays the pool for a written-off advance shows as both a payout and a pool recovery, so across programs it nets out.
- **Money in and out** for each `external:*` account: a credit to an external account is money coming in from outside (a bank deposit), and a debit is money going out (a withdrawal, a crypto send, card spend).

## Journal CSV

Columns: `seq, at, kind, memo, settlement, account, unit, amount`. `at` is ISO 8601 UTC; `amount` is an integer in the unit's smallest step (cents for USD, share units for SHARE; 1,000,000 units are one displayed share), debit positive.

- **Customer account ids appear in this file** (`wallet:u-…`, `usdc:u-…`, `escrow:<listing id>`, `shares:u-…`). It is the owner's full export, unlike the overview and report. Treat it as confidential, and every download is written to the owner's activity log.
- **Spreadsheet-safe.** Any text cell that starts with `=`, `+`, `-`, `@`, a tab, CR or LF gets a leading `'` so a spreadsheet shows it as text instead of running it as a formula. Integer amounts are left as numbers (a signed number is not a formula). Cells are quoted per RFC 4180 by Python's `csv` writer: commas, quotes and line breaks inside a memo are safe.
- Served with `Content-Disposition: attachment` and `Cache-Control: private, no-store`. The page fetches it with the session cookie and saves it from a blob.

## Limits

- Every overview and report replays the whole journal. That is fine at demo volume; a production ledger would need periodic balance snapshots so reports replay only from the nearest snapshot.
- Exposure and claims read at most 50,000 coverage and claim records.
- One CSV export carries at most 250,000 ledger lines (413 above that; choose a shorter period).
- Figures are only as complete as the ledger: anything not posted to the capital ledger (Stripe invoices, subscriptions) is not here.

## Tests

`backend/tests/test_treasury.py`: owner-only access (anonymous 401, non-owner 403), grouping and the no-customer-id rule, every check passing on a real workflow (pool deposit, early payment and repayment, cover, bank transfers, a credit contribution), checks failing on a tampered head, a sequence break and a negative wallet, `opening + netFlow = closing` across periods, income and loss classification, CSV quoting and formula neutralising, and date validation. `tests/test_route_auth_sweep.py` covers the new routes automatically.
