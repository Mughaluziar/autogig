# Landing page: funnel and copy

_Rebuilt 2026-11-12. Page: `app/(marketing)/page.tsx`. Components: `components/marketing/landing/`. Settings the business owns: `lib/landing.ts`._

## The funnel, top to bottom

Each section has one job. A visitor who stops reading at any point has still seen the main call to action, and every call to action has a `data-cta` attribute so an analytics tool can measure it without code changes.

| Stage | Section (anchor) | Job | Principle |
|---|---|---|---|
| Attention | Hero (`#hero`) | "I'm a… Freelancer / Agency / Investor" picker, then a headline written for that reader, and a live Job Radar preview the visitor drives by typing their own skill | Relevance beats cleverness: each persona sees its own pitch. Typing a skill and watching matches appear is the product demo and the first commitment (foot-in-the-door). |
| Attention | Trust strip | Platform names and three facts (official APIs, approval before sending, payouts) | Recognition lowers the effort of switching. |
| Interest | Pain → fix | Four pains crossed out, each with its fix | Problem–solution in one glance. |
| Interest | Everything in one login (`#offer`) | All 13 offerings as tiles, the visitor's persona first and marked "For you" | Shows the full breadth without a wall of text; personal sorting keeps choices small. |
| Desire | **Auto-find** (`#auto-find`) | Big and bold: Job Radar vs Gigs, Scan → Match → Send, a "what does pitching cost you" calculator, and the agent fleet | Self-persuasion: visitors compute their own monthly cost of searching and pitching (IKEA effect). |
| Desire | **Freelancer insurance** (`#insurance`) | Big and bold: 80% / 24h / 4%, a live cover-offer calculator, how claims work | Loss aversion: a cancelled order is the pain freelancers fear most. |
| Action | **Cards** (`#cards`) | 90-day countdown with progress bar, debit waitlist, inline personalized credit offer | Urgency tied to a real, fixed date. The 4-step credit flow uses a progress bar (goal-gradient) and ends in an offer built from the answers. |
| Action | Get paid (`#get-paid`) | Invoices and milestones paid by debit, credit or crypto, plus the early-pay calculator | Concrete money moments. |
| Action | Funding (`#funding`) | Up to $250,000 in business financing; the funding ladder (early pay → $10,000 project funding → $250,000 financing); early-access form | Anchoring on the large number, then a path to it. |
| Action | Invest (`#invest`) | Crypto investment marketplace, portfolios, revenue sharing; Direct vs Platform Index toggle; revenue-share worked example; investor early-access form | A second audience gets its own path and its own hero. |
| Action | How it works (`#how`) | Three steps | Shows the effort is small. |
| Action | Pricing (`#pricing`) | Basic free → `/signup`; Plus and Pro → `/checkout?plan=plus|pro` (free trial) | A highlighted default reduces decision effort. |
| Action | FAQ (`#faq`) | Objections: account bans, auto-find, payments, insurance, cards, credit checks, investing, trial, crypto | Removes the last doubts at the point of decision. |
| Action | Final CTA (`#final-cta`) | Persona-specific close with risk reversal | "Free plan forever · No card required · You approve every send." |

Funnel mechanics around the sections: a mobile sticky bar (persona-aware) once the hero scrolls away, and on desktop a once-per-session nudge after 60% scroll depth or on exit intent (`scroll-capture.tsx`). Neither shows once the final call to action is on screen.

## Personas ("text picked for the reader")

`PERSONA_COPY` in `lib/landing.ts` holds the headline, sub-copy, bullets, CTA, sticky label and closing pitch for each persona. The page starts as the freelancer pitch (so it's complete without JavaScript), then switches to `?for=freelancer|agency|investor` from the link, or to the visitor's last choice (localStorage `autopilot-persona`). Use `?for=` in ads and emails to land each audience on its own pitch.

## What we deliberately did not do

- **No invented social proof.** No testimonials, user counts, ratings or returns. Add real testimonials and logos as they come in; social proof is the biggest lift still missing.
- **No fake urgency.** The countdown runs to a fixed date (`CARD_LAUNCH_AT`); it never resets per visit, and switches to "Rolling out now" once the date passes.
- **Previews are labelled.** The hero radar says its matches are examples built from the skill typed; the marketplace listings, sample invoice and investing allocations say "Illustrative" or "Example".

## Settings to confirm before launch

| Setting | Where | Default |
|---|---|---|
| Card launch date | `NEXT_PUBLIC_CARD_LAUNCH_AT` (ISO 8601) or `CARD_LAUNCH_AT` in `lib/landing.ts` | `2027-02-10T14:00:00Z`: 90 days after the countdown went live on 2026-11-12 |
| Founding-member perks | `FOUNDING_PERKS` | 3 months of Pro free, priority access, founding card design |
| Planned reward targets | `PLANNED_REWARDS` | 3% on the visitor's top two spend categories, 1% on everything else. Shown as "planned reward targets, not final terms": confirm with the issuing bank or lower them before launch. |
| Personalized offer rules | `buildOffer()` | Business vs Starter card by role and revenue; funding early access for agencies and $50k+/mo |
| Product limits on the page | `COVER`, `EARLY_PAY`, `FUNDING` | Mirror `backend/app/capital/policy.py` (80% cover, 4% premium, $2,000 max; 70% early pay, 3% fee, $2,500 max) and the $10k / $250k funding headlines |
| Plans | `LANDING_PLANS` | Basic $0, Plus $9, Pro $19; paid plans link to the trial checkout |

Everything in `lib/landing.ts` is a promise to waitlist members, so keep it to things the team controls or labels as a target.

## Waitlists

Signups from the cards, funding and investor sections go to `POST /api/waitlist` (public, no account needed). Platform owners list them with `GET /api/waitlist?product=debit-card|credit-card|financing|investor`. Each entry stores the email, an optional first name, the answers (allowlisted keys, size-limited) and a timestamp; one entry is kept per product and email. The debit form sends `payout` (where the visitor gets paid today); the credit flow sends `role`, `revenue`, `spend`, `rewards` and the `offer` id. Without a backend (the frontend-only demo), the forms say that nothing was sent.

The hero radar stores the skill the visitor tried in sessionStorage (`SIGNUP_SKILL_KEY`) so the signup or radar setup can prefill it.

## Compliance notes

The page markets products that aren't live yet. The copy and disclaimers keep that clear:

- **Cards and financing** say "coming soon" or "early access", state that joining is not a credit application, and name licensed partners as the future provider. Reward percentages are labelled as planned targets. Before launch, any advertised rate, fee or limit needs the issuer's and lender's disclosures (in the US, Truth in Lending / Reg Z).
- **Freelancer insurance** says it's order protection backed by the protection fund, not a licensed insurer, and that settlement is simulated during beta (see `capital-program.md`).
- **Investing** is limited to accredited or professional investors, warns that capital is at risk, says the page is not an offer of securities, and that tokens run on test networks during beta (see `token-program.md`).
