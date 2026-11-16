# Staging verification: Vercel to Render headers, cookies, client address and timeouts

**Status: designed and tested locally; not yet run on Vercel or Render** (no accounts or deployments exist). Nothing here
may be skipped by guessing: each step records an observation, and the settings are derived from the observations.
Run it on **staging first** (a separate Vercel project and Render service pointing at a separate database), then repeat the
short checks on production after the first deploy. Never put the secrets below in chat, tickets or logs.

## 0. What is being verified, and why
| Question | Why it matters | Where it is observed |
|---|---|---|
| Does Vercel give the middleware the **real visitor address**, and replace anything a visitor sends in `X-Forwarded-For`, `X-Real-IP`, `X-Vercel-Forwarded-For`? | The signed edge address becomes the client address used for the per-IP rate limits. If a visitor could choose it, the limits are worthless. | step 4 |
| Do **middleware-added request headers reach the Render API** through the rewrite? | The signature travels in those headers. If Vercel drops them, every request looks direct. | step 3 |
| What does the API see for a **direct** request (no proof)? How many addresses does Render append to `X-Forwarded-For`? | Sets `TRUSTED_PROXY_HOPS` for direct requests (expected 1). | step 2 |
| Are the **session cookies** `HttpOnly; Secure; SameSite=Lax; Path=/` on the real domain, and is the CSRF cookie readable by the page? | Session safety. | step 5 |
| How long may a request stay open through Vercel's rewrite? | AI proposal drafts can take 30 s or more. | step 6 |
| Does the API refuse requests that skip the website? | Closes the "public Render URL" bypass (R1). | step 7 |

## 1. Prerequisites (needs you)
* Staging API on Render (paid plan: the free plan sleeps) with the production-like environment (`backend/.env.production.example`):
  `ENVIRONMENT=production`, `MONGODB_URI` for a **staging** database, `CORS_ORIGINS` and `PUBLIC_SITE_URL` = the staging site,
  `OWNER_EMAILS` = your address, `EDGE_SHARED_SECRET` = a fresh random value, `REQUIRE_EDGE_PROOF=false`,
  `TRUSTED_PROXY_HOPS=1`, `ENABLE_DIAG_SLEEP=true` is **refused in production mode**, so for the timeout probe use a staging
  API with `ENVIRONMENT=staging` (everything else the same) or set it only for the duration of step 6 and remove it afterwards.
* Staging site on Vercel with `BACKEND_API_URL=https://<staging-api>`, the **same** `EDGE_SHARED_SECRET` (server-side variable),
  and a production-style build (`ENFORCE_DEPLOY_GUARDS=true` if it is a Preview deployment).
* Two test accounts created through the site: a normal one (`STAGING_EMAIL`/`STAGING_PASSWORD`) and your owner account
  (`STAGING_OWNER_EMAIL`/`STAGING_OWNER_PASSWORD`). Pass them as environment variables only.

## 2. Direct request to the API (no proof): hop count for `TRUSTED_PROXY_HOPS`
From your own machine, with the owner session cookie obtained by signing in **directly** at the API address:
`GET https://<staging-api>/api/diag/request`. Record `clientIp`, `socketPeer`, `xForwardedFor`, `edgeProof`.
* `edgeProof` must be `absent` or `not configured`.
* Compare `xForwardedFor` with your public address (`curl https://api.ipify.org`): the **right-most** entry must be your address.
  If it is, Render appends exactly one entry and `TRUSTED_PROXY_HOPS=1` is right (`clientIp` equals your address).
* If `clientIp` is a private address (10.x, 172.16-31.x) the value is too low or Render adds a hop: raise by one and re-run.
* If your address is not the right-most entry at all, **stop**: do not set the number, and report the observed header.

## 3. Through the website: does the proof arrive?
Sign in to the staging **site** as the owner and call `GET https://<staging-site>/api/diag/request` (browser address bar is
enough once signed in). Expected: `edgeProof: "verified"` and `edgeIp` equal to your public address.
* `edgeProof: "absent"` on the site: Vercel dropped the headers, or `EDGE_SHARED_SECRET` is not set on Vercel. First check
  the variable (Vercel -> Settings -> Environment Variables -> redeploy). If it is set and the proof is still absent, report it:
  the fallback design is a route-handler proxy (`app/api/[...path]/route.ts`), which needs your approval.
* `edgeProof: "invalid signature"`: the two secrets differ (copy/paste, trailing space) or the path differs; re-enter both.
* `edgeProof: "expired"`: the clocks differ by more than 60 s (unlikely) or a cached response; retry.

### 3a. Replay protection (nonce)
Every proxied request carries a single-use `X-Edge-Nonce`; the API refuses a second request with the same nonce (`edgeProof: "replayed"`).
This is proven by unit tests and the local proxy test. On staging, confirm only that normal browsing never produces `replayed`
(browser retries, prefetches and Vercel retries each get a fresh nonce because the middleware runs per request). If `replayed` shows up for a
legitimate page load, stop and report the request path.

## 4. Forged headers sent to the website
`node scripts/ops/staging-check.mjs --web https://<site> --api https://<api> --expect-edge-proof` with the owner variables
set. It sends `X-Forwarded-For: 198.51.100.77`, `X-Real-IP: ...78`, `X-Vercel-Forwarded-For: ...79` to the site and asserts the
API-side `clientIp` is not any of them. It prints the observed `clientIp`; it must be your public address. **If Vercel passes
a visitor-supplied header through, the check fails: stop and report; do not enable `REQUIRE_EDGE_PROOF`.**

## 5. Cookies and CSRF
The same script (with `STAGING_EMAIL`/`PASSWORD`) checks, on the real domain: `autopilot_session` is `HttpOnly; Secure;
SameSite=Lax; Path=/`, `autopilot_csrf` is `Secure` and not `HttpOnly`, the sign-in body carries no token, an unsafe request
without `X-CSRF-Token` is refused, a foreign `Origin` is refused, a logged-out cookie is rejected on replay.
Manually, in a real browser: sign in, open DevTools -> Application -> Cookies for the site, confirm the same flags, sign in
on a second browser and "sign out everywhere", confirm the first session ends.

## 6. Timeouts
`ENABLE_DIAG_SLEEP=true` on the staging API, then
`node scripts/ops/staging-check.mjs --web https://<site> --timeout-probe 30` (and `60` if 30 passes). The script asks the API
to hold a request open and reports how long the proxy allowed. Record the seconds. Then generate a real AI proposal on staging
(needs `GROQ_API_KEY`) and note its duration. **Pass:** the proposal duration plus a safety margin is below the proven limit.
If the limit is lower than a typical draft, the draft call must be made asynchronous (not built); report the numbers.
Remove `ENABLE_DIAG_SLEEP` afterwards.
Also record the cold-start time of the API after 20 idle minutes if you stay on a plan that sleeps.

## 7. Enforce the proof (R1), then re-check
Only when steps 3 and 4 passed: set `REQUIRE_EDGE_PROOF=true` on the staging API and redeploy.
`node scripts/ops/staging-check.mjs --web https://<site> --api https://<api> --expect-edge-proof` must now also show:
a direct request to the API address answers `403`, a forged signature answers `403`, the same request through the site
reaches the API (`401` for a wrong password, not `403`), and headers a visitor sends to the site are replaced, not forwarded.
Confirm by hand that these still work: the inbound-email webhook, the Stripe webhook (if used), OAuth callbacks (they are
allow-listed), and an API key call from a script.

## 8. Rate-limit check
`--rate-limit-test` (it briefly rate-limits your own address): rotating forged `X-Forwarded-For` values must still produce
`429`. Then sign in from a second network (phone hotspot) and confirm that network is **not** limited by the first one's
attempts (separate budgets prove the per-visitor address is used, not the proxy's).

## 9. Decision table: what to set from what you saw
| Observation | Setting |
|---|---|
| Step 2: your address is the right-most entry, one proxy | `TRUSTED_PROXY_HOPS=1` (already the default) |
| Step 3 verified, step 4 passes | `REQUIRE_EDGE_PROOF=true` |
| Step 3 absent after the secrets match | keep `REQUIRE_EDGE_PROOF=false`; ask for the route-handler proxy design |
| Step 4: visitor-supplied header accepted | do **not** enforce; per-IP limits are not trustworthy through that path; report |
| Step 6: proxy limit shorter than a draft | draft generation needs a background job design; report numbers |
| Anything unexpected | stop, keep the strictest current setting, report the raw `GET /api/diag/request` output (no secrets in it) |

## 10. Record
Keep a dated table (`date | environment | who | step | observed | result`) in your private notes or the repository wiki, and
copy the final numbers into `docs/production-readiness.md`. An item stays "not verified" until its row exists.

## 11. Status (2026-11-16)
Still **not run on Vercel or Render**; no staging exists. Local evidence only: unit tests (edge proof, replay, rate limit), a real-proxy local test and the Chromium suite with `REQUIRE_EDGE_PROOF=true`. No row of section 10 has been recorded. `REQUIRE_EDGE_PROOF` must stay `false` in production until sections 3 and 4 have passed on real hosts.
