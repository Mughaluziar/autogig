// Deploy the pool-share token suite (T-REX 4.1.6) and hand all roles to the Safe.
//
//   npx hardhat run scripts/deploy.js --network baseSepolia
//
// Env (see .env.example): SAFE_ADDRESS, TOKEN_NAME, TOKEN_SYMBOL,
// ALLOWED_COUNTRIES, SUPPLY_LIMIT (optional), USDC_ADDRESS (recorded only),
// TREX_SALT (optional), plus BASE_SEPOLIA_RPC_URL / DEPLOYER_PRIVATE_KEY.
//
// Writes deployments/<network>.json.

const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { deploySuite, TREX_VERSION } = require("./lib/deploySuite");

const { ethers, network } = hre;

// Belt and braces on top of hardhat.config.js having no mainnet entries.
const ALLOWED_CHAIN_IDS = new Set([31337n, 84532n]);

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v.trim();
}

function parseCountries(raw) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < 1 || n > 999) {
        throw new Error(`ALLOWED_COUNTRIES: invalid ISO-3166 numeric code "${s}"`);
      }
      return n;
    });
}

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (!ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`Refusing to deploy to chainId ${chainId}: only hardhat (31337) and Base Sepolia (84532).`);
  }

  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("No deployer account: set DEPLOYER_PRIVATE_KEY in .env");
  const deployer = signers[0];

  let safe = env("SAFE_ADDRESS");
  if (!safe) {
    if (network.name !== "hardhat") throw new Error("SAFE_ADDRESS is required");
    safe = signers[1].address; // in-process dry run only
    console.log(`SAFE_ADDRESS not set; using hardhat account #1 as a stand-in Safe: ${safe}`);
  }
  if (!ethers.isAddress(safe)) throw new Error(`SAFE_ADDRESS is not an address: ${safe}`);
  safe = ethers.getAddress(safe);

  // Ownership transfers are single-step (OZ 4.x Ownable). A wrong address would
  // lose the token for good, so on a live network require a contract at SAFE_ADDRESS.
  if (network.name !== "hardhat" && env("ALLOW_SAFE_WITHOUT_CODE") !== "true") {
    const code = await ethers.provider.getCode(safe);
    if (code === "0x") {
      throw new Error(
        `No contract code at SAFE_ADDRESS ${safe} on chain ${chainId}. Deploy the Safe first ` +
          "(or set ALLOW_SAFE_WITHOUT_CODE=true for a throwaway test).",
      );
    }
  }

  const name = env("TOKEN_NAME", "Pool Share Token");
  const symbol = env("TOKEN_SYMBOL", "POOLS");
  const countries = parseCountries(env("ALLOWED_COUNTRIES", ""));
  if (countries.length === 0) throw new Error("ALLOWED_COUNTRIES is required (e.g. 840,276)");
  const supplyLimitRaw = env("SUPPLY_LIMIT");
  const supplyLimit = supplyLimitRaw ? BigInt(supplyLimitRaw) : null;
  const usdc = env("USDC_ADDRESS", null);
  if (usdc !== null && !ethers.isAddress(usdc)) throw new Error(`USDC_ADDRESS is not an address: ${usdc}`);
  const salt = env("TREX_SALT", `${symbol}-pool-share-v1`);

  console.log(`Network ${network.name} (chainId ${chainId})`);
  const { contracts: c, deployBlock, decimals } = await deploySuite({
    deployer,
    safe,
    name,
    symbol,
    countries,
    supplyLimit,
    salt,
    log: console.log,
  });

  const addr = (x) => (x ? x.getAddress() : null);
  const record = {
    network: network.name,
    chainId: Number(chainId),
    deployBlock,
    deployedAt: new Date().toISOString(),
    trexVersion: `${TREX_VERSION.major}.${TREX_VERSION.minor}.${TREX_VERSION.patch}`,
    token: await addr(c.token),
    tokenName: name,
    tokenSymbol: symbol,
    decimals,
    paused: await c.token.paused(),
    tokenOnchainId: await c.token.onchainID(),
    identityRegistry: await addr(c.identityRegistry),
    identityRegistryStorage: await addr(c.identityRegistryStorage),
    trustedIssuersRegistry: await addr(c.trustedIssuersRegistry),
    claimTopicsRegistry: await addr(c.claimTopicsRegistry),
    compliance: await addr(c.compliance),
    idFactory: await addr(c.idFactory),
    identityImplementationAuthority: await addr(c.identityImplementationAuthority),
    trexImplementationAuthority: await addr(c.trexImplementationAuthority),
    trexFactory: await addr(c.trexFactory),
    trexSalt: salt,
    modules: {
      countryAllow: await addr(c.countryAllowModule),
      supplyLimit: await addr(c.supplyLimitModule),
    },
    allowedCountries: countries,
    supplyLimit: supplyLimit === null ? null : supplyLimit.toString(),
    implementations: {
      token: await addr(c.implementations.token),
      identityRegistry: await addr(c.implementations.identityRegistry),
      identityRegistryStorage: await addr(c.implementations.identityRegistryStorage),
      trustedIssuersRegistry: await addr(c.implementations.trustedIssuersRegistry),
      claimTopicsRegistry: await addr(c.implementations.claimTopicsRegistry),
      modularCompliance: await addr(c.implementations.modularCompliance),
      identity: await addr(c.identityImplementation),
      countryAllowModule: await addr(c.implementations.countryAllowModule),
      supplyLimitModule: await addr(c.implementations.supplyLimitModule),
    },
    safe,
    deployer: deployer.address,
    usdc,
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nWrote ${path.relative(process.cwd(), file)}`);
  console.log(
    `Token is ${record.paused ? "PAUSED" : "unpaused"}. Mint/burn/freeze work while paused; ` +
      "investor-to-investor transfers need the Safe to call unpause().",
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
