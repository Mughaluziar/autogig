# AutoGig funding ecosystem: proposed architecture

Status: **design plus a simulated local prototype.** Separate headings below mark what exists today, what is simulated, what is
testnet-only and what is future/blocked. Nothing is deployed and no real money, custody, lending, insurance or token sale exists.

## 1. Layers
| Layer | Today | Where |
|---|---|---|
| Existing platform (accounts, roles, pool, contracts, Upwork assistant) | **Existing, working** | unchanged |
| Simulated capital modules (investor pool, early pay, protection fund, marketplace, banking) | **Existing, simulated** | `backend/app/capital/`, invitation-only |
| **AutoGig credit prototype** (contributions, applications, offers, agreements, repayments, treasury, audit) | **New, simulated** | `backend/app/credit/`, `routers/credit.py`, `components/credit/*` |
| Wallet connection (read-only, EIP-6963) | **New, local** | `lib/wallets.ts`, shown on `/investor/credit` and in the token wallet card |
| Permissioned pool token (T-REX / ERC-3643) on Base Sepolia | **Existing, testnet only**, mainnet refused in code | `contracts/`, `backend/app/token/` |
| AutoGig token (name and symbol, tokenomics) | **Proposal only** | `docs/autogig-tokenomics-proposal.md` |
| Real settlement, custody, KYC vendor, lending/insurance partner | **Future, blocked** | external accounts and legal approval |

### Isolation rules (kept by the code)
* The credit prototype has its **own ledger accounts** (`credit:cash`, `credit:capital`, `credit:receivable`, `credit:income`,
  `credit:losses`) and its own collections (`credit_*`). It posts to the shared append-only journal with `settlement: "simulated"`,
  but never touches `wallet:`/`usdc:`/`pool:` accounts, so demo balances cannot mix with real company funds (there are none).
* Blockchain logic is **not** spread through the app: the credit module has no chain code; the token layer is a separate package
  (`backend/app/token`, `contracts/`) behind its own flags (`TOKEN_PROGRAM_ENABLED`, `TOKEN_MAINNET_ENABLED`, both off).
* Wallet code never handles keys or seed phrases and is read-only unless the token program asks for a message signature.

## 2. Network recommendation
Compared against the client's criteria (accessibility, popularity, cost, wallet support, security tooling, target countries).
**Fees, user counts and exchange support change constantly and were not re-measured here; they must be re-checked at decision
time. The qualitative points below come from the architecture, not from live market data.**
| Network | Fit | Notes |
|---|---|---|
| **Base** (Ethereum L2) | **Recommended** | EVM, so every mainstream wallet works and the existing Solidity/Hardhat/T-REX tooling and backend indexer already target it (Base Sepolia). Low per-transaction cost, native USDC, strong fiat on-ramp story, inherits Ethereum security with L2 specifics (sequencer/bridge risk). Large auditor and tooling ecosystem |
| Ethereum mainnet | Good security and liquidity, rejected for the first version | Highest fees make small freelancer-sized transactions impractical |
| Polygon | Viable alternative | EVM, low fees, wide wallet support; a different security model than an Ethereum L2; check current status before choosing |
| BNB Smart Chain | Viable alternative for some retail markets | EVM and cheap, very popular with retail; more centralised validator set; some jurisdictions and partners treat it differently. Choose it only if the client's target countries demand it |
| Solana and others | Not recommended now | Different language, wallets and audit pool; the existing code would be rewritten |
**Caveats:** the recommendation is for a technical default. The choice also depends on the counsel's view of the target
countries, the settlement partner's supported chains, and the stablecoin used (USDC native on Base). **It needs the client's decision.**

## 3. Components in the prototype
### 3.1 Credit service (`backend/app/credit/service.py`)
* **Money:** integer cents and basis points only. `build_schedule` splits principal and fee with a largest-remainder rule so the parts
  always sum exactly; the property is tested over 500 random cases. There is no floating-point arithmetic in any balance.
* **Ledger entries** (all balanced, idempotent by key, tagged `simulated`):
  contribution `credit:cash +A / credit:capital -A`; disbursement `credit:receivable +P / credit:cash -P` (rejected if cash would go negative);
  repayment `credit:cash +X / credit:receivable -principal / credit:income -fee`; write-off `credit:losses +R / credit:receivable -R`.
* **State changes** are compare-and-set on a `version` field; money steps are intent, then idempotent ledger post, then mark done, and
  `run_jobs` repairs an interrupted step. A unique "one open application per user" index stops duplicate applications from racing.
* **Treasury** is derived from the ledger and records, and carries a `ledgerCheck` that cash and outstanding credit agree with both.
* **Audit** (`credit_audit`) is append-only with no update or delete route; each action records the actor id and role.

### 3.2 API (`routers/credit.py`, behind the simulated-modules gate)
See the file header for the route list. Owner-only: review/decision, treasury, audit, agreements, jobs. Everything else is scoped to the caller.

### 3.3 Frontend
`/investor/credit` (pool, contribution, statement, allocations, history, risk, wallet), `/freelancer/credit` and `/dashboard/credit` (apply,
offers, agreements, repayments), `/dashboard/credit/admin` (owner: treasury, review, agreements, audit). Responsive, labelled, states for
loading/empty/error. The simulated banner appears on every path in `SIMULATED_PREFIXES`.

### 3.4 Data rights
The new collections are in `DATA_MAP`: personal text is scrubbed on deletion, ledger consistency rows are kept, open applications or
agreements block account deletion (`docs/data-lifecycle.md`).

## 4. What a real version would need (not built)
A licensed lending partner as originator; a regulated custody/settlement partner; a KYC/KYB vendor; counsel's structure for investors;
a document store with malware scanning for uploads; credit-scoring policy; collections and complaint handling; the token (if any) per
`docs/autogig-tokenomics-proposal.md` with an independent audit; the staging and monitoring work in `docs/staging-verification.md`.
