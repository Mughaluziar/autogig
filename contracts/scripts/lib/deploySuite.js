// Deploys the full Tokeny T-REX 4.1.6 suite for the pool-share token and hands
// every privileged role to the Safe. Shared by scripts/deploy.js and the tests.
//
// Nothing here is custom token logic: every contract deployed is compiled
// verbatim from @tokenysolutions/t-rex@4.1.6 and @onchain-id/solidity@2.2.1.
// The suite itself is wired by the audited TREXFactory.deployTREXSuite().

const { ethers } = require("hardhat");

// Version recorded in the TREXImplementationAuthority (matches the npm package).
const TREX_VERSION = { major: 4, minor: 1, patch: 6 };

async function deployContract(name, args, signer, log) {
  const factory = await ethers.getContractFactory(name, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  log(`  ${name.padEnd(28)} ${await contract.getAddress()}`);
  return contract;
}

async function send(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

// Deploys a UUPS compliance module implementation and its ModuleProxy, calling
// initialize() through the proxy (msg.sender = deployer becomes module owner,
// transferred to the Safe at the end).
async function deployModule(name, signer, log) {
  const impl = await deployContract(name, [], signer, log);
  const initData = impl.interface.encodeFunctionData("initialize", []);
  const proxy = await deployContract("ModuleProxy", [await impl.getAddress(), initData], signer, log);
  return {
    implementation: impl,
    proxy: await ethers.getContractAt(name, await proxy.getAddress(), signer),
  };
}

/**
 * @param {object} opts
 * @param {import("ethers").Signer} opts.deployer  EOA paying for deployment; holds NO role afterwards.
 * @param {string} opts.safe                        Safe multisig address; receives owner + agent everywhere.
 * @param {string} opts.name                        Token name.
 * @param {string} opts.symbol                      Token symbol.
 * @param {number[]} opts.countries                 Allowed ISO-3166 numeric country codes (uint16).
 * @param {bigint|null} [opts.supplyLimit]          Optional SupplyLimitModule cap in raw units (6 decimals). null = no module.
 * @param {string} [opts.salt]                      CREATE2 salt for TREXFactory (unique per suite).
 * @param {(msg: string) => void} [opts.log]
 */
async function deploySuite(opts) {
  const { deployer, safe, name, symbol, countries } = opts;
  const supplyLimit = opts.supplyLimit ?? null;
  const salt = opts.salt || `${symbol}-pool-share`;
  const log = opts.log || (() => {});
  const decimals = 6;

  if (!ethers.isAddress(safe) || safe === ethers.ZeroAddress) {
    throw new Error(`SAFE address is invalid: ${safe}`);
  }
  if (!Array.isArray(countries) || countries.length === 0) {
    throw new Error("at least one allowed country code is required");
  }
  for (const c of countries) {
    if (!Number.isInteger(c) || c < 1 || c > 999) {
      throw new Error(`invalid ISO-3166 numeric country code: ${c}`);
    }
  }
  const deployerAddress = await deployer.getAddress();
  if (ethers.getAddress(safe) === ethers.getAddress(deployerAddress)) {
    throw new Error("SAFE address must not be the deployer EOA");
  }

  log(`Deployer ${deployerAddress}`);
  log(`Safe     ${safe}`);

  // 1. ONCHAINID: identity implementation (library mode), its authority, the factory.
  log("ONCHAINID:");
  const identityImpl = await deployContract("Identity", [deployerAddress, true], deployer, log);
  const oidAuthority = await deployContract(
    "ImplementationAuthority",
    [await identityImpl.getAddress()],
    deployer,
    log,
  );
  const idFactory = await deployContract("IdFactory", [await oidAuthority.getAddress()], deployer, log);

  // 2. T-REX logic contracts.
  log("T-REX implementations:");
  const tokenImpl = await deployContract("Token", [], deployer, log);
  const ctrImpl = await deployContract("ClaimTopicsRegistry", [], deployer, log);
  const tirImpl = await deployContract("TrustedIssuersRegistry", [], deployer, log);
  const irsImpl = await deployContract("IdentityRegistryStorage", [], deployer, log);
  const irImpl = await deployContract("IdentityRegistry", [], deployer, log);
  const mcImpl = await deployContract("ModularCompliance", [], deployer, log);

  // 3. Implementation authority (reference) + factory.
  log("T-REX authority and factory:");
  const trexAuthority = await deployContract(
    "TREXImplementationAuthority",
    [true, ethers.ZeroAddress, ethers.ZeroAddress],
    deployer,
    log,
  );
  await send(
    trexAuthority.addAndUseTREXVersion(TREX_VERSION, {
      tokenImplementation: await tokenImpl.getAddress(),
      ctrImplementation: await ctrImpl.getAddress(),
      irImplementation: await irImpl.getAddress(),
      irsImplementation: await irsImpl.getAddress(),
      tirImplementation: await tirImpl.getAddress(),
      mcImplementation: await mcImpl.getAddress(),
    }),
  );
  const trexFactory = await deployContract(
    "TREXFactory",
    [await trexAuthority.getAddress(), await idFactory.getAddress()],
    deployer,
    log,
  );
  await send(trexAuthority.setTREXFactory(await trexFactory.getAddress()));
  // The TREXFactory creates the token's own ONCHAINID through the IdFactory.
  await send(idFactory.addTokenFactory(await trexFactory.getAddress()));

  // 4. Compliance modules.
  log("Compliance modules:");
  const countryModule = await deployModule("CountryAllowModule", deployer, log);
  const modules = [countryModule.proxy];
  const settings = [
    countryModule.proxy.interface.encodeFunctionData("batchAllowCountries", [countries]),
  ];
  let supplyModule = null;
  if (supplyLimit !== null) {
    supplyModule = await deployModule("SupplyLimitModule", deployer, log);
    modules.push(supplyModule.proxy);
    settings.push(supplyModule.proxy.interface.encodeFunctionData("setSupplyLimit", [supplyLimit]));
  }

  // 5. The suite. Owner and agent go straight to the Safe; the deployer is
  //    never an agent on the token or identity registry.
  log("Deploying suite via TREXFactory.deployTREXSuite:");
  const tokenDetails = {
    owner: safe,
    name,
    symbol,
    decimals,
    irs: ethers.ZeroAddress, // deploy a fresh IdentityRegistryStorage
    ONCHAINID: ethers.ZeroAddress, // factory creates the token ONCHAINID (management key = Safe)
    irAgents: [safe],
    tokenAgents: [safe],
    complianceModules: await Promise.all(modules.map((m) => m.getAddress())),
    complianceSettings: settings,
  };
  // No required claim topics and no trusted issuers: KYC is done off-chain by a
  // regulated provider, so isVerified(wallet) == "wallet is registered".
  const claimDetails = { claimTopics: [], issuers: [], issuerClaims: [] };
  const receipt = await send(trexFactory.deployTREXSuite(salt, tokenDetails, claimDetails));
  const parsed = receipt.logs
    .map((l) => {
      try {
        return trexFactory.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "TREXSuiteDeployed");
  if (!parsed) throw new Error("TREXSuiteDeployed event not found");
  const [tokenAddr, irAddr, irsAddr, tirAddr, ctrAddr, mcAddr] = parsed.args;
  log(`  Token                        ${tokenAddr}`);
  log(`  IdentityRegistry             ${irAddr}`);
  log(`  IdentityRegistryStorage      ${irsAddr}`);
  log(`  TrustedIssuersRegistry       ${tirAddr}`);
  log(`  ClaimTopicsRegistry          ${ctrAddr}`);
  log(`  ModularCompliance            ${mcAddr}`);

  // 6. Hand over everything still owned by the deployer (or by the factory) to the Safe.
  log("Transferring ownership to the Safe:");
  // TREXFactory 4.1.6 does not transfer IRS ownership; recover it explicitly.
  await send(trexFactory.recoverContractOwnership(irsAddr, safe));
  for (const m of modules) await send(m.transferOwnership(safe));
  await send(idFactory.transferOwnership(safe));
  await send(oidAuthority.transferOwnership(safe));
  await send(trexAuthority.transferOwnership(safe));
  await send(trexFactory.transferOwnership(safe));

  const contracts = {
    token: await ethers.getContractAt("Token", tokenAddr, deployer),
    identityRegistry: await ethers.getContractAt("IdentityRegistry", irAddr, deployer),
    identityRegistryStorage: await ethers.getContractAt("IdentityRegistryStorage", irsAddr, deployer),
    trustedIssuersRegistry: await ethers.getContractAt("TrustedIssuersRegistry", tirAddr, deployer),
    claimTopicsRegistry: await ethers.getContractAt("ClaimTopicsRegistry", ctrAddr, deployer),
    compliance: await ethers.getContractAt("ModularCompliance", mcAddr, deployer),
    countryAllowModule: countryModule.proxy,
    supplyLimitModule: supplyModule ? supplyModule.proxy : null,
    idFactory,
    identityImplementationAuthority: oidAuthority,
    identityImplementation: identityImpl,
    trexImplementationAuthority: trexAuthority,
    trexFactory,
    implementations: {
      token: tokenImpl,
      claimTopicsRegistry: ctrImpl,
      trustedIssuersRegistry: tirImpl,
      identityRegistryStorage: irsImpl,
      identityRegistry: irImpl,
      modularCompliance: mcImpl,
      countryAllowModule: countryModule.implementation,
      supplyLimitModule: supplyModule ? supplyModule.implementation : null,
    },
  };

  await assertHandover(contracts, deployerAddress, safe);
  log("Handover verified: Safe owns everything, deployer holds no role.");

  // deployBlock = block of deployTREXSuite (token creation): the indexer's start block.
  return { contracts, deployBlock: receipt.blockNumber, salt, decimals };
}

// Every ownable contract the deployment created, as [label, contract].
function ownables(c) {
  const list = [
    ["token", c.token],
    ["identityRegistry", c.identityRegistry],
    ["identityRegistryStorage", c.identityRegistryStorage],
    ["trustedIssuersRegistry", c.trustedIssuersRegistry],
    ["claimTopicsRegistry", c.claimTopicsRegistry],
    ["compliance", c.compliance],
    ["countryAllowModule", c.countryAllowModule],
    ["idFactory", c.idFactory],
    ["identityImplementationAuthority", c.identityImplementationAuthority],
    ["trexImplementationAuthority", c.trexImplementationAuthority],
    ["trexFactory", c.trexFactory],
  ];
  if (c.supplyLimitModule) list.push(["supplyLimitModule", c.supplyLimitModule]);
  return list;
}

// Throws unless the Safe owns every ownable contract, is agent on the token,
// IR, and the deployer is neither owner nor agent anywhere.
async function assertHandover(c, deployer, safe) {
  const problems = [];
  for (const [label, contract] of ownables(c)) {
    const owner = await contract.owner();
    if (ethers.getAddress(owner) !== ethers.getAddress(safe)) {
      problems.push(`${label}.owner() is ${owner}, expected Safe ${safe}`);
    }
  }
  for (const [label, contract] of [
    ["token", c.token],
    ["identityRegistry", c.identityRegistry],
    ["identityRegistryStorage", c.identityRegistryStorage],
  ]) {
    if (await contract.isAgent(deployer)) problems.push(`deployer is agent on ${label}`);
  }
  if (!(await c.token.isAgent(safe))) problems.push("Safe is not agent on token");
  if (!(await c.identityRegistry.isAgent(safe))) problems.push("Safe is not agent on identityRegistry");
  if (problems.length) throw new Error(`Handover check failed:\n  - ${problems.join("\n  - ")}`);
}

module.exports = { deploySuite, assertHandover, ownables, TREX_VERSION };
