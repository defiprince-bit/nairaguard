// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {MockTextileReactor} from "../src/mocks/MockTextileReactor.sol";

/// @notice Deploys the Vault implementation + VaultFactory (design.md §7, §8).
/// Celo Sepolia: 6-dp mock cNGN/USDT, a mock Chainlink NGN/USD feed and a mock Textile reactor (reused when
/// MOCK_CNGN / MOCK_USDT / MOCK_FEED / MOCK_REACTOR are all set).
/// Mainnet: CNGN_ADDRESS, USDT_ADDRESS; Chainlink NGN/USD and both Textile contracts are constants.
contract Deploy is Script {
    uint256 constant CELO_SEPOLIA = 11142220;
    // Textile on Celo mainnet (docs/textile-research.md). Both allowlisted as target and spender; never Permit2.
    address constant TEXTILE_LIMIT_ORDER_REACTOR = 0xa9AA0a64769cBed4d3B1Ceb4Df01CdE915C235b3;
    address constant TEXTILE_VAULT_ORDER_EXECUTOR = 0x01b006d5c687bde182aa36F542f1f014144742e2;
    address constant CHAINLINK_NGN_USD = 0xc17cBE2dB40e53F4984C46F608DA6DA1fF074c11;

    function run() external returns (VaultFactory factory) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");

        vm.startBroadcast(pk);

        address cngn;
        address usdt;
        address feed;
        address reactor;
        address spender;
        if (block.chainid == CELO_SEPOLIA) {
            (cngn, usdt, feed, reactor) = _testnetMocks();
            spender = reactor;
        } else {
            cngn = vm.envAddress("CNGN_ADDRESS");
            usdt = vm.envAddress("USDT_ADDRESS");
            feed = vm.envOr("PRICE_FEED", CHAINLINK_NGN_USD);
            reactor = TEXTILE_LIMIT_ORDER_REACTOR;
            spender = TEXTILE_VAULT_ORDER_EXECUTOR;
        }

        Vault impl = new Vault();
        factory = new VaultFactory(address(impl), agent, cngn, usdt);
        factory.setPriceFeed(feed);
        // Allowlisted (target, spender) pairs. Never Permit2.
        factory.setVenue(reactor, reactor, true, "textile");
        if (spender != reactor) factory.setVenue(spender, spender, true, "textile");

        vm.stopBroadcast();

        console2.log("VaultImplementation", address(impl));
        console2.log("VaultFactory", address(factory));
        console2.log("cNGN", cngn);
        console2.log("USDT", usdt);
        console2.log("PriceFeed", feed);
        console2.log("TextileReactor", reactor);
        console2.log("TextileSpender", spender);
        console2.log("Agent", agent);
    }

    function _testnetMocks() internal returns (address cngn, address usdt, address feed, address reactor) {
        cngn = vm.envOr("MOCK_CNGN", address(0));
        usdt = vm.envOr("MOCK_USDT", address(0));
        feed = vm.envOr("MOCK_FEED", address(0));
        reactor = vm.envOr("MOCK_REACTOR", address(0));
        if (cngn != address(0) && usdt != address(0) && feed != address(0) && reactor != address(0)) {
            return (cngn, usdt, feed, reactor);
        }

        MockERC20 c = new MockERC20("cNGN", "cNGN", 6);
        MockERC20 u = new MockERC20(unicode"USD₮", "USDT", 6);
        // 0.00075193 USD/NGN, 8 dp (Chainlink mainnet read, 14 Oct 2026). Agent keeps it fresh on Sepolia.
        MockChainlinkFeed f = new MockChainlinkFeed(8, 75193);
        MockTextileReactor r = new MockTextileReactor();
        c.mint(address(r), 100_000_000e6);
        u.mint(address(r), 100_000e6);
        return (address(c), address(u), address(f), address(r));
    }
}
