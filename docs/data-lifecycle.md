# Data lifecycle: what is exported, deleted, anonymized and retained

Draft for the operator and a lawyer. It describes what the code does today (`backend/app/datarights.py`); it is **not**
legal advice and does not claim compliance with any law. The retention period below is a **placeholder** until a lawyer
sets it (`FINANCIAL_RETENTION_YEARS`, default 7).

## How it works
* **Export** (`POST /api/me/export`, page *Your data*): a JSON download of the signed-in user's own records. Needs the
  current password (or, for accounts without a password, a sign-in from the last 10 minutes). Limited to 3 per hour.
  Personal API keys cannot call it. Each export is logged as a count per collection, never the content.
* **Deletion** (`POST /api/me/deletion`, page *Your data*): needs the password (or a fresh sign-in) **and** the exact phrase
  `DELETE MY ACCOUNT`. It first shows a preview of exactly what will happen. It is then **scheduled** for
  `DELETION_GRACE_DAYS` (default 14) later: every session is signed out, API keys stop working, and until then the account can
  only sign in to cancel (or export). `DELETE /api/me/deletion` cancels. After the grace period the owner (or a scheduler)
  runs `POST /api/admin/deletions/run`, which executes each due request. Execution is repeatable: it can be re-run after a
  crash and the account row is removed last.
* **Refused** (409, with reasons) for: platform owners; an agency with other team members; any active contract (as agency or
  freelancer); open simulated advances, cover, investments, listings or financing applications. These protect other people.
* **Tombstone**: the account is replaced by `{id, deletedAt}` so ids are never reused. The same email can sign up again as a
  new account; old tokens never match it.
* **Pseudonym**: where a row is kept, the deleted person's name fields become `Deleted user <8 hex>` (a keyed hash of the
  id, not reversible without the server secret). Only the deleted person's own name fields are changed, never the
  counterparty's.
* **Retention**: rows kept in "name removed" form get `retain_until` (now + retention years). `purge_expired_retained()`
  removes them after that date (run it with the deletion job).
* **Audit**: `data_requests` records type, status, times and counts only; `terms_acceptances` records ids, versions, time and
  method only.

## Shared records, teams and account changes (reviewed 2026-11-15)
* **Tenant isolation:** every collection is read through one owner rule per collection (`DATA_MAP`). A team **member's** export has
  only the member's rows; a team **owner's** export lists the roster they already manage (member names and emails), never the members'
  own workspaces, settings or messages (`test_datarights_edge.py`). Deleting a member removes only their membership; deleting a
  bystander leaves other teams untouched; invitations addressed to a deleted address are removed.
* **Ledger entries** that involve several users (simulated Capital/Banking) are exported to each user named in them; the entry lists the
  other party only as an opaque account id.
* **Email change:** the account document is keyed by email, so a confirmed change moves it to the new key (new copy first, then the old
  one is deleted), signs every other session out (`session_version`), clears pending reset tokens, and updates the copies of the address
  on API keys, team memberships and social-sign-in links. Pending change codes (`email_change`) are never exported. Names already copied
  into shared records (a signed contract) keep the name they had; a later deletion replaces whichever name the record holds.
* **Terms:** `terms_accepted` on the account and the append-only `terms_acceptances` rows are kept as proof; the API refuses everything
  but account, export and deletion calls until the current versions are accepted.
* **Replay protection** (`edge_nonces`) and **rate limits** (`rate_limits`) hold no personal data and expire in minutes.

## Collection by collection
Generated from `DATA_MAP`; `tests/test_data_map_complete.py` fails if a collection the app writes is missing from it.

| Collection | In the export | On deletion | Why |
|---|---|---|---|
| `users` | yes | **Deleted** | The account. Replaced by a tombstone (id and deletion time only) so the id is never reused; the email can sign up again. |
| `deleted_accounts` | no | Kept as is | Tombstones: id and deletion date only. |
| `oauth_identities` | yes | **Deleted** | Links a Google/GitHub/... login to the account. |
| `api_keys` | yes | **Deleted** | Personal API keys (the export lists names and prefixes, never the key). |
| `workspaces` | yes | **Deleted** | Dashboard state: accounts, gigs, radar, growth. |
| `settings` | yes | **Deleted** | Preferences. |
| `notifications` | yes | **Deleted** | In-app notifications. |
| `activity` | yes | **Deleted** | The user's own activity feed. |
| `automation_jobs` | yes | **Deleted** | Automation queue. |
| `campaigns` | yes | **Deleted** | Outreach campaigns. |
| `bids` | yes | **Deleted** | The user's own saved bids/drafts. |
| `messages` | yes | **Deleted** | Forwarded alert emails and conversation messages (may name third parties). |
| `proposals` | yes | **Deleted** | Drafted proposals. |
| `upwork_leads` | yes | **Deleted** | Leads parsed from forwarded Upwork alert emails. |
| `orders` | yes | **Deleted** | Marketplace orders the user tracks (client names are third-party data). |
| `order_accounts` | yes | **Deleted** | Connected marketplace accounts (inbound-address hash is not exported). |
| `order_events` | yes | **Deleted** | Order timeline. |
| `bid_daily_limits` | no | **Deleted** | Daily bid counters. |
| `capital_daily_limits` | no | **Deleted** | Daily transfer-limit counters. |
| `wallet_activity` | no | **Deleted** | Transaction-history view derived from the ledger (rebuilt from it; the ledger itself is kept). |
| `wallet_activity_cursors` | no | **Deleted** | Where the user's transaction-history view is up to. |
| `waitlist` | yes | **Deleted** | Early-access signups for this email. |
| `beta_testers` | yes | **Deleted** | Beta signup for this email. |
| `login_failures` | no | **Deleted** | Failed-login counters for this email. |
| `team_members` | yes | **Deleted** | Membership rows (the user's own, and for a team owner the roster they already manage). |
| `team_invites` | yes | Your team's and addressed-to-you invitations deleted; invitations you sent elsewhere: kept, name removed | Invitations sent by or to the user. Rows for the user's own team or email are deleted; invitations the user sent on someone else's team keep their pseudonym. |
| `pool_specs` | yes | **Kept, name removed** | Job specs an agency posted: other people bid on them, so the record stays (closed) with the owner shown as a pseudonym. |
| `pool_bids` | yes | Awarded bids: kept, name removed; others deleted | Bids. Awarded bids are part of a contract and are kept; all others are deleted. |
| `pool_contracts` | yes | **Kept, name removed** | Contracts and milestones are retained for the counterparty and for financial records. |
| `pool_earnings` | yes | **Kept, name removed** | Recorded payouts (financial record). |
| `pool_threads` | yes | **Kept, name and last-message preview removed** | Conversations between a freelancer and an agency, one per spec: the other person keeps the conversation. |
| `pool_messages` | yes | Messages you wrote: **kept, text removed**; the other person's messages: kept as is | Messages in those conversations. The export holds both sides of your own conversations, as you see them in the app. |
| `billing` | yes | Kept as is | Plan, credits, purchase history (financial record, no personal text). |
| `subscriptions` | yes | Kept as is | Stripe subscription state (off until Stripe is configured). |
| `pay_links` | yes | **Kept, name removed** | Invoice pay links (financial record). |
| `capital_journal` | yes | Kept as is | Append-only simulated ledger; never rewritten. It holds ids and amounts, no names. |
| `capital_head` | no | Not personal data | Ledger head pointer (balances per account id). |
| `capital_profiles` | yes | **Deleted** | KYC profile (simulated verification). |
| `capital_advances` | yes | **Kept, name removed** | Simulated advances (ledger consistency). |
| `capital_coverages` | yes | **Kept, name removed** | Simulated cover. |
| `capital_claims` | yes | **Kept, name removed** | Simulated claims. |
| `capital_cover_offers` | yes | **Kept, name removed** | Simulated cover offers. |
| `token_wallets` | yes | **Deleted** | Linked wallet address (token program is off by default). |
| `token_subscriptions` | yes | **Kept, name removed** | Token subscriptions. |
| `token_proposals` | yes | Kept as is | Governance proposals. |
| `token_alerts` | no | Not personal data | System alerts. |
| `token_state` | no | Not personal data | Protocol state and short-lived challenges. |
| `market_listings` | yes | **Kept, name removed** | Simulated marketplace listings that investors reference. |
| `market_investments` | yes | **Kept, name removed** | Simulated investments. |
| `market_agreements` | yes | **Kept, name removed** | Simulated agreements. |
| `market_distributions` | yes | **Kept, name removed** | Simulated distributions. |
| `bank_accounts` | yes | **Deleted** | Simulated bank account details. |
| `bank_transfers` | yes | **Kept, name removed** | Simulated transfers (ledger consistency). A transfer between two members appears in both members' records; when one deletes their account, their label in the other member's copy is replaced and transfer notes are removed. |
| `crypto_addresses` | yes | **Deleted** | The user's own linked wallet addresses on Base (public addresses only; no keys or signatures). |
| `debit_cards` | yes | **Kept, name removed** | Simulated virtual debit cards: last four digits, expiry and limits only (no card number exists). Accounts with a live (active or frozen) card must cancel it before deletion. |
| `card_transactions` | yes | **Kept, name removed** | Simulated card purchases and refunds (ledger consistency); the merchant text is removed. |
| `financing_applications` | yes | **Kept, name removed** | Simulated financing applications. |
| `credit_contributions` | yes | **Kept, name removed** | Simulated contributions to the AutoGig demo credit pool (ledger consistency). |
| `credit_withdrawals` | yes | **Kept, name removed** | Requests to withdraw simulated credit-pool contributions (ledger consistency); notes are removed. A waiting request blocks deletion until it is paid, declined or cancelled. |
| `credit_applications` | yes | **Kept, name removed** | Simulated project-credit applications; the title, description and applicant contact fields are replaced. |
| `credit_agreements` | yes | **Kept, name removed** | Simulated credit agreements and their repayment schedule (ledger consistency). |
| `credit_documents` | yes (metadata only; file contents are never exported) | **Deleted** | Private supporting documents uploaded with a credit application (PDF/PNG/JPEG, 3 per application, 2 MB each). |

Credit document bytes are stored in MongoDB, limited by size/type and applicant/owner access. Downloads are forced attachments
with no-store, sandbox, same-origin resource policy, and no-index headers. The demo UI warns users not to upload real identity
or bank documents. There is no malware scanner or application-level document encryption; do not collect real sensitive files
until the client has chosen storage, scanning, encryption, retention, and incident-response policies.
| `credit_audit` | yes | **Kept** | Append-only audit trail of credit actions: ids and amounts only, no personal text. |
| `terms_acceptances` | yes | Kept as is | Proof of which Terms/Privacy version was accepted and when (no personal content). |
| `data_requests` | yes | Kept as is | Audit trail of export/deletion requests (counts, no content). |
| `rate_limits` | no | Not personal data | Request counters keyed by network address, not by user; each expires about two minutes after its window. Not linkable to an account. |
| `edge_nonces` | no | Not personal data | Single-use request identifiers of the website proxy (replay protection); expire in about two minutes. No personal data. |
| `revoked_sessions` | no | Not personal data | Revoked session ids; expire on their own. |
| `stripe_events` | no | Not personal data | Stripe webhook event log: Stripe event and object ids, event type, what the webhook did with it and when. No names, emails, amounts or user ids; expires after 90 days. |
| `oauth_states` | no | Not personal data | Single-use sign-in state; expires on its own. |
| `oauth_handoffs` | no | Not personal data | Single-use sign-in handoff; expires on its own. |
| `oauth_signup_proofs` | no | Hashed email binding and signup proof | Single use and automatic expiry after 15 minutes. |
| `app_state` | no | Not personal data | Legacy single shared document; retained until an explicit migration. |
| `app_state_backup` | no | Not personal data | Archive of the legacy shared document: mixed data of every user from before per-user storage. The owner must review and drop it (docs/data-lifecycle.md). |

## Not covered by the app (operator tasks)
* **Backups**: the database host's backups keep deleted data until they expire (Atlas snapshot retention, see
  `docs/backup-and-monitoring.md`). A restore from backup must be followed by re-running pending deletions.
* **Logs**: request logs hold ids, paths and status codes, not bodies; their retention is set at Render/Vercel/Sentry.
* **`app_state_backup`**: if the legacy shared document was ever archived there, it mixes all users' data from before per-user
  storage. The owner must review it and drop it; it is not touched by account deletion.
* **Third-party processors** (AI provider prompts, email provider, Stripe): data already sent to them is governed by their own
  retention; deletion in Autopilot does not call them. A lawyer should decide whether that needs a processor request flow.
* **Free-text in kept rows**: contract titles, milestone text and bid notes shared with a counterparty are kept as written
  (they are the counterparty's record too). Only name and email-type fields are replaced.

## Open questions for the lawyer (also in `docs/legal-review-questions.md`)
Retention period and legal basis for financial and contract records; whether keeping shared business text is acceptable;
whether the 14-day grace period is acceptable; whether to log IP or user agent with Terms acceptance; whether a processor
deletion flow is needed; response-time promises in the Privacy Policy.

## Verification status (2026-11-16)
Export, deletion (grace period, blockers, tombstone, pseudonym), retention purge, Terms recording and the data-map completeness check pass in the backend suite on real MongoDB (624 passed) and in the Chromium run (`datarights` group). Not verified: processor-side deletion (email/AI/Sentry providers), Atlas backup expiry of deleted data, and the 7-year/14-day placeholders, which need a lawyer.
