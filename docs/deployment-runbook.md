# Deployment runbook (staging first, then production)

Status: **new release not deployed.** Existing Vercel and Render production services remain on the earlier `main` revision;
the live Render process has used in-memory storage. Do not restart it or cut over until the owner decides whether its volatile
records need preservation. The integration branch is published for review, but this staging procedure has not run.

## 1. Architecture and what the code guarantees

```
Browser --https--> Vercel (Next.js)  --/api/* rewrite-->  Render (FastAPI)  -->  MongoDB Atlas
```
* The browser only talks to the frontend origin; `next.config.mjs` rewrites `/api/*` to `BACKEND_API_URL`, so the session
  cookie (`autopilot_session`, HttpOnly, SameSite=Lax) is first-party and the CSP stays `connect-src 'self'`.
* **Cookies:** `Secure` is forced in production or when `X-Forwarded-Proto` is https (`app/session.py`); `COOKIE_SECURE=false`
  is refused at startup in production.
* **CORS/CSRF:** only `CORS_ORIGINS` (https, validated at startup) and `PUBLIC_SITE_URL` may send cookie-authenticated unsafe
  requests (Origin check), which also need the `X-CSRF-Token` header bound to the session.
* **Client IP / rate limits:** the website's middleware (`middleware.ts`) signs every `/api` request it proxies with
  `EDGE_SHARED_SECRET` (HMAC over timestamp, method, path and visitor address); the API (`app/edge.py`) verifies it and
  trusts the signed address. A request without a valid proof is "direct": its address is the right-most `X-Forwarded-For`
  entry that Render appends (`TRUSTED_PROXY_HOPS=1`), and with `REQUIRE_EDGE_PROOF=true` direct requests are refused (403)
  except webhooks, health, OAuth callbacks and API keys. uvicorn runs with `--no-proxy-headers`. Counters are shared by every
  API instance through MongoDB (`app/ratelimit.py`). The exact verification is `docs/staging-verification.md`.
* **Startup guards:** production refuses to start with a weak `SECRET_KEY`, no `MONGODB_URI`, non-https/localhost CORS, demo
  data on, insecure cookies, a bad hop count or a rate limit below 60 (`production_problems`), and logs a warning for every
  integration that is off (`production_warnings`). A Vercel production build refuses a missing/non-https `BACKEND_API_URL`
  and `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` (`scripts/deploy-guards.mjs`).

## 2. Accounts and access you need (needs you)
MongoDB Atlas (Project Owner), Render (owner of the workspace), Vercel (owner/admin of the team), the DNS registrar for your
domain, GitHub (repo admin), and for each integration its own account (see `docs/integration-verification.md`).

## 3. Environment variables
Templates (placeholders only): `backend/.env.production.example` (Render) and `.env.production.example` (Vercel). Set values
in the platform dashboards; never commit them and never paste them into chat or tickets.

## 4. Render and Vercel settings (reviewed)
| Item | Setting | Notes |
|---|---|---|
| Render build | `pip install -r requirements.txt` | Python 3.12.7 (`runtime.txt`, `PYTHON_VERSION`) |
| Render start | `uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-proxy-headers` | already in `render.yaml` |
| Render health check | `GET /health` -> 200 `{"status":"ok","database":"ok"}` (503 `degraded` if MongoDB is down) | |
| Render plan | **Not `free`** for anything real | the free plan sleeps after 15 idle minutes and the first request then takes about a minute |
| Auto-deploy | `autoDeploy: false` in `render.yaml`; verify the actual Render dashboard setting before any release | deploy deliberately after CI is green |
| GitHub CI | Manual integration run 45397936608 was blocked before any steps by account payments/spending limit | account owner must restore Actions access and rerun on the final commit before release |
| Vercel Git | Production branch is `main`; Git deployment creation was disabled when the integration branch was published and its preview attempt was `BLOCKED` | recheck project settings before any future push |
| Vercel build | `npm run build`; CI uses Node 22, while the inspected Vercel project reported Node 26.x | align runtime versions and set `BACKEND_API_URL` for **Production and Preview** before staging |
| Vercel timeouts | **unverified:** AI draft calls can take up to about 30 s (`app/llm.py` timeout); confirm they complete through the Vercel rewrite on staging with a real Groq key | if proxied requests time out, move the API behind a custom domain on the same site or shorten/stream the call |
| Request size | Workspace saves are capped at 1 MB by the API | |
| Edge proof secret | `EDGE_SHARED_SECRET` on **both** hosts (same 48+ random characters; Vercel: a server-side variable, Production + Preview; Render: Environment) | generate once with `python3 -c "import secrets;print(secrets.token_urlsafe(48))"`; never `NEXT_PUBLIC_`; a Vercel production build fails without it |
| Edge enforcement | `REQUIRE_EDGE_PROOF=false` until `docs/staging-verification.md` steps 3-4 pass, then `true` | webhooks, health, OAuth callbacks and API keys stay reachable directly |
| Simulated modules | Application default is `invited`; `render.yaml` explicitly sets `SIMULATED_MODULES=all` and `ALLOW_PUBLIC_SIMULATED_MODULES=true` for the demo | confirm the public-demo audience and disclaimers before release; use `invited` to restrict access |
| Freelancer pool bids | Demo blueprint sets `POOL_BID_CREDITS=false` so bidding works without Stripe | set `true` only when paid-credit use is deliberately enabled; checkout still needs Stripe credentials and approval |
| Credit documents | Demo uploads are private, size/type limited and served as forced, uncached downloads | use synthetic files only; real identity/bank files need a storage, scanning, encryption and retention decision |
| Terms | `TERMS_VERSION` / `PRIVACY_VERSION` | bump when the legal text changes; the API then requires everyone to accept again |
| Sentry | `SENTRY_DSN` (Render), `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` (Vercel) | privacy baseline is in code; verify one real event (`integration-verification.md` s.6) |

## 5. Safe staging procedure (needs you for every step that touches an account)
Use a **separate** Atlas database (e.g. `autopilot_staging`, ideally its own project/cluster), a separate Render service and
a separate Vercel project (or a protected Preview deployment). Staging must never share data, secrets or keys with production.

1. **Gate on CI:** CI green on the commit to deploy (see `docs/ci-first-run.md`). Locally: backend memory and MongoDB suites,
   typecheck, lint, build, `npm run test:deploy-guards`, browser e2e.
2. **Atlas (staging):** create the cluster/database and an application user with `readWrite` on that database only; add the
   Render outbound IPs (or `0.0.0.0/0` only temporarily, then tighten) to the IP access list.
3. **Render (staging API):** create the service from `render.yaml` (or a copy with a `-staging` name), set every variable from
   `backend/.env.production.example` with **staging** values (staging domain in `CORS_ORIGINS`/`PUBLIC_SITE_URL`,
   `ENVIRONMENT=production` so the production guards are exercised). Deploy. Check `/health` and the log lines
   `production config: ...` for the warnings you still expect.
4. **Vercel (staging frontend):** set `BACKEND_API_URL=https://<staging-api>` and `ENFORCE_DEPLOY_GUARDS=true`; deploy.
5. **Owner account:** sign up with an address listed in `OWNER_EMAILS`. Confirm the email code arrives (this needs the email
   provider, see integration doc). Create a separate **test** agency account (never a real customer).
6. **Confirm the proxy chain and the edge proof:** follow `docs/staging-verification.md` steps 2-4 (direct hop count, `edgeProof:
   verified` through the site, forged headers). Do not guess `TRUSTED_PROXY_HOPS` (too low shares one rate-limit bucket among
   all users, too high lets a forged header dodge the limits) and do not enable `REQUIRE_EDGE_PROOF` before those steps pass.
7. **Automated smoke check** (prints no secrets; use a throw-away test account):
   ```bash
   STAGING_EMAIL=<test account> STAGING_PASSWORD=<its password> \
   node scripts/ops/staging-check.mjs --web https://<staging-frontend> --api https://<staging-api> \
        --origin https://<staging-frontend> --rate-limit-test
   ```
   Expect every line PASS: security headers, the `/api` proxy, health and `environment=production`, CORS refusing a foreign
   origin, foreign-Origin sign-in refused, session cookie `HttpOnly; Secure; SameSite=Lax`, no token in the sign-in body, CSRF
   enforced, logout revokes the cookie, and a forged `X-Forwarded-For` cannot dodge the credential limit (briefly rate-limits
   your address). The check was verified locally in five proxy topologies; it has **not** run against Vercel/Render yet.
8. **Browser pass on staging with synthetic data:** `scripts/qa/e2e.mjs` needs a local stack (it creates accounts in bulk), so
   on staging do the manual list in `docs/manual-smoke-checklist.md` instead, in a real browser over https: sign up, sign in,
   refresh (session persists), sign out, forgot-password email link, pool workflow, Upwork paste import, AI draft.
9. **Backups:** enable and test (docs/backup-and-monitoring.md) before any real data goes in.
10. **Integrations:** run each procedure in `docs/integration-verification.md` that you intend to launch with.

## 6. Production go-live (needs your explicit approval)
Repeat section 5 with production resources, then: set the production DNS (frontend domain on Vercel; optional API custom
domain on Render), confirm HTTPS certificates are issued, update `CORS_ORIGINS`/`PUBLIC_SITE_URL` to the final domain,
enable uptime monitoring on `/health` and the home page, confirm Sentry receives a test error, confirm a restore drill passed,
then announce. Do not change DNS or deploy without approval.

## 7. Rollback
* Frontend: Vercel -> Deployments -> promote the previous deployment. API: Render -> Deploys -> redeploy the previous commit.
* Data: schema is additive (indexes are created at startup; no destructive migrations). If data is damaged, restore from an
  Atlas snapshot or the archive (see backup doc); never restore over production without stopping the API first.
* A bad `SECRET_KEY` change signs everyone out (revert it); a bad `TRUSTED_PROXY_HOPS` needs only an environment change.

## 8. Known residual risks of this topology
* The API's own `onrender.com` URL stays publicly reachable. With the signed edge proof and `REQUIRE_EDGE_PROOF=true` a
  direct call is refused (webhooks, health, OAuth callbacks and API-key calls excepted: those carry their own secret or
  signature and per-key limits). Until `REQUIRE_EDGE_PROOF` is turned on after staging, direct requests are limited by the
  address Render appends. If `EDGE_SHARED_SECRET` leaks, rotate it (new value plus `EDGE_SHARED_SECRET_PREVIOUS`, redeploy
  both sides, drop the old one). A compromised Vercel project can sign anything: protect the Vercel account (2FA).
* Vercel and Render proxy behaviour (headers, timeouts) is documented by the vendors but unverified here; step 6-7 verify it.

## AutoGig staging configuration

- In Render, set `MONGODB_URI` to the Atlas connection string and `MONGODB_DB` to the **existing** target database name. Confirm the Atlas network access list permits the API and optional queue, and grant the service user access to read, write, and create indexes in that database. Set the same database values on the queue when enabled. Production startup requires MongoDB and checks connectivity and indexes. The live backend reported in-memory storage during the audit. Before restarting or deploying, confirm whether any data in that process needs preservation. Switching to Atlas cannot recover records from an earlier process. The app no longer archives legacy shared state on startup. If the database contains `app_state`, take an encrypted backup and review the existing archive procedure on a disposable copy before scheduling a migration.
- In Render, set `RESEND_API_KEY` and `RESEND_FROM` for a verified sending domain, or configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` and optionally `SMTP_FROM`. Prefer the HTTPS provider on a free instance. With `EMAIL_VERIFICATION=true`, password signup returns a temporary-unavailable response until a provider is configured. Test signup, resend, password recovery, and repeat redemption against a staging mailbox.
- In Render, set `GROQ_API_KEY` and optionally `GROQ_MODEL`. Verify Upwork and Job Radar drafts on staging. Inbound Upwork alerts additionally use `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_WEBHOOK_SECRET` and `INBOUND_EMAIL_PLATFORMS=upwork`. Upwork submission stays manual.
- On Vercel set the server-only `BACKEND_API_URL=https://autopilot-api-ybq7.onrender.com` and `EDGE_SHARED_SECRET` to the same secret configured on Render. The blueprint uses `CORS_ORIGINS` and `PUBLIC_SITE_URL` set to `https://autogig-pi.vercel.app`. On Render confirm `SECRET_KEY`, `OWNER_EMAILS`, and the demo settings `SIMULATED_MODULES=all` and `ALLOW_PUBLIC_SIMULATED_MODULES=true`. Set `REQUIRE_EDGE_PROOF=true` only after a successful signed request on staging. Dashboard values must be checked before deployment.
- Use [Backup and monitoring](backup-and-monitoring.md) to test restoration into a disposable database. Alert on `/health` returning 503, review the Atlas backup policy, and configure `SENTRY_DSN` if error reporting is available.

## Approval gates and client acceptance

1. **Preserve production.** The running Render API reported in-memory storage during the audit. Inventory the data the
   client needs to retain and agree on a supported export or a clean start before any restart. An Atlas URI cannot migrate
   data held by the running process. Keep this cutover separate from code approval.
2. **Prepare staging.** Use a separate Render service, Vercel environment, Atlas database, and provider keys.
   In Atlas allow only the staging Render service's outbound CIDRs and grant a database user `readWrite` on
   `autogig_staging`. Set `MONGODB_URI` to the Atlas `mongodb+srv://` URI and `MONGODB_DB=autogig_staging` on Render.
   Verify an owned sending domain and create a sending-only key in Resend. Set `RESEND_API_KEY`, `RESEND_FROM` from that
   domain, and `EMAIL_VERIFICATION=true`. Set `GROQ_API_KEY`. `GROQ_MODEL` defaults to `openai/gpt-oss-120b`.
3. **Prepare the release configuration.** Use `ENVIRONMENT=production`, a staging-only `SECRET_KEY`,
   `CORS_ORIGINS` and `PUBLIC_SITE_URL` set to the staging frontend's HTTPS origin, and staging `OWNER_EMAILS` on Render.
   Set `BACKEND_API_URL` to the staging API's HTTPS origin and the same `EDGE_SHARED_SECRET` on both hosts.
   Set `TOKEN_PROGRAM_ENABLED=false`, `TOKEN_MAINNET_ENABLED=false`, and `PAYMENTS_CRYPTO_ENABLED=false`. Leave
   `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` unset. Keep provider secrets on Render and use **Save only** until approved.
4. **After staging approval**, deploy matching frontend and API revisions. Verify `/health` returns `database: "ok"`.
   Confirm a synthetic account survives an approved staging restart and run a backup and restore against a disposable
   target. Confirm signup responds identically for new and registered addresses before mailbox proof, code replay is rejected,
   and sign-in and password recovery work through the frontend with a controlled mailbox. Run the signed-edge verification
   from [staging verification](staging-verification.md) before requiring edge proof.
5. **Accept the demo.** With separate synthetic agency, freelancer, investor and owner accounts, run a blind bid through
   award and delivery. Check that exactly one contract and one earning per approved milestone remain after an approved
   staging restart. Reopen a Job Radar detail link after that restart to verify the per-user recent snapshot. Draft a
   proposal from a synthetic Upwork alert and confirm `aiGenerated: true`, and walk a demo
   contribution through credit application, offer, documents, repayment and treasury reconciliation. Verify that a second
   freelancer cannot see or download the first one's records. Test desktop, tablet and mobile. Confirm Fahim's Billing
   and Inbox/Messaging acceptance separately. Provider failures should produce a clear retry or documented fallback.
6. **Approve production and rollback.** Get sign-off on the volatile-data decision, staging checks, and demo-only scope.
   Set production values separately and take a verified archive of any existing persistent database before cutover.
   Pin the last tested Atlas-compatible frontend/API pair and database name. If code must roll back, redeploy that pair
   against the same Atlas database. For data recovery, restore into a fresh database, verify it, and approve switching
   `MONGODB_DB`; keep the old database available. The volatile production build cannot serve as a data rollback.
