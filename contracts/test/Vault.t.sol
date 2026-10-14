// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault} from "../src/Vault.sol";

contract VaultTest {
    Vault vault;

    function setUp() public {
        vault = new Vault(address(0xA11CE), 100e18);
    }

    function test_InitialState() public view {
        require(vault.owner() == address(this), "owner");
        require(vault.agent() == address(0xA11CE), "agent");
        require(vault.dailyLimit() == 100e18, "limit");
    }

    function test_OwnerCanSetLimit() public {
        vault.setDailyLimit(5e18);
        require(vault.dailyLimit() == 5e18, "limit");
    }
}
