// SPDX-License-Identifier: UNLICENSED
// Import shim ONLY. This file contains no logic. It exists so Hardhat compiles
// the audited Tokeny T-REX 4.1.6 and ONCHAINID 2.2.1 sources from node_modules
// and emits artifacts (with build-info, for block-explorer verification) that
// the deploy script and tests use via ethers.getContractFactory(<name>).
pragma solidity 0.8.17;

// ONCHAINID: identity implementation, its implementation authority, identity factory.
import "@onchain-id/solidity/contracts/Identity.sol";
import "@onchain-id/solidity/contracts/proxy/ImplementationAuthority.sol";
import "@onchain-id/solidity/contracts/factory/IdFactory.sol";

// T-REX implementations (logic contracts, used behind T-REX proxies).
import "@tokenysolutions/t-rex/contracts/token/Token.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/ClaimTopicsRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/TrustedIssuersRegistry.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistryStorage.sol";
import "@tokenysolutions/t-rex/contracts/registry/implementation/IdentityRegistry.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/ModularCompliance.sol";

// T-REX implementation authority + factory (deploys the proxies and wires the suite).
import "@tokenysolutions/t-rex/contracts/proxy/authority/TREXImplementationAuthority.sol";
import "@tokenysolutions/t-rex/contracts/factory/TREXFactory.sol";

// Compliance modules (UUPS-upgradeable, deployed behind ModuleProxy).
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/ModuleProxy.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/CountryAllowModule.sol";
import "@tokenysolutions/t-rex/contracts/compliance/modular/modules/SupplyLimitModule.sol";
