// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice The mainnet deploy path (agent/scripts/deploy-mainnet.ts) appends the ERC-8021 suffix for
/// celo_9efd0f97b491 to creation bytecode. These tests prove contracts still deploy and initialise correctly.
contract TaggedDeployTest is Test {
    bytes constant SUFFIX = hex"63656c6f5f396566643066393762343931110080218021802180218021802180218021";

    function _create(bytes memory initcode) internal returns (address a) {
        assembly ("memory-safe") {
            a := create(0, add(initcode, 0x20), mload(initcode))
        }
        require(a != address(0), "create failed");
    }

    function test_SuffixEndsWithTagAndMarker() public pure {
        bytes memory tag = bytes("celo_9efd0f97b491");
        for (uint256 i = 0; i < tag.length; i++) {
            assertEq(SUFFIX[i], tag[i]);
        }
        assertEq(SUFFIX[SUFFIX.length - 1], bytes1(0x21));
    }

    function test_TaggedDeploy_VaultAndFactoryWork() public {
        address impl = _create(abi.encodePacked(type(Vault).creationCode, SUFFIX));
        address agent = address(0xA11CE);
        address cngn = address(0xC1);
        address usdt = address(0xC2);
        VaultFactory f = VaultFactory(
            _create(abi.encodePacked(type(VaultFactory).creationCode, abi.encode(impl, agent, cngn, usdt), SUFFIX))
        );
        assertEq(f.implementation(), impl);
        assertEq(f.agent(), agent);
        assertEq(f.cNGN(), cngn);
        assertEq(f.usdt(), usdt);
        assertEq(f.owner(), address(this));

        // Implementation stays locked; a clone initialises normally.
        vm.expectRevert(Vault.AlreadyInitialized.selector);
        Vault(impl).initialize(address(1), agent, cngn, usdt, Vault.Limits(1, 1, 1, 1, 1));
        Vault v = Vault(f.createVault(Vault.Limits(1, 1, 1, 1, 1)));
        assertEq(v.owner(), address(this));
    }
}
