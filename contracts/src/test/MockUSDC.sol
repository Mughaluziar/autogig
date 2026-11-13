// SPDX-License-Identifier: UNLICENSED
// TEST ONLY: a 6-decimal ERC-20 with open minting, standing in for Circle USDC
// on the local Hardhat chain in the end-to-end test (scripts/e2e-local.sh).
// scripts/deploy-mock-usdc.js refuses to deploy it anywhere but chainId 31337.
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USD Coin (test only)", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
