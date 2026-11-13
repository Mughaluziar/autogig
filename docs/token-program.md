# Token program: audit and proposed architecture

_Proposal and Phase 1 build, 2026-11-09. Status: **Path A chosen; Phase 1 built for test networks only** (section 11). Nothing here sells a token or collects real funds, and mainnet is blocked in code until the launch gate passes._

## 1. Summary

We want a token that raises money for freelancer protection and early payment, attracts investors, and trades on as many exchanges as possible. Under the rules in force today, **one token cannot do all three**:

- **It's a security.** A token sold to fund the investor pool, whose buyers expect a return from the platform's work, is very likely a security in the US (Howey; the SEC/CFTC taxonomy of 17 Mar 2026 calls these "digital securities"). In the EU it's likely a financial instrument rather than a MiCA crypto-asset.
- **Major exchanges won't list it.** Coinbase says it does not list securities, and none of the exchanges researched offers a route for a token it considers one.
- **US buyers can't resell it on exchanges.** Tokens sold under the usual US exemptions (Reg D, Reg CF) are restricted: they cannot trade on retail exchanges until a holding period ends, and only through registered venues.

**Recommendation: Path A.** Make the token the on-chain form of the pool shares that already exist. It's a permissioned ERC-3643 token on Base, sold only to verified investors, and it plugs into the capital module's ledger, identity checks and fee split. Defer exchange listings: plan for regulated secondary venues instead, and revisit retail listings if the SEC's proposed *Regulation Crypto Assets* becomes final. Section 4 compares the options.

## 2. Audit of the existing codebase

| Area | What exists | Reuse for the token |
|---|---|---|
| Stack | Next.js 14 frontend, FastAPI + MongoDB (motor), arq worker, Render free plan | Same stack. Contracts get their own `contracts/` workspace. |
| Capital module | `backend/app/capital/`: policy, ledger, store, service; router `routers/capital.py` | Core integration point. |
| Ledger | Append-only double-entry journal with integer amounts in `USD` (cents) and `SHARE` units. Writers serialize on the journal sequence. Idempotent entries, invariant checks, `settlement: "simulated"`. | Pool shares already exist as a ledger unit, so the token becomes their on-chain mirror. Chain events post as idempotent entries keyed by `chainId:txHash:logIndex`. |
| Investor pool | NAV-priced shares (cash + outstanding advances), deposit/withdraw with a liquidity reserve, fee split 70% investors / 20% protection fund / 10% platform | Unchanged. Token mint/burn maps to deposit/withdraw. |
| Identity | `capital_profiles`: operator-reviewed KYC, **self-attested** accreditation, risk acknowledgment, country allowlist (`CAPITAL_INVESTOR_JURISDICTIONS`) | Workflow reusable. Self-attestation is **not enough** for Reg D 506(c); a regulated KYC and accreditation-verification provider must replace it. |
| Roles | `investor` role, investor portal (`/investor`), owner-only admin (`OWNER_EMAILS`) | Extend the portal. Owner admin holds the launch gate. |
| Protection fund | Discretionary, claims need a platform-API loss event plus operator approval, sold in the UI as "order insurance", disclosed as backed by the fund and not a licensed insurer | Unchanged. The token does not change the insurance question (§7). |
| Blockchain | **None.** No contracts, wallets, RPC, keys or chain dependencies. | All new. |
| Real money | **None.** Settlement is simulated everywhere. | A settlement partner is still a prerequisite (go-live checklist in `capital-program.md`). |

The capital module's go-live checklist (securities counsel, lending licensing, regulated KYC, settlement partner, protection-fund opinion, tax) applies in full to the token. It does not disappear because the shares move on-chain.

## 3. What the research found

Gathered 2026-11-09 from primary sources where possible. Re-check each item before relying on it; listing rules change often.

**Exchanges.** None of the exchanges below charges a published listing fee except where noted, and none has a route for a token it considers a security.

| Exchange | How to apply | Notable requirements |
|---|---|---|
| Coinbase | Asset Hub (coinbase.com/listings) | Legal, compliance and security review. Rejects securities, privileged admin keys, investment-style marketing, concentrated team holdings. Free. |
| Binance | Spot form (binance.com/en/my/coin-apply); Alpha and Futures have separate forms | Steers new projects to Launchpool, Megadrop or HODLer Airdrops, which require a token allocation to Binance users. Reviews tokenomics, tech risk, team. No fees. Blacklists applications made through third parties. |
| Kraken | kraken.com/get-listed | Audits, team, tokenomics, market-maker plan. EEA listings need a MiCA white paper notified at least 20 business days before listing. About 2–6 weeks after approval. |
| OKX | okx.com/token-listing-apply | Tokenomics, funding history, team, MiCA white paper. |
| Bybit | bybit.com/en/trade/spot/listing-apply | Reported (2025) $200k–300k stablecoin security deposit plus marketing commitments. |
| KuCoin | AssetsHub | Legal opinion from a US, UK, EU, HK or SG firm, third-party audit, KYC on at least 3 core members. |
| Gate | gate.com/listing | No published requirements. |
| Uniswap v4 | Permissionless pools | **Permissioned Pools** allow trading only between allowlisted holders, so a restricted token can trade there. |

**There is no "listing API."** Applications are forms and human review. The only exchange-side integrations worth building are payment rails, for example Coinbase Business payment APIs (USDC) or Binance Pay merchant APIs, to receive subscription funds once a settlement partner is chosen.

**US.** Compliant routes to raise money today:
- **Reg D 506(c):** no cap, verified accredited investors only, restricted for 6–12 months.
- **Reg CF:** up to $5M through a registered portal, 1-year resale bar.
- **Reg A+:** up to $75M.
- **Reg S:** for non-US buyers.

The SEC's proposed **Regulation Crypto Assets** (18 Aug 2026; comments closed 20 Oct 2026) would allow unrestricted tokens up to $75M a year. It is **not final**, and whether exchanges could list such tokens is unresolved. The CLARITY Act stalled in the Senate on 15 Sep 2026.

**EU.** MiCA requires a notified white paper for public offers, unless an exemption applies: under 150 people per member state, €1M or less over 12 months, or qualified investors only. A token with fund-like rights is a MiFID financial instrument instead. Since 1 Jul 2026 only authorised crypto-asset service providers may serve EU clients.

**UK.** Crypto financial promotions are regulated (PS23/6). The full regime goes live 25 Oct 2027.

**Insurance.** A fund obliged to pay freelancers on uncertain losses likely meets insurance definitions, for example NY Ins. Law §1101. Discretionary payouts are the usual mitigation and need insurance counsel.

## 4. Options

| | **A. Tokenized pool shares (recommended)** | B. Open ERC-20 for exchange listings | C. No token: USDC settlement only |
|---|---|---|---|
| What it is | ERC-3643 permissioned token. One token is one pool share, minted and burned at NAV. | Fixed-supply ERC-20 tradable by anyone. | The existing pool settles real deposits and withdrawals in USDC. |
| Raises money for protection and advances | Yes, from verified investors | Only by a public sale, which is a securities offering | Yes, the same pool without a token |
| Binance / Coinbase listing | No (restricted security) | Possible **only** if it is not a security: real utility, no sale for profit, no fee share | n/a |
| Secondary trading | Uniswap v4 permissioned pools, regulated ATS (tZERO, Securitize Markets, INX) after holding periods | Open markets | None |
| Fit with existing code | Direct: SHARE unit, NAV, KYC, fee split | Weak: a separate economy beside the pool | Direct: swaps the simulated settlement |
| Legal path | Reg D 506(c) + Reg S, MiCA qualified-investor exemption | Needs a strong non-security opinion. Any fundraising use undermines it. | Lending/settlement licensing only |

**Why not B:** the moment B is sold to fund the pool or pays holders from fees, it becomes A legally, and the exchanges will refuse it. B only works as a separate utility token (for example, paying protection premiums at a discount), which does not raise capital.

**Possible sequence:** C (real USDC settlement), then A (tokenized shares for verified investors), then optionally B (a utility token) if counsel and the exchanges' legal reviews support it.

## 5. Proposed architecture (Path A)

```
 Investor wallet (allowlisted)                 Safe multisigs (no server keys)
        │  USDC subscription                     ┌─ Raise / Pool Safe ─────┐
        ▼                                        │  holds pool USDC         │
 ┌─────────────────────┐   mint/burn (agent)     ├─ Protection Fund Safe ──┤
 │ PoolShareToken      │◄────────────────────────┤  20% of fees            │
 │ ERC-3643 on Base    │                         ├─ Platform Ops Safe ─────┤
 │ IdentityRegistry    │   identity claims       │  10% of fees            │
 │ Compliance modules  │◄── ONCHAINID ◄── KYC ───┘                          │
 └─────────┬───────────┘     provider            └─────────────────────────┘
           │ Transfer / Mint / Burn events                 ▲ proposals only
           ▼                                               │
 ┌─────────────────────────────────────────────────────────┴──────────┐
 │ backend/app/token/                                                  │
 │  chain.py      JSON-RPC over httpx (eth_getLogs, eth_call)          │
 │  indexer.py    arq cron: confirmed events → idempotent ledger posts │
 │  subscribe.py  subscription intents, eligibility, Safe tx proposals │
 │  reconcile.py  totalSupply == ledger shares:issued, Safe balances   │
 │  gate.py       launch gate (legal, audit, KYC, signers, owner OK)  │
 │  report.py     treasury and allocation reporting                    │
 └─────────────────────────────┬───────────────────────────────────────┘
                               ▼
         capital ledger (existing): USD + SHARE units, source of truth
                               ▼
   /investor/token (portal) · /transparency (public) · owner admin
```

### Smart contracts (`contracts/`, Foundry)

- **PoolShareToken:** the ERC-3643 suite (T-REX: token, IdentityRegistry, ModularCompliance), built on audited reference code rather than custom logic. Compliance modules cover:
  - country allowlist (mirrors `CAPITAL_INVESTOR_JURISDICTIONS`)
  - max holders per country
  - holding-period lock (Rule 144 / Reg S)
  - per-investor caps
- **Roles:**
  - The owner and agent roles (mint, burn, freeze, forced transfer for court orders or lost keys) sit with a **Safe multisig**, never with an externally owned account or the server.
  - Upgrades, if any, go through a timelock.
- **No custom sale contract.** Subscriptions settle USDC into the Raise Safe, and the Safe mints after the backend confirms eligibility. This removes the riskiest contract surface. An on-chain sale contract is optional later.
- **Tests:**
  - Foundry unit tests plus fuzz tests and invariant tests (supply = sum of balances; no transfer to an unverified identity).
  - Slither in CI.
  - Deploy scripts for Base Sepolia only until the gate passes.

### Backend (`backend/app/token/`, `routers/token.py`)

- **Chain access:** plain JSON-RPC through the existing `httpx` (no web3.py). The RPC URL comes from an env var (Alchemy, Infura or a public Base endpoint).
- **Indexer:** an arq cron job reads `Transfer` events after N confirmations and posts them to the existing ledger as idempotent entries (`idem = chain:{chainId}:{txHash}:{logIndex}`). The ledger stays the source of truth, and on-chain state is reconciled against it every run. A mismatch pauses subscriptions and alerts operators.
- **Subscriptions:** each subscription records its intent, passes the eligibility checks (regulated KYC, verified accreditation, jurisdiction, caps), confirms receipt of the USDC payment, then proposes a mint to the Safe. This mirrors the record-intent, post, mark-done pattern the capital service already uses.
- **Wallet linking:** Sign-In with Ethereum (EIP-4361) proves the investor controls the address before it's added to the IdentityRegistry.
- **Launch gate (`gate.py`):** mainnet chain IDs and every money-moving endpoint are refused unless **all** of these are true:
  - `TOKEN_MAINNET_ENABLED=true`
  - the owner has recorded each gate item with evidence: US securities opinion, EU/other jurisdiction opinions, insurance opinion, KYC/accreditation vendor live, settlement partner live, audit report(s) whose commit hash matches the deployed bytecode, Safe signers and threshold, explicit owner authorization

  The gate defaults to closed, and tests assert that it is closed.

### Treasury and fund allocation

- **Three Safes** (for example 3-of-5 with hardware keys and geographically separate signers) map to the existing ledger accounts: `pool:cash`, `protection:cash`, `platform:cash`. The server **never holds a private key**; it only prepares Safe transaction proposals.
- **Allocation is policy, not code.** Investor capital buys pool shares, so it must stay in the pool, where it funds early payments and is reflected in NAV. The protection fund grows from its 20% fee share. It can also take a separate platform contribution, but **investor capital should not be moved into the protection fund**: payouts are not recoverable and would cut investors' NAV. If you want raised money to fund protection directly, that's a different instrument (a donation or grant, or a first-loss tranche) and needs counsel.
- **Transparency:**
  - A public `/transparency` page shows Safe balances read on-chain next to ledger balances, plus advances outstanding, repaid and defaulted, protection fund balance, claims paid, and the fee split.
  - A monthly report is generated from the journal.
  - An external attestation (accountant) is scheduled before launch.

### Frontend

- `/investor/token`: link a wallet, view eligibility, subscription status, token balance vs. ledger shares, and lock-up end date.
- `/transparency`: public, read-only.
- Owner admin: a gate checklist with evidence uploads, a reconciliation status panel, and a Safe proposal queue.
- Wallet connection calls the browser wallet directly (EIP-1193 `personal_sign`), with no new frontend dependency. The backend verifies signatures with `eth-account`, its one new dependency.

### What does not change

The existing capital flows, endpoints and tests stay as they are. Everything new sits behind `TOKEN_PROGRAM_ENABLED` (default off), so with the flag off the app behaves exactly as today.

## 6. Tokenomics (Path A draft)

| Item | Proposal |
|---|---|
| Supply | **No fixed supply.** One token = one pool share. Tokens are minted on subscription and burned on redemption at NAV ($1.00 at launch, matching the current share scale). A fixed supply with a team allocation would be a different, riskier instrument. |
| Raise | Target, minimum and per-investor caps set in `policy.py` with counsel. The Reg CF ($5M) and MiCA (€1M) exemption limits apply only if those routes are used. |
| Return to holders | 70% of early-payment fees, accrued to NAV (existing split). |
| Team / platform | Earns the 10% platform fee share. No token allocation. |
| Redemption | At NAV, subject to the existing liquidity reserve and the lock-up. |
| Use of proceeds | 100% to pool liquidity for early payments. The protection fund is funded by fees plus an optional platform contribution (§5). |

If Path B is chosen later, it would need its own fixed-supply allocation (community, treasury, liquidity, team with vesting), drafted with counsel. That is out of scope here.

## 7. Security and compliance plan

1. **Counsel:**
   - US securities (offering exemption, Reg S, accreditation verification)
   - EU (MiCA vs. MiFID qualification), plus each target country
   - insurance (protection fund)
   - lending (early payment)
   - tax
2. **KYC / AML:** a regulated provider (for example Persona, Onfido or Sumsub) for identity checks, sanctions and PEP screening, and ongoing monitoring. A third-party accreditation-verification letter for 506(c). Travel-rule compliance through the settlement partner.
3. **Audits:** at least one independent audit of the contracts and deployment scripts by a recognised firm (OpenZeppelin, Trail of Bits, Spearbit/Cantina, ConsenSys Diligence, Quantstamp or Sherlock). Vendors quote about $40k–100k+ for this complexity tier. Re-audit after any change. Run a bug bounty from launch.
4. **Operations:**
   - Safe signer policy, key ceremony and runbooks for a lost key, compromise or a forced transfer.
   - Contract monitoring and alerting (for example OpenZeppelin Defender or Tenderly).
   - Reconciliation alerts that pause subscriptions automatically.
5. **Marketing:** no yield promises or "investment" language in public material. Exchange legal reviews flag it, and UK and EU promotion rules restrict it.

## 8. Exchange and listing plan

- **Now:** none. A Path A token cannot be listed on Binance, Coinbase, Kraken, OKX, Bybit, KuCoin or Gate. Do not apply, and do not pay any third party that offers listings; Binance blacklists projects that apply through intermediaries.
- **After lock-up:** permissioned Uniswap v4 pools (register with Uniswap Labs for routing in its interface) and a regulated ATS. Both need counsel and, for an ATS, a broker-dealer relationship.
- **If the rules change:** if Regulation Crypto Assets becomes final and counsel confirms the token qualifies, prepare the listing dossier that Kraken, OKX and KuCoin ask for: MiCA white paper (iXBRL), audit reports, tokenomics, team KYC, legal opinion, market-maker plan.

### Draft project description (for the dossier and investor materials, pending legal review)

> **[Platform name]** connects freelancers with verified work across Upwork, Freelancer.com and other marketplaces, and gives them financial support that ordinary marketplaces don't: early payment on verified fixed-price orders and a discretionary protection fund for cancelled or refunded work. Every order is confirmed by the marketplace's own API before any money moves, and every movement is recorded in a double-entry ledger that is reported publicly. The **[token name]** is a permissioned digital representation of a share in the platform's early-payment pool, available only to verified, eligible investors. Pool capital finances early payments to freelancers. Fees from those payments are shared between the pool, the protection fund and the platform, and the pool's balances and performance are published on our transparency page.

## 9. Phased plan

| Phase | Work | Needs |
|---|---|---|
| **0. Decide** | Choose a path (§4) and the target jurisdictions. Engage counsel. | You and counsel |
| **1. Build on testnet** (code, safe to do now) | `contracts/` (T-REX suite, compliance modules, tests, Base Sepolia deploy); `backend/app/token/` (indexer, reconciliation, subscription intents, launch gate, reports); `/investor/token`, `/transparency`, owner admin; listing dossier drafts in `docs/token/`. All behind `TOKEN_PROGRAM_ENABLED`, mainnet refused by the gate. | Engineering only |
| **2. External prerequisites** | Legal opinions, entity, KYC/accreditation vendor, settlement partner (USDC), Safe signers, audit(s), bug bounty, accountant attestation | Licensed partners, budget |
| **3. Launch** (only with every gate item recorded and your explicit authorization) | Mainnet deploy of the audited commit, first subscriptions | Owner sign-off |

## 10. Decisions

| Decision | Status |
|---|---|
| Path | **A** (tokenized pool shares), chosen 2026-11-09. |
| Chain | Base, with Base Sepolia (84532) for Phase 1. The recommended default; change it before deploying if needed. |
| Protection funding | Fee-funded only. The recommended default; investor capital stays in the pool. |
| Investor jurisdictions | **Still open.** Set `CAPITAL_INVESTOR_JURISDICTIONS` and the contracts' `ALLOWED_COUNTRIES` once counsel advises. |

## 11. Phase 1: what's built (test networks only)

**Contracts (`contracts/`, Hardhat).**
- Tokeny's audited T-REX 4.1.6 and ONCHAINID 2.2.1, compiled from npm and deployed through T-REX's own `TREXFactory`. The only Solidity in the repo is an import shim; there is no custom token or sale contract.
- The Safe owns every contract and is the agent on the token and the identity registry. The deploy script verifies that the deployer keeps no role.
- `CountryAllowModule` is on, and `SupplyLimitModule` is optional. The token has 6 decimals, so one raw unit is one ledger share unit.
- The token **deploys paused**. Mint, burn, freeze and forced transfer still work, but investor-to-investor transfers stay blocked until the Safe unpauses.
- The deploy script refuses any chain except local (31337) and Base Sepolia (84532), and refuses a Safe address with no contract code.
- 34 tests pass, including role handover, compliance, lock-up by partial freeze, forced transfer, and a randomized supply invariant.
- See `contracts/README.md` for deployment steps and the selector table.

**Backend (`backend/app/token/`, `routers/token.py`).**
- Wallets are linked with an EIP-4361 signature.
- The backend drafts Safe proposals (Transaction Builder batch files) for each step: create the investor's identity, register it, mint plus freeze, and unfreeze when the lock-up ends.
- USDC subscriptions are matched exactly by wallet and amount.
- An indexer mirrors confirmed `Transfer` events into the capital ledger, idempotently by `chainId:tx:logIndex`. The worker runs it every 5–10 minutes, and owners can also trigger it.
- Reconciliation compares supply and every wallet balance at the confirmed block. Any difference, or an unexpected mint or burn, pauses subscriptions and alerts the owners.
- Unmatched payments raise an alert instead of being posted to the ledger.
- The launch gate is the `TOKEN_MAINNET_ENABLED` switch plus 8 owner-recorded items, each with evidence.
- There's a public `/api/token/transparency` endpoint (no personal data, cached for 60 s) and a ledger report by date range.
- There are 21 tests. They also pass against MongoDB.
- **End-to-end on a real chain:** `contracts/scripts/e2e-local.sh` starts a Hardhat node and deploys the real T-REX suite, with a test-only mock USDC. It then runs `backend/tests/test_token_e2e.py`, which drives the unmodified backend over JSON-RPC and executes each Safe batch from a stand-in Safe account. It covers onboarding, an exact USDC payment, mint + freeze, unfreeze, transfers after unpause, the public report, and detecting a burn the platform didn't make. Outside that script the test is skipped.

**Frontend.**
- `/investor/token`: link a wallet, subscribe, follow payment instructions, view holdings and lock-ups.
- An owner **Token** tab on `/dashboard/capital`: launch gate, reconciliation, Safe batch downloads, alerts.
- A public `/transparency` page.

**Not built yet (Phase 1b):**
- **A run on Base Sepolia with a real Safe.** This also checks that the Safe app imports the batch files. It needs your Safe, deployer key and test ETH.
- **Redemptions.** A burn is mirrored and alerted, but the payout is settled by hand.
- **Lock-up events.** `TokensFrozen` and `TokensUnfrozen` aren't indexed; the indexer reads `getFrozenTokens` instead.
- **Upgrade timelock.** The Safe can upgrade the T-REX suite immediately. Put a TimelockController in front before mainnet.
- **Regulated KYC vendor and real accreditation verification.** These are launch-gate items.
- **Worker on Render.** The `arq` worker service is commented out on the free plan. Until it runs, an owner presses "Sync now".

**Running it on Base Sepolia:**
1. Create a Safe on Base Sepolia.
2. Deploy: `cd contracts && npm ci && npm run deploy:base-sepolia`, with `SAFE_ADDRESS`, `ALLOWED_COUNTRIES` and the deployer key in `contracts/.env`.
3. Copy the addresses and `deployBlock` from `contracts/deployments/baseSepolia.json` into the backend's `TOKEN_*` settings and set `TOKEN_PROGRAM_ENABLED=true`.
4. Get test USDC from Circle's faucet.
