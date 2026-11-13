const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, US, DE, FR, SUPPLY_LIMIT } = require("./fixture");
const { deploySuite, ownables } = require("../scripts/lib/deploySuite");

describe("Deployment wiring", function () {
  it("deploys the token with the expected metadata, paused, with zero supply", async function () {
    const { token } = await loadFixture(deployFixture);
    expect(await token.name()).to.equal("Pool Share Token");
    expect(await token.symbol()).to.equal("POOLS");
    expect(await token.decimals()).to.equal(6n);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.version()).to.equal("4.1.3"); // T-REX 4.1.6 Token reports _TOKEN_VERSION "4.1.3"
    expect(await token.paused()).to.equal(true);
  });

  it("wires token -> identity registry -> storage / topics / issuers, and token -> compliance", async function () {
    const f = await loadFixture(deployFixture);
    const ir = await f.identityRegistry.getAddress();
    const irs = await f.identityRegistryStorage.getAddress();
    const mc = await f.compliance.getAddress();
    const token = await f.token.getAddress();

    expect(await f.token.identityRegistry()).to.equal(ir);
    expect(await f.token.compliance()).to.equal(mc);
    expect(await f.compliance.getTokenBound()).to.equal(token);

    expect(await f.identityRegistry.identityStorage()).to.equal(irs);
    expect(await f.identityRegistry.topicsRegistry()).to.equal(await f.claimTopicsRegistry.getAddress());
    expect(await f.identityRegistry.issuersRegistry()).to.equal(await f.trustedIssuersRegistry.getAddress());
    expect(await f.identityRegistryStorage.linkedIdentityRegistries()).to.deep.equal([ir]);
    expect(await f.identityRegistryStorage.isAgent(ir)).to.equal(true);
    // The token is an agent on the IR (T-REX needs it for recoveryAddress()).
    expect(await f.identityRegistry.isAgent(token)).to.equal(true);
  });

  it("requires no claim topics and trusts no issuers (isVerified == registered)", async function () {
    const f = await loadFixture(deployFixture);
    expect(await f.claimTopicsRegistry.getClaimTopics()).to.deep.equal([]);
    expect(await f.trustedIssuersRegistry.getTrustedIssuers()).to.deep.equal([]);
  });

  it("binds CountryAllowModule (US, DE allowed) and SupplyLimitModule to compliance", async function () {
    const f = await loadFixture(deployFixture);
    const mc = await f.compliance.getAddress();
    const country = await f.countryAllowModule.getAddress();
    const supply = await f.supplyLimitModule.getAddress();
    expect(await f.compliance.getModules()).to.deep.equal([country, supply]);
    expect(await f.countryAllowModule.isComplianceBound(mc)).to.equal(true);
    expect(await f.supplyLimitModule.isComplianceBound(mc)).to.equal(true);
    expect(await f.countryAllowModule.isCountryAllowed(mc, US)).to.equal(true);
    expect(await f.countryAllowModule.isCountryAllowed(mc, DE)).to.equal(true);
    expect(await f.countryAllowModule.isCountryAllowed(mc, FR)).to.equal(false);
    expect(await f.supplyLimitModule.getSupplyLimit(mc)).to.equal(SUPPLY_LIMIT);
  });

  it("registers T-REX 4.1.6 in the implementation authority and links the factories", async function () {
    const f = await loadFixture(deployFixture);
    const v = await f.trexImplementationAuthority.getCurrentVersion();
    expect([v.major, v.minor, v.patch]).to.deep.equal([4n, 1n, 6n]);
    expect(await f.trexImplementationAuthority.getTokenImplementation()).to.equal(
      await f.implementations.token.getAddress(),
    );
    expect(await f.trexFactory.getImplementationAuthority()).to.equal(
      await f.trexImplementationAuthority.getAddress(),
    );
    expect(await f.trexFactory.getIdFactory()).to.equal(await f.idFactory.getAddress());
    expect(await f.idFactory.isTokenFactory(await f.trexFactory.getAddress())).to.equal(true);
    expect(await f.trexFactory.getToken(f.salt)).to.equal(await f.token.getAddress());
  });

  it("gives the token its own ONCHAINID, managed by the Safe", async function () {
    const f = await loadFixture(deployFixture);
    const tokenId = await f.token.onchainID();
    expect(tokenId).to.not.equal(ethers.ZeroAddress);
    expect(await f.idFactory.getToken(tokenId)).to.equal(await f.token.getAddress());
    const identity = await ethers.getContractAt("Identity", tokenId);
    const safeKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [f.signers.safe.address]));
    const deployerKey = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["address"], [f.signers.deployer.address]),
    );
    expect(await identity.keyHasPurpose(safeKey, 1)).to.equal(true);
    expect(await identity.keyHasPurpose(deployerKey, 1)).to.equal(false);
  });

  it("refuses to deploy with the deployer as the Safe", async function () {
    const [deployer] = await ethers.getSigners();
    await expect(
      deploySuite({ deployer, safe: deployer.address, name: "X", symbol: "X", countries: [US] }),
    ).to.be.rejectedWith("SAFE address must not be the deployer EOA");
  });
});

describe("Roles after deployment", function () {
  it("the Safe owns every ownable contract", async function () {
    const f = await loadFixture(deployFixture);
    for (const [label, contract] of ownables(f.contracts)) {
      expect(await contract.owner(), label).to.equal(f.signers.safe.address);
    }
  });

  it("the Safe is agent on token and identity registry", async function () {
    const f = await loadFixture(deployFixture);
    expect(await f.token.isAgent(f.signers.safe.address)).to.equal(true);
    expect(await f.identityRegistry.isAgent(f.signers.safe.address)).to.equal(true);
  });

  it("the deployer has no owner or agent role anywhere", async function () {
    const f = await loadFixture(deployFixture);
    const d = f.signers.deployer;
    for (const [label, contract] of ownables(f.contracts)) {
      expect(await contract.owner(), label).to.not.equal(d.address);
    }
    expect(await f.token.isAgent(d.address)).to.equal(false);
    expect(await f.identityRegistry.isAgent(d.address)).to.equal(false);
    expect(await f.identityRegistryStorage.isAgent(d.address)).to.equal(false);

    // And concretely cannot use any privileged function.
    const agentErr = "AgentRole: caller does not have the Agent role";
    const ownerErr = "Ownable: caller is not the owner";
    await expect(f.token.connect(d).mint(d.address, 1)).to.be.revertedWith(agentErr);
    await expect(f.token.connect(d).unpause()).to.be.revertedWith(agentErr);
    await expect(f.identityRegistry.connect(d).registerIdentity(d.address, d.address, US)).to.be.revertedWith(
      agentErr,
    );
    await expect(f.idFactory.connect(d).createIdentity(d.address, "x")).to.be.revertedWith(ownerErr);
    await expect(f.token.connect(d).addAgent(d.address)).to.be.revertedWith(ownerErr);
    await expect(f.identityRegistry.connect(d).addAgent(d.address)).to.be.revertedWith(ownerErr);
    await expect(f.compliance.connect(d).removeModule(await f.countryAllowModule.getAddress())).to.be.revertedWith(
      ownerErr,
    );
    await expect(f.trexFactory.connect(d).recoverContractOwnership(await f.token.getAddress(), d.address)).to.be
      .reverted;
    await expect(f.countryAllowModule.connect(d).transferOwnership(d.address)).to.be.revertedWith(ownerErr);
  });
});
