# Production-readiness register

**The platform is NOT declared production-ready.** This register lists every remaining blocker, who can clear it, and what was
actually verified. Baseline `75cc719`; this pass built on `82c454c`. Nothing was deployed, pushed or run against production data.

Legend: **L** = I can complete it locally (done unless noted) · **X** = needs external credentials/account access ·
**A** = needs your approval · **P** = needs a lawyer or other professional.

## 1. Audit findings and what was done about each
| # | Finding (evidence) | Class | Status |
|---|---|---|---|
| 1 | **Rate limits could be dodged by forging `X-Forwarded-For`.** `render.yaml` ran uvicorn with `--forwarded-allow-ips='*'`, which trusts the *leftmost* entry; reproduced (a forged header changed `client.host`). | L | **Fixed.** `--no-proxy-headers`; the app picks the client from the right-hand end (`TRUSTED_PROXY_HOPS`, `app/security.py`); 10 tests; verified in five proxy topologies with `scripts/ops/staging-check.mjs`. Residual risk below (R1). |
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

## 2. Blockers that remain (classified)
| Blocker | Class | What clears it |
|---|---|---|
| Atlas cluster, Cloud Backup + PITR, restore drill on Atlas | X, A (cost) | docs/backup-and-monitoring.md section 3 |
| Render API (paid plan) and Vercel project; staging then production; DNS and HTTPS | X, A | docs/deployment-runbook.md |
| Confirm `TRUSTED_PROXY_HOPS` and header behaviour on the real Vercel to Render chain; run `staging-check.mjs` on staging | X | runbook steps 6-7 |
| Confirm AI draft calls complete through the Vercel rewrite (proxy timeout) | X | runbook section 4 |
| Email provider + verified domain (password reset, verification codes) | X | docs/integration-verification.md section 1 |
| Groq key and real-output check | X | section 2 |
| Inbound email provider, DNS, 3-5 real Upwork alert emails for the parser | X | section 3 |
| Stripe live payments (only if wanted), webhooks, licensing | X, A, P | section 4; nothing live without approval |
| Social sign-in apps, Sentry, Outlook/Nango (optional) | X | sections 5-7 |
| Uptime monitoring | X | backup doc section 5 |
| First GitHub Actions run, branch protection, billing allowance | X, A | docs/ci-first-run.md |
| Terms, Privacy, AI Disclosure; money/licensing questions; data-protection regime | P | docs/legal-review-questions.md |
| **Account deletion / data export** promised in the Privacy text does not exist | A (a feature) or P | build it, or run a manual process with a stated deadline |
| **"Stealth mode" toggle** (impersonation, typos, no AI disclosure) is advertised in the header and Settings; browser-only, no server effect; conflicts with the no-stealth rule | A | recommend removing it |
| Terms acceptance is not recorded (checkbox only on the client) | A (a feature), P | store version + timestamp |
| Decide which Coming-soon modules (Banking, Marketplace, Capital are simulated) are visible at launch | A | owner decision |
| Remaining npm advisories (build-time/optional): Next 16, Sentry 11, Nango 0.72 majors | A | approve a separate upgrade pass |

## 3. Residual security and operational risks (not fixed)
* **R1: API reachable around the proxy.** The Render URL stays public. With `TRUSTED_PROXY_HOPS=2` a caller who talks to
  Render directly can add one extra forged `X-Forwarded-For` entry and dodge the per-IP limits (best effort only). Not
  IP-dependent: the per-email lockout (MongoDB), CSRF/Origin checks, session revocation. Hardening options not built: a shared
  secret header injected by a Next middleware, or a custom API domain with the default URL disabled.
* **R2: per-IP counters are in process memory** (one API instance assumed; a second instance would have separate budgets).
* **R3: vendor proxy behaviour unverified** (Vercel/Render header handling, rewrite timeouts, cold starts on the free plan).
* **R4: remaining dependency advisories** listed in finding 6; not reachable from user input in the current code paths, but
  they should be cleared in a planned upgrade.
* **R5: parsers and AI quality unverified on real data** (Upwork alert parser, Groq output); prompt-injection handling is
  tested only against synthetic text.
* **R6: simulated money features** can mislead if shown to real users without the existing labels; payouts are only recorded.
* **R7: legal exposure** until P items are done: promises about deletion/export, QA gates, NDA shielding, stealth mode.
* **R8: no automated browser test in CI;** the 233-check suite is local only.
* **R9: backup restore time on production-sized data is unknown;** the Mongo CI job is slow (about 45 min).

## 4. Required credentials and external services (names only, never values)
MongoDB Atlas (project owner), Render, Vercel, DNS registrar, GitHub, an email provider (Resend or SMTP) with a verified domain,
Groq API key, an inbound-email provider (Postmark/Mailgun/SendGrid/Cloudflare) plus domain, Sentry projects, an uptime monitor;
optional: Stripe, Google/GitHub/Microsoft/Apple developer apps, Nango and a Microsoft app registration.

## 5. Environment variables and migrations
Variables: see `backend/.env.production.example` and `.env.production.example`. New this pass: `TRUSTED_PROXY_HOPS` (required to
be correct), `PUBLIC_SITE_URL` (https, now validated), `ENFORCE_DEPLOY_GUARDS` / `ALLOW_FRONTEND_ONLY_DEMO` (frontend build
guards). Database migrations: **none**; indexes are created at startup; no collection is dropped or rewritten.
