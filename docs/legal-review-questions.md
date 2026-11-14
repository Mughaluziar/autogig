# Legal review pack (for a qualified lawyer: not legal advice, not an approval)

Prepared by the engineering side to make a lawyer's review quick. **Nothing here asserts that the product or its documents
comply with any law, and none of the legal pages has been approved.** Until a lawyer signs them off, the Terms, Privacy Policy
and AI Disclosure pages carry a visible "Draft ... not yet reviewed by a lawyer" notice (`components/marketing/legal-page.tsx`).

## 1. Simulated money features (must be stated plainly everywhere)
Banking, Marketplace and Capital are **simulated**. They record entries in Autopilot's own ledger. **No real money moves, no
bank or blockchain is contacted, and Autopilot provides no escrow, does not hold anyone's funds, is not a bank, and is not a
licensed insurer or lender.** Payouts to freelancers are only *recorded* as paid by the agency; the actual payment happens
outside Autopilot. This statement is already shown in the product (`components/marketplace/common.tsx`, `components/capital/
verification-card.tsx`, banking pages, `app/(marketing)/legal/terms/page.tsx` section 3) and is enforced by a QA check
(`scripts/qa/gapcheck.mjs` fails the build if the Terms promise escrow). The only real card processing that exists is Stripe
Checkout for invoice pay links, and it is **off** until Stripe keys are configured (checkout returns 503 and charges nothing).

## 2. Claims in the current legal pages that need review or correction
| Page / claim | What the product actually does | Issue |
|---|---|---|
| Terms intro: "By accessing or using the platform, you agree..." | **Now recorded server-side**: user id, Terms and Privacy version, UTC time, and method (signup or re-accept) in an append-only table; no IP or user agent is stored | Is click-wrap acceptance enough? Do you want IP / user agent / document hash stored too (more evidence, more personal data)? |
| Terms 2: accounts across roles | **Corrected to agency, freelancer or investor** | No Investor-specific terms exist (risk disclosures, accredited-investor wording on the landing page) |
| Terms 3: Stripe processes payments only when the operator enables it; not a bank/trustee/escrow agent | True as built (see section 1) | Wording and fee/refund/dispute language need a lawyer; no fee schedule is stated |
| Terms 3A: Autopilot does not log in to or submit on Upwork/Fiverr; user reviews and submits | True as built (human-in-the-loop; automation is refused) | Is this consistent with Upwork's/Fiverr's terms about third-party tools and forwarding their emails? |
| Terms 4: freelancers "deliver work that passes automated quality gates" and "NDA-shielding requirements" | **Reworded to what exists** (agency approves milestones; confidentiality as the agency asks) | Is that wording enough to create a confidentiality duty? |
| Terms 5: "as is", no warranties | Only limitation; no cap on liability, no indemnity, no termination, no governing law, no dispute resolution, no age limit, no IP ownership of drafts/work, no acceptable-use clause | Missing clauses |
| Privacy 1-2: collects "usage analytics"; generates proposals "via RAG" | **Privacy page rewritten to the facts**: no trackers; proposals are drafted by prompting an AI provider with job text and profile | Please review the rewrite as a whole |
| Privacy 3: "strict intermediary... NDA-shielding model" | **Removed**; replaced by a processor list and "other users see only what the product shows them" | Is the processor list (Atlas, Render, Vercel, Groq, email provider, optional Stripe/Sentry/inbound email) complete and sufficient? |
| Privacy 4: "store credentials in a dedicated secrets manager", "never log secrets" | **Reworded**: one-way password hashes, encrypted provider tokens with a key held outside the database | Is "No system is perfectly secure" acceptable wording? |
| Privacy 5: "request access, correction or deletion at any time" | **Built**: self-service export (JSON) and scheduled deletion with a 14-day grace period; details in `docs/data-lifecycle.md`. Correction of name/email is not self-service yet | Are 14 days acceptable? Is self-service sufficient or must a response deadline be promised? |
| Privacy: no list of processors | Data goes to MongoDB Atlas, Render, Vercel, Groq (job text and profile), Resend/SMTP (emails), Stripe, Sentry (errors), Nango/Microsoft (optional), inbound-email provider | Cross-border transfers and processor list undisclosed |
| Privacy: retention, cookies, children, breach notice, contact | Session and CSRF cookies only (strictly functional); no cookie banner; activity kept 180 days, notifications 90 days (TTL indexes); no stated retention for accounts | Missing |
| AI Disclosure: "Stealth mode ... human-impersonation behaviors" | **Removed from the product and from the page** (toggle, setting, code, wording); a QA rule fails the build if it returns | The Personas feature (working names for AI agents) remains: does it need explicit disclosure wording in outbound messages? |
| AI Disclosure: sentiment monitoring escalations, "all capital movements require explicit human approval", portfolio-bounded agents | Those are demo-only (not built) or simulated | Claims describe unbuilt features |

## 3. Questions for a Pakistani technology lawyer
Business and licensing
1. Which entity should operate this (Pakistani company, a foreign entity, or both), and what registrations apply (SECP, NTN/FBR, PSEB/ITES, sales-tax on services)?
2. Does recording invoice/pay-link payments through Stripe, or holding any funds later, trigger State Bank of Pakistan licensing (payment system operator/provider, EMI, Payment Systems and Electronic Fund Transfers Act 2007 and current SBP rules)? What if Autopilot only *records* payouts it does not make?
3. The Capital and Marketplace modules describe early-payment financing, investing in raises, and an insurance-like protection fund. Which of lending, investment solicitation/crowdfunding (SECP), collective investment, and insurance rules would apply **if they ever settled real money**, and can they be offered at all by a small operator? Is the current "simulated" labelling adequate while they are demonstrations?
4. There is an optional token program (disabled by default). What is the current legal status in Pakistan of issuing or distributing any token or virtual-asset product, and should that code stay disabled for launch?
5. Anti-money-laundering and KYC duties (Anti-Money Laundering Act 2010, FMU reporting) if real payments or investor funds are ever handled.

Data and privacy
6. Which data-protection regime applies today (the Personal Data Protection Bill's status, sector rules) and, because users may be in the EU/UK/US, GDPR/UK GDPR/CCPA: do we need a DPO/representative, a lawful-basis statement, DPAs with processors, and transfer mechanisms (data goes to US-hosted providers)?
7. What must the Privacy Policy say about retention, deletion/export requests (response times), breach notification, children, and cookies (we only set functional session/CSRF cookies; is a consent banner required)?
8. Users forward their own marketplace alert emails and paste job text, which then goes to an AI provider. Is that lawful processing of third-party (client/buyer) personal data and what consent/notice is required?

Contracts and terms
9. Please draft or review the Terms of Service for three user types (agency, freelancer, investor): liability cap and enforceability, indemnity, termination/suspension, acceptable use, IP ownership of work and AI-drafted proposals, fees, refunds, disputes, governing law and venue (Pakistan vs foreign users), arbitration.
10. How should the agency-freelancer relationship be framed (independent contractors, no employment, tax withholding responsibilities, cross-border payments and foreign-exchange rules for freelancers receiving foreign currency)?
11. Does forwarding a user's own Upwork/Fiverr alert emails into a tool, and drafting proposals the user submits manually, breach those marketplaces' terms or create liability for the user or for us? (We never log in to, scrape or automate those sites.)
12. Is the AI Disclosure sufficient, and are there disclosure duties when drafts are used in client communications? Should the "Stealth mode" wording (impersonation, no AI disclosure) be removed from the product altogether?

Compliance mechanics
13. Electronic Transactions Ordinance 2002 / PECA 2016: electronic acceptance records, email marketing/consent rules for the outreach feature (cold email to agencies), and any content-liability obligations.
14. Taxes: withholding or digital-services tax on subscription fees and credit packs charged to Pakistani and foreign users; invoicing requirements.
15. Insurance and liability: is professional-indemnity/cyber insurance advisable before launch?

## 4. Decisions needed from the owner before the lawyer meets
* Which modules go live at launch (investor demo only vs. real users; simulated money features visible or hidden).
* Whether the "Stealth mode" toggle stays (recommendation: remove it; it does nothing server-side and contradicts the no-stealth rule).
* Whether a data export/deletion process is built (a small feature) or run manually on request within a stated deadline.
* Which countries' users you will accept at launch.

## 5. Added in the second production-readiness pass (2026-11-14): what exists now, and new questions
**What exists (all local; nothing deployed):**
* Terms/Privacy acceptance record (above); a re-accept screen when the version changes. Versions are `draft-...` until a lawyer approves text.
* Export and deletion (`docs/data-lifecycle.md`): deleted / kept-with-name-removed / kept, collection by collection; retention period is a **placeholder** (7 years) in `FINANCIAL_RETENTION_YEARS`.
* The simulated money modules (Banking, Marketplace, Capital, pool token) are restricted by default in production to platform owners and accounts an owner invited; pages show "by invitation, a demonstration, no real money" to others.
* No concealment features: stealth mode removed.

**New questions:**
16. Retention: what period and legal basis for contract, payout and ledger records that must outlive an account? Is replacing names with "Deleted user <code>" sufficient anonymization, given that contract text and amounts remain?
17. Shared business text (contract titles, milestone text, bid notes) stays as written because it is also the counterparty's record. Acceptable?
18. Is a 14-day deletion grace period acceptable (it protects against mistaken or malicious requests but delays deletion)? Should a longer-lived backup copy at the database host be disclosed with an expiry?
19. Deletion does not call third-party processors (AI provider, email provider, Stripe, error tracker). Is a processor-deletion flow required?
20. Should the Terms acceptance log also keep IP address, user agent or a hash of the document text?
21. Can the invitation-only demonstration modules be shown to investors without a licence, and what disclaimer text is required on them?
22. Is "Deleted user" labelling plus retention enough where a freelancer's tax reporting needs the record to identify them?
