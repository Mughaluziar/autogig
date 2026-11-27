# Client demo recordings: first sale, unified messaging, Agent Fleet

Three short screen recordings (about 3–5 minutes each) for the client. Record them on the **local credential-free
stack** below: synthetic accounts, a throwaway database, no email, Stripe, bank, chain or marketplace is contacted.
Do not record on production or on a server with real users.

## 1. Start the stack (about 10 minutes, once)

From the repository root, in three terminals:

```bash
# a) disposable MongoDB on loopback
docker run -d --rm --name autogig-demo-mongo -p 127.0.0.1:27018:27017 mongo:7

# b) API: the local runner (scripts/qa/local-api.py) refuses anything but test mode + a loopback database,
#    simulates the AI provider and blocks every outbound provider call
export EDGE_SHARED_SECRET="demo-edge-$(openssl rand -hex 12)"; echo "$EDGE_SHARED_SECRET" > /tmp/autogig-demo-edge
cd backend && PYTHONPATH=. ENVIRONMENT=test MONGODB_URI=mongodb://127.0.0.1:27018 \
  MONGODB_DB=autogig_browser_qa_demo_$(date +%s) SECRET_KEY=$(openssl rand -hex 32) \
  OWNER_EMAILS=owner@example.test CORS_ORIGINS=http://localhost:3100 PUBLIC_SITE_URL=http://localhost:3100 \
  EMAIL_VERIFICATION=false REQUIRE_TERMS_ACCEPTANCE=true SIMULATED_MODULES=all \
  INBOUND_EMAIL_DOMAIN=in.example.test INBOUND_EMAIL_PLATFORMS=upwork,fiverr,freelancer.com \
  INBOUND_EMAIL_WEBHOOK_SECRET=qa-hook-secret AI_LOG=/tmp/autogig-demo-ai.log \
  EDGE_SHARED_SECRET="$(cat /tmp/autogig-demo-edge)" REQUIRE_EDGE_PROOF=true QA_API_PORT=8010 \
  python ../scripts/qa/local-api.py

# c) frontend (production build), same edge secret
BACKEND_API_URL=http://127.0.0.1:8010 EDGE_SHARED_SECRET="$(cat /tmp/autogig-demo-edge)" npm run build
BACKEND_API_URL=http://127.0.0.1:8010 EDGE_SHARED_SECRET="$(cat /tmp/autogig-demo-edge)" npx next start -p 3100
```

Then seed the demo data (Playwright, as for `scripts/qa/e2e.mjs`; set `PLAYWRIGHT_MODULE`/`CHROME` if needed):

```bash
BASE=http://localhost:3100 API=http://127.0.0.1:8010 HOOK=qa-hook-secret node scripts/qa/demo-seed.mjs
```

The seed refuses any non-local or non-test server. To start over, stop the API, start it again with a new
`MONGODB_DB` name, and re-run the seed.

## 2. Demo accounts (synthetic)

Password for every account: `Demo-Synthetic-Pass-2026`. `*.example.test` addresses can't receive mail.

| Account | Login as | Prepared state | Used in |
|---|---|---|---|
| `hana.agency@demo.example.test` (Hana Park, **Harbor Digital**) | Agency | One awarded contract with Leo ("Brand refresh for a neighbourhood bakery"); 3 forwarded marketplace messages (Upwork, Fiverr, Freelancer.com); the default fleet of 5 starter agents | Videos 1, 2, 3 |
| `maya.freelancer@demo.example.test` (Maya Lopez) | Freelancer | Clean account, no bids | Video 1 |
| `leo.freelancer@demo.example.test` (Leo Chen) | Freelancer | Holds the bakery contract | Video 2 |

## What is live, what is simulated (say this in each video)

| Shown in the videos | On the local recording stack | In production |
|---|---|---|
| Pool specs, bids, awards, contracts, milestones, messages | Real app logic and database | Same |
| Payouts ("I paid this", Earnings) | **Records only**: the page says Autopilot does not move money | Same: records only, no payment rail |
| Forwarded marketplace messages (Unified Inbox) | The seed posts them the way the mail provider would | Live: marketplace notification emails forwarded to the private address |
| Inbox replies | Drafted and saved; **you paste and send on the marketplace** ("Autopilot sends nothing") | Same |
| AI drafts (✨ in the inbox, Writer, Copilot) | **Simulated**: a fixed sample text, no AI provider is called | Live with the configured AI provider; still waits for approval |
| Job Radar / Scout scans | **Blocked**: no job feeds are reached, so runs find 0 listings | Live public feeds and approved APIs |
| Outlook mailbox | Not connected ("not enabled") | Needs Microsoft consent and approval |
| Banking, cards, crypto, credit, treasury | Not part of these videos; **simulated** everywhere (banner on every page) | Simulated: no bank, card network, chain or lender |

## 3. Recording setup

- Browser window 1280×800, zoom 100%, light theme, bookmarks bar hidden. Use two browser profiles (or one normal
  and one private window) so the agency and the freelancer stay signed in side by side.
- Close notifications on the recording machine. Don't show the terminals (they hold the local secrets).
- Record during the day: the default fleet guardrail has quiet hours from 23:00 to 07:00 (the recording machine's time),
  and Agent Fleet shows a "Quiet hours" banner in that window. Or turn quiet hours off under **Guardrails** first.
- Don't type into **Copilot** or press the ✨ draft button on the local stack: the AI is simulated and answers with a
  fixed sample text that won't match the question.
- Forwarded notifications show the marketplace (Upwork, Fiverr, Freelancer) as the sender: that's what a forwarded
  notification email carries. The message text is the client's.
- The agency's Freelancer Pool already shows the awarded bakery spec (prepared for video 2); that's expected.

## Video 1: Getting the first sale through the platform (≈4 min)

Story: an agency posts a project, a freelancer wins it, delivers, and gets their first recorded payout.

1. **Agency** (Hana) → sidebar **Freelancer Pool** (`/dashboard/pool`) → **New spec**.
   Title `Landing page for a coffee roaster`; summary `Responsive Next.js landing page with a contact form.`;
   stack `Next.js, Tailwind`; hours `20`; a deadline three weeks out; max rate `60` → **Broadcast**.
   Say: the spec goes to the vetted freelancer pool; bids are blind.
2. **Freelancer** (Maya) → **Specs** (`/freelancer/specs`) → **Bid** on the coffee-roaster spec → hours `18`, rate `50`
   (the total `$900` updates live) → **Place bid**. Show **My Bids** with the bid "submitted".
3. **Agency** → **Freelancer Pool**: the bid shows Maya's name and total → **Award**. Open the **Contracts** tab: the
   contract and its milestone.
4. **Freelancer** → **Contracts** (`/freelancer/contracts`) → delivery note `Live preview: https://example.test/preview`
   → **Mark delivered** ("Waiting for your agency").
5. **Agency** → Freelancer Pool → **Contracts** → **Approve** (the contract completes) → **Payouts** tab →
   **I paid this**. Point out the line "records only, does not move money".
6. **Freelancer** → **Earnings** (`/freelancer/earnings`): `$900` paid, the first sale. End here.

## Video 2: Unified messaging (≈3 min)

Story: every conversation in one place: marketplace clients and the agency–freelancer channel.

1. **Agency** → **Unified Inbox** (`/dashboard/conversations`): the three forwarded messages from Upwork, Fiverr and
   Freelancer.com, with platform filters. Show **Forward marketplace notifications here** (the private forwarding
   address) and explain that marketplaces' email notifications land here.
2. Open the Upwork message ("Hi! Are you available to start Monday…") → type
   `Hi Dana, yes, we can start Monday. I'll send a short plan today.` → **Save** ("Draft saved") → **Copy reply**.
   Say: Autopilot drafts and saves; you paste and send on the marketplace ("Autopilot sends nothing"). The ✨ button
   drafts with AI in production; skip it here (simulated locally).
3. **Freelancer** (Leo) → **Contracts** → **Message agency** → `Hi Hana, sharing the first logo concepts tomorrow.`
   → **Send** (opens **Messages**).
4. **Agency** → Freelancer Pool → **Messages** tab (the sidebar shows the unread badge) → open Leo's conversation →
   reply `Great, can you include a version in the bakery's green?` → Enter.
5. Back on Leo's window: the reply arrives without reloading (within ~4 s), and his message shows **Seen**.

## Video 3: Customizing agents through Agent Fleet (≈4 min)

Story: the fleet is yours to shape, and nothing reaches a client without your OK.

1. **Agency** → **Agent Fleet** (`/dashboard/agents`): the control center, the live map and the five starter agents.
   Say: Scout finds work, Writer drafts proposals, Applier tracks the pipeline, Closer drafts inbox replies, Account
   Keeper checks accounts.
2. **Deploy agent** → choose the **High-budget Hunter** template (a Scout that only surfaces listings of $1,000 or
   more) → **Configure**: name it `Coffee & food brands scout`, schedule **Every hour**; **Next** → **Autonomy**: pick
   **Approve each** (every draft waits for your OK) → **Next** → review → **Deploy**.
3. On the new agent's page → **Targeting**: skills and keywords `next.js, tailwind, shopify`; minimum match `70%`;
   skip listings mentioning `wordpress, unpaid` → **Save changes**. Reload: the settings persist (saved on the server).
   Then open the starter **Writer** (click it on the live map → **Edit prompt and rules**) → tone and **Prompt and
   rules** `Always mention food & beverage experience. Never promise delivery under 5 days.` → **Save changes**.
4. **Dry run** (optional): the run log explains what the agent would do without saving anything. On the local stack
   job feeds are blocked, so it reports "No new matches in 0 listings". Say "this test environment has no live job
   feeds", or skip the step. Live matches can only be shown on staging, after approval.
5. **Guardrails** (top tabs): daily draft cap, quiet hours and the kill switch. **Approvals**: where drafts wait.
   End on the control center with **Pause all**.

## Do and don't

- Do say at the start of each video that it's recorded on a test environment with synthetic data.
- Don't open Banking, Capital, Credit, Treasury or Marketplace in these videos. They are simulated (every page says
  so) and not part of these three workflows. If they appear, keep the "Simulated demonstration" banner visible.
- Don't show real names, real email addresses, real API keys or real marketplace accounts.
