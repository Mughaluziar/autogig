# Upwork assistant (human-in-the-loop)

Replaces the Nango and Upwork-API routes for Upwork. Written 2026-11-14.

**What it is.** Upwork emails you job alerts. Autopilot reads *those emails* (which you forward to your private Autopilot address, or paste in), turns each job into a lead in **Gigs** (the Job Radar family), drafts a proposal with AI, and lets you edit, save and copy it. You open the job on Upwork and submit the proposal yourself.

**What it never does.** It does not use the Upwork API or Nango for Upwork, log in to Upwork, store Upwork passwords or cookies, drive a browser on Upwork, get around CAPTCHA/MFA/bot detection, or submit a proposal. The server (`POST /api/automation/jobs`) and the browser worker (`worker/main.py`) both refuse anything aimed at Upwork, and the UI hides auto-apply on Upwork jobs.

## Flow
```
Upwork job-alert email
   ├─ forwarded to u-<token>@<INBOUND_EMAIL_DOMAIN>  → POST /api/inbox/inbound  (existing webhook)
   ├─ or read from the user's Outlook (existing, gated Nango Outlook sync)
   └─ or pasted into "Add Upwork jobs" (POST /api/upwork/leads/import)
        ↓  backend/app/upwork_alerts.py  (title, link, budget, skills, description)
        ↓  repo.add_unique("upwork_leads")  one lead per Upwork job id per user (unique DB index)
Gigs feed  /dashboard/gigs  (source "Upwork (email alert)")  ← merged in /api/radar/jobs
        ↓  Apply → proposal editor (existing Composer)
POST /api/radar/proposal   AI draft from the job + the user's signup profile  (template if AI is off)
PUT  /api/radar/proposals/{id}   edit/save · Copy · "Open the original job on Upwork"
User pastes it into Upwork and submits there → "I've submitted it on Upwork — track it"
```

## Setup for a user
1. Ask Autopilot for your private address: Accounts → Inbox (`GET /api/inbox/address`). It needs `INBOUND_EMAIL_DOMAIN`, `INBOUND_EMAIL_WEBHOOK_SECRET` and **`INBOUND_EMAIL_PLATFORMS` containing `Upwork`** on the server, plus an inbound-email provider (Postmark, Mailgun, SendGrid, Cloudflare Email Routing...) posting to `/api/inbox/inbound`.
2. In Upwork, turn on email alerts for your saved searches, and forward them to that address (or use a mail rule).
3. Or skip email: Gigs → "Add Upwork jobs from an alert email" and paste the email text, or enter one job.

## Extracted fields
Title, canonical job URL (`https://www.upwork.com/jobs/~<id>`), hourly range or fixed budget, skills, description text, posted/proposals/location when the email says so. Anything not found is left empty, never guessed. Only links on `upwork.com` count; other domains are ignored.

## Duplicates
The Upwork job id (`~0123…`) is the key, so the same job in a new email, with different tracking parameters, or pasted twice is stored once. The database enforces it with a unique `(user_id, dedupe_key)` index. A lead you remove stays removed.

## Verified vs not verified
| Item | Status |
|---|---|
| Parser on synthetic fixtures (HTML digest, plain-text single and multi-job, spoofed domains, duplicates) | Tested: `backend/tests/test_upwork_alerts.py` |
| Webhook → lead → radar feed → detail, per-user isolation, dismiss, import, proposal draft/edit, automation refusal | Tested: `backend/tests/test_upwork_leads.py` |
| Same flow end to end in a real browser against a real MongoDB, including edit/save/reload | Verified manually on 2026-11-14 (local test database, synthetic email) |
| **Parser on real Upwork alert emails** | **NOT verified.** Fixtures are synthetic. Upwork's template may differ. Forward 3 to 5 real alerts, check the extracted fields, and tell us what is missing. |
| AI draft quality with the real model | **NOT verified.** Tests mock the model. Without `GROQ_API_KEY` the app returns a template. |
| Real inbound-email provider delivery | **NOT verified.** Needs a provider account and DNS. |
| Upwork terms | Not a legal opinion. Reading emails the user receives and drafting text is passive, but the client should confirm Upwork's terms allow AI-assisted proposals and that users submit them personally. |

## Files
`backend/app/upwork_alerts.py`, `backend/app/routers/upwork_leads.py`, hooks in `backend/app/routers/inbox.py` and `radar.py`, `backend/app/repo.py` (`add_unique`), guards in `backend/app/routers/automation.py` and `worker/main.py`; UI in `components/gigs/` (`upwork-import-dialog.tsx`, `manual-submit-notice.tsx`, `gig-apply.tsx`, `gig-detail.tsx`, `gigs-market.tsx`) and `components/radar/` (`radar-data.ts` `isUpwork`, `use-radar.tsx`).
