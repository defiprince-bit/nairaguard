// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockSwapRouter} from "../src/mocks/MockSwapRouter.sol";

contract VaultTest is Test {
    Vault vault;
    VaultFactory factory;
    MockERC20 cngn;
    MockERC20 usdt;
    MockSwapRouter router;

    address owner = address(this);
    address agent = address(0xA11CE);
    address stranger = address(0xB0B);

    uint256 constant MAX_TRADE = 100e18;
    uint256 constant MAX_DAILY = 500e18;
    uint256 constant THRESHOLD = 50e18;
    uint16 constant MAX_SLIPPAGE_BPS = 100; // 1%
    uint16 constant TARGET_NGN_BPS = 5_000;

    function setUp() public {
        cngn = new MockERC20("cNGN", "cNGN", 18);
        usdt = new MockERC20(unicode"USD₮", "USDT", 18);

        // All existing Vault tests run against a clone created by the factory.
        factory = new VaultFactory(address(new Vault()), agent, address(cngn), address(usdt));
        router = new MockSwapRouter();

        // 1:1 rates for simple assertions (both 18 decimals).
        router.setRate(address(cngn), 1e18);
        router.setRate(address(usdt), 1e18);

        // Fund router with liquidity for swaps.
        cngn.mint(address(router), 1_000_000e18);
        usdt.mint(address(router), 1_000_000e18);

        factory.setRouter(address(router), true);
        vault = Vault(factory.createVault(_limits()));

        cngn.mint(owner, 1_000_000e18);
        usdt.mint(owner, 1_000_000e18);
        cngn.approve(address(vault), type(uint256).max);
        usdt.approve(address(vault), type(uint256).max);
    }

    function _limits() internal pure returns (Vault.Limits memory) {
        return Vault.Limits({
            maxTradeUsd: MAX_TRADE,
            maxDailyUsd: MAX_DAILY,
            approvalThresholdUsd: THRESHOLD,
            maxSlippageBps: MAX_SLIPPAGE_BPS,
            targetNgnBps: TARGET_NGN_BPS
        });
    }

    function _depositBoth(uint256 amount) internal {
        vault.deposit(address(cngn), amount);
        vault.deposit(address(usdt), amount);
    }

    function _minOut(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256) {
        uint256 quoted = router.quote(tokenIn, tokenOut, amountIn);
        return (quoted * (10_000 - MAX_SLIPPAGE_BPS)) / 10_000;
    }

    // ── deposit / withdraw ───────────────────────────────────────────────

    function test_DepositAndWithdraw() public {
        vault.deposit(address(cngn), 100e18);
        assertEq(cngn.balanceOf(address(vault)), 100e18);

        uint256 before = cngn.balanceOf(owner);
        vault.withdraw(address(cngn), 40e18, owner);
        assertEq(cngn.balanceOf(address(vault)), 60e18);
        assertEq(cngn.balanceOf(owner), before + 40e18);
    }

    function test_Deposit_RevertUnsupportedToken() public {
        MockERC20 other = new MockERC20("OTHER", "OTH", 18);
        other.mint(owner, 1e18);
        other.approve(address(vault), 1e18);
        vm.expectRevert(Vault.TokenNotSupported.selector);
        vault.deposit(address(other), 1e18);
    }

    function test_Withdraw_WorksWhilePaused() public {
        vault.deposit(address(cngn), 50e18);
        vault.pause();
        vault.withdraw(address(cngn), 10e18, owner);
        assertEq(cngn.balanceOf(address(vault)), 40e18);
    }

    // ── swap happy path ──────────────────────────────────────────────────

    function test_Swap_BelowThreshold() public {
        _depositBoth(1_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);
        uint256 usdValue = 10e18;

        vm.prank(agent);
        uint256 amountOut = vault.swap(address(cngn), address(usdt), amountIn, minOut, usdValue);

        assertGe(amountOut, minOut);
        assertEq(vault.dailySpentUsd(), usdValue);
        assertEq(cngn.balanceOf(address(vault)), 1_000e18 - amountIn);
        assertEq(usdt.balanceOf(address(vault)), 1_000e18 + amountOut);
    }

    // ── limit reverts ────────────────────────────────────────────────────

    function test_Swap_RevertTradeTooLarge() public {
        // Keep maxTrade under the approval threshold so `swap` (not propose) hits TradeTooLarge.
        vault.setLimits(
            Vault.Limits({
                maxTradeUsd: 20e18,
                maxDailyUsd: MAX_DAILY,
                approvalThresholdUsd: THRESHOLD,
                maxSlippageBps: MAX_SLIPPAGE_BPS,
                targetNgnBps: TARGET_NGN_BPS
            })
        );
        _depositBoth(1_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        vm.prank(agent);
        vm.expectRevert(Vault.TradeTooLarge.selector);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, 21e18);
    }

    function test_Swap_RevertDailyLimit() public {
        _depositBoth(10_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        // Spend up to daily cap with sub-threshold trades.
        uint256 chunk = THRESHOLD - 1;
        uint256 spent;
        while (spent + chunk <= MAX_DAILY) {
            vm.prank(agent);
            vault.swap(address(cngn), address(usdt), amountIn, minOut, chunk);
            spent += chunk;
        }

        vm.prank(agent);
        vm.expectRevert(Vault.DailyLimitExceeded.selector);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, chunk);
    }

    function test_Swap_RevertApprovalRequired() public {
        _depositBoth(1_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        vm.prank(agent);
        vm.expectRevert(Vault.ApprovalRequired.selector);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, THRESHOLD);
    }

    function test_Swap_RevertSlippageTooHigh() public {
        _depositBoth(1_000e18);
        uint256 amountIn = 10e18;
        uint256 quoted = router.quote(address(cngn), address(usdt), amountIn);
        uint256 tooLow = (quoted * (10_000 - MAX_SLIPPAGE_BPS)) / 10_000 - 1;

        vm.prank(agent);
        vm.expectRevert(Vault.SlippageTooHigh.selector);
        vault.swap(address(cngn), address(usdt), amountIn, tooLow, 10e18);
    }

    function test_Swap_RevertPaused() public {
        _depositBoth(1_000e18);
        vault.pause();
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        vm.prank(agent);
        vm.expectRevert(Vault.VaultPaused.selector);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, 10e18);
    }

    // ── router allowlist ─────────────────────────────────────────────────

    function test_Swap_RevertRouterNotAllowed() public {
        _depositBoth(1_000e18);
        factory.setRouter(address(router), false);

        uint256 amountIn = 10e18;
        // Can't quote without rates via vault path; call with a plausible minOut.
        vm.prank(agent);
        vm.expectRevert(Vault.RouterNotAllowed.selector);
        vault.swap(address(cngn), address(usdt), amountIn, 1, 10e18);
    }

    function test_SetRouter_OnlyFactoryOwner() public {
        vm.prank(stranger);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setRouter(address(router), true);
    }

    // propose / approve / reject now live in test/TextileSwap.t.sol (design.md §8).

    // ── pause / unpause ──────────────────────────────────────────────────

    function test_PauseAndUnpause() public {
        _depositBoth(1_000e18);
        vault.pause();
        assertTrue(vault.paused());

        vault.unpause();
        assertFalse(vault.paused());

        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);
        vm.prank(agent);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, 10e18);
    }

    // ── access control ───────────────────────────────────────────────────

    function test_Swap_OnlyAgent() public {
        _depositBoth(1_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        vm.prank(stranger);
        vm.expectRevert(Vault.NotAgent.selector);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, 10e18);
    }

    function test_Deposit_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.deposit(address(cngn), 1e18);
    }

    function test_Withdraw_OnlyOwner() public {
        vault.deposit(address(cngn), 10e18);
        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.withdraw(address(cngn), 1e18, stranger);
    }

    function test_SetLimits_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setLimits(
            Vault.Limits({maxTradeUsd: 1, maxDailyUsd: 1, approvalThresholdUsd: 1, maxSlippageBps: 1, targetNgnBps: 1})
        );
    }

    function test_SetAgent_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.setAgent(stranger);
    }

    function test_OwnerCanSetAgent() public {
        vault.setAgent(stranger);
        assertEq(vault.agent(), stranger);
    }

    function test_Pause_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.pause();
    }

    // ── daily reset ──────────────────────────────────────────────────────

    function test_DailyLimit_ResetsAfterOneDay() public {
        _depositBoth(10_000e18);
        uint256 amountIn = 10e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        // Fill the daily cap with sub-threshold trades.
        uint256 chunk = THRESHOLD - 1;
        uint256 spent;
        while (spent + chunk <= MAX_DAILY) {
            vm.prank(agent);
            vault.swap(address(cngn), address(usdt), amountIn, minOut, chunk);
            spent += chunk;
        }
        assertEq(vault.dailySpentUsd(), spent);

        vm.warp(block.timestamp + 1 days);

        vm.prank(agent);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, 10e18);
        assertEq(vault.dailySpentUsd(), 10e18);
    }

    // ── fuzz: daily limit ────────────────────────────────────────────────

    function testFuzz_DailyLimit(uint256 first, uint256 second) public {
        // Cap daily below 2*(threshold-1) so the fuzz can hit both pass and revert paths
        // while staying on the direct `swap` path (under approval threshold).
        uint256 dailyCap = 80e18;
        vault.setLimits(
            Vault.Limits({
                maxTradeUsd: MAX_TRADE,
                maxDailyUsd: dailyCap,
                approvalThresholdUsd: THRESHOLD,
                maxSlippageBps: MAX_SLIPPAGE_BPS,
                targetNgnBps: TARGET_NGN_BPS
            })
        );

        first = bound(first, 1, THRESHOLD - 1);
        second = bound(second, 1, THRESHOLD - 1);

        _depositBoth(10_000e18);
        uint256 amountIn = 1e18;
        uint256 minOut = _minOut(address(cngn), address(usdt), amountIn);

        vm.prank(agent);
        vault.swap(address(cngn), address(usdt), amountIn, minOut, first);

        if (first + second > dailyCap) {
            vm.prank(agent);
            vm.expectRevert(Vault.DailyLimitExceeded.selector);
            vault.swap(address(cngn), address(usdt), amountIn, minOut, second);
        } else {
            vm.prank(agent);
            vault.swap(address(cngn), address(usdt), amountIn, minOut, second);
            assertEq(vault.dailySpentUsd(), first + second);
        }
    }

    // ── ownership transfer (Ownable2Step) ───────────────────────────────

    function test_TransferOwnership_TwoStep() public {
        address next = makeAddr("nextOwner");
        vault.transferOwnership(next);
        assertEq(vault.pendingOwner(), next);
        assertEq(vault.owner(), owner);

        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
        assertEq(vault.pendingOwner(), address(0));

        // previous owner lost access
        vm.expectRevert(Vault.NotOwner.selector);
        vault.pause();
        // new owner works
        vm.prank(next);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_TransferOwnership_OnlyOwner() public {
        vm.prank(agent);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.transferOwnership(makeAddr("x"));
    }

    function test_AcceptOwnership_OnlyPending() public {
        vault.transferOwnership(makeAddr("next"));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(Vault.NotOwner.selector);
        vault.acceptOwnership();
    }

    function test_TransferOwnership_RevertZero() public {
        vm.expectRevert(Vault.ZeroAddress.selector);
        vault.transferOwnership(address(0));
    }
}
