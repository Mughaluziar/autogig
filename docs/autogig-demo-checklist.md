# AutoGig prototype: demonstration checklist

**Everything shown is a simulation.** Say so at the start: no real money, lending, investing, insurance or token exists; the
platform is not production-ready. Use only synthetic accounts and test files. Do not demonstrate on a server with real users' data.

## Before the demo (10 minutes)
- [ ] Start a throwaway MongoDB and the API with `SIMULATED_MODULES=all` (local) or invite the demo accounts (`/api/admin/users/{id}/simulated-access`).
- [ ] Set `OWNER_EMAILS` to a demo owner address; leave `REQUIRE_EDGE_PROOF`, `TOKEN_PROGRAM_ENABLED`, `TOKEN_MAINNET_ENABLED` at their defaults (off).
- [ ] Create four accounts: owner (agency), freelancer, a second freelancer (unverified), investor.
- [ ] As the freelancer open **Capital** and submit verification; as the owner approve it (simulated identity check).
- [ ] Prepare a small PDF or PNG (no real personal data) and, optionally, a browser wallet extension with a test account.

## Script (about 15 minutes)
1. **Investor** `/investor/credit`: read the simulation banner; add a $2,000 demo contribution (note the risk checkbox and the disabled button until ticked); show the pool, the simulated statement ("never a forecast", net result can be negative), the risk disclosures and "AutoGig token: not issued".
2. **Wallet (optional):** connect the wallet; show only the address and network. Open the browser's wallet log or say it asked only for accounts and chain id: no signature, no transaction.
3. **Unverified freelancer** `/freelancer/credit`: show why they cannot apply.
4. **Verified freelancer:** apply for $1,000, attach the PDF (try an `.html` file to show it is refused), send.
5. **Owner** `/dashboard/credit/admin`: show the treasury (contributions, available, committed, outstanding, ledger check "Balanced"), open the review dialog, download the file (it downloads, never opens in the browser), set grade B, 10% flat fee, 3 installments, send the offer. Point out the funds are now "committed" and available cash dropped.
6. **Freelancer:** view the offer (flat fee, total to repay, "nothing is lent"), tick the terms, accept; show the 3-line schedule; record a $400 repayment (fee first) and see what is still owed.
7. **Owner:** treasury again: outstanding, repayments, fees, ledger check; the audit history (including that the owner viewed the document).
8. **Failure paths:** reject an offer on a second application (funds return); show an out-of-range amount; try repaying more than owed; open another freelancer's agreement URL (404).
9. **Late/default:** the hourly job does this automatically; for the demo press "Run late / default checks" after changing the date, or explain it from the tests (`test_credit_jobs.py`). Show a defaulted agreement's write-off and the investor's negative simulated net.
10. **Mobile:** repeat steps 1, 4 and 5 on a phone-width window.

## Things to say out loud
- Fees are flat amounts, not annual rates; nothing here is advice, an offer, or a promised return.
- The protection fund is a simulation, not insurance. Real lending, insurance, custody and any token need legal approval and licensed partners first.
- Documents are stored in the demo database without malware scanning.
- Everything was tested locally; staging, email, Sentry, backups on the cloud, and an independent security review have not happened.

## Checks that prove the claims (run locally)
`cd backend && pytest -q` (memory) and `TEST_MONGODB_URI=mongodb://127.0.0.1:27018 pytest -q` (real MongoDB); `npm run qa` (includes the wallet read-only and no-return-promise rules); the browser suite `scripts/qa/e2e.mjs` (group `credit`).
