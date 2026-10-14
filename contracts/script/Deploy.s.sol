// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

/// @notice Deploys the Vault implementation + VaultFactory (design.md §7).
/// On Celo Sepolia, reuses mock tokens/router when MOCK_* env vars are set, otherwise deploys new mocks.
contract Deploy is Script {
    uint256 constant CELO_SEPOLIA = 11142220;

    function run() external returns (VaultFactory factory) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        vm.startBroadcast(pk);

        address cngn;
        address usdt;
        address router;
        if (block.chainid == CELO_SEPOLIA) {
            (cngn, usdt, router) = _testnetTokens();
        } else {
            cngn = vm.envAddress("CNGN_ADDRESS");
            usdt = vm.envAddress("USDT_ADDRESS");
            router = vm.envOr("TEXTILE_ROUTER", address(0));
        }

        Vault impl = new Vault();
        factory = new VaultFactory(address(impl), agent, cngn, usdt);
        if (router != address(0)) factory.setRouter(router, true);

        vm.stopBroadcast();

        console2.log("VaultImplementation", address(impl));
        console2.log("VaultFactory", address(factory));
        console2.log("cNGN", cngn);
        console2.log("USDT", usdt);
        console2.log("Router", router);
        console2.log("Agent", agent);
    }

    function _testnetTokens() internal returns (address cngn, address usdt, address router) {
        cngn = vm.envOr("MOCK_CNGN", address(0));
        usdt = vm.envOr("MOCK_USDT", address(0));
        router = vm.envOr("MOCK_ROUTER", address(0));
        if (cngn != address(0) && usdt != address(0) && router != address(0)) return (cngn, usdt, router);

        MockERC20 c = new MockERC20("cNGN", "cNGN", 18);
        MockERC20 u = new MockERC20(unicode"USD₮", "USDT", 18);
        MockSwapRouter r = new MockSwapRouter();
        // quote(in,out) = amountIn * rate[out] / rate[in]  →  1 USDT = 1500 cNGN.
        r.setRate(address(c), 1500e18);
        r.setRate(address(u), 1e18);
        c.mint(address(r), 10_000_000e18);
        u.mint(address(r), 10_000_000e18);
        return (address(c), address(u), address(r));
    }
}
