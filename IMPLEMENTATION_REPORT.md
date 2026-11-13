# Implementation report (live)

Last updated: 2026-11-14. Git: `git log --oneline`; the untouched original is tag `baseline-as-received` (`git diff baseline-as-received` shows everything changed).
Status words: **DONE** = implemented and verified as stated · **PARTIAL** = implemented, part not verified · **PENDING** = not started or not finished · **BLOCKED** = needs a decision, credentials or approval from outside.
"Verified" always says how. Nothing here claims a real third-party service works unless it says it was tested with real credentials; **none were**.

## Test evidence so far
| Check | Result |
|---|---|
| Backend suite, **Python 3.12.14** (production pin), in-memory | **407 passed, 4 skipped, 0 failed** (before the last parser fixes, see re-run below) |
| Backend suite against a **real MongoDB 7** (throwaway Docker container on port 27018) | In progress; see "Mongo-mode results" |
| Frontend `tsc --noEmit`, `next lint`, `next build` | Pass; 1 pre-existing lint warning |
| Real browser (Playwright, Chromium) against the production build + API + MongoDB | Signup, login, Gigs feed with Upwork leads, import dialog, proposal draft/edit/save/reload, forgot/reset password: verified manually, 2026-11-14 |
| Mobile 390 px: Gigs page, import dialog | No horizontal overflow (checked); other pages not yet audited |

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
| Role label said "Administrator" for every user | **DONE** | Now shows the account's role (not yet re-checked in a browser) |
| Freelancer portal "Open specs/earnings/contracts" | **PENDING / needs decision** | They call demo-only endpoints (`SEED_DEMO_DATA`); real accounts see empty tables and 404s in the console. Finishing the blind-auction/spec marketplace is a product-sized feature |
| Browser crawl of all routes (`npm run qa:crawl`), forms, buttons | **PENDING** | Playwright install in progress |
| Responsive audit of the rest of the app | **PENDING** | |
| Loading/error states review | **PENDING** | |
| README is out of date (says "76 routes, in-memory, DB not connected") | **PENDING** | |
| Stripe, social sign-in, email, Sentry, inbound email with real credentials | **BLOCKED** | Need your accounts/keys; none tested |
| Upwork API path (OAuth) code | **UNTOUCHED** | Still present but off (`UPWORK_COMMERCIAL_APPROVED=false`). You said not to use it; say if you want it removed |

## 5. Decisions and approvals needed from you
1. Sessions: same-site `/api` proxy + HttpOnly cookie (recommended), or keep bearer tokens with the CSP mitigation.
2. Remove the dormant Upwork OAuth/GraphQL code and the Nango Outlook path, or leave it disabled?
3. Production accounts and keys: MongoDB Atlas (paid tier for backups), email provider, Stripe, Groq, Sentry, inbound-email provider.
4. Lawyer review of Terms/Privacy; confirmation that Upwork's terms allow AI-drafted proposals that users submit personally.
5. Which of the demo-only features (agents, arbitrage, spec auctions, client portal) are in scope for launch.
