// TEST ONLY: deploy MockUSDC on the local Hardhat node and record it in
// deployments/<network>.json as `usdc`. Refuses every chain but 31337.
const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (chainId !== 31337n) throw new Error(`MockUSDC is local-only; refusing chainId ${chainId}.`);
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await usdc.waitForDeployment();
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  record.usdc = await usdc.getAddress();
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`MockUSDC ${record.usdc} recorded in ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
