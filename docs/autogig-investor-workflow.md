# AutoGig investor experience (simulated prototype)

**Everything on these screens is a simulation.** No real money is accepted, held, lent or paid out; no return is promised; the
AutoGig token is not issued. Real investor access is a regulated activity and is BLOCKED pending legal advice (`docs/autogig-funding-requirements.md` #4).

## Screens (`/investor/credit`)
| Section | Content | Notes |
|---|---|---|
| Simulation banner | Plain statement that nothing is real | On every page; also the platform-wide simulated banner |
| Funding pool overview | Contributions, available to allocate, committed, outstanding credit, fees, defaults written off, cash | Losses are shown next to fees |
| Add a demo contribution | $10-$10,000, risk acknowledgement required, idempotency key per form | Cannot be withdrawn in this prototype |
| Simulated statement | Contributed, share of pool, attributed fees (70% of fee income pro rata), attributed losses, **simulated net result (can be negative)** | Wording: "never a forecast". Integer maths |
| Allocations | Every credit funded from the pool, anonymised: reference, date, grade, amount, principal repaid, status | Transparency without personal data |
| Transaction history | Own contributions | |
| Risk disclosures | Default, concentration, no insurance/guarantee, token not issued | |
| Wallet (read-only) | Chooser of discovered browser wallets, shows shortened address and network name | No signing, no transaction, nothing stored or sent to the server |

## Not provided on purpose
No projected-return calculator or chart, no "APY", no revenue-share contract, no withdrawals, no secondary market, no token purchase, no
exchange listing. Adding any of them is a legal decision first.

## Open questions for counsel
Who may be an investor and where; whether a pooled credit product is a collective investment scheme, a note or a loan participation;
what disclosures and cooling-off periods apply; how contributions are held; what the platform may call "interest"; whether fee-share
attribution constitutes a profit-sharing arrangement. See `docs/legal-review-questions.md`.
