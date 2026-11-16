# AutoGig funding prototype: security review

Scope: the new simulated credit module (`backend/app/credit/`, `routers/credit.py`, `components/credit/*`, `lib/wallets.ts`) and how it
sits in the existing platform. Method: reading the code, writing the tests listed, and running them (results in `IMPLEMENTATION_REPORT.md`).
**This is a self-review by the developer, not an independent audit. Smart contracts have not been written for this scope and no
audit has taken place.**

## 1. Findings and what was done
| # | Area | Finding | Status |
|---|---|---|---|
| 1 | Authorization | Every credit route sits behind the simulated-modules gate and a session; owner routes use `require_owner`; borrower reads are scoped by `user_id`. Another user's application, agreement or repayment answers 404 | Fixed by design, tested (`test_credit.py`: isolation, owner-only, anonymous sweep `test_route_auth_sweep.py`) |
| 2 | Separation of duties | An owner could approve their own application | Blocked: owners cannot apply or review their own, tested |
| 3 | Money integrity | Float rounding in schedules/fees | None: integer cents and basis points only; largest-remainder split proven by a 500-case randomized test; ledger rejects non-integers |
| 4 | Idempotency / double submit | Contribution and repayment retried or double-clicked | Idempotency key required (validated pattern); same key records once; UI generates one key per dialog/form |
| 5 | Race: double accept | Two accepts of one offer could create two agreements | Compare-and-set on `version` plus a unique `application_id` on agreements; tested sequentially (second gets 404, one agreement) |
| 6 | Race: two open applications | Pre-check can race | **Found in own review, fixed:** unique partial index "one open application per user" (Mongo) and the same rule in the memory store, tested |
| 7 | Race: over-commit | Two owner decisions at once could reserve more than the pool holds | **Residual**: a disbursement is rejected if cash would go negative and the offer reopens; reservation is not a single atomic step. Low risk (owner-only, simulated) |
| 8 | Ledger consistency | Crash between steps | Intent, idempotent post, mark done; `run_jobs` re-posts or re-disburses unfinished steps; treasury `ledgerCheck` compares cash/outstanding with the records; tested |
| 9 | Isolation from real money | Demo balances mixing with real funds | Separate `credit:` accounts, `settlement: "simulated"` on every entry, no code path to a bank, chain or card |
| 10 | Input validation | Oversized/odd input, hostile links | Pydantic limits (lengths, 1-6 installments, amounts), cents must be integers (floats rejected 422), documents must be https with a label (javascript:/http: refused), at most 5; React escapes text; links open with `noopener noreferrer nofollow` and only for the owner |
| 11 | CSRF / CORS | State-changing calls | Use the platform's cookie sessions, CSRF header and Origin check (unchanged); personal API keys can use the credit routes like other routes but cannot touch sign-in/keys/team/data |
| 12 | Rate limiting | Spam | Platform per-IP limits apply (MongoDB shared counters) |
| 13 | Replay | Signed edge requests | Platform nonce replay protection applies to all routes (unchanged) |
| 14 | Privacy | Applicant contact details | Email and id appear only in owner responses; allocations are anonymised; personal text is scrubbed on account deletion; open credit blocks deletion |
| 15 | Audit | Missing history | Append-only `credit_audit` for every action; no edit/delete route |
| 16 | Wallet connection | Malicious wallet announcement, key exposure | EIP-6963 events validated (types, address regex, name length), only `data:image` icons, no private keys or seed phrases ever requested or handled; the credit page's wallet card is read-only; the existing token flow signs only a server message (never a transaction) |
| 17 | Secrets | | No new secrets, no credentials in code or docs |
| 18 | Dependencies | | No new package; `npm audit --omit=dev` and `pip-audit` results in the report |
| 19 | Smart contracts | Not in scope of code written | **None written.** Any token contract needs OpenZeppelin or T-REX, a published spec and threat model, Slither/fuzz tests, an independent audit and a bug bounty first |
| 20 | Fail-open nonce store | Existing, unchanged | Residual from the earlier review |

## 2. Residual risks and limits
* Self-review only. Run an independent review before any real use.
* Simulated screens could be mistaken for real services: mitigated by banners and wording, tested in the browser; the owner must keep the modules invitation-only (`SIMULATED_MODULES=invited`, enforced in production).
* No document verification or sanctions screening; links are unverified.
* Manual `run-jobs` means late/default marking depends on the owner running it.
* The statement attribution is an illustration; if it were read as a promised share of income it could raise securities-law issues (`docs/autogig-funding-requirements.md` #7).
* No load testing of the credit routes.

## 3. Tests added (names)
`backend/tests/test_credit.py` (arithmetic, contribution rules and idempotency, eligibility, validation, lifecycle books, offer limits, reject/withdraw/decline/expiry, double accept, late and default, paying up, statement, tenant isolation, owner-only, privacy of contact data, audit, deletion blocker, module gate, DB guard for duplicate applications), the route sweep, and the browser group `credit` in `scripts/qa/e2e.mjs`.
