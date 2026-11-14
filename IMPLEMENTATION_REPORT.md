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
- **Demo-only agency sections** (superseded: see the investor-demo pass below): now marked Coming soon, no longer requested.
- **Anonymous 401 console line:** fixed in the investor-demo pass below.
- **Mobile tables:** fixed (stacked cards below 640 px), see below.
- **QA & Submissions** (freelancer) has no real backend: now Coming soon.
- **Payouts only record that the agency paid;** there is no Stripe Connect transfer. No escrow.
- Third-party integrations awaiting credentials/approval: Stripe (live), email provider (Resend/SMTP), Groq (or another LLM), inbound-email provider, Google/GitHub/Microsoft/Apple sign-in apps, Sentry DSNs, Nango/Outlook (optional), MongoDB Atlas + backups, uptime monitor.
- Production blockers: items above plus a lawyer's review of Terms/Privacy, Atlas backups and a restore drill, real-world check of the Upwork parser with 3-5 real alert emails, and a decision on the Upwork browser-assist extension.

## MongoDB-mode full-suite outcome (final)
Whole backend suite against real MongoDB 7: **413 passed, 7 skipped, 11 failed**. All 11 failures were in `test_session_cookies.py`: that file created extra `TestClient`s, and a Motor (MongoDB) client cannot be shared between event loops (a test-harness limit, not a product bug; the same flows passed in the real-browser run against MongoDB). The tests now use cookie-jar "devices" on one client and the file passes in **both** modes (21/21 memory, 21/21 Mongo). The other 413 stayed green; the 7 skips are the 4 normal skips plus 3 tests that read in-memory storage by design.


---

# Investor-demo pass 2026-11-14 (honest demo, no new features)

Scope given: make the existing agency workflow polished and honest; no new features, no real payments/escrow/integrations, no Upwork browser extension, nothing deployed or pushed. Method: audit first (`scripts/qa/nav-audit.mjs`: signs up a fresh synthetic agency and freelancer, visits every nav route at 1440 px and 390 px, records failed requests, redirects, Coming soon states, buttons), then fix, then re-audit.

## Audit result before the changes (real agency account)
| Area | Finding |
|---|---|
| Command Center | 9 requests to endpoints that exist only in demo mode (404): `kpis, agents, revenue-streams, hitl, contracts, leads, clients, milestones, invoices`; widgets showed zero revenue/margin/win-rate |
| Calendar, Accounts, Integrations, Bidding | 2, 3, 3, 3 failing demo-only requests |
| `/dashboard/clients, /contracts, /milestones, /freelancers` | silently redirected to the Command Center |
| Freelancer QA, Billing | fake data and fake-success buttons ("Receipt downloaded", "Payment method updated", "Add-on activated", "PR opened"); Billing showed a hard-coded "Pro plan, trial active, 4% fee" |
| Freelancer Profile | invented person: "Priya Sharma, 96/100, India, $28/h, 4.2 days", a canned bio, and a Save button that saved nothing |
| Agency Profile | canned headline/bio/skills/rate and two invented portfolio items ($4,800 / $3,200), "verified" badge, placeholder stats; never loaded what the account saved |
| Settings | password fields, timezone and currency selects and LLM-routing selects that saved nothing; "Password reset link sent" toast with no request |
| Activity lists (Audit Log, Notifications, Integrations activity) | showed "never" for every real row: the API returns `created_at`, the UI read the demo field `time` (pre-existing bug) |
| Anonymous visitors | a 401 for `/api/auth/me` on every page, plus 401s for pool/automation/audit/notification requests fired by dashboard pages before the redirect to login |
| Mobile | no page overflowed; wide tables scrolled sideways inside their card |

## Demo-only agency sections and what was decided
| Section | Missing endpoints (real accounts) | Decision |
|---|---|---|
| Command Center | the 9 above | **Rebuilt on real data only:** open specs, bids to review, active contracts, milestones to approve, owed to freelancers, new Upwork leads, items needing a decision, latest Upwork leads, recent activity. Revenue, margin, win-rate and trend figures removed; no Agent Fleet panel; compact Calendar "Coming soon" tile |
| Agent Fleet | `/api/agents*` (and the fleet engine is client-side) | Coming soon, in the new **Roadmap** nav group |
| Calendar | `/api/milestones`, `/api/contracts` | Coming soon (Roadmap group) |
| Bidding | `/api/proposals, /leads, /kpis` | Coming soon (Gigs replaced it; not in the nav) |
| Clients, Contracts, Milestones, Freelancers | demo-only | Coming soon at their own URL (no redirect) |
| Freelancer QA & Submissions, Messages, Billing & Plan | `/api/qa-runs, /conversations, /addons` | Coming soon (Roadmap group); milestone delivery lives in My Contracts |
| Integrations: Connections, Voice, QA & Delivery tabs | `/api/integrations, /voice-calls, /qa-runs` | Tabs hidden for real accounts (shown only in the frontend-only demo); Capability Map, Migrate and Activity remain |
| Arbitrage, Margins, HITL, Personas, Portfolio, Job Hunter, Marketing | demo-only | already Coming soon (unchanged) |
| Analytics, Refer & Extend, Outreach, Client Onboarding | none failing | kept: they compute from the account's own recorded data; they still contain links to Agent Fleet/Calendar, which now say Coming soon |

## What changed (commits on `main`, nothing pushed)
`83a9a83` Command Center on real data. `8317627` Coming soon states, Roadmap group, no redirects, `useEntity` no longer requests demo-only collections. `41d45ba` money pages: explicit "no escrow, no funds move". `3779da3` `DataTable` stacked cards below 640 px (first column as title, other columns as label/value, header-less columns as the row's actions; the desktop table is unchanged). `fa2e5ab` + `211151b` anonymous visitors: no request is sent without a session hint, and the dashboard shell never mounts a page for a signed-out visitor. `8e392a5` invented profile data and fake-success actions removed. `211151b` real timestamps; 26 new browser checks. `dd43bdf` audit script. The pool test fix is its own commit.

## Anonymous 401: investigation and handling
Cause: `AuthProvider` asked `/api/auth/me` on every load, and dashboard pages mounted and fetched before the redirect to login. A 401 there is expected, but the browser logs every failed fetch as a console error. Handling (no security change): the server sets/clears the readable `autopilot_csrf` cookie together with the HttpOnly session cookie, so with no such cookie there cannot be a session and the app treats the visitor as signed out without calling the server. That cookie is only a hint. A forged or stale hint still goes to the server, gets a 401, and the user lands on login (a browser check forges both cookies and asserts exactly that). Authentication, CSRF, Origin checks, revocation, session restoration and the 401 handling for expired sessions are untouched.

## Regression results (real Chromium, production build, real MongoDB 7, synthetic data, mock AI provider)
| Check | Result |
|---|---|
| Browser e2e `scripts/qa/e2e.mjs` | **181 / 181 passed** (153 earlier + 28 new demo-honesty checks) |
| Nav audit, 88 visits (agency + freelancer, desktop + mobile) | **0 failed requests** except `403 /api/beta-testers` on the owner-only page that is not in the nav, and one `409 PUT /api/state` (see below); 0 page errors; 0 horizontal overflow |
| Backend suite, memory mode, Python 3.12.14 | **428 passed, 3 skipped, 0 failed** |
| Backend suite, "real MongoDB" | **CORRECTION: this row was wrong.** That run passed `MONGODB_URI=...`, which `tests/conftest.py` overrides (it only honours `TEST_MONGODB_URI`), so it ran in memory mode. The genuine MongoDB result is in the reliability pass below |
| Frontend typecheck / production build | pass / pass |
| Lint | 1 warning, unchanged and pre-existing (`app/dashboard/conversations/page.tsx:46`) |

Bug found in my own earlier test: `test_open_specs_show_bid_counts_but_never_other_freelancers_bids` asserted that the string "25" did not appear anywhere in a bid, and the bid's timestamp contains "25" when the clock minute is 25. It failed twice in the same minute and passed otherwise. It now compares the rate value. This was a test flaw, not a product bug.

## Remaining limitations (not fixed, by scope)
- **Everything in the earlier "Not verified" list still stands:** real Upwork alert emails (parser only saw synthetic ones), real AI output, real email delivery, Stripe live, social sign-in apps, Sentry, Atlas backups and a restore drill, Vercel to Render proxy and Secure cookies on a live https deployment, lawyer review of Terms/Privacy, GitHub CI never run.
- **Banking, Marketplace, Capital** are simulated settlement: they now state in every place that no real money moves and there is no escrow. They record ledger entries only; no licensed partner is connected. I did not audit these flows' business logic in this pass.
- **Calendar, Agent Fleet, Clients/Contracts/Milestones/Freelancers views, freelancer QA/Messages/Billing, Bidding** are Coming soon, not built. Agency "Messages" (`/dashboard/conversations`) shows forwarded notifications only.
- **Profile editing:** the freelancer profile is read-only (signup details); there is no profile-edit API for it. Name/email changes are not available in Settings (password change is).
- **Settings LLM routing:** no per-task model choice; text now says drafting uses the server's configured provider.
- **Analytics** pages link to Agent Fleet and Calendar (Coming soon) in their empty states.
- **`409 PUT /api/state`:** observed once by the audit when two pages of the same brand-new account were open at once (workspace save version conflict). Not investigated further; single-tab use did not show it.
- Wrong-role URLs: fixed in the reliability pass below.
- Payouts are still only recorded as paid by the agency; no money moves, no escrow.
- The Upwork browser-assist extension was not started. The email-based Upwork assistant and all non-API Upwork code are unchanged by this pass (the Upwork e2e group passes).


---

# Reliability pass 2026-11-14: multi-tab workspace saves and wrong-role URLs

Scope: exactly two defects, no new features. Upwork assistant, payments/escrow, baseline and deployment untouched.

## 1. Multi-tab workspace save (the 409)
**Reproduced** with two real tabs on one account (Chromium, real MongoDB), logging every `PUT /api/state` with the version sent and returned:
- A single tab was fine: 4 edits, 4 saves (200), all persisted after reload.
- Two tabs: the older tab's next edit got a 409, the browser then silently swapped in the server's copy, and **the edit was lost without any message** (`FromTab1`, `T1second` gone after reload). Both "new account" (version 0 race) and "existing workspace" variants reproduced.

**Cause (two parts):**
1. `FleetProvider` (mounted on every dashboard page) recorded a "last visit" in the workspace on every page load. Each page load therefore wrote the workspace and bumped its version, so merely opening a second tab made every other open tab stale. This was the only load-time writer (found by version logs; Agent Fleet itself is Coming soon).
2. On a 409 the store adopted the server copy over the screen, discarding the user's change silently.

The server contract itself was correct (compare-and-set on `version`; the stale save is refused and the stored data is not touched).

**Fix:**
- `components/agents/fleet-provider.tsx`: the visit is recorded only while `/dashboard/agents` is open, so loading pages and tabs no longer writes.
- `lib/demo-store.tsx`: on a 409 the store marks a `conflict`, sends nothing more (no retry, no overwrite) and does not silently replace the screen's data. `components/dashboard/dashboard-shell.tsx` shows a red alert: "This workspace was changed in another tab or device, so your latest change here was not saved and nothing more will be saved from this page. Reload to get the latest version, then redo that change." with a **Reload now** button. After reloading, the tab saves normally again.
- No server change was needed.

**Verified in the browser (after):** opening extra tabs/pages = 0 writes; single-tab edits save with no banner; the stale tab's save is refused (409) and the banner appears; a further edit in the stale tab sends nothing; the server keeps the first tab's data and none of the stale tab's; Reload now shows the latest data and the same tab saves again (200) and the edit persists. In the repeat of the original repro the first tab's data now survives in both the new-account and existing-workspace cases.

**Tests:** `backend/tests/test_workspace_concurrency.py` (9 tests, memory and MongoDB): single-tab saves chain and persist; stale tab refused with the newer copy and nothing overwritten; repeated stale saves change nothing; reload-then-save works; 8 simultaneous saves from one version (new and existing workspace) give exactly one 200 and seven 409s, with the stored state one writer's whole copy; per-user independence; server-owned fields still dropped; session required. Browser: 10 new checks in `scripts/qa/e2e.mjs`.

## 2. Wrong-role URLs
**Reproduced:** a freelancer opening `/dashboard/command`, `/pool`, `/automation`, `/integrations` saw the full agency shell and nav with failed 403 calls; an agency opening `/freelancer/*` saw the freelancer shell with 403 errors. The API was already refusing correctly (no data leaked); the experience was wrong and the pages still mounted and fired requests.

**Fix:** `lib/access.ts` (rules) + `components/auth/role-gate.tsx` (access-denied page: "You don't have access to this page", who the area is for, and a button to the user's own dashboard), mounted in `app/dashboard/layout.tsx` and `app/freelancer/layout.tsx` inside the email-verification gate and **outside** the shell and fleet provider. For a wrong role the children never mount, so nothing renders or fetches. Rules mirror the API:
- Agency-only: `/dashboard/command, pool, automation, growth, accounts, integrations, bidding, onboarding, agents, calendar, clients, contracts, milestones, freelancers`. Everything else under `/dashboard` (Gigs, Job Radar, Orders, Money, Banking, Marketplace, Capital, Settings, Profile, ...) stays shared by all roles, as the API allows.
- `/freelancer/*`: freelancers only. `/investor/*`: open to every signed-in role (the capital/marketplace API is).
- The platform owner (OWNER_EMAILS) opens everything, as on the API. Signed-out visitors still go to login. The frontend-only demo is not gated.
- Backend authorization, sessions, CSRF and origin checks are unchanged; the gate is presentation only.

**Tests:** `backend/tests/test_role_matrix.py` (39 tests): anonymous gets 401 on every restricted endpoint; agency-only, freelancer-only, any-signed-in and owner-only endpoints for agency, freelancer, investor and owner; a 403 carries no agency data. Browser (30 new checks): freelancer on 6 agency URLs sees the access-denied page, no agency data, and no agency API call is made, and its button leads to `/freelancer`; shared pages still open for a freelancer; agency on 4 freelancer URLs denied with no freelancer API call; agency, investor and owner open what they should; investor denied on agency and freelancer URLs; anonymous sent to login.

## Results (final tree)
| Check | Result |
|---|---|
| Backend suite, **memory** mode (Python 3.12.14) | **476 passed, 3 skipped, 0 failed** |
| Backend suite, **real MongoDB 7** (`TEST_MONGODB_URI=mongodb://127.0.0.1:27018`) | **473 passed, 6 skipped, 0 failed** (45 min; the 3 extra skips are the memory-only tests) |
| Typecheck / lint / production build | clean / 1 pre-existing warning (`conversations/page.tsx:46`) / passes |
| Chromium E2E against real throwaway MongoDB | **233 / 233 passed** (192 before + 41 new) |

Honest notes on the runs:
- **Correction:** the "real MongoDB" backend results reported in the two previous passes were memory-mode runs (the wrong environment variable). The first genuine Mongo result for the whole suite on this code is the one above; the earlier session-cookie Mongo fix (21/21) was verified in genuine Mongo mode at the time.
- The 233/233 run is the 3rd clean E2E run of this tree. One earlier run on the same code failed 2 Upwork UI checks ("both jobs appear in Gigs" timed out after the leads were already stored in MongoDB); a rerun on a fresh database passed. I did not find the cause and nothing in the Upwork code was touched: treat it as one unexplained intermittent timeout. Another run failed everything at signup because I restarted the API while the old process still held the port (my test-harness error).

## Remaining limitations (this pass)
- If a second tab edits at the same time, the older tab's edit is not merged: it is refused and the user must reload and redo it. There is no automatic merge.
- A failed save because the server is unreachable (not a 409) is still not announced beyond the existing "can't reach the server" banner.
- The access-denied page is a presentation layer; shared `/dashboard/*` pages remain open to all roles by design. If any of those should become agency-only, add the prefix to `lib/access.ts`.
- All earlier "not verified" items (real emails, real AI output, Stripe, live https, backups, etc.) are unchanged.

---

# Production-readiness pass 2026-11-14 (audit, hardening, backups, deployment/CI/legal preparation)

**The platform is not declared production-ready.** Full register and classification: `docs/production-readiness.md`.
Nothing was deployed, pushed or run against production data; the baseline tag is untouched.

## What was found and changed
1. **Spoofable client IP (security).** `--forwarded-allow-ips='*'` made uvicorn trust the leftmost `X-Forwarded-For` entry, so a
   forged header dodged the per-IP rate and credential limits (reproduced). Fix: `--no-proxy-headers` + `TRUSTED_PROXY_HOPS`
   (`app/security.py`), owner-only `GET /api/diag/request` to confirm the chain on staging. Verified with proxies that append,
   in three correct topologies (direct / one proxy / two proxies: 21/21 staging checks) and an over-set hop count (detected, fails).
   Self-hosted `next start` does **not** append the client address, so a Vercel-like chain cannot be modelled locally:
   this must be confirmed on staging.
2. **Startup guards.** Production now also refuses `SEED_DEMO_DATA`, `COOKIE_SECURE=false`, non-https CORS/site URL, a bad hop
   count and a rate limit below 60, and logs a warning for each missing integration.
3. **Frontend deploy guard.** A Vercel production build refuses a missing/non-https `BACKEND_API_URL` (it would silently ship the
   unauthenticated demo) and `NEXT_PUBLIC_DEV_BYPASS_AUTH=true`.
4. **Dependencies.** Next.js 14.2.35 -> 15.5.29 with React 19 (critical image-optimizer RCE and several high advisories),
   `next-themes` 0.4.6, `recharts` 2.15.4; image optimizer disabled (nothing used it; `/_next/image` is 404). Backend upgraded and
   pinned (FastAPI 0.162.7, Starlette 1.10.0, cryptography 50.0.2, PyMongo 4.20.0 ...): `pip-audit` clean (23 advisories before).
   Frontend `npm audit`: 0 critical; 4 high + 6 moderate remain, all build-time tooling or the optional Nango SDK (see register R4).
5. **CI.** The first GitHub run would have failed: `npm run qa` flagged the corrected Terms as promising escrow. Fixed; the
   workflow gained least-privilege permissions, timeouts, concurrency control, the deploy-guard test, and runs the 45-minute
   real-MongoDB job only on pushes to `main`/manual runs. `actionlint`: clean. Never run on GitHub (no remote).
6. **Backups (verified).** Disposable MongoDB populated through the real API: backup -> restore -> `verify_restore.py` compared
   45 collections, 28 documents and 128 indexes (unique and TTL included): identical; the API then booted on the restored copy and
   signed in with the original passwords. Overwrite protection, retention and failure handling checked. New `verify_restore.py`
   and `restore-drill.sh` (which also fixed a trap: `mongorestore` adds to an existing database).
7. **Legal/launch.** Public placeholder text removed and a visible "Draft, not reviewed by a lawyer" notice added. Claims the
   product does not support (client role, quality gates, NDA shielding, RAG, secrets manager, deletion/export, stealth mode) and 15
   questions for a Pakistani technology lawyer are in `docs/legal-review-questions.md`; simulated Banking/Marketplace/Capital are
   documented as moving no money and providing no escrow. No legal compliance is claimed.
8. **Docs added:** `deployment-runbook.md`, `integration-verification.md`, `ci-first-run.md`, `production-readiness.md`,
   rewritten `backup-and-monitoring.md`, env templates, `scripts/ops/staging-check.mjs`.

## Tests (final tree)
| Check | Result |
|---|---|
| Backend, in-memory, pinned production dependencies (Python 3.12) | **495 passed, 3 skipped, 0 failed** |
| Backend, **real MongoDB 7** (`TEST_MONGODB_URI`) | MONGO_RESULT |
| Frontend typecheck / lint / `npm run qa` / `npm run test:deploy-guards` / production build (clean `npm ci` export) | pass / 1 pre-existing warning / 23 pass, 3 warn, 0 fail / 5 pass / pass |
| Chromium end-to-end against real MongoDB (Next 15, React 19, upgraded API) | **239 / 239 passed** (233 + 6 new hardening checks) |
| `scripts/ops/staging-check.mjs` on a production-mode local API | 21/21 in three topologies; fails the unsafe hop-count case |
| `pip-audit` (pinned requirements) / `npm audit --omit=dev` | no known vulnerabilities / 0 critical, 4 high, 6 moderate |
| `actionlint` on the workflow | no findings |

## Not verified in this pass (needs accounts or approval; see the register)
Atlas backups and restore time, Vercel/Render header and timeout behaviour, real email/AI/inbound email/Stripe/social/Sentry/
Nango, real Upwork alert emails, a first GitHub run, behaviour against a pre-existing production database, and all legal items.
