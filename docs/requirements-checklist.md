# Requirement-by-requirement checklist

Status words: **COMPLETED** = implemented and verified as the "Evidence" column says · **PARTIAL** = implemented, part not verifiable
without an external account or deployment (the gap is named) · **BLOCKED** = needs a credential, an account, a deployment or a
professional decision before it can be done or verified. Nothing is marked COMPLETED on the strength of a mock where the requirement
is about a real third party: those rows are PARTIAL or BLOCKED. Test commands and results: `IMPLEMENTATION_REPORT.md` (third pass).

## A. Standing rules from the owner (must never be broken)
| Rule | Status | Evidence |
|---|---|---|
| No official Upwork API, no Nango for Upwork, no unattended Upwork automation, no CAPTCHA/MFA/bot-detection bypass, no stored Upwork passwords or cookies, no automatic proposal submission | **COMPLETED** | Server returns 422/403 for Upwork automation (`test_upwork_leads.py`, `test_platform_workflows.py`); the assistant only reads forwarded alert emails and the user submits manually; Upwork API path disabled by `UPWORK_API_ENABLED=false`; no credential fields exist |
| No concealment features (stealth mode) | **COMPLETED** | Removed; `npm run qa` rule `no-concealment` fails the build if it returns |
| Baseline preserved (`baseline-as-received` = `75cc719`), work on `main`, nothing pushed or deployed | **COMPLETED** | `git tag`, `git remote -v` (none) |
| No real money moves; simulated modules are labelled and restricted | **COMPLETED** | Banner on every simulated page (`simulated-banner`, e2e), invitation-only default (`test_modules_gate.py`), Terms section 4A, `docs/legal-review-questions.md` section 1 |
| Stripe / real payment processing not implemented | **COMPLETED (by decision)** | Checkout returns 503 without keys; live Stripe is a separate approval |

## B. Core product
| Requirement | Status | Evidence / gap |
|---|---|---|
| Accounts: agency, freelancer, investor; roles enforced on every route | **COMPLETED** | `test_role_matrix.py`, `test_auth_accounts.py`, e2e roles group |
| Sessions: HttpOnly cookie, CSRF, Origin check, logout/revocation, password reset, login lockout | **COMPLETED** | `test_session_cookies.py`, `test_password_reset_and_throttle.py`, e2e auth group (real Chromium) |
| Email verification and password-reset emails actually delivered | **BLOCKED** | Code and tests done; needs an email provider and verified domain (`docs/integration-verification.md` s.1) |
| Freelancer pool: specs, blind bids, award, milestones, delivery, approval, earnings, recorded payouts | **COMPLETED** | `test_pool.py`, e2e pool group |
| Teams, invites, personal API keys (scoped, revocable) | **COMPLETED** | `test_team.py`, `test_api_keys.py` |
| Upwork human-in-the-loop assistant: alert emails to leads, duplicate detection, AI draft with review, manual submit, link to the job | **PARTIAL** | Complete and tested on synthetic emails; real alert-email parsing and real AI output unverified (needs 3-5 real alerts and a Groq key: `integration-verification.md` s.2-3) |
| AI disclosure on AI-drafted replies; edit before sending; wording cannot be removed or made untrue | **COMPLETED** | `test_ai_disclosure.py`; conversation composer shows "AI-assisted draft" and the exact line added on copy; Settings field; e2e `disclosure` group. Autopilot never sends messages itself |
| Self-service profile: name, rate, skills, availability, bio | **COMPLETED** | `test_profile.py`, e2e `demo`/`profile` groups |
| Secure email change (password + code to the new address, notice to the old, sessions invalidated, no takeover) | **COMPLETED** | `test_profile.py` (13 cases: bound code, attempts, expiry, rate limit, other sessions signed out, keys still work, old address freed); e2e `profile` group. Real email delivery is BLOCKED (provider) |
| Simulated Banking / Marketplace / Capital / Token, restricted to invited accounts | **COMPLETED** | `test_modules_gate.py`, e2e; `SIMULATED_MODULES=invited` is the production default |
| Calendar, Agent Fleet, Clients/Contracts/Milestones views, freelancer QA/Messages/Billing, Bidding | **PARTIAL (decided out of launch scope)** | Shown as "Coming soon", not built; earlier decision that demo-only agency sections are not requested |
| Account deletion and data export | **COMPLETED** | `test_datarights.py` (21), `test_datarights_edge.py` (7), `test_data_map_complete.py`; e2e `datarights` group; `docs/data-lifecycle.md` |
| Terms acceptance recorded with version and time; enforced on the server | **COMPLETED** | `test_terms.py` (10): signup requires it, new version blocks the API until accepted |

## C. Security
| Requirement | Status | Evidence / gap |
|---|---|---|
| Production refuses unsafe configuration (secret, DB, CORS, cookies, demo data, proxy hops, rate limit, simulated modules, edge secret) | **COMPLETED** | `test_production_config.py` |
| Build refuses to ship the unauthenticated demo or without the edge secret | **COMPLETED** | `scripts/deploy-guards.mjs` + tests (10) |
| Webhook authentication: inbound email (bearer, constant-time), Stripe (signature, timestamp), Nango (HMAC) | **COMPLETED** | `test_payments.py`, `test_orders.py`, inbox tests; webhooks are also exempt from the edge requirement |
| R1: signed edge proof (HMAC, timestamp window, single-use nonce, rotation, direct requests refused) | **PARTIAL** | Implemented; unit tests (23), real-proxy local test, e2e with the proof enforced. **Not verified on Vercel/Render** (does Vercel pass middleware headers and overwrite visitor `X-Forwarded-For`?). `REQUIRE_EDGE_PROOF` stays false until staging passes |
| R2: shared per-IP rate limits | **COMPLETED** | MongoDB counters; two real processes share one budget (`test_ratelimit.py`) |
| R3: staging verification procedure for headers, cookies, client IP, timeouts | **PARTIAL** | Procedure and scripts ready (`docs/staging-verification.md`); **no staging exists to run it on** |
| R4: dependency advisories | **COMPLETED** | Production audit 0 advisories; dev tooling: 6 moderate (see `docs/npm-advisories.md`); `pip-audit` clean |
| Sentry 11 with explicit privacy settings (no cookies, headers, bodies, user, query strings, local variables) and event scrubbing | **PARTIAL** | Upgraded, configured and unit-tested (`lib/sentry-privacy.test.mjs`, `test_privacy_filter.py`); **needs a real DSN and a staging error to confirm what arrives** |

## D. Data, backups, deployment
| Requirement | Status | Evidence / gap |
|---|---|---|
| Backup and restore scripts verified | **COMPLETED (local)** | 45 collections / 128 indexes compared on a disposable MongoDB (`verify_restore.py`, `restore-drill.sh`) |
| MongoDB Atlas cloud backup, point-in-time recovery, restore drill on Atlas | **BLOCKED** | Needs an Atlas Project Owner account and a tier/budget decision (`docs/backup-and-monitoring.md` s.2-3) |
| Staging and production deployment (Render, Vercel, DNS, HTTPS) | **BLOCKED** | Needs accounts, a paid Render plan and your go-ahead (`docs/deployment-runbook.md`, exact steps) |
| GitHub Actions first run | **PARTIAL** | Workflow hardened, replicated locally, `actionlint` clean; **no remote, never run**; push needs your approval (`docs/ci-first-run.md`) |
| Uptime monitoring | **BLOCKED** | Needs a monitor account (`backup-and-monitoring.md` s.5) |

## E. Integrations (none verified with a real service)
| Integration | Status | What is needed |
|---|---|---|
| Email (Resend/SMTP) | **BLOCKED** | account + verified domain (SPF/DKIM/DMARC) |
| Groq (AI drafting) | **BLOCKED** | API key; check proposal latency through the proxy |
| Inbound Upwork alert email | **BLOCKED** | inbound-email provider, domain/MX, 3-5 real alert emails |
| Stripe | **BLOCKED (not wanted yet)** | business account, keys, webhook, lawyer sign-off |
| Social sign-in (Google/GitHub/Microsoft/Apple) | **BLOCKED** | developer apps |
| Sentry DSNs | **BLOCKED** | projects |
| Nango / Outlook (optional) | **BLOCKED** | Nango account and Microsoft app approval |

## F. Legal and professional
| Item | Status | Needed |
|---|---|---|
| Terms, Privacy Policy, AI Disclosure text | **PARTIAL** | Rewritten to match the product and labelled "draft, not reviewed by a lawyer"; **lawyer review is BLOCKED** (22 questions, `docs/legal-review-questions.md`) |
| Retention period for kept records, grace period, processor deletion, acceptance evidence | **BLOCKED** | lawyer decision (placeholder 7 years / 14 days in config) |
| Licensing for any real money, investment, lending or insurance feature | **BLOCKED** | lawyer; the modules stay simulated and invitation-only meanwhile |
| Confirmation that Upwork's/Fiverr's terms allow forwarding your own alert emails to a drafting tool | **BLOCKED** | your decision / lawyer |

## G. Final verification pass (2026-11-16)
| Item | Status | Evidence / gap |
|---|---|---|
| "Insurance": the platform's **protection fund** (not insurance): automatic cover on advances, optional 24-hour cover purchase, platform-reported-loss claims, claim cap at fund balance, claims hold off write-offs | **COMPLETED as a simulation** | `tests/test_capital.py` (16 tests, all passed in memory and real-MongoDB modes); `tests/test_modules_gate.py` (6) for invitation-only access. It moves ledger entries only: **no real money, no licensed insurer, no regulated insurance product.** Real insurance is BLOCKED on legal/licensing decisions (`docs/legal-review-questions.md`) |
| Every API route refuses anonymous callers except a reviewed public list | **COMPLETED** | `tests/test_route_auth_sweep.py` (22): walks the OpenAPI route list; stale allowlist entries also fail |
| Real ecosystem token / token-funded insurance | **BLOCKED (out of scope, research only)** | `docs/crypto-token-feasibility.md`; needs a separate contract, counsel, professional tokenomics review and an independent audit. Nothing deployed |

## H. Re-verification and new scope (2026-11-16, branch `w/requirements`, based on `e774a37`)
Statuses here use the five words COMPLETED / PARTIAL / BLOCKED / NOT STARTED / DEFERRED. "Verified" means a test in this repository
passed in the final run of this branch (counts in `IMPLEMENTATION_REPORT.md`), not that an earlier report said so.

### H1. Original platform
| Requirement | Status | Verified by |
|---|---|---|
| Authentication, accounts, roles, permissions (agency, freelancer, investor; owner) | COMPLETED | `test_auth*.py`, `test_role_matrix.py`, `test_route_auth_sweep.py` (every route refuses anonymous callers except a reviewed list), e2e auth/roles groups |
| Freelancer and agency profiles; editing; secure email change | COMPLETED | `test_profile.py`, e2e profile group |
| Teams, invitations, personal API keys | COMPLETED | `test_team.py`, `test_api_keys.py` |
| Upwork job discovery from forwarded alert emails, duplicate detection, AI-assisted proposals with manual submit | PARTIAL | Works on synthetic emails and a stub AI; **real alert samples and a real Groq key are BLOCKED**; no Upwork API/automation by rule |
| Freelancer pool, blind bidding, award, contracts, milestones, delivery, rejection/approval, earnings, payout records | COMPLETED | `test_pool.py`, e2e pool group. Payouts are records, not real transfers |
| Command Center and dashboards | PARTIAL | Live parts tested; many agency demo sections (Calendar, Agent Fleet and others) are shown as "Coming soon" by decision (NOT STARTED, DEFERRED) |
| AI disclosure | COMPLETED | `test_ai_disclosure.py`, e2e disclosure group |
| Terms, Privacy (draft), data export, account deletion, retention | COMPLETED as software; legal text and retention values BLOCKED on a lawyer | `test_terms.py`, `test_datarights*.py`, `test_data_map_complete.py` |
| Security: tenant isolation, CSRF, CORS, rate limiting, edge proof and replay protection | COMPLETED locally; edge proof on Vercel/Render BLOCKED | `test_edge.py`, `test_ratelimit.py`, `test_session_cookies.py`, e2e with enforcement on |
| Backups, restore, data lifecycle | COMPLETED locally; Atlas backups/restore drill BLOCKED | restore drill scripts, `docs/data-lifecycle.md` |
| Sentry and logging privacy | PARTIAL | unit-tested config; needs a real DSN to see an event |
| Protection fund ("insurance") | COMPLETED as a **simulation**; real insurance BLOCKED | `test_capital.py`; labelled "not insurance" |
| Token module | COMPLETED as simulation plus testnet-only permissioned token code; mainnet BLOCKED in code | `test_token*.py` (chain end-to-end needs the local-chain script) |
| Navigation, buttons, forms | COMPLETED / PARTIAL | `npm run qa` 24 pass / 3 warn (four `Button`s the static check cannot see handlers for in the shell, a "Payment received" toast string in the demo money provider, no og:image); crawl and e2e |

### H2. AutoGig funding ecosystem (new scope; see `docs/autogig-funding-requirements.md`)
| Item | Status |
|---|---|
| Network recommendation (Base) with comparison | COMPLETED (document; client decision needed) |
| Token name/symbol, tokenomics and allocation proposal | COMPLETED (document, **not final, needs lawyer and client approval**) |
| Investor dashboard, demo contribution, pool overview, allocations, statement, risk disclosures, history (simulated) | COMPLETED |
| Freelancer credit application, owner review, grade, offer, accept/reject, schedule, repayments, late/default, audit (simulated) | COMPLETED |
| Treasury dashboard with ledger check (simulated) | COMPLETED |
| Wallet connection for common browser wallets (read-only) | COMPLETED; mobile/QR wallets BLOCKED (Reown license and project id) |
| Testnet AutoGig token | NOT STARTED (deliberate: no structure decision) |
| Real investor funds, real credit, revenue sharing, insurance product, DEX/CEX listing | BLOCKED (legal, licensed partners, audit) |
| Open-source evaluation | COMPLETED (`docs/open-source-evaluation.md`) |

## I. Readiness branch audit

Source material for this pass is the original platform checklist (A–H1) and the client wording in
[AutoGig funding requirements](autogig-funding-requirements.md). This table updates their release status.

| Requirements | Readiness evidence | Remaining gate |
|---|---|---|
| Platform roles, teams, auth, signup privacy, verification, password recovery, profile, consent, rights and tenant isolation | Route sweep, role, cookie/CSRF, reset, profile, data rights and terms tests. Production avoids account lookup until signup mailbox proof is redeemed | Live Resend, role-based staging acceptance, legal review of policy and retention |
| Pool specifications, blind bids, awards, milestones, earnings and payout records | Pool API and browser workflows. Payout records are simulated | Live payout/custody partner and legal approval |
| Job Radar and Upwork | Synthetic email import, deduplication, mocked Groq success/failure, editable manual-submit drafts | Groq key, inbound email provider and real sample alerts. No automatic Upwork submission |
| Bank, Marketplace, Capital, protection fund, wallet and credit | Simulated balances; backend credit, treasury, indexed recovery, data-isolation and document-upload tests. Browser wallets are read-only | Any real transfer, licensed lending, custody, protection/insurance, or returns. WalletConnect requires client approval and a project ID |
| Client funding scope 1–5 | Base recommendation and tokenomics proposals documented. AutoGig name is provisional. No AutoGig token issued | Chain/name/structure decisions, counsel, audit. Existing token integration stays disabled for the demo |
| Client funding scope 6–10 | Demo contribution, verified applicant flow, owner review, offers, repayments, treasury and investor statement. Existing responsive design system | Launch timing and regulated funding remain client/legal decisions. No promise of returns or withdrawals |
| Frontend dashboards and navigation | Static route audit and local browser role/workflow checks. Credit has explicit retry when a required API fails | Previously deferred agency demo views remain outside launch scope. Fahim owns Freelancer Billing and Inbox/Messaging |
| Security, stability, integrations, deployment and rollback | MongoDB startup guard and restart recovery, offline provider mocks, production live-finance guards, restore drill, signed proxy tests | Client Atlas, Groq and Resend credentials. Staging verification, monitoring/backup ownership, data preservation and release approval |
