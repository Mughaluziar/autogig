# AutoGig funding ecosystem: requirements and status

Source: the client's new requirements (received 2026-11-16, copied below as the client stated them), treated as **new scope**
separate from the original platform agreement. Status words: COMPLETED (implemented and verified) / PARTIAL / BLOCKED (needs an
external account, approval or third party) / NOT STARTED / DEFERRED (deliberately excluded from this phase).
**Everything built here is a simulation or a design document. No real money, lending, investing, insurance or token sale exists.**

## 1. The client's requirements and how each is handled
| # | Client requirement | Status | What exists / what is missing |
|---|---|---|---|
| 1 | Blockchain: the most accessible and popular suitable network | **COMPLETED (recommendation only)** | `docs/autogig-architecture.md` section 2 compares BNB Smart Chain, Polygon, Ethereum and Base (Ethereum L2) and recommends **Base**, with reasons and the points that need the client's and counsel's agreement. Nothing is deployed |
| 2 | Token name: AutoGig | **PARTIAL** | Name and symbol proposed (`AUTOGIG`, subject to a trademark/name check); shown as "not issued" in the UI. No token contract is written or deployed. Existing testnet-only permissioned pool token (T-REX) is unchanged |
| 3 | Propose initial tokenomics and allocations for client approval | **COMPLETED (proposal)** | `docs/autogig-tokenomics-proposal.md`: three structures, an illustrative allocation table, and why a return-bearing token for the public is a legal gate. **Needs client approval and a lawyer; not final** |
| 4 | Investors: anyone who wants to invest and potentially earn a return | **BLOCKED (legal)** | Open public investing for a return is very likely securities/lending regulation. The prototype offers demo contributions only. Public access needs counsel, an exemption or a licensed partner. The existing permissioned design is the compliant direction |
| 5 | Wallet support for as many commonly used wallets as practical | **PARTIAL** | Every injected browser wallet that supports EIP-6963 or `window.ethereum` (MetaMask, Coinbase Wallet, Rabby, Brave, Trust, OKX...) via `lib/wallets.ts`, read-only. **Mobile/QR wallets (WalletConnect) are BLOCKED**: Reown AppKit needs a project id and has a non-open-source license (`docs/open-source-evaluation.md`) |
| 6a | Users contribute funds to keep the platform liquid | **COMPLETED (simulated)** | Demo contributions with risk acknowledgement, idempotency, limits (`/api/credit/contributions`, `/investor/credit`). Real contributions are BLOCKED (custody, securities law) |
| 6b | Verified freelancers/users can request funds before a project starts | **COMPLETED (simulated)** | Credit application (identity-verification gate, private PDF/PNG/JPEG uploads), `/freelancer/credit`, `/dashboard/credit` |
| 6c | Platform reviews applications and provides credit offers | **COMPLETED (simulated)** | Owner review queue with risk grade, fee, installments, expiry; offer acceptance/rejection; `/dashboard/credit/admin` |
| 6d | UI/UX like a professional banking or insurance platform | **PARTIAL** | Consistent cards, tables, statuses, empty/loading/error states, accessible forms, mobile-checked. Built on the existing design system; no separate brand redesign (see section 3) |
| 7 | Investor economics: share of payment income or securities, insurance fees, interest and fees on project credit | **PARTIAL (illustration only)** | A pro-rata **simulated** attribution of credit fees (70%) and losses is shown on the statement, labelled "not a forecast". **No revenue-share contract, profit distribution, insurance fee or promised return is implemented or allowed** (section 4 of the requirements brief) |
| 8 | Initial funding provided by users | **BLOCKED (legal/custody)** | Simulated only. Real funding needs a regulated structure, a licensed custody/settlement partner and a legal opinion |
| 9 | Simple first version, quick launch, expand later; traction | **PARTIAL** | The simulated prototype is the "first version". A public launch is not achievable without the legal and external gates; see `docs/autogig-two-week-mvp-plan.md` |
| 10 | Two-week development target | **PARTIAL** | The local prototype was built in this session; the two-week *launch* target is not achievable (section 4 of the MVP plan) |

## 2. What existed before this work (verified in the code, not assumed)
Reused unchanged: the integer-cent double-entry capital ledger, simulated identity verification (KYC) and investor checks, the
simulated investor pool and early payment, the protection fund ("not insurance"), the marketplace/banking simulations, the
permissioned token layer for Base Sepolia (testnet only, mainnet blocked in code), the simulated-modules gate, data export/deletion.
`docs/capital-program.md`, `docs/marketplace-and-banking.md`, `docs/token-program.md` describe them.

## 3. Out of scope for this phase (DEFERRED)
Real payments or custody; real lending/credit disbursement; deposit/withdrawal of contributions; revenue-share agreements; any
insurance product; a token contract or sale; DEX/CEX listing; scanning/encryption/retention for uploaded documents; a separate fintech
brand/visual redesign; mobile-wallet (QR) connection; automatic credit scoring (the owner assigns the grade by hand).

## 4. The client's wording (for the record)
Blockchain: most accessible and popular suitable network. Token name AutoGig. Proposed initial tokenomics and allocations for
approval. Investors: anyone who wants to invest and potentially earn a return. Support many common wallets. Funding model:
users contribute to keep the platform liquid; verified freelancers/users request funds before a project starts; the platform
reviews applications and provides credit offers; professional banking/insurance UI. Investors potentially share in
payment-related income or securities, insurance fees, and interest/fees from project credit. Initial funding from users. Simple
first version in two weeks, then expand.

## 5. Commercial scope (not a legal statement)
The client has discussed a guaranteed payment within 14 days after launch, 20% company equity and a possible bonus. These are
**not a substitute for a signed agreement**, and this repository makes no statement about equity, ownership or securities. This
funding ecosystem is **additional scope beyond the original Fiverr order**; it should be quoted and agreed separately, with the
dependencies in `docs/autogig-two-week-mvp-plan.md` section 3 written into that agreement (legal opinions, partner accounts and
audits are outside the developer's control and must not be tied to a delivery date).
