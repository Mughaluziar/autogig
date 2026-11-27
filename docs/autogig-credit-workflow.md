# AutoGig project-credit workflow (simulated)

**Simulation.** No real loan, deposit or payment exists. Amounts are demo-ledger entries; the screens say so on every page. Real credit
needs a licensed lender or partner, a legal opinion and the controls listed in `docs/autogig-architecture.md` section 4.

## 1. Roles
| Role | Can do |
|---|---|
| Freelancer or agency (verified) | Apply, withdraw, accept/reject an offer, record repayments, see own agreements and schedule |
| Platform owner | Review applications, grade risk, make an offer or decline, run late/default checks, see treasury, agreements and the audit trail; cannot apply or review their own application |
| Investor / any simulated-access account | Contribute demo funds, ask for contributions back, see the pool, allocations (without names) and a simulated statement |
| Anyone else | 403 (simulated modules are invitation-only in production) |

## 2. Steps
1. **Eligibility:** account role freelancer/agency, **and** identity verified in the capital module (simulated KYC reviewed by the owner), not an owner, no other open application or unpaid agreement.
2. **Application** (`POST /api/credit/applications`): title, description (20+ chars), requested amount $100-$5,000, preferred installments 1-6. Status `submitted`. Then up to **3 private documents** (PDF, PNG or JPEG, 2 MB each) can be uploaded while it is waiting for review (section 6).
3. **Review** (owner): sees the text, links and signals (verification status, earlier agreements repaid/defaulted/open). Declines with a note, or offers: risk grade A-E, flat fee 1%-20%, installments 1-6, amount up to the request and up to the pool's **uncommitted** cash. Offer valid 7 days. **The money is reserved atomically in the ledger** (`credit:cash` to `credit:reserved`, rejected if cash would go negative), so two offers can never claim the same funds, even when approved at the same moment. Status `offered`.
4. **Acceptance** (applicant): must tick the terms. Exactly one accept can win (compare-and-set). The agreement is created with a schedule and disbursed from the reservation (`credit:reserved` to `credit:receivable`). Rejecting, withdrawing or letting the offer expire returns the reservation to cash exactly once (fixed ledger keys).
5. **Schedule:** equal principal installments every 30 days from acceptance plus the flat fee split the same way; shares add up to the total exactly (largest remainder).
6. **Repayment** (`POST /api/credit/agreements/{id}/repay`, idempotency key required): oldest installment first, fee before principal; overpayment is refused; a repeated key records nothing twice. Fully paid -> `repaid`.
7. **Late and default** (a background pass every hour in the API process, idempotent and safe on several instances; the owner can also press the button or call `run-jobs`): `late` the day after an unpaid installment is due; paying the overdue installments returns it to `active`; **60 days** after a missed installment it is `defaulted`, and the **unpaid principal** (not the unpaid fee) is written off to `credit:losses`. No further repayments are accepted.
8. **Audit:** every action appends a row (actor id and role, action, subject, amounts). No edit or delete route exists.
9. **Notifications** (in-app, each ending "(Simulated.)"): operators on a new application or withdrawal request; the applicant on an offer (amount, total repayable, installments, deadline), a decline (with the note), an expired offer; the borrower when funds are sent (first due date), after each repayment (amount still owed), when fully repaid, **3 days before each installment falls due** (once per installment: the reminder is recorded with a compare-and-set before it is sent, so concurrent job runs send it once), when late, and on default.
10. **Contribution withdrawals** (`POST /api/credit/withdrawals`, owner review in `/api/credit/admin/withdrawals`): a contributor asks for up to their **net contributions less their pro-rata share of written-off losses less requests already waiting** (minimum $10). Attributed fees are an illustration and are never paid out. The owner approves (it pays from **free** pool cash only, never funds reserved for offers: `credit:cash` → `credit:capital`, rejected if cash would go negative, in which case the request keeps waiting) or declines with a note; the contributor can cancel while it waits. Approval is intent (`paying`) → idempotent ledger entry → `paid`, and the maintenance pass finishes an interrupted approval. The statement shows contributed, withdrawn and net amounts, and the share of the pool is computed on net contributions. An owner can't review their own request. A waiting request blocks account deletion.

## 3. Fees and money rules
Fee = floor(principal x fee_bps / 10,000), flat, not an annual rate; the UI says so and shows total repayable. No compounding, no late fees in this prototype. All values are integer cents. The ledger rejects any disbursement that would overdraw the reservation. The acceptance stays pending for the maintenance pass or operator review.

The maintenance pass resumes an interrupted acceptance, final repayment, or default write-off from MongoDB. It uses the
original ledger keys so retries cannot move the same demo funds twice.

## 4. Statuses
Application: `submitted`, `offered`, `declined`, `accepted`, `rejected`, `withdrawn`, `expired`. Agreement: `active`, `late`, `repaid`, `defaulted`, `cancelled`. Withdrawal: `requested`, `paying`, `paid`, `declined`, `cancelled`.

## 5. Known limitations
* Uploaded files are **not scanned for malware** and not otherwise verified; see section 6.
* The risk grade is entered by hand; there is no scoring model, bureau data, affordability check or collections process.
* If the API process is stopped, late/default marking waits until it runs again; the pass catches up on its next run.
* Terms shown to the borrower are placeholders for lawyer-written terms.

## 6. Private documents
* **Storage:** the file bytes are stored in the application database (a `credit_documents` row), not on disk and not at a public URL. This keeps the existing deployment shape; a real launch should use encrypted object storage (see below).
* **Accepted:** PDF, PNG, JPEG only, judged by the file's own first bytes (`%PDF-`, PNG signature, JPEG signature), never by the name or the type the browser claims. 1 byte to 2 MB, at most 3 per application, label up to 80 characters, base64 JSON upload (no multipart dependency).
* **Access:** only the applicant and platform owners; everyone else gets 404, anonymous gets 401. Documents can be added or removed only while the application is waiting for review; once an offer exists they are frozen but still readable.
* **Download:** always an attachment with a generated file name (`document-1.pdf`), `Content-Security-Policy: default-src 'none'; sandbox`, `nosniff`, `Cache-Control: private, no-store`. Nothing the uploader typed reaches a header. Every owner view is written to the audit trail.
* **Privacy:** bytes never appear in lists, exports or the audit log; documents are deleted with the account (they are in the data map as "delete").
* **Not done (needed before real use):** malware scanning, encryption at rest with a managed key, a retention schedule, per-document access expiry, and a content-disarm step. Demo users are told not to upload real identity or bank documents.
