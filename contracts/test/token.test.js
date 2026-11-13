const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture, US, DE, FR, ONE_SHARE, SUPPLY_LIMIT } = require("./fixture");

const AGENT_ERR = "AgentRole: caller does not have the Agent role";
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

// alice (US) and bob (DE) are registered in allowed countries; dave (FR) is
// registered in a disallowed country; carol is not registered at all.
async function onboardedFixture() {
  const f = await deployFixture();
  const { alice, bob, dave } = f.signers;
  await f.onboard(alice.address, US);
  await f.onboard(bob.address, DE);
  await f.onboard(dave.address, FR);
  return f;
}

async function liveFixture() {
  const f = await onboardedFixture();
  await (await f.asSafe.token.unpause()).wait();
  return f;
}

describe("Token: agent-only operations", function () {
  it("only the agent can mint, burn, freeze, unfreeze, forcedTransfer, pause and unpause", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    const { alice, bob, outsider, deployer } = signers;
    await (await asSafe.token.mint(alice.address, 10n * ONE_SHARE)).wait();

    for (const s of [outsider, deployer, alice]) {
      const t = token.connect(s);
      await expect(t.mint(alice.address, 1)).to.be.revertedWith(AGENT_ERR);
      await expect(t.burn(alice.address, 1)).to.be.revertedWith(AGENT_ERR);
      await expect(t.freezePartialTokens(alice.address, 1)).to.be.revertedWith(AGENT_ERR);
      await expect(t.unfreezePartialTokens(alice.address, 0)).to.be.revertedWith(AGENT_ERR);
      await expect(t.setAddressFrozen(alice.address, true)).to.be.revertedWith(AGENT_ERR);
      await expect(t.forcedTransfer(alice.address, bob.address, 1)).to.be.revertedWith(AGENT_ERR);
      await expect(t.unpause()).to.be.revertedWith(AGENT_ERR);
    }
    await (await asSafe.token.unpause()).wait();
    await expect(token.connect(outsider).pause()).to.be.revertedWith(AGENT_ERR);
  });

  it("agent mint emits a standard ERC-20 Transfer from the zero address", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    const amount = 250n * ONE_SHARE;
    const tx = await asSafe.token.mint(signers.alice.address, amount);
    await expect(tx).to.emit(token, "Transfer").withArgs(ethers.ZeroAddress, signers.alice.address, amount);
    const receipt = await tx.wait();
    const log = receipt.logs.find((l) => l.topics[0] === TRANSFER_TOPIC);
    expect(log.topics[1]).to.equal(ethers.zeroPadValue(ethers.ZeroAddress, 32));
    expect(log.topics[2]).to.equal(ethers.zeroPadValue(signers.alice.address, 32));
    expect(BigInt(log.data)).to.equal(amount);
    expect(await token.balanceOf(signers.alice.address)).to.equal(amount);
    expect(await token.totalSupply()).to.equal(amount);
  });

  it("agent burn emits Transfer to the zero address and reduces supply", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    await (await asSafe.token.mint(signers.alice.address, 5n * ONE_SHARE)).wait();
    await expect(asSafe.token.burn(signers.alice.address, 2n * ONE_SHARE))
      .to.emit(token, "Transfer")
      .withArgs(signers.alice.address, ethers.ZeroAddress, 2n * ONE_SHARE);
    expect(await token.totalSupply()).to.equal(3n * ONE_SHARE);
    await expect(asSafe.token.burn(signers.alice.address, 4n * ONE_SHARE)).to.be.revertedWith(
      "cannot burn more than balance",
    );
  });
});

describe("Token: identity and compliance checks", function () {
  it("mint to an unregistered wallet reverts", async function () {
    const { asSafe, signers } = await loadFixture(onboardedFixture);
    await expect(asSafe.token.mint(signers.carol.address, ONE_SHARE)).to.be.revertedWith(
      "Identity is not verified.",
    );
  });

  it("mint to a registered wallet in a disallowed country reverts", async function () {
    const { asSafe, signers } = await loadFixture(onboardedFixture);
    await expect(asSafe.token.mint(signers.dave.address, ONE_SHARE)).to.be.revertedWith("Compliance not followed");
  });

  it("mint above the SupplyLimitModule cap reverts", async function () {
    const { asSafe, signers } = await loadFixture(onboardedFixture);
    await (await asSafe.token.mint(signers.alice.address, SUPPLY_LIMIT)).wait();
    await expect(asSafe.token.mint(signers.bob.address, 1)).to.be.revertedWith("Compliance not followed");
  });

  it("transfers are blocked while paused (the deploy state); mint still works", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    expect(await token.paused()).to.equal(true);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
      "Pausable: paused",
    );
    await expect(asSafe.token.unpause()).to.emit(token, "Unpaused").withArgs(signers.safe.address);
    await (await token.connect(signers.alice).transfer(signers.bob.address, 1)).wait();
    expect(await token.balanceOf(signers.bob.address)).to.equal(1n);
  });

  it("transfer to an unregistered wallet reverts", async function () {
    const { token, asSafe, signers } = await loadFixture(liveFixture);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await expect(token.connect(signers.alice).transfer(signers.carol.address, 1)).to.be.revertedWith(
      "Transfer not possible",
    );
  });

  it("transfer to a registered wallet in a disallowed country reverts", async function () {
    const { token, asSafe, identityRegistry, signers } = await loadFixture(liveFixture);
    expect(await identityRegistry.isVerified(signers.dave.address)).to.equal(true);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await expect(token.connect(signers.alice).transfer(signers.dave.address, 1)).to.be.revertedWith(
      "Transfer not possible",
    );
    // transferFrom takes the same path.
    await (await token.connect(signers.alice).approve(signers.bob.address, 1)).wait();
    await expect(
      token.connect(signers.bob).transferFrom(signers.alice.address, signers.dave.address, 1),
    ).to.be.revertedWith("Transfer not possible");
  });

  it("transfer between registered wallets in allowed countries succeeds", async function () {
    const { token, asSafe, signers } = await loadFixture(liveFixture);
    await (await asSafe.token.mint(signers.alice.address, 3n * ONE_SHARE)).wait();
    await expect(token.connect(signers.alice).transfer(signers.bob.address, ONE_SHARE))
      .to.emit(token, "Transfer")
      .withArgs(signers.alice.address, signers.bob.address, ONE_SHARE);
  });
});

describe("Token: lock-up via partial freeze", function () {
  it("mint + freezePartialTokens blocks transfer of the frozen amount until unfreeze", async function () {
    const { token, asSafe, signers } = await loadFixture(liveFixture);
    const { alice, bob } = signers;
    const minted = 100n * ONE_SHARE;
    const locked = 60n * ONE_SHARE;

    // Subscription with a lock-up: mint then freeze (one Safe batch).
    await (await asSafe.token.mint(alice.address, minted)).wait();
    await expect(asSafe.token.freezePartialTokens(alice.address, locked))
      .to.emit(token, "TokensFrozen")
      .withArgs(alice.address, locked);
    expect(await token.getFrozenTokens(alice.address)).to.equal(locked);
    expect(await token.balanceOf(alice.address)).to.equal(minted); // frozen tokens still count in balanceOf

    // Free balance is 40: moving 41 fails, 40 succeeds, then nothing more.
    await expect(token.connect(alice).transfer(bob.address, 41n * ONE_SHARE)).to.be.revertedWith(
      "Insufficient Balance",
    );
    await (await token.connect(alice).transfer(bob.address, 40n * ONE_SHARE)).wait();
    await expect(token.connect(alice).transfer(bob.address, 1)).to.be.revertedWith("Insufficient Balance");

    // Cannot freeze more than the unfrozen balance.
    await expect(asSafe.token.freezePartialTokens(alice.address, 1)).to.be.revertedWith(
      "Amount exceeds available balance",
    );

    // Lock-up ends: unfreeze, then the tokens move.
    await expect(asSafe.token.unfreezePartialTokens(alice.address, locked))
      .to.emit(token, "TokensUnfrozen")
      .withArgs(alice.address, locked);
    expect(await token.getFrozenTokens(alice.address)).to.equal(0n);
    await (await token.connect(alice).transfer(bob.address, locked)).wait();
    expect(await token.balanceOf(bob.address)).to.equal(minted);
    await expect(asSafe.token.unfreezePartialTokens(alice.address, 1)).to.be.revertedWith(
      "Amount should be less than or equal to frozen tokens",
    );
  });

  it("burn (redemption) of more than the free balance unfreezes the difference automatically", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    const { alice } = signers;
    await (await asSafe.token.mint(alice.address, 10n * ONE_SHARE)).wait();
    await (await asSafe.token.freezePartialTokens(alice.address, 8n * ONE_SHARE)).wait();
    await expect(asSafe.token.burn(alice.address, 5n * ONE_SHARE))
      .to.emit(token, "TokensUnfrozen")
      .withArgs(alice.address, 3n * ONE_SHARE);
    expect(await token.getFrozenTokens(alice.address)).to.equal(5n * ONE_SHARE);
    expect(await token.balanceOf(alice.address)).to.equal(5n * ONE_SHARE);
  });

  it("setAddressFrozen blocks the whole wallet", async function () {
    const { token, asSafe, signers } = await loadFixture(liveFixture);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await (await asSafe.token.setAddressFrozen(signers.alice.address, true)).wait();
    expect(await token.isFrozen(signers.alice.address)).to.equal(true);
    await expect(token.connect(signers.alice).transfer(signers.bob.address, 1)).to.be.revertedWith(
      "wallet is frozen",
    );
  });
});

describe("Token: forcedTransfer", function () {
  it("agent can force-move tokens, including frozen ones, even while paused", async function () {
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    const { alice, bob } = signers;
    expect(await token.paused()).to.equal(true);
    await (await asSafe.token.mint(alice.address, 10n * ONE_SHARE)).wait();
    await (await asSafe.token.freezePartialTokens(alice.address, 6n * ONE_SHARE)).wait();

    await expect(asSafe.token.forcedTransfer(alice.address, bob.address, 7n * ONE_SHARE))
      .to.emit(token, "Transfer")
      .withArgs(alice.address, bob.address, 7n * ONE_SHARE)
      .and.to.emit(token, "TokensUnfrozen")
      .withArgs(alice.address, 3n * ONE_SHARE);
    expect(await token.balanceOf(alice.address)).to.equal(3n * ONE_SHARE);
    expect(await token.getFrozenTokens(alice.address)).to.equal(3n * ONE_SHARE);
    expect(await token.balanceOf(bob.address)).to.equal(7n * ONE_SHARE);
  });

  it("forcedTransfer to an unregistered wallet reverts", async function () {
    const { asSafe, signers } = await loadFixture(onboardedFixture);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await expect(asSafe.token.forcedTransfer(signers.alice.address, signers.carol.address, 1)).to.be.revertedWith(
      "Transfer not possible",
    );
  });

  it("forcedTransfer is NOT country-checked (T-REX 4.1.6 behaviour: only isVerified)", async function () {
    // Documented so operators know: the Safe must check the destination's jurisdiction itself.
    const { token, asSafe, signers } = await loadFixture(onboardedFixture);
    await (await asSafe.token.mint(signers.alice.address, ONE_SHARE)).wait();
    await (await asSafe.token.forcedTransfer(signers.alice.address, signers.dave.address, 1)).wait();
    expect(await token.balanceOf(signers.dave.address)).to.equal(1n);
  });
});

describe("Invariant: totalSupply == sum of balances", function () {
  // Deterministic PRNG (mulberry32) so failures reproduce; override with INVARIANT_SEED.
  function prng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("holds (and matches a reference model) across a random sequence of mints/transfers/burns/freezes", async function () {
    const f = await loadFixture(liveFixture);
    const { token, asSafe, signers } = f;
    const holders = [signers.alice, signers.bob];
    // A third and fourth registered holder (US) for more interleavings.
    for (const s of (await ethers.getSigners()).slice(7, 9)) {
      await f.onboard(s.address, US);
      holders.push(s);
    }
    const seed = Number(process.env.INVARIANT_SEED || 20261109);
    const rand = prng(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const amt = (max) => (max <= 0n ? 0n : BigInt(Math.floor(rand() * Number(max))) + 1n);

    const bal = new Map(holders.map((h) => [h.address, 0n]));
    const frozen = new Map(holders.map((h) => [h.address, 0n]));
    let supply = 0n;
    const counts = { mint: 0, transfer: 0, burn: 0, freeze: 0, unfreeze: 0, forced: 0, rejected: 0 };

    const STEPS = Number(process.env.INVARIANT_STEPS || 150);
    for (let i = 0; i < STEPS; i++) {
      const r = rand();
      const a = pick(holders);
      const b = pick(holders.filter((h) => h !== a));
      const free = bal.get(a.address) - frozen.get(a.address);

      if (r < 0.3) {
        const x = amt(1000n * ONE_SHARE);
        await (await asSafe.token.mint(a.address, x)).wait();
        bal.set(a.address, bal.get(a.address) + x);
        supply += x;
        counts.mint++;
      } else if (r < 0.55) {
        if (free > 0n && rand() < 0.85) {
          const x = amt(free);
          await (await token.connect(a).transfer(b.address, x)).wait();
          bal.set(a.address, bal.get(a.address) - x);
          bal.set(b.address, bal.get(b.address) + x);
          counts.transfer++;
        } else {
          // Over-spend of the free balance must revert and change nothing.
          await expect(token.connect(a).transfer(b.address, free + 1n)).to.be.reverted;
          counts.rejected++;
        }
      } else if (r < 0.75) {
        const x = amt(bal.get(a.address));
        if (x === 0n) continue;
        await (await asSafe.token.burn(a.address, x)).wait();
        const fromFree = x <= free ? x : free;
        frozen.set(a.address, frozen.get(a.address) - (x - fromFree));
        bal.set(a.address, bal.get(a.address) - x);
        supply -= x;
        counts.burn++;
      } else if (r < 0.85) {
        const x = amt(free);
        if (x === 0n) continue;
        await (await asSafe.token.freezePartialTokens(a.address, x)).wait();
        frozen.set(a.address, frozen.get(a.address) + x);
        counts.freeze++;
      } else if (r < 0.93) {
        const x = amt(frozen.get(a.address));
        if (x === 0n) continue;
        await (await asSafe.token.unfreezePartialTokens(a.address, x)).wait();
        frozen.set(a.address, frozen.get(a.address) - x);
        counts.unfreeze++;
      } else {
        const x = amt(bal.get(a.address));
        if (x === 0n) continue;
        await (await asSafe.token.forcedTransfer(a.address, b.address, x)).wait();
        if (x > free) frozen.set(a.address, frozen.get(a.address) - (x - free));
        bal.set(a.address, bal.get(a.address) - x);
        bal.set(b.address, bal.get(b.address) + x);
        counts.forced++;
      }

      // Check the invariant after every step.
      const total = await token.totalSupply();
      let sum = 0n;
      for (const h of holders) sum += await token.balanceOf(h.address);
      expect(total, `step ${i} seed ${seed}`).to.equal(sum);
      expect(total, `model supply, step ${i} seed ${seed}`).to.equal(supply);
    }

    for (const h of holders) {
      expect(await token.balanceOf(h.address)).to.equal(bal.get(h.address));
      expect(await token.getFrozenTokens(h.address)).to.equal(frozen.get(h.address));
      expect(frozen.get(h.address) <= bal.get(h.address)).to.equal(true);
    }
    // Make sure the sequence actually exercised every operation.
    for (const k of ["mint", "transfer", "burn", "freeze", "unfreeze", "forced"]) {
      expect(counts[k], `op ${k} never ran (seed ${seed})`).to.be.greaterThan(0);
    }
  });
});
