# AutoGig project-credit workflow (simulated)

**Simulation.** No real loan, deposit or payment exists. Amounts are demo-ledger entries; the screens say so on every page. Real credit
needs a licensed lender or partner, a legal opinion and the controls listed in `docs/autogig-architecture.md` section 4.

## 1. Roles
| Role | Can do |
|---|---|
| Freelancer or agency (verified) | Apply, withdraw, accept/reject an offer, record repayments, see own agreements and schedule |
| Platform owner | Review applications, grade risk, make an offer or decline, run late/default checks, see treasury, agreements and the audit trail; cannot apply or review their own application |
| Investor / any simulated-access account | Contribute demo funds, see the pool, allocations (without names) and a simulated statement |
| Anyone else | 403 (simulated modules are invitation-only in production) |

## 2. Steps
1. **Eligibility:** account role freelancer/agency, **and** identity verified in the capital module (simulated KYC reviewed by the owner), not an owner, no other open application or unpaid agreement.
2. **Application** (`POST /api/credit/applications`): title, description (20+ chars), requested amount $100-$5,000, preferred installments 1-6, up to 5 supporting documents as **https links** (no file upload in this prototype). Status `submitted`.
3. **Review** (owner): sees the text, links and signals (verification status, earlier agreements repaid/defaulted/open). Declines with a note, or offers: risk grade A-E, flat fee 1%-20%, installments 1-6, amount up to the request and up to the pool's **uncommitted** cash. Offer valid 7 days, funds reserved ("committed") meanwhile. Status `offered`.
4. **Acceptance** (applicant): must tick the terms. Exactly one accept can win (compare-and-set). The agreement is created with a schedule and disbursed in the ledger. Rejecting or letting it expire releases the reservation.
5. **Schedule:** equal principal installments every 30 days from acceptance plus the flat fee split the same way; shares add up to the total exactly (largest remainder).
6. **Repayment** (`POST /api/credit/agreements/{id}/repay`, idempotency key required): oldest installment first, fee before principal; overpayment is refused; a repeated key records nothing twice. Fully paid -> `repaid`.
7. **Late and default** (owner runs `run-jobs`, or the scheduler): `late` the day after an unpaid installment is due; paying the overdue installments returns it to `active`; **60 days** after a missed installment it is `defaulted`, and the **unpaid principal** (not the unpaid fee) is written off to `credit:losses`. No further repayments are accepted.
8. **Audit:** every action appends a row (actor id and role, action, subject, amounts). No edit or delete route exists.

## 3. Fees and money rules
Fee = floor(principal x fee_bps / 10,000), flat, not an annual rate; the UI says so and shows total repayable. No compounding, no late fees in this prototype. All values are integer cents. A simulated pool cannot go negative: a disbursement that would overdraw cash is rejected and the offer reopens.

## 4. Statuses
Application: `submitted`, `offered`, `declined`, `accepted`, `rejected`, `withdrawn`, `expired`. Agreement: `active`, `late`, `repaid`, `defaulted`, `cancelled`.

## 5. Known limitations
* No file upload or document verification; the owner clicks links (opened with `noopener nofollow`).
* The risk grade is entered by hand; there is no scoring model, bureau data, affordability check or collections process.
* Concurrent owner decisions could over-commit the pool by a small margin; the cash check at acceptance prevents overdraw (the offer then reopens).
* `run-jobs` is a manual owner action; it is not yet scheduled.
* Terms shown to the borrower are placeholders for lawyer-written terms.
