// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract VaultFactoryTest is Test {
    VaultFactory factory;
    Vault impl;
    MockERC20 cngn;
    MockERC20 usdt;
    MockSwapRouter router;

    address agent = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB2);
    address stranger = address(0xBAD);

    event VaultCreated(address indexed owner, address indexed vault);

    function setUp() public {
        cngn = new MockERC20("cNGN", "cNGN", 18);
        usdt = new MockERC20(unicode"USD₮", "USDT", 18);
        impl = new Vault();
        factory = new VaultFactory(address(impl), agent, address(cngn), address(usdt));
        router = new MockSwapRouter();
        router.setRate(address(cngn), 1e18);
        router.setRate(address(usdt), 1e18);
        cngn.mint(address(router), 1_000_000e18);
        usdt.mint(address(router), 1_000_000e18);
        factory.setRouter(address(router), true);
    }

    function _limits() internal pure returns (Vault.Limits memory) {
        return Vault.Limits(100e18, 500e18, 50e18, 100, 5_000);
    }

    function _create(address who) internal returns (Vault v) {
        vm.prank(who);
        v = Vault(factory.createVault(_limits()));
    }

    function _fund(Vault v, address who, uint256 amt) internal {
        cngn.mint(who, amt);
        vm.startPrank(who);
        cngn.approve(address(v), amt);
        v.deposit(address(cngn), amt);
        vm.stopPrank();
    }

    function test_CreateVault_OwnerIsCaller() public {
        Vault v = _create(alice);
        assertEq(v.owner(), alice);
        assertEq(v.agent(), agent);
        assertEq(v.factory(), address(factory));
        assertEq(factory.vaultOf(alice), address(v));
        assertEq(factory.allVaults(0), address(v));
        assertEq(factory.vaultCount(), 1);
        (,,,, uint16 target) = v.limits();
        assertEq(target, 5_000);
    }

    function test_CreateVault_EmitsVaultCreated() public {
        vm.recordLogs();
        Vault v = _create(alice);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        Vm.Log memory last = logs[logs.length - 1];
        assertEq(last.topics[0], keccak256("VaultCreated(address,address)"));
        assertEq(address(uint160(uint256(last.topics[1]))), alice);
        assertEq(address(uint160(uint256(last.topics[2]))), address(v));
    }

    function test_CreateVault_IsEip1167Clone() public {
        Vault v = _create(alice);
        bytes memory code = address(v).code;
        assertEq(code.length, 45);
        assertEq(code, abi.encodePacked(hex"363d3d373d3d3d363d73", address(impl), hex"5af43d82803e903d91602b57fd5bf3"));
    }

    function test_OneVaultPerOwner() public {
        Vault a = _create(alice);
        Vault b = _create(bob);
        assertTrue(address(a) != address(b));
        assertEq(factory.vaultCount(), 2);
    }

    function test_CreateVault_RevertVaultExists() public {
        _create(alice);
        vm.prank(alice);
        vm.expectRevert(VaultFactory.VaultExists.selector);
        factory.createVault(_limits());
    }

    function test_Initialize_RevertTwice() public {
        Vault v = _create(alice);
        vm.expectRevert(Vault.AlreadyInitialized.selector);
        v.initialize(stranger, stranger, address(cngn), address(usdt), _limits());
    }

    function test_Initialize_RevertOnImplementation() public {
        vm.expectRevert(Vault.AlreadyInitialized.selector);
        impl.initialize(stranger, stranger, address(cngn), address(usdt), _limits());
    }

    function test_RouterAllowlist_ReadFromFactory() public {
        Vault v = _create(alice);
        _fund(v, alice, 1_000e18);
        assertEq(v.textileRouter(), address(router));

        factory.setRouter(address(router), false);
        vm.prank(agent);
        vm.expectRevert(Vault.RouterNotAllowed.selector);
        v.swap(address(cngn), address(usdt), 10e18, 1, 10e18);

        factory.setRouter(address(router), true);
        vm.prank(agent);
        v.swap(address(cngn), address(usdt), 10e18, 9.9e18, 10e18);
        assertEq(usdt.balanceOf(address(v)), 10e18);
    }

    function test_SetRouter_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setRouter(address(router), false);
    }

    function test_UserCanWithdrawWhilePaused() public {
        Vault v = _create(alice);
        _fund(v, alice, 100e18);
        vm.startPrank(alice);
        v.pause();
        v.withdraw(address(cngn), 100e18, alice);
        vm.stopPrank();
        assertEq(cngn.balanceOf(alice), 100e18);
    }

    function test_FactoryOwnerCannotTouchUserVault() public {
        Vault v = _create(alice);
        _fund(v, alice, 100e18);
        vm.expectRevert(Vault.NotOwner.selector);
        v.withdraw(address(cngn), 1, address(this));
    }

    function test_AgentOfOneVaultCannotTouchAnother() public {
        Vault a = _create(alice);
        Vault b = _create(bob);
        address agent2 = address(0xA9);
        vm.prank(alice);
        a.setAgent(agent2);
        _fund(b, bob, 100e18);
        vm.prank(agent2);
        vm.expectRevert(Vault.NotAgent.selector);
        b.swap(address(cngn), address(usdt), 10e18, 9.9e18, 10e18);
    }

    function test_UserCanRevokeAgent() public {
        Vault v = _create(alice);
        _fund(v, alice, 100e18);
        vm.prank(alice);
        v.setAgent(address(0));
        vm.prank(agent);
        vm.expectRevert(Vault.NotAgent.selector);
        v.swap(address(cngn), address(usdt), 10e18, 9.9e18, 10e18);
    }

    function test_SetAgent_DoesNotChangeExistingVaults() public {
        Vault a = _create(alice);
        address agent2 = address(0xA9);
        factory.setAgent(agent2);
        Vault b = _create(bob);
        assertEq(a.agent(), agent);
        assertEq(b.agent(), agent2);
    }

    function test_SetAgent_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setAgent(stranger);
    }

    function test_Factory_TransferOwnership_TwoStep() public {
        factory.transferOwnership(alice);
        assertEq(factory.owner(), address(this));
        vm.prank(stranger);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.acceptOwnership();
        vm.prank(alice);
        factory.acceptOwnership();
        assertEq(factory.owner(), alice);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setRouter(address(router), false);
    }
}
