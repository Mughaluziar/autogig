# Security architecture and data-rights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining production blockers that can be handled locally: no stealth mode, recorded Terms acceptance, real data export and deletion, restricted simulated money modules, a trusted-edge proof for the API (R1), shared rate-limit storage (R2), a staging procedure (R3), an advisory investigation (R4), and the legal pack (R7).

**Architecture:** Backend (FastAPI + MongoDB, in-memory fallback for tests) gains three small modules: `terms.py` (acceptance records), `datarights.py` (a classified data map plus export/deletion services), and `edge.py` (signed edge proof; **blocked until you approve section A**). The Next.js frontend gains a middleware that signs proxied `/api` requests with a server-only secret. Rate limiting moves behind a small store interface with a MongoDB implementation (**blocked until you approve section B**).

**Tech Stack:** FastAPI, Motor/PyMongo, pytest (memory and real MongoDB via `TEST_MONGODB_URI`), Next.js 15 middleware, Playwright e2e (`scripts/qa/e2e.mjs`).

**Spec:** your message of 2026-11-14 ("I have reviewed the production-readiness report. Proceed...", decisions 1-12) and `docs/production-readiness.md`.

## Global Constraints
- No push, no deploy, no DNS, no production data, no paid service, no Stripe, no change to tag `baseline-as-received`.
- Existing features keep working; every change ships with tests; the full suite (memory, genuine MongoDB, e2e, typecheck, lint, build, qa gapcheck) is re-run at the end.
- No secret value in code, docs, logs or reports. The edge secret exists only as a server-side environment variable.
- Legal documents are never declared compliant or approved. Retention periods are configuration with a placeholder default and a lawyer question.
- Upwork stays human-in-the-loop; nothing here adds automation of any account.
- Commits are local, logical, with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus
1. Export of user A must never contain a record that belongs to user B (including the counterparty on a shared contract beyond what A already sees).
2. Deleting an agency owner who still has team members or open contracts must be refused, not half-done.
3. Deletion must not leave a login path (sessions, API keys, OAuth identities, reset tokens, invite links) alive.
4. A request replayed, or sent directly to the Render URL with a forged `X-Forwarded-For`, must not receive the client-IP trust of a proxied request.
5. A second API instance (or restart) must not reset a rate-limit counter or a lockout.

---

## Section A: R1 architecture proposal (needs your approval before any code)

**Problem.** `TRUSTED_PROXY_HOPS=2` assumes the chain browser -> Vercel -> Render. Anyone who calls the Render URL directly can append one forged entry and choose their own "client IP". Guessing the hop count is also fragile.

**Proposal: signed edge proof.**
1. Next.js `middleware.ts` runs on Vercel only for `/api/*`. It reads the real client address from Vercel's own header (`x-forwarded-for` as set by Vercel's edge, which overwrites caller values; confirmed on staging, see Task 9), and sends the rewrite upstream with three extra request headers: `X-Edge-Ts` (unix seconds), `X-Edge-Ip` (client IP), `X-Edge-Sig` = hex HMAC-SHA256(`EDGE_SHARED_SECRET`, `ts \n METHOD \n path+query \n ip`). The secret is a server-only env var (no `NEXT_PUBLIC_` prefix), is used only inside middleware, and is never put in a response header, cookie or page, so browser JavaScript cannot read it.
2. The API middleware `edge.py` verifies the signature with `hmac.compare_digest`, rejects timestamps more than 60 s off, and on success sets `request.state.client_ip = X-Edge-Ip`. Verified requests therefore need no hop guessing.
3. Requests without a valid proof are **direct**. Their client IP is the right-most `X-Forwarded-For` entry (Render's load balancer appends the real peer, so hops = 1; verified by `staging-check` on Render alone). With `REQUIRE_EDGE_PROOF=true` the API additionally answers `403` to direct requests on browser-facing routes, with an allowlist for machine callers that legitimately come straight from outside: `/health`, `/api/inbox/inbound`, `/api/payments/stripe/webhook`, `/api/orders/webhooks/nango`, OAuth callbacks, and personal API keys (`apk_`, which are already rate-limited per key).
4. Rotation: `EDGE_SHARED_SECRET` and `EDGE_SHARED_SECRET_PREVIOUS` are both accepted; rotate by setting new+previous, redeploying both sides, then dropping previous.
5. Failure modes: secret mismatch -> everything looks direct -> with `REQUIRE_EDGE_PROOF=true` the site returns 403 (loud, safe); with it false it degrades to hops=1 limits.
6. Not solved by this: a leaked secret (rotate), a compromised Vercel project. A custom API domain with the default Render URL disabled is a complementary option you can choose later.

**Open point I cannot test locally:** whether Vercel passes middleware-added request headers to an external rewrite destination. Locally I verify it on self-hosted `next start` with a stub upstream; the Vercel behaviour is verified on staging (Task 9). Fallback if Vercel drops them: a route-handler proxy at `app/api/[...path]/route.ts` (adds a timeout and body-size responsibility; I would ask before doing it).

**Effort:** about 1 day including tests. **Cost:** none.

## Section B: R2 recommendation and estimate (needs your approval before any code)

| Option | Fit | Cost | Effort | Risk |
|---|---|---|---|---|
| In-process (today) | single instance only | none | 0 | a second instance doubles every limit; restart resets limits |
| **MongoDB fixed-window counters (recommended now)** | N instances, no new infrastructure | none beyond Atlas | about 0.5-1 day | one atomic upsert per request (about 1-3 ms on Atlas, plus Atlas write load); counters in a TTL collection |
| Redis (Render Key Value / Upstash) | best throughput, native expiry | a paid or free-tier service (needs your approval and account) | about 1 day plus provisioning | new moving part and credentials |

Design: `RateLimitStore` interface (`hit(key, window_s, limit) -> (allowed, retry_after)`) with `MemoryStore` (tests, local) and `MongoStore` (`update_one({_id: f"{key}:{window_start}"}, {$inc:{n:1}, $setOnInsert:{expireAt}}, upsert=True)` returning the new count; TTL index on `expireAt`). Auth endpoints use it with the strict budget; the general per-IP limit uses it too, with a documented fixed-window burst (up to 2x at a boundary). If MongoDB errors, auth limits **fail closed to the in-process counter** (degraded but still limiting) and a warning is logged. Production startup refuses `RATE_LIMIT_BACKEND=memory` unless `SINGLE_INSTANCE=true` is set explicitly. Move to Redis later only if request volume makes the per-request write a cost problem; the interface makes that a swap.

---

## File Structure
- Create `backend/app/terms.py`: acceptance records and current document versions.
- Create `backend/app/datarights.py`: data map (`DATA_MAP`), `build_export(user)`, `plan_deletion(user)`, `execute_deletion(user_id)`.
- Create `backend/app/routers/me.py`: `/api/me/terms`, `/api/me/export`, `/api/me/deletion` (request, cancel, status).
- Create `backend/app/modules_gate.py`: simulated-modules access dependency.
- Create (blocked) `backend/app/edge.py`, `backend/app/ratelimit.py`, `middleware.ts`.
- Modify `backend/app/config.py`, `main.py`, `security.py`, `routers/auth.py`, `routers/banking.py`, `marketplace.py`, `capital.py`, `token.py`, `routers/admin.py`.
- Modify frontend: `lib/app-mode.tsx` (delete), `components/dashboard/dashboard-shell.tsx`, `app/dashboard/settings/page.tsx`, `app/dashboard/personas/page.tsx`, `app/(marketing)/legal/*`, sign-up pages, `lib/api.ts` auth types, nav.
- Create `docs/data-lifecycle.md` (exactly what is exported, deleted, anonymized, retained), `docs/npm-advisories.md`, `docs/staging-verification.md`.
- Tests: `backend/tests/test_terms.py`, `test_datarights_export.py`, `test_datarights_delete.py`, `test_modules_gate.py`, `test_data_map_complete.py` (and blocked `test_edge.py`, `test_ratelimit.py`); e2e additions in `scripts/qa/e2e.mjs`.

---

### Task 1: Remove stealth mode completely
**Files:** delete `lib/app-mode.tsx`; modify `components/dashboard/dashboard-shell.tsx:~221`, `app/dashboard/settings/page.tsx:~98-115`, `app/dashboard/personas/page.tsx:~58`, `app/(marketing)/legal/ai-disclosure/page.tsx:16-20`, `app/providers.tsx` (provider), `lib/demo-engine.ts`, `lib/mock-data.ts`, `backend/app/seed.py`, `backend/app/routers/demo.py` (agent "Stealth Client Manager": rename to "Client Comms Manager" and describe it as AI-assisted with disclosure, not "human-persona"); modify `scripts/qa/gapcheck.mjs`.
**Interfaces:** Produces a gapcheck rule `no-concealment` that fails on `stealth`, `impersonat`, `no AI disclosure` outside `docs/` and tests.
- [ ] Step 1: Add the gapcheck rule; run `npm run qa`; expect FAIL listing the current hits.
- [ ] Step 2: Remove the toggle, `AppMode` provider, localStorage key, Settings card, persona-page badge; rewrite the AI Disclosure section to state AI assistance is always disclosed to users and that no feature conceals it (draft notice kept).
- [ ] Step 3: Rename the demo agent in frontend and backend seeds; update any test or e2e expectation that names it or the toggle.
- [ ] Step 4: Run `npm run typecheck && npm run qa`; expect PASS with zero concealment hits.
- [ ] Step 5: Commit `feat: remove stealth mode and concealment wording`.

### Task 2: Server-side Terms acceptance
**Files:** create `backend/app/terms.py`, `backend/app/routers/me.py` (terms part); modify `config.py` (`terms_version`, `privacy_version`, default `"draft-2026-11-14"`), `routers/auth.py` (signup, OAuth completion, `/auth/me`), frontend sign-up and a re-accept gate.
**Interfaces:**
- `terms.CURRENT: dict[str,str]` = `{"terms": settings.terms_version, "privacy": settings.privacy_version}`
- `async terms.record(user_id: str, method: Literal["signup","oauth","reaccept"], request: Request) -> dict` stores `{id, user_id, terms_version, privacy_version, accepted_at (UTC), method}`; no IP or user-agent is stored (data minimisation; a lawyer may require them: listed question).
- `async terms.status(user_id: str) -> {"accepted": bool, "acceptedVersions": dict|None, "current": dict, "needsAcceptance": bool}`
- `POST /api/me/terms/accept` body `{"terms": str, "privacy": str}` must equal CURRENT or `409`.
- `/auth/me` and the login response include `needsTermsAcceptance`.
- [ ] Step 1: Write failing tests in `test_terms.py`: `test_signup_without_acceptance_rejected` (422), `test_signup_records_acceptance` (record has current versions and a UTC timestamp), `test_wrong_version_rejected_409`, `test_existing_user_flagged_needs_acceptance`, `test_accept_clears_flag`, `test_acceptance_history_is_append_only_and_per_user`, `test_oauth_signup_requires_acceptance`.
- [ ] Step 2: Run `pytest backend/tests/test_terms.py -v`; expect FAIL.
- [ ] Step 3: Implement the module, collection `terms_acceptances` (index `(user_id, accepted_at)`), signup/OAuth changes; existing users are not blocked from read-only data-rights endpoints while pending.
- [ ] Step 4: Frontend: required checkbox sends `acceptedTerms` with the displayed version; a full-screen gate for `needsTermsAcceptance`; e2e step for both.
- [ ] Step 5: Run tests (memory, then `TEST_MONGODB_URI`); expect PASS; commit `feat(legal): record terms and privacy acceptance server-side`.

### Task 3: Restrict simulated modules (Banking, Marketplace, Capital, Token)
**Files:** create `backend/app/modules_gate.py`; modify the four routers (router-level dependency), `config.py`, `routers/admin.py` (grant/revoke), `/auth/me`, frontend navigation.
**Interfaces:**
- Setting `SIMULATED_MODULES` in `{"off","invited","all"}`; default **`invited`** in production and `all` outside production; production refuses `all` unless `ALLOW_PUBLIC_SIMULATED_MODULES=true`.
- `modules_gate.require_simulated_access` (FastAPI dependency): allowed for owners, or users whose user doc has `simulatedAccess: true`; otherwise `403 {"detail": "This module is a demonstration and is not available to your account."}`.
- `POST /api/admin/users/{id}/simulated-access` body `{"enabled": bool}`, owner only, audited.
- `/auth/me` returns `modules: {"simulated": bool}`; the nav hides the four entries and each page shows the existing "simulated, no real money" banner when visible.
- [ ] Step 1: Failing tests in `test_modules_gate.py`: ordinary user gets 403 on one route per module in `invited` mode; granted user passes; owner passes; `off` blocks even owners' non-owner roles? (owner still passes); `all` passes everyone; grant/revoke audited; non-owner cannot grant; production config refuses `all` without the opt-in.
- [ ] Step 2: Run, expect FAIL; implement; run, expect PASS.
- [ ] Step 3: Frontend nav gating plus e2e (ordinary investor does not see the entries; granted account does). Commit `feat: restrict simulated money modules to granted accounts`.

### Task 4: Data map and completeness guard
**Files:** create `backend/app/datarights.py` (map only), `backend/tests/test_data_map_complete.py`.
**Interfaces:** `DATA_MAP: dict[str, Rule]` where `Rule = {"owner_field": str|None, "export": bool, "action": "delete"|"anonymize"|"retain"|"n/a", "why": str}` covering every collection the app writes (about 45: users, workspaces, billing, settings, notifications, activity, automation_jobs, campaigns, bids, messages, proposals, upwork_leads, api_keys, oauth_identities, revoked_sessions, login_failures, team_members, team_invites, pool_specs/bids/contracts/earnings, orders/order_accounts/order_events, bank_accounts/transfers, capital_*, market_*, token_*, waitlist, beta_testers, terms_acceptances, data_requests, and others found by grep).
- [ ] Step 1: Test `test_every_collection_is_classified`: run the real API against the memory store and a Mongo store through a scripted workflow, list `db.list_collection_names()`, assert each name is in `DATA_MAP` or in an explicit `SYSTEM_ALLOWLIST`; expect FAIL.
- [ ] Step 2: Fill the map with a one-line reason per entry (default policy: personal content deleted; financial/contract/ledger rows retained and pseudonymized; security/audit rows retained without personal content; counterparty-owned rows untouched). Expect PASS.
- [ ] Step 3: Commit `feat(data): classified data map with a completeness test`.

### Task 5: Export
**Interfaces:** `async build_export(user: dict) -> dict` returns `{"exportedAt", "format": "autopilot-export-1", "account", "records": {collection: [..]}, "notIncluded": [{"what","why"}]}`; routes `POST /api/me/export` (recent password re-entry, or fresh OAuth login within 10 minutes) returning `application/json` with `Content-Disposition: attachment`; limited to 3 per hour per user; audited in `data_requests` (counts only, no content).
- Always excluded: password hash, API-key hashes, token secrets and encrypted provider tokens, CSRF/session ids, other users' emails beyond what the user already sees on shared contracts (counterparty is exported by display name and role only).
- [ ] Step 1: Failing tests: `test_export_contains_only_own_records` (two users, assert no id or email of B appears anywhere in A's payload, including nested text), `test_export_excludes_secrets`, `test_export_requires_reauth`, `test_export_unauthenticated_401`, `test_export_rate_limited`, `test_export_audited_without_content`, `test_api_key_cannot_export` (personal keys are blocked on `/me`).
- [ ] Step 2: Implement per `DATA_MAP` (export flag, owner_field filter); run memory and genuine Mongo; expect PASS; commit.

### Task 6: Deletion
**Interfaces:**
- `async plan_deletion(user) -> {"blockers": [str], "willDelete": {coll: n}, "willAnonymize": {coll: n}, "willRetain": {coll: {"n": int, "until": iso, "why": str}}}` (dry-run, returned by `GET /api/me/deletion/preview`).
- `POST /api/me/deletion` body `{"password": str | None, "confirm": "DELETE MY ACCOUNT"}` -> schedules deletion `DELETION_GRACE_DAYS` (default 14) ahead, signs out all sessions (bumps `session_version`), revokes API keys, marks `deletionScheduledFor`; `DELETE /api/me/deletion` cancels while pending (login still allowed only to cancel).
- `async execute_deletion(user_id: str) -> dict` run by `scripts/ops/run-deletions.py` and owner-only `POST /api/admin/deletions/run` (idempotent, resumable, per-collection result recorded in `data_requests`).
- Blockers (refuse with 409 and a plain-language list): platform owners; agency accounts with active team members or open/awarded contracts or unpaid milestones; freelancers with active contracts; pending capital/market positions (simulated, still blocked to keep ledgers consistent).
- Retention (configurable, **placeholder, lawyer to set**): `FINANCIAL_RETENTION_YEARS=7`: contracts, earnings, payouts, invoices, ledger and transfer rows are kept with name/email/profile replaced by `"Deleted user <8 hex of HMAC(user_id)>"` and free text cleared; security audit rows keep ids only; `terms_acceptances` are kept as proof of acceptance with the user id pseudonymized.
- Deleted outright: user doc (replaced by a tombstone `{id, deletedAt}` so ids cannot be reused), workspaces, settings, notifications, activity, automation jobs, campaigns, bids, messages, proposals, upwork leads, API keys, OAuth identities, reset tokens, sessions, team invites sent by or addressed to the email, waitlist/beta rows for the email, token wallets/alerts.
- [ ] Step 1: Failing tests: `test_preview_matches_execution_counts`, `test_requires_password_and_exact_confirmation`, `test_grace_period_blocks_login_except_cancel`, `test_cancel_restores_account`, `test_owner_cannot_self_delete`, `test_agency_with_open_contract_blocked`, `test_deletion_never_touches_other_users_rows` (snapshot B before and after, equal), `test_counterparty_contract_survives_pseudonymized`, `test_all_login_paths_dead_after_execution` (password, API key, OAuth identity, reset link, invite link, old session), `test_execution_idempotent_after_partial_failure`, `test_email_can_be_reused_after_deletion`, `test_audit_record_has_counts_but_no_personal_content`, `test_every_collection_has_a_deletion_outcome` (ties to Task 4).
- [ ] Step 2: Implement; run memory and genuine Mongo; expect PASS; commit.

### Task 7: UI and policy alignment
- Settings -> "Your data": Export (re-auth dialog), Delete (preview, blockers, typed confirmation, grace banner with Cancel); e2e covering export download, blocked deletion, scheduled deletion and cancel.
- Correct the Privacy/Terms statements to match the product (export and deletion now exist and how; remove "RAG", "NDA shielding", "secrets manager", analytics claims; add the processor list and retention table from `docs/data-lifecycle.md`). The draft notice stays; nothing is declared compliant.
- [ ] Commit `feat(ui): data export and account deletion, policy text matches the product`.

### Task 8: R4 advisory investigation
- [ ] Step 1: `npm audit --omit=dev --json` and `--json` for dev; for each advisory record package, installed version, dependency chain (`npm ls`), fix availability and whether the fix is semver-major, whether the vulnerable code path is used by this app (grep and a build-output check), and exposure (build-time only, server, browser).
- [ ] Step 2: Apply only safe non-breaking changes (patch/minor bumps, `overrides` where the tool supports it); re-run typecheck, qa, build, e2e.
- [ ] Step 3: Write `docs/npm-advisories.md` with a table and an upgrade-risk assessment for Next 16, Sentry 11, Nango 0.72 (breaking-change notes read from their changelogs; no major upgrade started). Commit.

### Task 9: R3 staging verification procedure
- `docs/staging-verification.md` plus script additions to `scripts/ops/staging-check.mjs`: print the observed `X-Forwarded-For` chain through the real path (owner-only `/api/diag/request`, extended to report `edgeProof: verified|absent|invalid`), cookie attributes as received by a real browser path, client-IP test from two networks, proxy-timeout probe via owner-only `GET /api/diag/sleep?seconds=N` (cap 60, disabled outside staging with `ENABLE_DIAG_SLEEP=true`), and a decision table that derives `TRUSTED_PROXY_HOPS` from the observation rather than a guess.
- [ ] Commit.

### Task 10 (blocked on Section A): Signed edge proof
Files `middleware.ts`, `backend/app/edge.py`, `config.py`, `render.yaml`, env templates, `staging-check.mjs`. Tests: `test_edge.py` (valid, bad signature, expired timestamp, future timestamp, replay on another path/method, missing, previous-secret accepted, constant-time compare used, allowlisted machine routes pass, direct+forged XFF gets direct-IP treatment); a Node test that the middleware adds headers and the secret appears in no response; a local end-to-end with `next start` and the real API proving the proof verifies and that a direct call with a forged header is limited as direct.

### Task 11 (blocked on Section B): Shared rate limits
Files `backend/app/ratelimit.py`, `security.py`, `config.py`, `main.py` startup guard. Tests: `test_ratelimit.py` (memory store semantics; Mongo store shared by two app instances in one test run: the second instance sees the first's counts; window rollover; TTL index exists; Mongo failure falls back and logs; per-email lockout unaffected); real-Mongo two-process test.

### Task 12: Legal pack refresh (R7)
Update `docs/legal-review-questions.md` for the new functions: processor list, retention table, acceptance-record fields, deletion model, simulated-module restriction, removal of stealth, questions on IP/user-agent logging for acceptance, grace period length, pseudonymization sufficiency. No compliance claim.

### Task 13: Final regression and report
- [ ] Run: backend memory; backend genuine MongoDB (`TEST_MONGODB_URI`, disposable container, about 40 min); `npm run typecheck`, `lint`, `qa`, `test:deploy-guards`, `build`; Chromium e2e on a fresh DB; `pip-audit`; `npm audit`.
- [ ] Update `IMPLEMENTATION_REPORT.md`, `docs/production-readiness.md`; commit locally. Production readiness is **not** declared.

## Execution order
Tasks 1 -> 4 -> 5 -> 6 -> 2 -> 3 -> 7 -> 8 -> 9 -> 12 -> 13 now. Tasks 10 and 11 wait for your reply to Sections A and B.

## Self-review notes
Every decision 1-12 maps to a task (1: T1; 2: T4-T7; 3: T2; 4: T3; 5: none, nothing built; 6: T8; 7: Section A/T10; 8: Section B/T11; 9: T9; 10: T8; 11: T12; 12: T4-T6). Names used across tasks (`DATA_MAP`, `plan_deletion`, `execute_deletion`, `terms.CURRENT`, `require_simulated_access`) are defined once above.
