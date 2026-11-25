# Open-source evaluation for the AutoGig funding prototype

Checked 2026-11-16 against the npm registry (`npm view`, which reports the license and last-modified date of each published
package) and the license file inside the downloaded package. Web search results were used only for context and are marked.
**Re-run these checks before any dependency is added to a production build.** Nothing in this table was installed except as stated
in section 3.

## 1. Summary of decisions
| Candidate | What it would do for us | License (verified how) | Decision |
|---|---|---|---|
| EIP-6963 + `window.ethereum` (no library) | Discover MetaMask, Coinbase Wallet, Rabby, Brave, Trust, OKX... browser wallets | A web standard, no code license | **Adopted** (`lib/wallets.ts`, about 100 lines, no dependency) |
| OpenZeppelin Contracts | Audited ERC-20 / Ownable / timelock building blocks | MIT (`npm view`: 5.6.1 modified 2026-09-24; 5.7.0 also published) | **Deferred**: needed only when a token is written; the existing token layer already uses audited Tokeny T-REX (`contracts/`). Use OpenZeppelin for any new contract. Not added now |
| viem | Typed Ethereum client (read chain, encode calls) | MIT (`npm view`: 2.57.20, modified 2026-11-16) | **Deferred**: nothing in the prototype reads the chain from the browser. The Python backend already talks JSON-RPC. Add when a chain read is actually shown |
| wagmi | React hooks over viem | MIT (`npm view`: 3.7.11, modified 2026-11-03) | **Rejected for now**: pulls a large dependency tree (React Query, connectors) to do what `lib/wallets.ts` does in a page. Revisit with the token UI |
| Reown AppKit (WalletConnect) | QR / mobile-wallet connection, wallet picker UI | **Not an open-source license.** `npm view` says "SEE LICENSE IN LICENSE.md"; the file in `@reown/appkit@1.8.24` is the **Reown Community License Agreement** (release 25 Aug 2025). Read from the package | **Rejected until counsel reads it**: you must display "Portions (c) 2025 Reown, Inc." and its branding, modifications to the SDK are assigned to Reown, and use is royalty-free only subject to its section 3 (pricing/terms we did not resolve). It also needs a project id from an external account (dashboard.reown.com), so it is an external blocker anyway |
| Apache Fineract | Full core-banking / loan servicing platform | Apache License 2.0 (search results; also upstream docs) | **Rejected for this phase**: a separate Java 21 + MariaDB/PostgreSQL service (README per search result). It is a production lending engine, which the project is explicitly not building; adopting it would also create a second system of record. Its loan-schedule concepts informed `credit/service.py` (flat fee, installments, arrears, write-off) |
| ERPNext (Frappe) | Accounting and finance administration | GPL-3.0 (search results and Frappe docs) | **Rejected**: GPL-3.0 copyleft, a separate Python/MariaDB/Redis stack, and it is accounting software for a real company, not for a demo ledger. If the real business later needs bookkeeping, evaluate it (or a hosted service) then |

## 2. Detail and reasoning
### Wallets: EIP-6963 instead of a wallet library
* Wallet extensions announce themselves to the page through two browser events (`eip6963:announceProvider` /
  `eip6963:requestProvider`), so several can coexist. `lib/wallets.ts` collects them, offers a chooser, and falls back to
  `window.ethereum` for older wallets.
* **What it can do:** ask for an account (`eth_requestAccounts`), read the chain id, and, in the existing token program only,
  ask for a `personal_sign` signature on a server-provided message. It never requests a transaction, never touches keys or recovery phrases.
* **Security choices:** announcements are validated (uuid/name types, 40-hex address check), names are truncated, and only
  `data:image/...` icons are accepted so a wallet announcement can never make the page fetch a remote URL.
* **Limits:** only injected browser wallets. Mobile wallets that connect by QR code need WalletConnect, which means Reown
  (license above, project id) or another vetted library. That is listed as a blocker, not faked.
* **Tested:** unit-level validation by typecheck; the Chromium suite announces two mock wallets and connects the chosen one.

### Smart-contract libraries
* OpenZeppelin Contracts (MIT) is the standard source of audited ERC-20, access-control and timelock code, and "prefer
  established libraries over custom smart-contract code" is adopted as a rule. The repository's existing token contracts are
  Tokeny's T-REX (permissioned ERC-3643), compiled from npm, with no custom Solidity (`contracts/README.md`). Nothing new is needed
  until the token design is approved, so no Solidity dependency was added. Even with OpenZeppelin, a deployment needs an
  independent audit (`docs/autogig-security-review.md`).

### Lending and accounting systems
* Fineract and ERPNext solve real-world problems (servicing real loans, keeping real books). This project's prototype has one
  small, deliberate goal: a **simulated** credit workflow that investors and borrowers can try. Importing either would add a
  second database, a second auth system and a licence obligation (GPL for ERPNext), and invite the mistake of treating the demo
  as a live lender. The integer-cent, double-entry ledger already in `backend/app/capital/ledger.py` (append-only, idempotent,
  balanced entries) is the right size and was extended instead.
* If the business ever lends real money, the servicing system should be chosen with the licensed lending partner (they often
  bring their own), not now.

## 3. What was actually added to the repository
No npm or pip dependency was added. New code: `lib/wallets.ts` (EIP-6963), `backend/app/credit/` (decimal-safe credit
workflow on the existing ledger), `components/credit/*`. `npm audit --omit=dev` stays at 0 advisories (see the final report).

## 4. Rules for future dependencies
1. Record exact license (from the package, not a blog) and last release; reject anything unmaintained for 12 months.
2. No unaudited financial protocol or unverified smart contract; no copying whole projects.
3. `npm audit --omit=dev`, `pip-audit` must stay clean; a license file that is not OSI-approved goes to counsel first.
4. No library may hold private keys or seed phrases on our servers.
