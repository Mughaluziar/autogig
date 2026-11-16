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
| 6 | Race: two open applications | Pre-check can race | **Fixed:** unique partial index "one open application per user" (Mongo) and the same rule in the memory store; tested with 6 simultaneous submissions |
| 7 | Race: over-commit | Two owner decisions at once could reserve more than the pool holds | **Found in review, fixed (this pass):** the reservation is now a ledger entry whose balance check runs inside the ledger's serialised section, so overlapping approvals cannot both succeed; losers reopen the application. Mutation-tested: removing the check makes the concurrent test fail (5 offers instead of 2) |
| 7b | Scheduled jobs | Late/default only when an owner pressed a button | **Fixed:** hourly background pass, idempotent (compare-and-set plus fixed ledger keys), safe if several run at once, one bad record cannot stop it; tested for double and concurrent runs |
| 8 | Ledger consistency | Crash between steps | Intent, idempotent post, mark done; `run_jobs` re-posts or re-disburses unfinished steps; treasury `ledgerCheck` compares cash/outstanding with the records; tested |
| 9 | Isolation from real money | Demo balances mixing with real funds | Separate `credit:` accounts, `settlement: "simulated"` on every entry, no code path to a bank, chain or card |
| 10 | Input validation and uploads | Oversized/odd input, hostile files | Pydantic limits, integer cents (floats rejected 422); external links were **removed**; uploads accept PDF/PNG/JPEG only by magic bytes, 2 MB, 3 per application, strict base64; served only as sandboxed attachments with generated names; React escapes text. **No malware scanning** (residual) |
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
* Uploaded files are not malware-scanned, encrypted at rest with a managed key, or verified; there is no sanctions screening.
* Background jobs run inside the API process; if it is down, marking waits.
* The statement attribution is an illustration; if it were read as a promised share of income it could raise securities-law issues (`docs/autogig-funding-requirements.md` #7).
* No load testing of the credit routes.

## 3. Tests added (names)
`backend/tests/test_credit_concurrency.py` (simultaneous applications, simultaneous offers against a limited pool, simultaneous decisions on one application, simultaneous accepts, accept racing a withdraw, concurrent and duplicate repayments, duplicate contributions, crash repair, tenant isolation), `test_credit_jobs.py` (late/default, idempotent and concurrent passes, bad record), `test_credit_documents.py` (content sniffing, limits, privacy, headers), `backend/tests/test_credit.py` (arithmetic, contribution rules and idempotency, eligibility, validation, lifecycle books, offer limits, reject/withdraw/decline/expiry, double accept, late and default, paying up, statement, tenant isolation, owner-only, privacy of contact data, audit, deletion blocker, module gate, DB guard for duplicate applications), the route sweep, and the browser group `credit` in `scripts/qa/e2e.mjs`.
