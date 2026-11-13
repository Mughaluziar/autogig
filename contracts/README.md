# Pool-share token contracts

This is the on-chain mirror of the investor-pool share ledger (Path A in `docs/token-program.md`, sections 5 to 7).

- **One token = one pool share.** The token has 6 decimals, so 1 raw unit = 1 ledger share unit, and 1,000,000 units = one $1 share at launch.
- **Mint and burn:** tokens are minted when an investor's USDC subscription is confirmed and burned on redemption.
- **Permissioned (ERC-3643):** only wallets registered in the IdentityRegistry can hold or receive the token.
- **Roles:** every privileged role belongs to a Safe multisig. The deployer EOA keeps no role after deployment.

**No custom token, registry, compliance or sale logic lives here.** Every deployed contract is compiled verbatim from two audited npm packages:

- `@tokenysolutions/t-rex@4.1.6` (Tokeny T-REX, the ERC-3643 reference implementation)
- `@onchain-id/solidity@2.2.1` (ONCHAINID)

`src/TREXImports.sol` is an import shim with no logic. It makes Hardhat compile those sources from `node_modules` and emit build-info for block-explorer verification.

Dependencies are pinned to exact versions, and `package-lock.json` is committed. OpenZeppelin is `@openzeppelin/contracts{,-upgradeable}@4.9.6`: T-REX 4.1.6 declares `^4.8.3`, and its shipped artifacts were built against 4.9.x. Solidity is 0.8.17 with the optimizer at 200 runs, as T-REX and ONCHAINID pin it.

## Install, compile, test

Node 22+ is required.

```bash
cd contracts
npm ci
npm run compile          # hardhat compile
npm test                 # hardhat test (in-process network)
npm run selectors        # prints the selector table below from the compiled ABIs
```

The invariant test uses a seeded PRNG. You can change the seed and the number of steps with `INVARIANT_SEED=123 INVARIANT_STEPS=400 npm test`.

**Compiler warnings:** compilation emits 11 warnings, all in third-party audited sources. We don't fix them, because that would mean editing the audited code:

- 7 × "payable fallback but no receive" (T-REX proxies, ONCHAINID IdentityProxy)
- 2 × "shadows an existing declaration" (ONCHAINID IdFactory)
- 2 × "can be restricted to pure" (CountryAllowModule and SupplyLimitModule `canComplianceBind`)

There are no warnings from code in this workspace, and every contract is under the 24 KB size limit.

## What gets deployed

`scripts/deploy.js` calls `scripts/lib/deploySuite.js`, which the tests use too. It deploys and wires the suite in this order:

1. **ONCHAINID:**
   - `Identity` implementation (library mode, so it has no keys)
   - `ImplementationAuthority`
   - `IdFactory`
2. **T-REX logic contracts:**
   - `Token`
   - `ClaimTopicsRegistry`
   - `TrustedIssuersRegistry`
   - `IdentityRegistryStorage`
   - `IdentityRegistry`
   - `ModularCompliance`
3. **`TREXImplementationAuthority`** (the reference authority), with version 4.1.6 registered. Then `TREXFactory`. The TREXFactory is added as a token factory on the IdFactory.
4. **Compliance modules,** each as a UUPS implementation behind `ModuleProxy`:
   - `CountryAllowModule`
   - optionally `SupplyLimitModule`
5. **`TREXFactory.deployTREXSuite(...)`.** This is T-REX's audited orchestration. It deploys the proxies for Token, IR, IRS, CTR, TIR and MC (CREATE2, so the addresses are deterministic), then:
   - binds IRS to IR and compliance to the token
   - creates the token's own ONCHAINID (management key = Safe)
   - adds the token as an agent on IR (T-REX needs this for `recoveryAddress`)
   - adds the **Safe** as agent on the token and the IR
   - binds the modules and configures them through `callModuleFunction`:
     - `batchAllowCountries(ALLOWED_COUNTRIES)`
     - `setSupplyLimit(SUPPLY_LIMIT)`
   - transfers ownership of Token, IR, TIR, CTR and MC to the Safe
6. **Hand over the rest to the Safe:**
   - IRS ownership, via `TREXFactory.recoverContractOwnership`. The 4.1.6 factory leaves IRS owned by itself.
   - both module proxies
   - `IdFactory`
   - the ONCHAINID `ImplementationAuthority`
   - the `TREXImplementationAuthority`
   - the `TREXFactory`
7. **`assertHandover`:**
   - checks that every ownable contract's `owner()` is the Safe
   - checks that the Safe is agent on token and IR
   - checks that the deployer is agent on none of token, IR or IRS
   - aborts the script otherwise

**The deployer is never an agent.** The factory adds the Safe directly, so there is no "remove deployer as agent" step.

**Claims:** no claim topics are required and no trusted issuers are registered. KYC is done off-chain by a regulated provider and recorded by the platform. So `isVerified(wallet)` simply means "wallet is registered in the IdentityRegistry".

**Paused at deploy (decision):** the token starts **paused**. This is T-REX's default (`Token.init` sets `_tokenPaused = true`), and we keep it on purpose.

- While paused, the agent's `mint`, `burn`, `freezePartialTokens`, `unfreezePartialTokens`, `setAddressFrozen` and `forcedTransfer` all still work. Subscriptions, redemptions and lock-ups can operate.
- `transfer` and `transferFrom` (investor-to-investor) revert with `Pausable: paused`.
- The Safe calls `unpause()` when secondary transfers are allowed, which is a launch-gate decision. `pause()` is the emergency brake.

## Roles

| Role | Holder | Powers |
|---|---|---|
| Token **owner** | Safe | `addAgent` and `removeAgent`, `setIdentityRegistry`, `setCompliance`, `setName`, `setSymbol`, `setOnchainID` |
| Token **agent** | Safe | `mint`, `burn`, `pause`, `unpause`, `freezePartialTokens`, `unfreezePartialTokens`, `setAddressFrozen`, `forcedTransfer`, `recoveryAddress`, and their batch variants |
| IdentityRegistry **owner** | Safe | agent management, registry wiring |
| IdentityRegistry **agent** | Safe, plus the Token contract itself | `registerIdentity`, `deleteIdentity`, `updateCountry`, `updateIdentity`, `batchRegisterIdentity` |
| IdentityRegistryStorage **owner** | Safe | agent management, bind or unbind IR. Its only agent is the IR. |
| ModularCompliance **owner** | Safe | `addModule`, `removeModule`, `callModuleFunction` (for example, allow or disallow countries, change the supply limit) |
| Module proxies **owner** | Safe | UUPS `upgradeTo` on CountryAllowModule and SupplyLimitModule |
| CTR / TIR **owner** | Safe | claim topics and trusted issuers (both unused, left empty) |
| **IdFactory owner** | Safe | **`createIdentity`**. It is `onlyOwner`, and IdFactory has no agent role. Also `addTokenFactory` and `removeTokenFactory`. |
| ONCHAINID `ImplementationAuthority` owner | Safe | upgrades the logic behind every investor identity proxy |
| `TREXImplementationAuthority` owner | Safe | registers and switches T-REX versions, which **upgrades all six suite proxies** |
| `TREXFactory` owner | Safe | `deployTREXSuite`, `recoverContractOwnership` |
| Deployer EOA | none | pays gas only. Tests assert it has no role. |

**Upgrades:** the Safe can upgrade the suite through `TREXImplementationAuthority`, the identities through the ONCHAINID IA, and the modules through UUPS. Section 5 of the design doc calls for a timelock in front of upgrades. That isn't part of this workspace. Before mainnet, consider making a `TimelockController` (proposer = Safe) the owner of the two implementation authorities and the module proxies.

## Deploy to Base Sepolia

1. Create a Safe on Base Sepolia (app.safe.global). For a test, a 1-of-1 is fine. Note its address.
2. Fund a throwaway deployer EOA with Base Sepolia ETH. The full deployment is about 30 transactions.
3. Run `cp .env.example .env` and fill in the values:
   - `BASE_SEPOLIA_RPC_URL`
   - `DEPLOYER_PRIVATE_KEY`
   - `SAFE_ADDRESS`
   - `TOKEN_NAME` and `TOKEN_SYMBOL`
   - `ALLOWED_COUNTRIES` (ISO-3166 numeric, comma separated; mirror `CAPITAL_INVESTOR_JURISDICTIONS`)
   - optionally `SUPPLY_LIMIT` (raw 6-decimal units) and `TREX_SALT`
   - `USDC_ADDRESS`
4. Run `npm run deploy:base-sepolia`.
5. The script writes `deployments/baseSepolia.json` (commit it):

   ```json
   {
     "network": "baseSepolia", "chainId": 84532, "deployBlock": 0,
     "token": "0x…", "identityRegistry": "0x…", "identityRegistryStorage": "0x…",
     "compliance": "0x…", "idFactory": "0x…",
     "modules": { "countryAllow": "0x…", "supplyLimit": "0x… | null" },
     "safe": "0x…", "usdc": "0x…",
     "trustedIssuersRegistry": "0x…", "claimTopicsRegistry": "0x…",
     "trexImplementationAuthority": "0x…", "trexFactory": "0x…",
     "identityImplementationAuthority": "0x…", "tokenOnchainId": "0x…",
     "decimals": 6, "paused": true, "allowedCountries": [840], "supplyLimit": null,
     "implementations": { "…": "0x…" }, "deployer": "0x…", "trexSalt": "…", "trexVersion": "4.1.6"
   }
   ```

   `deployBlock` is the block of the `deployTREXSuite` transaction, which is the token's creation block. Start the `Transfer` indexer there.

To try it in-process first, run `ALLOWED_COUNTRIES=840 npm run deploy:local`. If `SAFE_ADDRESS` is unset, hardhat account #1 stands in for the Safe.

The script has these guards:

- It refuses any chainId other than 31337 or 84532. There is deliberately no mainnet network in `hardhat.config.js`.
- On a live network, it refuses a `SAFE_ADDRESS` that has no contract code. Ownership transfer in OZ 4.x is single-step, so a typo would lose control for good.
- It refuses `SAFE_ADDRESS == deployer`.

**Verification:** the non-proxy contracts (implementations, factories, authorities, module proxies) can be verified with `npx hardhat verify --network baseSepolia <address> <constructor args…>`, using `BASESCAN_API_KEY`. The suite proxies were created by `TREXFactory`. Verify them with their constructor args: the implementation authority, plus for IR (tir, ctr, irs) and for Token (ir, mc, name, symbol, 6, tokenOnchainId).

**Circle USDC on Base Sepolia:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

- Verified against Circle's docs (developers.circle.com/stablecoins/usdc-contract-addresses, Testnet table, "Base Sepolia" row).
- `decimals()` returns 6 on chain 84532.
- The contracts never interact with USDC. The address is only recorded in the deployments file.

## Interfaces the backend relies on

Every row was taken from the compiled T-REX 4.1.6 and ONCHAINID 2.2.1 ABIs by `npm run selectors`. The script fails if any listed function is missing. Selector = `keccak256(signature)[0:4]`, and event topic0 = the full `keccak256(signature)`.

### Token (`deployments.token`)

| Signature | Selector | Notes |
|---|---|---|
| `mint(address,uint256)` | `0x40c10f19` | agent only. **No return value.** Reverts `Identity is not verified.` (unregistered) or `Compliance not followed` (country or supply cap). |
| `burn(address,uint256)` | `0x9dc29fac` | agent only. **Burns from a holder; this is not ERC20Burnable `burn(uint256)`.** No return value. If the amount exceeds the free balance, it auto-unfreezes the difference (emits `TokensUnfrozen`). |
| `freezePartialTokens(address,uint256)` | `0x125c4a33` | agent only. Lock-up: mint, then freeze. Reverts `Amount exceeds available balance`. |
| `unfreezePartialTokens(address,uint256)` | `0x1fe56f7d` | agent only. Reverts `Amount should be less than or equal to frozen tokens`. |
| `forcedTransfer(address,address,uint256)` | `0x9fc1d0e7` | agent only. Returns `bool`. Works while paused, moves frozen tokens (unfreezing them), and checks only `isVerified(to)`. **It does not run compliance modules (country, supply).** |
| `setAddressFrozen(address,bool)` | `0xc69c09cf` | agent only. Freezes the whole wallet. |
| `totalSupply()` | `0x18160ddd` | view → `uint256` |
| `balanceOf(address)` | `0x70a08231` | view → `uint256`. **Includes frozen tokens.** Free balance = `balanceOf − getFrozenTokens`. |
| `getFrozenTokens(address)` | `0x158b1a57` | view → `uint256` |
| `isFrozen(address)` | `0xe5839836` | view → `bool` (wallet-level freeze) |
| `paused()` | `0x5c975abb` | view → `bool`. `true` after deployment. |
| `pause()` | `0x8456cb59` | agent only. Reverts if already paused. |
| `unpause()` | `0x3f4ba83a` | agent only. Reverts `Pausable: not paused` if not paused. |
| `decimals()` | `0x313ce567` | view → `uint8` = 6 |
| `identityRegistry()` | `0x134e18f4` | view → `address` |
| `compliance()` | `0x6290865d` | view → `address` |
| `isAgent(address)` | `0x1ffbb064` | view → `bool` |
| `owner()` | `0x8da5cb5b` | view → `address` |

| Event | topic0 |
|---|---|
| `Transfer(address indexed from, address indexed to, uint256 value)` | `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef` |
| `TokensFrozen(address indexed _userAddress, uint256 _amount)` | `0xa065e63c631c86f1b9f66a4a2f63f2093bf1c2168d23290259dbd969e0222a45` |
| `TokensUnfrozen(address indexed _userAddress, uint256 _amount)` | `0x9bed35cb62ad0dba04f9d5bfee4b5bc91443e77da8a65c4c84834c51bb08b0d6` |
| `Paused(address _userAddress)` | `0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258` |
| `Unpaused(address _userAddress)` | `0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa` |

Mint is `Transfer(0x0 → to)`, burn is `Transfer(from → 0x0)`, and a forced transfer is an ordinary `Transfer(from → to)`. Freezes emit **no** `Transfer` event, so index `TokensFrozen` and `TokensUnfrozen` separately if lock-ups are mirrored in the ledger. Note that `burn` and `forcedTransfer` can emit `TokensUnfrozen` implicitly.

### IdentityRegistry (`deployments.identityRegistry`)

| Signature | Selector | Notes |
|---|---|---|
| `registerIdentity(address,address,uint16)` | `0x454a03e0` | agent only. In Solidity the 2nd param is typed `IIdentity`, which is `address` in the ABI. Reverts `address stored already`. |
| `deleteIdentity(address)` | `0xa8d29d1d` | agent only. Reverts `address not stored yet`. It does **not** unlink the wallet in the IdFactory. |
| `updateCountry(address,uint16)` | `0x3b239a7f` | agent only |
| `isVerified(address)` | `0xb9209e33` | view → `bool`. With no claim topics, this equals "registered". |
| `contains(address)` | `0x5dbe47e8` | view → `bool` |
| `identity(address)` | `0xf0eb5e54` | view → `address` |
| `investorCountry(address)` | `0x7e42683b` | view → `uint16` |
| `isAgent(address)` | `0x1ffbb064` | view → `bool` |

| Event | topic0 |
|---|---|
| `IdentityRegistered(address indexed investorAddress, address indexed identity)` | `0x6ae73635c50d24a45af6fbd5e016ac4bed179addbc8bf24e04ff0fcc6d33af19` |
| `IdentityRemoved(address indexed investorAddress, address indexed identity)` | `0x59d6590e225b81befe259af056324092801080acbb7feab310eb34678871f327` |

### IdFactory (`deployments.idFactory`)

| Signature | Selector | Notes |
|---|---|---|
| `createIdentity(address,string)` | `0x8e952bfe` | **owner only (the Safe)**. Returns `address`, but a Safe execution can't read it. Use `getIdentity(wallet)` or the `WalletLinked` event afterwards. Reverts `salt already taken` and `wallet already linked to an identity`. |
| `getIdentity(address)` | `0x2fea7b81` | view → `address` (zero if none) |
| `isSaltTaken(string)` | `0x3a500451` | view → `bool`. **Pass `"OID" + salt`:** `createIdentity` prefixes the salt internally. |
| `owner()` | `0x8da5cb5b` | view → `address` |

| Event | topic0 |
|---|---|
| `WalletLinked(address indexed wallet, address indexed identity)` | `0x8e0c709111388f5480579514d86663489ab1f206fe6da1a0c4d03ac8c318b3c6` |

### Differences from the originally listed signatures

Every function listed in the brief exists with exactly that canonical signature and selector. The behaviour differs in these ways:

- `mint` and `burn` return nothing (not `bool`).
- `burn(address,uint256)` is the T-REX agent burn, not the ERC20Burnable `burn(uint256)`.
- `registerIdentity`'s identity argument is `IIdentity` in source, which is `address` in the ABI.
- `createIdentity` is `onlyOwner` on IdFactory (there is no agent role there), and its return value is unavailable through a Safe.
- `unpause()` and `pause()` revert when already in the target state. Check `paused()` before proposing.

### Investor onboarding batch (proposed to the Safe)

```
1. IdFactory.createIdentity(wallet, salt)                 // salt: unique, non-empty; e.g. "investor-<uuid>"
2. IdentityRegistry.registerIdentity(wallet, identity, country)
```

The identity address isn't known to the Safe batch at build time unless the backend precomputes it. There are two options:

- **Two transactions:** run (1), then read `getIdentity(wallet)`, then propose (2).
- **One batch:** precompute the CREATE2 address:

  ```
  getCreate2Address(
    deployer = idFactory,
    salt     = keccak256(utf8("OID" + salt)),
    initCodeHash = keccak256(IdentityProxy.creationCode ++ abi.encode(identityImplementationAuthority, wallet))
  )
  ```

  `identityImplementationAuthority` is recorded in the deployments file. Take `IdentityProxy.creationCode` from `artifacts/@onchain-id/solidity/contracts/proxy/IdentityProxy.sol/IdentityProxy.json` (`bytecode`). Any recompile with different settings changes this hash, so ship the artifact's bytecode with the backend, or fall back to the two-transaction path.

Tests cover both paths: `test/onboarding.test.js` asserts that the predicted address matches.

Re-onboarding a wallet after `deleteIdentity`: `createIdentity` reverts because the wallet stays linked in the IdFactory. Reuse `getIdentity(wallet)` and call `registerIdentity` again.

**Subscription with a lock-up** is a single batch: `mint(wallet, units)`, then `freezePartialTokens(wallet, units)`. When the lock-up ends, call `unfreezePartialTokens(wallet, units)`.

**Redemption:** `burn(wallet, units)`.

## Layout

```
contracts/
  package.json, package-lock.json   pinned deps
  hardhat.config.js                 networks: hardhat, baseSepolia (84532). No mainnet.
  .env.example
  src/TREXImports.sol               import shim only (no logic)
  scripts/lib/deploySuite.js        suite deployment + Safe handover + handover assertions
  scripts/deploy.js                 env-driven deploy, writes deployments/<network>.json
  scripts/selectors.js              selector/topic table from compiled ABIs
  test/                             Hardhat + chai + ethers v6
  deployments/                      deployment records (hardhat.json is gitignored)
```

## End-to-end test with the backend

```bash
npm ci && ./scripts/e2e-local.sh
```

The script:
1. Starts a Hardhat node on port 8545.
2. Deploys the suite, with Hardhat account #1 standing in for the Safe.
3. Deploys `src/test/MockUSDC.sol`. This is test only, and `scripts/deploy-mock-usdc.js` refuses any chain but 31337.
4. Runs `backend/tests/test_token_e2e.py` against the node.

The Python test runs the real backend and executes every Safe batch it produces, the same way the signers would.
