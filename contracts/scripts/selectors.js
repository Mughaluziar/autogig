// Prints the exact signatures + 4-byte selectors the backend relies on, taken
// from the compiled T-REX 4.1.6 / ONCHAINID 2.2.1 ABIs (not typed by hand), and
// fails if any expected function is missing from the real ABI.
//
//   npx hardhat run scripts/selectors.js        (or: npm run selectors)

const hre = require("hardhat");

const WANTED = {
  Token: [
    "mint(address,uint256)",
    "burn(address,uint256)",
    "freezePartialTokens(address,uint256)",
    "unfreezePartialTokens(address,uint256)",
    "forcedTransfer(address,address,uint256)",
    "setAddressFrozen(address,bool)",
    "totalSupply()",
    "balanceOf(address)",
    "getFrozenTokens(address)",
    "isFrozen(address)",
    "paused()",
    "pause()",
    "unpause()",
    "decimals()",
    "identityRegistry()",
    "compliance()",
    "isAgent(address)",
    "owner()",
  ],
  IdentityRegistry: [
    "registerIdentity(address,address,uint16)",
    "deleteIdentity(address)",
    "updateCountry(address,uint16)",
    "isVerified(address)",
    "contains(address)",
    "identity(address)",
    "investorCountry(address)",
    "isAgent(address)",
  ],
  IdFactory: ["createIdentity(address,string)", "getIdentity(address)", "isSaltTaken(string)", "owner()"],
};

const EVENTS = {
  Token: [
    "Transfer(address,address,uint256)",
    "TokensFrozen(address,uint256)",
    "TokensUnfrozen(address,uint256)",
    "Paused(address)",
    "Unpaused(address)",
  ],
  IdentityRegistry: ["IdentityRegistered(address,address)", "IdentityRemoved(address,address)"],
  IdFactory: ["WalletLinked(address,address)"],
};

function canonical(fragment) {
  return fragment.format("sighash");
}

async function main() {
  let missing = 0;
  const rows = [];
  for (const [contract, sigs] of Object.entries(WANTED)) {
    const { abi } = await hre.artifacts.readArtifact(contract);
    const iface = new hre.ethers.Interface(abi);
    for (const sig of sigs) {
      const fn = iface.getFunction(sig);
      if (!fn) {
        console.error(`MISSING in ${contract} ABI: ${sig}`);
        missing++;
        continue;
      }
      const params = fn.inputs.map((i) => `${i.type} ${i.name}`).join(", ");
      const outs = fn.outputs.map((o) => o.type).join(", ");
      rows.push([contract, canonical(fn), fn.selector, `${fn.stateMutability}; (${params})${outs ? ` -> ${outs}` : ""}`]);
    }
    for (const sig of EVENTS[contract] || []) {
      const ev = iface.getEvent(sig);
      if (!ev) {
        console.error(`MISSING event in ${contract} ABI: ${sig}`);
        missing++;
        continue;
      }
      const params = ev.inputs.map((i) => `${i.type}${i.indexed ? " indexed" : ""} ${i.name}`).join(", ");
      rows.push([contract, `event ${canonical(ev)}`, ev.topicHash, `(${params})`]);
    }
  }
  console.log("| Contract | Signature | Selector / topic0 | Notes |");
  console.log("|---|---|---|---|");
  for (const r of rows) console.log(`| ${r[0]} | \`${r[1]}\` | \`${r[2]}\` | ${r[3]} |`);
  if (missing) {
    console.error(`${missing} expected signature(s) not found`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
