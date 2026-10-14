// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

/// @notice Deploys Vault; on Celo Sepolia also deploys mocks and allowlists the mock router.
contract Deploy is Script {
    uint256 constant CELO_SEPOLIA = 11142220;

    function run() external returns (Vault vault) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        vm.startBroadcast(pk);

        if (block.chainid == CELO_SEPOLIA) {
            vault = _deployTestnet(agent);
        } else {
            address cngn = vm.envAddress("CNGN_ADDRESS");
            address usdt = vm.envAddress("USDT_ADDRESS");
            vault = new Vault(agent, cngn, usdt);
            console2.log("Vault", address(vault));
        }

        vm.stopBroadcast();
    }

    function _deployTestnet(address agent) internal returns (Vault vault) {
        MockERC20 cngn = new MockERC20("cNGN", "cNGN", 18);
        MockERC20 usdt = new MockERC20(unicode"USD₮", "USDT", 18);

        vault = new Vault(agent, address(cngn), address(usdt));

        MockSwapRouter router = new MockSwapRouter();
        // quote(in,out) = amountIn * rate[out] / rate[in]  →  1 USDT = 1500 cNGN.
        router.setRate(address(cngn), 1500e18);
        router.setRate(address(usdt), 1e18);

        // Seed router inventory for test swaps.
        cngn.mint(address(router), 10_000_000e18);
        usdt.mint(address(router), 10_000_000e18);

        vault.setSwapRouter(address(router), true);
        vault.setLimits(
            Vault.Limits({
                maxTradeUsd: 100e18,
                maxDailyUsd: 500e18,
                approvalThresholdUsd: 50e18,
                maxSlippageBps: 100,
                targetNgnBps: 5_000
            })
        );

        console2.log("Vault", address(vault));
        console2.log("cNGN", address(cngn));
        console2.log("USDT", address(usdt));
        console2.log("MockSwapRouter", address(router));
        console2.log("Agent", agent);
    }
}
