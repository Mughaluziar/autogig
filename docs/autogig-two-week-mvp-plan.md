# AutoGig: two-week MVP plan and honest assessment

## 1. What "MVP" means here
A **working prototype** that can be demonstrated to investors and users: simulated funding, credit applications, owner review, offers,
repayment tracking and a treasury view, on top of the existing platform. It is **not** a live financial product.

## 2. Status against the client's MVP priorities
| # | Priority | Status |
|---|---|---|
| 1 | AutoGig branding and token information | PARTIAL: "AutoGig funding pool" naming and "token not issued" statements in the UI; no logo/brand system; token proposal in docs |
| 2 | Testnet token prototype only if justified | NOT STARTED, on purpose: the permissioned pool token already exists for Base Sepolia; a new token is not justified before the legal decision (`docs/autogig-tokenomics-proposal.md`) |
| 3 | Wallet connection | COMPLETED for browser wallets (EIP-6963, read-only); mobile/QR BLOCKED |
| 4 | Investor dashboard (demo data labelled) | COMPLETED |
| 5 | Simulated contribution and allocation flow | COMPLETED |
| 6 | Freelancer credit application | COMPLETED |
| 7 | Admin verification and approval workflow | COMPLETED (verification from the existing capital module; grading by hand) |
| 8 | Credit offer interface | COMPLETED |
| 9 | Simulated repayment ledger | COMPLETED |
| 10 | Treasury dashboard | COMPLETED |
| 11 | Responsive UI/UX | COMPLETED for the new pages (390px checked in the browser suite); the wider platform's responsive checks were already in place |
| 12 | Role-based access and security tests | COMPLETED (see the security review and the test counts in the report) |

## 3. External dependencies that cannot be scheduled by the developer
Legal opinions on securities, lending, insurance and virtual assets in the target countries; a licensed lending/settlement/custody
partner; KYC vendor; Atlas, Render, Vercel, email, Sentry, Groq accounts; a smart-contract audit (weeks, paid, third party); staging
verification (`docs/staging-verification.md`); decisions on chain, token structure and name. **None of these can be completed by
coding, so none can honestly be promised inside two weeks.**

## 4. Is the two-week target achievable?
* **Simulated prototype: achieved locally** within this work (all rows above except branding polish and mobile wallets).
* **Public launch with real investor money or real credit: not achievable in two weeks, and must not be tied to that date.** The critical
  path is legal advice and a regulated partner, which typically take longer and cost real money, then an independent audit if a token
  exists, then staging and monitoring. Rushing a launch would put users' money, the client and the developer at legal risk.
* **Realistic next phase (suggested, each needs the client's approval):**
  1. Week 1-2: client decisions (structure, chain, name), lawyer engaged, staging deployed with test accounts (blockers in the readiness report).
  2. Weeks 2-6: legal opinions, partner selection, remove "simulated" only where a partner takes over; real KYC; document upload with scanning.
  3. Only if a token is approved: specification and threat model, contracts from OpenZeppelin/T-REX, testnet, independent audit, then a restricted pilot.

## 5. Traction without a regulated product (suggestions, no legal advice)
Use the working simulation for demos and a waitlist of freelancers and prospective investors (the waitlist form exists); gather real
alert emails and early freelancer users for the Upwork assistant; publish the transparency page and the roadmap with honest "simulation" wording; avoid
return projections and token-sale talk until counsel clears it.

## 6. Commercial terms
The discussed payment, equity or bonus terms are not part of this plan and are not a substitute for a signed agreement; nothing in these documents is a legal statement about equity, ownership or securities. This scope is additional to the original order and should be quoted and agreed separately, with section 3 written in as client-side dependencies.
