const { ethers } = require("hardhat");
const { deploySuite } = require("../scripts/lib/deploySuite");

// ISO-3166 numeric codes used in tests.
const US = 840;
const DE = 276;
const FR = 250; // registered but NOT allowed by CountryAllowModule

const ONE_SHARE = 1_000_000n; // 6 decimals: 1,000,000 raw units = one $1 share at launch
const SUPPLY_LIMIT = 1_000_000n * ONE_SHARE; // 1M shares

async function deployFixture() {
  const [deployer, safe, alice, bob, carol, dave, outsider] = await ethers.getSigners();
  const { contracts, deployBlock, salt } = await deploySuite({
    deployer,
    safe: safe.address, // a plain signer stands in for the Safe multisig
    name: "Pool Share Token",
    symbol: "POOLS",
    countries: [US, DE],
    supplyLimit: SUPPLY_LIMIT,
  });

  // Every call the backend proposes is executed by the Safe.
  const asSafe = {
    token: contracts.token.connect(safe),
    identityRegistry: contracts.identityRegistry.connect(safe),
    idFactory: contracts.idFactory.connect(safe),
    compliance: contracts.compliance.connect(safe),
  };

  // The onboarding sequence the backend proposes as a Safe batch:
  //   1. IdFactory.createIdentity(wallet, salt)
  //   2. IdentityRegistry.registerIdentity(wallet, identity, country)
  async function onboard(wallet, country, idSalt = `investor-${wallet.toLowerCase()}`) {
    const identity = await asSafe.idFactory.createIdentity.staticCall(wallet, idSalt);
    await (await asSafe.idFactory.createIdentity(wallet, idSalt)).wait();
    await (await asSafe.identityRegistry.registerIdentity(wallet, identity, country)).wait();
    return identity;
  }

  return {
    ...contracts,
    contracts,
    asSafe,
    onboard,
    deployBlock,
    salt,
    signers: { deployer, safe, alice, bob, carol, dave, outsider },
  };
}

module.exports = { deployFixture, US, DE, FR, ONE_SHARE, SUPPLY_LIMIT };
