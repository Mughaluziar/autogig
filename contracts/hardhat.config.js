// Hardhat config for the pool-share token (T-REX 4.1.6).
// Networks: in-process `hardhat` and `baseSepolia` (84532) only.
// There are intentionally NO mainnet network entries: mainnet deployment is
// blocked until the launch gate in docs/token-program.md (sections 5 and 7) passes.
require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");

const { BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, BASESCAN_API_KEY } = process.env;

const baseSepoliaAccounts =
  DEPLOYER_PRIVATE_KEY && DEPLOYER_PRIVATE_KEY.trim() !== "" ? [DEPLOYER_PRIVATE_KEY.trim()] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    // T-REX 4.1.6 and ONCHAINID 2.2.1 pin `pragma solidity 0.8.17`.
    version: "0.8.17",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: baseSepoliaAccounts,
    },
  },
  etherscan: {
    apiKey: BASESCAN_API_KEY || "",
  },
  sourcify: {
    enabled: false,
  },
  mocha: {
    timeout: 120000,
  },
};
