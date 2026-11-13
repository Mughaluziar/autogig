const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, US, DE } = require("./fixture");

// The investor onboarding batch the backend proposes to the Safe:
//   1. IdFactory.createIdentity(wallet, salt)            (IdFactory owner = Safe)
//   2. IdentityRegistry.registerIdentity(wallet, id, cc)  (IR agent = Safe)
describe("Investor onboarding (Safe batch)", function () {
  it("createIdentity then registerIdentity makes the wallet verified", async function () {
    const { asSafe, idFactory, identityRegistry, signers } = await loadFixture(deployFixture);
    const wallet = signers.alice.address;
    expect(await identityRegistry.isVerified(wallet)).to.equal(false);
    expect(await identityRegistry.contains(wallet)).to.equal(false);
    expect(await idFactory.getIdentity(wallet)).to.equal(ethers.ZeroAddress);

    // Step 1: the identity address is deterministic (CREATE2) and readable after the call.
    await expect(asSafe.idFactory.createIdentity(wallet, "investor-42"))
      .to.emit(idFactory, "WalletLinked")
      .withArgs(wallet, (id) => ethers.isAddress(id));
    const identity = await idFactory.getIdentity(wallet);
    expect(identity).to.not.equal(ethers.ZeroAddress);
    expect(await idFactory.isSaltTaken("OIDinvestor-42")).to.equal(true); // IdFactory prefixes "OID"

    // The investor's wallet is the identity's management key; the Safe is not.
    const oid = await ethers.getContractAt("Identity", identity);
    const key = (a) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [a]));
    expect(await oid.keyHasPurpose(key(wallet), 1)).to.equal(true);
    expect(await oid.keyHasPurpose(key(signers.safe.address), 1)).to.equal(false);

    // Step 2.
    await expect(asSafe.identityRegistry.registerIdentity(wallet, identity, US))
      .to.emit(identityRegistry, "IdentityRegistered")
      .withArgs(wallet, identity);
    expect(await identityRegistry.isVerified(wallet)).to.equal(true);
    expect(await identityRegistry.contains(wallet)).to.equal(true);
    expect(await identityRegistry.identity(wallet)).to.equal(identity);
    expect(await identityRegistry.investorCountry(wallet)).to.equal(BigInt(US));
  });

  it("the identity address can be precomputed (CREATE2) so both steps fit in one Safe batch", async function () {
    const { asSafe, idFactory, identityImplementationAuthority, identityRegistry, signers } =
      await loadFixture(deployFixture);
    const wallet = signers.carol.address;
    const salt = "investor-precompute";
    const proxy = await ethers.getContractFactory("IdentityProxy");
    const initCode = ethers.concat([
      proxy.bytecode,
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address"],
        [await identityImplementationAuthority.getAddress(), wallet],
      ),
    ]);
    const predicted = ethers.getCreate2Address(
      await idFactory.getAddress(),
      ethers.keccak256(ethers.toUtf8Bytes(`OID${salt}`)),
      ethers.keccak256(initCode),
    );
    await (await asSafe.idFactory.createIdentity(wallet, salt)).wait();
    expect(await idFactory.getIdentity(wallet)).to.equal(predicted);
    await (await asSafe.identityRegistry.registerIdentity(wallet, predicted, US)).wait();
    expect(await identityRegistry.isVerified(wallet)).to.equal(true);
  });

  it("works when the Safe is an address with no private key (impersonated)", async function () {
    // Same sequence, but sent from an impersonated account, as a Safe would execute it.
    const f = await loadFixture(deployFixture);
    const safeAddr = f.signers.safe.address;
    await ethers.provider.send("hardhat_impersonateAccount", [safeAddr]);
    const impersonated = await ethers.getSigner(safeAddr);
    const wallet = f.signers.bob.address;
    await (await f.idFactory.connect(impersonated).createIdentity(wallet, "investor-bob")).wait();
    const identity = await f.idFactory.getIdentity(wallet);
    await (await f.identityRegistry.connect(impersonated).registerIdentity(wallet, identity, DE)).wait();
    await ethers.provider.send("hardhat_stopImpersonatingAccount", [safeAddr]);
    expect(await f.identityRegistry.isVerified(wallet)).to.equal(true);
  });

  it("createIdentity is owner-only (an IR/token agent cannot call it)", async function () {
    const { idFactory, token, identityRegistry, signers } = await loadFixture(deployFixture);
    const { safe, alice, carol } = signers;
    // Give carol the agent role on token and IR (via the Safe/owner): still cannot create identities.
    await (await token.connect(safe).addAgent(carol.address)).wait();
    await (await identityRegistry.connect(safe).addAgent(carol.address)).wait();
    await expect(idFactory.connect(carol).createIdentity(alice.address, "s")).to.be.revertedWith(
      "Ownable: caller is not the owner",
    );
  });

  it("rejects a reused salt and a wallet that already has an identity", async function () {
    const { asSafe, signers } = await loadFixture(deployFixture);
    await (await asSafe.idFactory.createIdentity(signers.alice.address, "dup")).wait();
    await expect(asSafe.idFactory.createIdentity(signers.bob.address, "dup")).to.be.revertedWith(
      "salt already taken",
    );
    await expect(asSafe.idFactory.createIdentity(signers.alice.address, "other")).to.be.revertedWith(
      "wallet already linked to an identity",
    );
  });

  it("registerIdentity is agent-only and rejects a wallet registered twice", async function () {
    const { asSafe, identityRegistry, onboard, signers } = await loadFixture(deployFixture);
    const identity = await onboard(signers.alice.address, US);
    await expect(
      identityRegistry.connect(signers.alice).registerIdentity(signers.bob.address, identity, US),
    ).to.be.revertedWith("AgentRole: caller does not have the Agent role");
    await expect(asSafe.identityRegistry.registerIdentity(signers.alice.address, identity, US)).to.be.revertedWith(
      "address stored already",
    );
  });

  it("deleteIdentity un-verifies; re-onboarding reuses IdFactory.getIdentity(wallet)", async function () {
    const { asSafe, idFactory, identityRegistry, token, onboard, signers } = await loadFixture(deployFixture);
    const wallet = signers.alice.address;
    const identity = await onboard(wallet, US);

    await expect(asSafe.identityRegistry.deleteIdentity(wallet))
      .to.emit(identityRegistry, "IdentityRemoved")
      .withArgs(wallet, identity);
    expect(await identityRegistry.isVerified(wallet)).to.equal(false);
    expect(await identityRegistry.contains(wallet)).to.equal(false);
    await expect(asSafe.token.mint(wallet, 1)).to.be.revertedWith("Identity is not verified.");

    // The IdFactory link survives deletion from the registry, so createIdentity
    // would revert; the backend must re-register the existing identity instead.
    expect(await idFactory.getIdentity(wallet)).to.equal(identity);
    await expect(asSafe.idFactory.createIdentity(wallet, "again")).to.be.revertedWith(
      "wallet already linked to an identity",
    );
    await (await asSafe.identityRegistry.registerIdentity(wallet, identity, US)).wait();
    expect(await identityRegistry.isVerified(wallet)).to.equal(true);
    expect(await token.balanceOf(wallet)).to.equal(0n);
  });
});
