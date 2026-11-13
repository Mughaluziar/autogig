# Implementation report (live)

Last updated: 2026-11-14. Git: `git log --oneline`; the untouched original is tag `baseline-as-received` (`git diff baseline-as-received` shows everything changed).
Status words: **DONE** = implemented and verified as stated · **PARTIAL** = implemented, part not verified · **PENDING** = not started or not finished · **BLOCKED** = needs a decision, credentials or approval from outside.
"Verified" always says how. Nothing here claims a real third-party service works unless it says it was tested with real credentials; **none were**.

## Test evidence
| Check | Result |
|---|---|
| Backend suite, **Python 3.12.14** (production pin), in-memory, final code | **408 passed, 4 skipped, 0 failed**. Skips: 2 Mongo-only tests (`test_mongo.py`), the on-chain token e2e (needs a local chain), 1 needing the frontend checkout |
| Same suite against a **real MongoDB 7** (throwaway container) | Whole suite before the last changes: 389 passed, 5 failed, 1 skipped. The 5 were tests that read in-memory dictionaries or use their own event loop (test-harness limits, not product bugs); they are now marked memory-only. Re-run after the change of all new/changed test files (Upwork, reset, config, API keys, inbox, team, Upwork OAuth): **79 passed, 5 skipped (the memory-only ones), 0 failed**. The full suite was not re-run end to end against Mongo after the last edits |
| Frontend `tsc --noEmit` / `next lint` / `next build` (final code) | Pass / 1 pre-existing warning / pass |
| Static `npm run qa` | Payments/escrow check now passes (was the only failure) |
| Browser crawl, all **137 routes**, desktop 1440 px and mobile 390 px (demo build) | **0** HTTP errors, 0 blank pages, 0 console/page errors, 0 failed requests, **0 horizontal overflow**. This is the mock-data demo build: it proves the pages render, not that they work with real data |
| Real browser against production build + API + real MongoDB | Signup, login, Gigs with Upwork leads, import dialog (390 and 1280 px), draft/edit/save/reload, forgot and reset password: verified manually, 2026-11-14. Not exercised in the browser: the remove-lead button, the copy button, other roles' pages with real data |
| Backup/restore scripts | Tested on the throwaway Mongo |

## 1. Git and baseline
| Item | Status | Evidence |
|---|---|---|
| Git repository inside the project folder, original files preserved | **DONE** | `git init` in the project; first commit `75cc719`, tag `baseline-as-received`; 476 files, no secrets, no `node_modules` |
| Browser-test artefacts kept out of git | **DONE** | `.gitignore` |

## 2. Critical infrastructure
| Item | Status | Evidence / note |
|---|---|---|
| Production refuses to start without MongoDB, weak `SECRET_KEY`, wildcard/localhost-only CORS; pings Mongo at startup | **DONE** | `backend/tests/test_production_config.py` (12 tests). `ALLOW_IN_MEMORY_DB=true` is the explicit opt-out for throwaway demos |
| MongoDB persistence | **PARTIAL** | Verified by hand against real Mongo (user, leads, proposal, reset token, lockout rows written/read/cleared). Full suite against Mongo: see below. Existing tests that read in-memory dictionaries directly cannot run in Mongo mode (pre-existing) |
| Terms no longer promise Stripe escrow | **DONE** | `app/(marketing)/legal/terms/page.tsx`; `npm run qa` Payments check now passes. **A lawyer must still review the Terms and Privacy Policy before launch** |
| Fake `sk_live_…` key removed from Settings | **DONE** | Replaced by a link to the real API-keys page |
| Security headers on the frontend (CSP, HSTS, X-Frame-Options, nosniff, Referrer/Permissions-Policy, no `X-Powered-By`) | **DONE** | `next.config.mjs`; verified with `curl -I` on the production build; no CSP violations seen in the browser console on signup, login, Gigs, apply, reset pages. CSP keeps `'unsafe-inline'` for scripts/styles (Next.js needs it) |
| Real password reset (forgot/reset were fake: showed "link sent" and "password updated" without doing anything) | **DONE** | `POST /api/auth/forgot-password`, `/reset-password`; hashed single-use 30-minute token, no account enumeration, 60 s cooldown; 8 tests + browser flow verified end to end. **Email delivery not tested** (no provider configured; locally the link is shown on screen outside production) |
| Login lockout persisted (survives restarts, shared across instances) | **DONE** | MongoDB `login_failures` with TTL; tests in memory mode + verified in real Mongo by hand |
| Per-IP budget on credential endpoints (20/min) plus `--proxy-headers` start command | **PARTIAL** | Unit-tested. Whether Render's proxy headers are honoured is **not verified** (needs a deployed instance). General limiter is still in-process memory (not shared across instances) |
| Session security (token in `localStorage`) | **BLOCKED / PENDING** | Mitigated by CSP and 60-minute tokens, not removed. Moving to HttpOnly cookies cross-site (Vercel to Render) needs either a same-site proxy (`/api` rewrite) or SameSite=None + CSRF tokens: an architectural decision for you. Existing JWTs also are not revoked on password change (60 min max) |
| Backups | **PARTIAL** | `scripts/backup/mongo-backup.sh` and `mongo-restore.sh` **tested** on a throwaway Mongo (retention and the "refuse to overwrite" guard worked; restored data matched). **Not scheduled anywhere**: Atlas backups / a scheduler need your account (see `docs/backup-and-monitoring.md`) |
| Monitoring configuration | **PARTIAL** | `/health` exists and was tested (ok / degraded). Uptime checker and Sentry DSNs need your accounts: documented, not configured |
| CI | **PARTIAL** | `.github/workflows/ci.yml` now runs typecheck, lint, qa, build, pytest on Python 3.12, and a second job against a MongoDB service. **Never run on GitHub** (no remote) |

## 3. Upwork human-in-the-loop assistant (no API, no Nango, no automation)
See `docs/upwork-assistant.md` for the flow, setup and the verified/not-verified table.
| Requirement | Status | Evidence |
|---|---|---|
| Upwork alert emails ingested through the existing inbound-email architecture (webhook, and the existing Outlook sync) | **DONE** (synthetic emails) | `test_upwork_leads.py`; real webhook call in the browser session. **Real Upwork emails not tested**, **real inbound provider not tested** |
| Extract title, description, budget, skills, URL (+ posted, proposals, location when present) | **PARTIAL** | 12 parser tests on synthetic fixtures; shape of real alerts is an assumption |
| Duplicate detection | **DONE** | Upwork job id as key; unique DB index; tested for repeat emails, URL variants, repeated pastes, dismissed leads |
| Leads in Job Radar | **DONE** | They show in the Gigs feed (the Job Radar family; Upwork work is "gigs" in this app) as "Upwork (email alert)"; detail page works |
| Personalised AI proposal using the existing AI infrastructure | **PARTIAL** | Prompt uses signup profile, forbids invented claims, fences the job text as untrusted; tested with a mocked model (prompt content asserted). Template fallback verified live. **Real model output not tested** (no `GROQ_API_KEY`) |
| Review interface: edit, copy, save, manage | **DONE** | Existing proposal composer + Bids page reused; edit/save/reload verified in the browser against Mongo; owner-only access tested |
| Link to the original Upwork job | **DONE** | Notice and button open the canonical `upwork.com/jobs/~id` |
| Clear "you submit manually" notice | **DONE** | On the detail and apply pages (desktop), asserted in the browser |
| No auto-submit, no automation, no credentials | **DONE** | Server returns 422 for Upwork automation (3 variants tested), worker returns 403, UI hides auto-apply; submit endpoint still 501 |
| Paste-an-email and one-job import | **DONE** | Dialog verified at 390 px and 1280 px; API tested (invalid input, duplicates) |
| "Remove this job" | **DONE** | API tested; button not exercised in the browser |

## 4. Website completeness (in progress)
| Item | Status | Note |
|---|---|---|
| Role label said "Administrator" for every user | **DONE** (typecheck/build only) | Now shows the account's role; not re-checked in a browser |
| Freelancer portal "Open specs/earnings/contracts" | **PENDING / needs decision** | They call demo-only endpoints (`SEED_DEMO_DATA`); real accounts see empty tables and 404s in the console. Finishing the blind-auction/spec marketplace is a product-sized feature |
| Browser crawl of all routes, desktop + mobile | **DONE** | See test evidence. Forms/buttons were exercised by hand only on the flows listed there, not exhaustively |
| Responsive check | **PARTIAL** | No page overflows at 390 px (crawl). Visual quality on phones was reviewed only for the new Upwork dialog |
| Loading/error states review | **PENDING** | Not reviewed page by page; new pages show busy, error and empty states |
| README status table out of date | **DONE** | Corrected; the rest of the 56 KB README was not re-audited |
| Stripe, social sign-in, email, Sentry, inbound email with real credentials | **BLOCKED** | Need your accounts/keys; none tested |
| Upwork API path (OAuth/GraphQL) | **DONE (disabled)** | Code kept but a master switch `UPWORK_API_ENABLED` (default false) makes connecting and live search impossible; signup/verify screens no longer offer it; tested. Delete the code if you prefer |

## 5. Decisions and approvals needed from you
1. Sessions: same-site `/api` proxy + HttpOnly cookie (recommended), or keep bearer tokens with the CSP mitigation.
2. Remove the dormant Upwork OAuth/GraphQL code and the Nango Outlook path, or leave it disabled?
3. Production accounts and keys: MongoDB Atlas (paid tier for backups), email provider, Stripe, Groq, Sentry, inbound-email provider.
4. Lawyer review of Terms/Privacy; confirmation that Upwork's terms allow AI-drafted proposals that users submit personally.
5. Which of the demo-only features (agents, arbitrage, spec auctions, client portal) are in scope for launch.


---

# QA pass 2026-11-14 (browser + real MongoDB)

Stack under test: production Next.js build proxying `/api` to the FastAPI app (Python 3.12.14) on a throwaway MongoDB 7 container; synthetic accounts and synthetic Upwork emails only; a local mock "AI provider" answered the real HTTP call that the app makes to Groq (no real AI provider was configured). Nothing was deployed and no production data was touched.

| Suite | Result |
|---|---|
| Browser E2E (`scripts/qa/e2e.mjs`, real Chromium, 6 roles) | **153/153 passed** (auth/cookies/CSRF/logout/reset, Upwork assistant, pool, roles/privacy, responsive, loading/error) |
| Authenticated route crawl, every route of admin / freelancer / investor, desktop 1440 + mobile 390 | **220 page visits: 0 server errors, 0 page errors, 0 blank pages, 0 horizontal overflow** |
| Backend suite, Python 3.12.14, in-memory | **427 passed, 4 skipped, 0 failed** |
| Frontend typecheck / lint / production build | pass / 1 pre-existing warning / pass |
| Backend log during the browser run | no tracebacks, no 5xx |
| Data in MongoDB after the run | verified by query: users, specs, bids (awarded/rejected), contract, earning (paid), Upwork leads, proposal flagged manual-submit-only, revoked session, `session_version` bump, unique indexes `(spec_id, freelancer_id)` and `(user_id, dedupe_key)` |

## Bugs found by this pass, all fixed and re-tested
1. **Rate limit too tight (real).** 240 requests/min per IP was exhausted by normal use (one dashboard page makes ~25 calls; users behind one office IP share it) and returned 429s. Now `RATE_LIMIT_PER_MINUTE`, default 900 (unit-tested). The QA run used 4000 for its single-IP load; 900 for real traffic is a judgement, not measured.
2. **Freelancer home page still called demo-only endpoints** (404/403 in the console, zeros/mock). Now uses the real pool data with loading/error states.
3. **Upwork lead detail page showed "spent only when an auto-apply is actually sent"** (irrelevant, implies automation). Hidden for Upwork.
4. **Fabricated "+8.1%" revenue trend** on the agency Command Center and Margins pages for accounts with $0. Removed.
5. Test-script bugs (not product bugs): an award click matched the wrong row; an assertion counted the tester's own probe lead as a leak.

## Not verified / still incomplete (honest list)
- **MongoDB-mode run of the entire suite** after the last edits: started, see the note at the end of this file for its outcome. The pool/session/Upwork/auth/orders tests passed against Mongo in earlier runs; 5 older tests are memory-only by design.
- **Real Upwork emails, real AI provider output, real inbound-email delivery, real email sending (reset links, verification codes): not tested** (no credentials). In QA the reset link is returned on screen because no email provider is configured; in production the same link is only emailed.
- **Vercel to Render proxy in production:** same-site cookies and `X-Forwarded-*` trust were tested only on localhost. Vercel rewrites have their own timeout (about 30 s on some plans) which can be shorter than a sleeping Render free instance wakes; use a paid Render plan.
- **Secure cookie flag** is verified by unit tests (production/https), not in a live https deployment.
- **Admin dashboard sections that are demo-only** still make ~10 calls to endpoints that do not exist for real accounts (`/api/kpis`, `/api/agents`, ...): harmless 404s in the console, and the pages show empty zero states, but they are not features. Routes like `/dashboard/clients`, `/contracts`, `/milestones`, `/freelancers` redirect to the Command Center for real accounts.
- **Anonymous visitors cause a 401 `/api/auth/me` console line** on every page load (expected probe; cosmetic).
- **Mobile tables** (e.g. Open Specs) scroll sideways inside their card at 390 px; the page itself does not overflow. A card layout would be nicer.
- **QA & Submissions** (freelancer) has no real backend.
- **Payouts only record that the agency paid;** there is no Stripe Connect transfer. No escrow.
- Third-party integrations awaiting credentials/approval: Stripe (live), email provider (Resend/SMTP), Groq (or another LLM), inbound-email provider, Google/GitHub/Microsoft/Apple sign-in apps, Sentry DSNs, Nango/Outlook (optional), MongoDB Atlas + backups, uptime monitor.
- Production blockers: items above plus a lawyer's review of Terms/Privacy, Atlas backups and a restore drill, real-world check of the Upwork parser with 3-5 real alert emails, and a decision on the Upwork browser-assist extension.

## MongoDB-mode full-suite outcome (final)
Whole backend suite against real MongoDB 7: **413 passed, 7 skipped, 11 failed**. All 11 failures were in `test_session_cookies.py`: that file created extra `TestClient`s, and a Motor (MongoDB) client cannot be shared between event loops (a test-harness limit, not a product bug; the same flows passed in the real-browser run against MongoDB). The tests now use cookie-jar "devices" on one client and the file passes in **both** modes (21/21 memory, 21/21 Mongo). The other 413 stayed green; the 7 skips are the 4 normal skips plus 3 tests that read in-memory storage by design.
