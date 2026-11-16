# AutoGig token: initial tokenomics proposal (for the client's review, NOT final)

**This is a discussion proposal, not an offer, not advice and not a design a lawyer or financial professional has reviewed.** No token
exists or will be deployed from this repository until the gates in `docs/crypto-token-feasibility.md` section 10 pass. Nothing here
promises, implies or guarantees a return, a price, a listing or a compliance outcome. Do not use this table as a substitute for
professional tokenomics, legal and tax review.

## 1. The core decision the client must make
The client wants "anyone who wants to invest and potentially earn a return". A token sold to the public whose value depends on the
platform's lending and fee income is very likely a **security** in many places (and a regulated crypto-asset in others). That is the
opposite of "anyone can buy it". The three structures:

| Option | What it is | Fit with "anyone can invest" | Legal weight | Recommendation |
|---|---|---|---|---|
| **A. No token yet** | Keep the simulated pool and credit prototype; add a token only after counsel and a licensed partner exist | Not yet | Lowest | **Do this first.** It is what is built |
| **B. Permissioned pool token** (existing design, `docs/token-program.md`) | One token = one pool share, ERC-3643, only verified investors' registered wallets can hold it, mint/burn at pool value, testnet only | Only verified/eligible investors, not "anyone" | High (securities), but the structure is built for it | The compliant direction for a real pool |
| **C. Fixed-supply "AutoGig" utility/governance token** | A new ERC-20 with an allocation table (section 3), used for fee discounts, access or governance | Anyone can hold it on-chain | Highest if buyers expect profit; "utility" labelling does not remove regulation | **Not recommended** for funding the credit pool; only with counsel |

## 2. Token facts to settle (all proposals)
| Item | Proposal | Why it needs a decision |
|---|---|---|
| Name / symbol | AutoGig / `AUTOGIG` | Trademark and existing-token name check required |
| Chain | Base (see `docs/autogig-architecture.md`) | Counsel and partner support |
| Standard | Option B: ERC-3643 via audited Tokeny T-REX (already integrated). Option C: plain ERC-20 from OpenZeppelin | |
| Decimals | 6 for Option B (one raw unit = one ledger share unit); 18 for Option C | |
| Admin | Multi-signature Safe owns everything; time-lock on upgrades and parameter changes; no single key | |
| Transfers | Option B: allow-listed wallets only, paused until the Safe unpauses. Option C: free transfer | |
| Mint/burn | Option B: no fixed supply, minted on subscription and burned on redemption at pool value. Option C: **fixed supply, no mint function** | |
| Features to avoid | Transfer taxes, blacklists beyond the compliance module, rebasing, hidden minting, upgradeable logic without a time-lock | Exchange and wallet red flags |

## 3. Illustrative allocation for Option C only (placeholder numbers)
Shown because the client asked for a proposal. **These percentages are a starting point for a professional, not a recommendation,
and exist only to show what must be decided.**
| Bucket | % of supply | Mechanics to decide |
|---|---|---|
| Credit-pool and insurance reserve (treasury multi-sig) | 30 | Spending policy, who can move it, reporting; a reserve held in the platform's own volatile token cannot back dollar-denominated credit or claims |
| Ecosystem and user incentives | 20 | Rules, caps, no promise of value |
| Liquidity provision | 10 | Who funds the pool, who holds the LP position, lock |
| Team and contractors | 15 | Vesting with a 12-month cliff over 4 years, on-chain |
| Early supporters (only if lawful) | 15 | Jurisdiction, exemptions, lock-ups, KYC |
| Security and audit reserve | 5 | Audits and a bug bounty |
| Community and grants | 5 | Governance of grants |
| **Total** | **100** | Fixed supply, number to be set; no further minting |

## 4. Treasury design (any option)
Separate wallets by purpose (operations, credit pool, insurance reserve, incentives), all multi-signature with hardware signers and a
published policy; monthly reconciliation of on-chain balances to the ledger (the existing indexer does this for Option B); public
transparency report without personal data (`/api/token/transparency`). **Never mix demo ledger balances with real company funds; the
simulated accounts stay labelled and separate.**

## 5. What the token must not be used for in this phase
No public sale, no presale, no promised yield, no revenue-sharing or profit-distribution contract, no DEX/CEX listing, no accepting
investor funds. Wording in the app must not suggest a price or return. Volatility, liquidity, smart-contract, custody, regulatory and
loss-of-key risks must be disclosed to anyone who is ever allowed to hold it (`docs/crypto-token-feasibility.md` sections 4-9).

## 6. Approval needed from the client
1. Pick Option A, B or C (recommendation: A now, B when a lawyer and a partner exist).
2. Confirm the chain (Base) and the stablecoin (USDC).
3. Confirm the name and symbol after a conflict search.
4. Engage a crypto-experienced lawyer and a professional tokenomics adviser before any numbers are final.
