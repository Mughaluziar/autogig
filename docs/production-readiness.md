# Production-readiness register

**The platform is NOT declared production-ready.** This register lists every remaining blocker, who can clear it, and what was
actually verified. Baseline `75cc719`. Two local passes so far (first ending `b682cb7`, second below). Nothing was deployed, pushed or run against production data.

Legend: **L** = I can complete it locally (done unless noted) · **X** = needs external credentials/account access ·
**A** = needs your approval · **P** = needs a lawyer or other professional.

## 1. Audit findings and what was done about each
| # | Finding (evidence) | Class | Status |
|---|---|---|---|
| 1 | **Rate limits could be dodged by forging `X-Forwarded-For`.** `render.yaml` ran uvicorn with `--forwarded-allow-ips='*'`, which trusts the *leftmost* entry; reproduced (a forged header changed `client.host`). | L | **Fixed in pass 1** (`--no-proxy-headers`, right-hand `X-Forwarded-For` entry), **and replaced in pass 2 by a signed edge proof** (R1 below), which removes the dependency on guessing the proxy count for website traffic. |
| 2 | Production CORS list included `http://localhost:3000`; no check that origins are https. | L | **Fixed:** production refuses non-https origins/site URL. |
| 3 | Production started silently with demo data on, insecure cookies forced, absurd rate limit, or no email provider (verification then skipped, reset links undeliverable). | L | **Fixed:** startup refuses demo data / `COOKIE_SECURE=false` / bad hop count / limit < 60; logs a warning per missing integration. 14 tests. |
| 4 | A Vercel production build with no backend URL silently became the unauthenticated frontend-only demo (and `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` would sign everyone in as admin). | L | **Fixed:** the build refuses both (`scripts/deploy-guards.mjs`, 5 tests, verified against the real config loader). |
| 5 | `render.yaml`: `autoDeploy: true`, no owner/email variables, stale proxy flags. | L | **Fixed.** Env templates added (`backend/.env.production.example`, `.env.production.example`). |
| 6 | **Dependency vulnerabilities.** `npm audit`: Next.js 14.2.35 had 1 critical + several high advisories (image-optimizer RCE, DoS, SSRF, request smuggling) with fixes only in 15.5.x+; backend: 23 advisories in 6 packages (Starlette, cryptography, PyMongo, ...). | L | **Fixed within the 15.x line:** Next 15.5.29 + React 19 (after the async `params`/`searchParams` migration), `next-themes` 0.4.6, `recharts` 2.15.4; image optimizer disabled (`/_next/image` now 404; no page used it). Backend upgraded and pinned (FastAPI 0.162.7, Starlette 1.10.0, cryptography 50.0.2, PyMongo 4.20.0, ...): `pip-audit` reports **no known vulnerabilities**. Frontend `npm audit` now: **0 critical**, 4 high + 6 moderate remaining, all build-time tooling (PostCSS bundled in Next, Sentry's build plugin, glob/minimatch) or the optional Nango browser SDK's `axios`; fixing those needs major upgrades (Next 16, Sentry 11, Nango 0.72). See R4. |
| 7 | CI would have failed on the first GitHub run: `npm run qa` flagged the corrected Terms ("not ... an escrow agent") as an escrow promise. | L | **Fixed** (rule only flags an affirmative claim; verified it still catches one). |
| 8 | Public Terms/Privacy pages contained "placeholder content for the frontend phase". | L / P | Placeholder text removed; a visible "Draft, not reviewed by a lawyer" notice added. Legal substance unchanged and **not approved** (P). |
| 9 | No secrets in the repository: pattern scan of all tracked files and history found only placeholders (`sk_live_` appears in docs and a masked demo seed row; the real-looking key removed earlier). No `.env` tracked. | L | Verified. |
| 10 | Frontend-only demo mode exists by design (`NEXT_PUBLIC_DEV_BYPASS_AUTH`, no backend URL); `.playwright-mcp/` is git-ignored. | L | Guarded by finding 4. |
| 11 | Backups: scripts existed but had only a user-count check. | L | **Verified end to end** on a disposable MongoDB (45 collections / 128 indexes / 28 documents identical; app boots on the restored copy and signs in). `verify_restore.py` and `restore-drill.sh` added. |
| 12 | Existing-data compatibility: indexes are created at API startup (73 `create_index` calls); no destructive migration exists. | L | Verified on fresh databases and on the restored copy. **Not verified against a pre-existing production-shaped database** (none exists yet). |
| 13 | **R1: the public Render URL could be used around the website; forged forwarded headers.** | L (staging step X) | **Implemented and verified locally.** `middleware.ts` signs each proxied `/api` request (HMAC over timestamp, method, path, visitor address) with `EDGE_SHARED_SECRET`, a server-only variable; `app/edge.py` verifies it (60 s skew, constant-time compare, current + previous secret for rotation). A verified request's address is trusted; others are "direct" (Render-appended address, `TRUSTED_PROXY_HOPS=1`). `REQUIRE_EDGE_PROOF=true` refuses direct requests (webhooks, health, OAuth callbacks and API keys excepted). Verified on `next start` + the real API: direct 403, via site 401/200, visitor-sent `X-Edge-*` replaced, JS and Python signatures identical on a shared test vector. A Vercel production build refuses to ship without the secret. **Not verified: Vercel passing middleware headers to the external rewrite and overwriting visitor `X-Forwarded-For`**: `docs/staging-verification.md` steps 3-4. |
| 14 | **R2: per-IP counters in process memory (a second instance doubled every limit; a restart reset them).** | L | **Fixed.** `app/ratelimit.py`: MongoDB counters (general: one atomic `$inc` per request in a fixed one-minute window; credential endpoints: exact sliding log in one atomic pipeline update) with TTL; degrades to process memory (logged) if MongoDB errors; production refuses `RATE_LIMIT_BACKEND=memory` unless `SINGLE_INSTANCE=true`. Verified with two real API processes on one database (24 wrong logins split across both: exactly 20 allowed, 4 blocked), a second connection seeing the same budget, and an outage test. Cost: one small write per request; no new service. Redis stays a drop-in option if volume grows. |
| 15 | **Stealth mode** (impersonation, typos, no AI disclosure) in the header, Settings, AI Disclosure and the demo agent's description. | L | **Removed completely** (toggle, provider, setting, wording; the demo agent is now "Client Comms Manager", AI-assisted and disclosed). A QA rule fails the build if the wording returns. Personas still exist as working names; wording says AI assistance is never hidden. |
| 16 | **Privacy text promised export and deletion that did not exist; other claims were untrue.** | L / P | **Built:** self-service export and scheduled deletion (see `docs/data-lifecycle.md`); Privacy/Terms pages rewritten to what the product does. Draft notice stays; **not approved by a lawyer**. |
| 17 | **Terms acceptance was a client-side checkbox only.** | L | **Recorded server-side**: append-only `terms_acceptances` (user id, versions, UTC time, method); re-accept screen when `TERMS_VERSION`/`PRIVACY_VERSION` change; social-sign-in accounts are asked at first visit. |
| 18 | **Simulated money modules visible to every user.** | L | **Restricted:** `SIMULATED_MODULES=invited` is the production default (owners + accounts an owner invites); production refuses `all` without an explicit opt-in; nav, cover-offer polling and pages respect it; pages explain "by invitation, no real money". |
| 19 | **R4: npm advisories.** | L / A | `axios` (never loaded, types-only) and the PostCSS copy inside Next fixed with same-major overrides: production audit now **0 critical, 0 high, 5 moderate** (all one Sentry build-plugin chain). `docs/npm-advisories.md` has every advisory, reachability and the upgrade analysis. Sentry 11 clears the rest but changes data-collection defaults (privacy): **awaiting your approval**. Next 16 and Nango 0.72 are not needed. |
| 20 | **R3: no way to verify the Vercel to Render chain.** | L (run: X) | `docs/staging-verification.md`, extra checks in `scripts/ops/staging-check.mjs` (owner diagnostics, forged headers, edge-proof expectations, timeout probe), owner-only `/api/diag/request` and a staging-only `/api/diag/sleep`. **Not run on real infrastructure.** |

## 2. Blockers that remain (classified)
| Blocker | Class | What clears it |
|---|---|---|
| Atlas cluster, Cloud Backup + PITR, restore drill on Atlas | X, A (cost) | docs/backup-and-monitoring.md section 3 |
| Render API (paid plan) and Vercel project; staging then production; DNS and HTTPS | X, A | docs/deployment-runbook.md |
| Run `docs/staging-verification.md` on real Vercel + Render (edge proof arrives, visitor headers overwritten, hop count 1, then `REQUIRE_EDGE_PROOF=true`) | X | you create staging; I (or you) run the script |
| Confirm AI draft calls complete through the Vercel rewrite (proxy timeout) | X | `staging-verification.md` step 6 |
| Email provider + verified domain (password reset, verification codes) | X | docs/integration-verification.md section 1 |
| Groq key and real-output check | X | section 2 |
| Inbound email provider, DNS, 3-5 real Upwork alert emails for the parser | X | section 3 |
| Stripe live payments (only if wanted), webhooks, licensing | X, A, P | section 4; nothing live without approval |
| Social sign-in apps, Sentry, Outlook/Nango (optional) | X | sections 5-7 |
| Uptime monitoring | X | backup doc section 5 |
| First GitHub Actions run, branch protection, billing allowance | X, A | docs/ci-first-run.md |
| Terms, Privacy, AI Disclosure; money/licensing questions; data-protection regime | P | docs/legal-review-questions.md |
| Lawyer review of the rewritten Privacy/Terms and of the data lifecycle (retention period for kept records is a **placeholder of 7 years**; 14-day grace; shared business text kept; processor deletion; acceptance evidence) | P | `docs/legal-review-questions.md` questions 1-22 |
| Decide launch posture for the invitation-only simulated modules (who is invited, what disclaimer investors see) | A, P | owner decision + lawyer (question 21) |
| Personas feature (working names for AI agents): decide whether outbound messages need an explicit AI disclosure line | A, P | owner decision |
| Self-service correction of name/email does not exist (only export and delete) | A (a feature) | decide if needed for launch |
| Sentry 11 (clears the last 5 moderate production advisories; sets data-collection defaults, needs a DSN to verify) | A, X | approve; then verify on staging (`docs/npm-advisories.md`) |

## 3. Residual security and operational risks (not fixed)
* **R1 (reduced, not closed): unverified on real Vercel/Render.** The signed-proof design works locally. If Vercel does not pass
  middleware-added headers to the rewrite, or does not overwrite visitor `X-Forwarded-For`, the proof will be absent and the
  fallback is a route-handler proxy (needs your approval). A leaked `EDGE_SHARED_SECRET` lets a caller forge addresses until it is
  rotated; a compromised Vercel project can sign anything. Until `REQUIRE_EDGE_PROOF=true` is set after staging, direct calls to
  the Render URL are still accepted (limited by the address Render appends). Webhook, health, OAuth-callback and API-key
  routes are reachable directly by design (own secrets/limits).
* **R2 (closed locally): counters are shared** through MongoDB. Residual: a fixed-window burst can reach 2x the general limit at a
  window boundary; if MongoDB errors the counters degrade to per-process memory (logged); one extra small write per request.
* **R3 (open): vendor behaviour unverified** (Vercel/Render headers, rewrite timeouts, cold starts on a sleeping plan).
* **R4 (reduced): 5 moderate production advisories left** in the Sentry build plugin chain (build-time only); fix = Sentry 11 (approval).
* **R5: parsers and AI quality unverified on real data** (Upwork alert parser, Groq output); prompt-injection handling tested on synthetic text only.
* **R6 (reduced): simulated money features** are hidden from ordinary users in production by default and labelled where shown; payouts are only recorded.
* **R7: legal exposure** until the lawyer items are done. The product no longer promises features it lacks, but the texts are drafts.
* **R8: no automated browser test in CI;** the browser suite (now 260+ checks) runs locally.
* **R9: backup restore time on production-sized data is unknown;** the Mongo CI job is slow (about 45 min).
* **R10 (new): deletion edge cases.** Free text a user wrote inside a record shared with another person (contract titles, bid notes,
  messages to a counterparty) stays as written; third-party processors are not asked to delete; Atlas backups keep deleted data
  until they expire; `app_state_backup` (if the legacy shared document was ever archived) is not touched.
* **R11 (new): the in-process housekeeping job** (hourly) runs deletions; with several instances every step is idempotent but runs
  redundantly. A stuck job is visible in the logs and `POST /api/admin/deletions/run` does the same on demand.

## 4. Required credentials and external services (names only, never values)
MongoDB Atlas (project owner), Render, Vercel, DNS registrar, GitHub, an email provider (Resend or SMTP) with a verified domain,
Groq API key, an inbound-email provider (Postmark/Mailgun/SendGrid/Cloudflare) plus domain, Sentry projects, an uptime monitor;
optional: Stripe, Google/GitHub/Microsoft/Apple developer apps, Nango and a Microsoft app registration.

## 5. Environment variables and migrations
Variables: see `backend/.env.production.example` and `.env.production.example`. Pass 1: `TRUSTED_PROXY_HOPS`, `PUBLIC_SITE_URL`,
`ENFORCE_DEPLOY_GUARDS` / `ALLOW_FRONTEND_ONLY_DEMO`. **Pass 2 (new):** `EDGE_SHARED_SECRET` (+ `_PREVIOUS`) on **both** the API and the
website, `REQUIRE_EDGE_PROOF`, `RATE_LIMIT_BACKEND`, `SINGLE_INSTANCE`, `SIMULATED_MODULES`, `ALLOW_PUBLIC_SIMULATED_MODULES`,
`TERMS_VERSION`, `PRIVACY_VERSION`, `REQUIRE_TERMS_ACCEPTANCE`, `DELETION_GRACE_DAYS`, `FINANCIAL_RETENTION_YEARS`, `DELETION_RUNNER`,
`ENABLE_DIAG_SLEEP` (staging only), `ALLOW_NO_EDGE_PROOF` (website build). **Database changes:** new collections `terms_acceptances`,
`data_requests`, `deleted_accounts`, `rate_limits` and indexes on `users.id`, created at startup; user documents may gain
`terms_accepted`, `deletion_scheduled_for`, `simulated_access`. No collection is dropped or rewritten; existing documents keep working.
