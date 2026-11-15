# Ecosystem token: feasibility study (separate scope, not part of the current agreement)

**Status: research and discussion document only.** Nothing here has been built, deployed, audited or reviewed by a lawyer or a
financial professional. It is **not** legal, tax, financial or investment advice, and it is **not** a tokenomics design. The
numbers in section 4 are structural examples to show what questions must be answered, not recommendations. No token will be
deployed, no investor money accepted, no returns promised and no compliance claimed by this project until the gates in
section 10 are passed by qualified professionals.

## 1. What is being asked
The client wants a real ecosystem token that funds insurance and other business operations. That is a new product with new
risk, so it is additional scope beyond the platform delivered so far. Today the platform contains only a **simulated** token
program (an internal ledger, no chain, no wallet, no real value; `docs/token-program.md`) and a **simulated** "protection fund,
not insurance" (`docs/capital-program.md`). Both are labelled as demonstrations and are invitation-only in production.
**A real token must not be switched on by flipping those modules.** They were built as demonstrations and are legally and
technically different from a live token.

## 2. Blockchain options (ownership of the decision stays with the client and counsel)
| Option | Fit | Notes / trade-offs |
|---|---|---|
| Ethereum mainnet | Deepest liquidity, most tooling and auditors | High gas fees; expensive for many small user actions |
| Ethereum L2 (Base, Arbitrum, Optimism) | Cheap transactions, EVM tooling, large DEX markets | Inherit L1 security with their own sequencer/bridge risk; bridging UX |
| Polygon PoS / zkEVM | Cheap, EVM | Different security model; check current status before choosing |
| BNB Chain | Cheap, large retail base | More centralised validator set; regulatory perception varies by jurisdiction |
| Solana | Very cheap, fast | Different language (Rust), different audit pool, new tooling for the existing Hardhat contracts |
| Non-EVM / own chain | Not recommended | A chain is a security burden far beyond the project |

The repository's `contracts/` folder uses Hardhat (EVM/Solidity), so an EVM chain keeps the existing tooling. Prefer a
well-used L2 or mainnet for liquidity and auditor availability. This is a trade-off for the client and counsel, not a decision
made here. Re-check each chain's fees, status and exchange support at decision time; they change.

## 3. Basic token architecture (minimum, if approved later)
* **Standard:** ERC-20, using a maintained library (OpenZeppelin) with no custom arithmetic or custom transfer hooks.
* **Supply:** fixed and decided in advance, or mint-capped; no hidden or owner-only unlimited mint. If minting exists, it is a
  documented role behind a multi-signature wallet and a time-lock.
* **Admin keys:** no single key. Treasury and upgrade/pause roles sit in a multi-signature wallet (for example a Safe) with
  hardware-wallet signers, a published signer policy and a time-lock for sensitive changes. Lost-key and signer-rotation procedures
  written down before launch.
* **Upgradeability:** avoid proxies unless there is a clear need; if used, time-locked and audited as part of the system.
* **Features to avoid at first:** transfer taxes, blacklists/freeze powers, rebasing, anything that can trap holders' funds. These
  attract regulatory and security problems and some are red flags for exchanges and wallets.
* **Vesting and treasury:** vesting contracts for team/advisors/treasury with cliffs; treasury moves only through the multi-sig.
* **Off-chain:** the platform would show balances read from the chain; it must never hold private keys or seed phrases for users.

## 4. Tokenomics and treasury: questions that must be answered by professionals
Not answered here. A professional (tokenomics adviser plus a lawyer plus an accountant) must decide, and the project must be able
to explain each answer to a regulator:
* What does the token do for its holder that is not "profit from others' efforts"? (utility, governance, fee discount, access)
* Supply, allocation percentages (team, treasury, community, liquidity, investors), vesting length, unlock schedule.
* Who sells to whom, at what price, and under which exemption (see section 8). A sale of tokens to raise money for the company's
  insurance business is the single highest-risk activity in this document.
* Treasury: custody, currency mix (stablecoin vs. own token), spending policy, reporting, who may spend, how often it is audited.
* Why the company's own token should fund an insurance liability at all: a liability valued in dollars funded by an asset whose
  price can fall 90% in a week is a solvency problem, not just a marketing choice.
Do not use AI-generated (or any unreviewed) tokenomics as a substitute for this review.

## 5. Insurance funding structure
Today's "protection fund" is explicitly **not insurance**: it reimburses losses the platform itself records, from a ledger
(`backend/app/capital/`, covered by `tests/test_capital.py`). Real insurance is a regulated activity.
* Options a lawyer would compare: (a) a licensed insurer or MGA/fronting arrangement where the platform is distributor; (b) a
  discretionary mutual or a cover-pool such as on-chain "discretionary cover" models, which are legally contested and treated
  differently by jurisdiction; (c) staying a clearly-labelled limited fee-funded reserve with no promise to pay.
* Whatever is chosen: capital and reserving rules, claims process, who decides claims, fraud controls, conflicts of interest, what
  happens when the pool is empty, and consumer-disclosure wording. Do not market anything as "insurance", "guaranteed" or "safe"
  unless counsel confirms that is lawful for that product and place.
* A token-funded pool adds price risk, liquidity risk and oracle/governance risk on top of the above.

## 6. Smart-contract security and independent audit
* Written specification and threat model before code; unit and property/fuzz tests (Foundry or Hardhat) with high coverage;
  static analysis (Slither) in CI; a testnet period.
* **Independent audit by at least one reputable firm** (two for anything holding treasury funds), the report published, and a
  fix-review round. A bug bounty (for example on Immunefi) before and after mainnet. Audits reduce risk; they do not guarantee safety.
* Audit cost and calendar time are significant and usually run to tens of thousands of USD and several weeks per firm; get quotes
  rather than relying on this document.
* Deployment runbook: deterministic builds, verified source on a block explorer, multi-sig ownership transferred at deploy, an
  incident and pause plan, monitoring of treasury and admin transactions.

## 7. DEX launch requirements (technical)
* A liquidity pool (for example Uniswap v3/v4 on the chosen chain) seeded with the token and a paired asset (ETH or a stablecoin).
  Someone must fund that liquidity: this is real money at risk of impermanent loss.
* Decide who holds the liquidity-provider position (multi-sig, locked or time-locked), and publish it.
* Anyone can list a token on a DEX; that is not an endorsement and offers no legal protection. Scam-token tooling, wallet
  warnings and price-impact/manipulation are the operator's reputational problem.
* Front-running/MEV and low-liquidity manipulation are common in launches; plan the launch mechanics with an expert.

## 8. CEX listing limitations
* Centralised exchanges decide listing at their discretion, charge fees or require market-making arrangements, and run their own
  legal/compliance review (KYC/KYB of the issuer, legal opinion, audit report, token-classification analysis, team background).
* Many will refuse or restrict tokens that look like securities in their key markets; some jurisdictions are closed to listings.
* A listing cannot be promised to anyone, and no price or listing timeline may be advertised.

## 9. Legal and regulatory dependencies (a lawyer qualified in the relevant jurisdictions must answer these)
* Is the token a security, a regulated crypto-asset (for example under the EU's MiCA, where an issuer may need a white paper and
  authorisation), a commodity, or something else, in each place it is offered? The answer differs by country and by how it is sold.
* Securities or crowdfunding laws on any sale to the public or to investors; accredited-investor and geographic restrictions.
* Insurance, lending or money-transmission licensing for anything that looks like cover, yield or custody.
* AML/KYC and sanctions screening on buyers, travel-rule obligations, record keeping, tax reporting and withholding.
* Consumer-protection and advertising rules on how the token and any "return" are described; anti-fraud exposure for founders.
* Data protection: public blockchains are append-only, which conflicts with deletion rights. Never write personal data on chain;
  the platform's data-export and deletion design (`docs/data-lifecycle.md`) assumes it holds no personal data on chain.
* Corporate structure: which entity issues, holds the treasury, and what liability the directors carry.
* Open questions already collected for counsel on the simulated modules: `docs/legal-review-questions.md` sections 1 and 16-22.

## 10. Gates before any build, sale or deployment (all required)
1. Written client decision to proceed, with scope, budget and timeline agreed as a **separate contract/change order**.
2. Legal opinion(s) from qualified counsel on classification, offering structure, insurance and licensing, jurisdiction by jurisdiction.
3. Professional tokenomics and treasury review, with an accountant on the accounting and tax treatment.
4. Specification and threat model approved; contracts written, tested, and audited by an independent firm; findings fixed and re-reviewed.
5. Multi-signature treasury and key-management policy in place; incident plan; monitoring.
6. Testnet dry run and a documented launch plan; compliance programme (KYC/AML) live if any sale is permitted.
7. Only then a mainnet deployment, and only by the client's authorised signers (never from this repository's tooling alone).

## 11. What this project will and will not do in the meantime
* Will not deploy a token, create or hold wallets/keys, accept funds, run a sale, promise returns, list on any exchange, or claim
  legal or regulatory compliance.
* The existing simulated token and protection modules stay labelled, invitation-only, and clearly "demonstration".
* The platform's public wording must not hint that a real token exists or is coming until the gates above pass.
* If the client wishes to continue, the next step is to engage a crypto-experienced lawyer and write the separate scope.
