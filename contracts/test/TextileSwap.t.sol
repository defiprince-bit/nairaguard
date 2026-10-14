// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vault} from "../src/Vault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockChainlinkFeed} from "../src/mocks/MockChainlinkFeed.sol";
import {MockTextileReactor} from "../src/mocks/MockTextileReactor.sol";

/// @dev Exposes an extra supported token so the "no other balance may change" rule is testable.
contract VaultHarness is Vault {
    function addSupportedForTest(address token) external {
        _addSupported(token);
    }
}

/// @dev Pulls input, pays output, and also drops an unrelated supported token into the vault.
contract SideEffectReactor {
    function fill(MockTextileReactor.Order calldata o, address extra, uint256 extraAmt) external {
        MockERC20(o.tokenIn).transferFrom(msg.sender, address(this), o.amountIn);
        MockERC20(o.tokenOut).transfer(msg.sender, o.amountOut);
        MockERC20(extra).transfer(msg.sender, extraAmt);
    }
}

/// @dev Malicious calldata: pays the output to someone other than the taker.
contract DivertingReactor {
    function fill(MockTextileReactor.Order calldata o, address to) external {
        MockERC20(o.tokenIn).transferFrom(msg.sender, address(this), o.amountIn);
        MockERC20(o.tokenOut).transfer(to, o.amountOut);
    }
}

/// @dev Pulls input then reverts.
contract RevertingReactor {
    error Boom();

    function fill(MockTextileReactor.Order calldata o) external {
        MockERC20(o.tokenIn).transferFrom(msg.sender, address(this), o.amountIn);
        revert Boom();
    }
}

contract TextileSwapTest is Test {
    VaultFactory factory;
    VaultHarness vault;
    MockERC20 cngn;
    MockERC20 usdt;
    MockERC20 extra;
    MockChainlinkFeed feed;
    MockTextileReactor reactor;

    address owner = address(this);
    address agent = address(0xA11CE);
    address stranger = address(0xB0B);

    uint256 constant MAX_TRADE = 100e18;
    uint256 constant MAX_DAILY = 150e18;
    uint256 constant THRESHOLD = 25e18;
    int256 constant FEED_ANSWER = 75193; // 0.00075193 USD/NGN, 8 dp (≈ ₦1,329.9/$), mainnet read 14 Oct

    function setUp() public {
        vm.warp(1_760_000_000);
        cngn = new MockERC20("cNGN", "cNGN", 6);
        usdt = new MockERC20(unicode"USD₮", "USDT", 6);
        extra = new MockERC20("X", "X", 18);
        feed = new MockChainlinkFeed(8, FEED_ANSWER);
        reactor = new MockTextileReactor();

        factory = new VaultFactory(address(new VaultHarness()), agent, address(cngn), address(usdt));
        factory.setPriceFeed(address(feed));
        factory.setTextileTarget(address(reactor), true);
        factory.setTextileSpender(address(reactor), true);
        vault = VaultHarness(factory.createVault(_limits()));

        cngn.mint(owner, 10_000_000e6);
        usdt.mint(owner, 10_000e6);
        cngn.approve(address(vault), type(uint256).max);
        usdt.approve(address(vault), type(uint256).max);
        vault.deposit(address(cngn), 1_000_000e6);
        vault.deposit(address(usdt), 1_000e6);

        cngn.mint(address(reactor), 10_000_000e6);
        usdt.mint(address(reactor), 10_000e6);
    }

    function _limits() internal pure returns (Vault.Limits memory) {
        return Vault.Limits({
            maxTradeUsd: MAX_TRADE,
            maxDailyUsd: MAX_DAILY,
            approvalThresholdUsd: THRESHOLD,
            maxSlippageBps: 100,
            targetNgnBps: 7_000
        });
    }

    function _order(address tIn, address tOut, uint256 amtIn, uint256 amtOut, address to)
        internal
        view
        returns (MockTextileReactor.Order memory)
    {
        to;
        return MockTextileReactor.Order(tIn, tOut, amtIn, amtOut, block.timestamp + 30);
    }

    function _data(address tIn, address tOut, uint256 amtIn, uint256 amtOut, address to)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(MockTextileReactor.fill, (_order(tIn, tOut, amtIn, amtOut, to)));
    }

    /// @dev ₦13,615 → $10.0037 at ₦1,361/$ (market), 2.3% below the feed: inside the 3% band.
    function _sellNgn(uint256 minOut, uint256 approvalId) internal returns (uint256) {
        uint256 amtIn = 13_615e6;
        uint256 amtOut = 10_003_674; // 13615 / 1361
        vm.prank(agent);
        return vault.swapViaTextile(
            address(cngn),
            address(usdt),
            amtIn,
            minOut,
            address(reactor),
            address(reactor),
            _data(address(cngn), address(usdt), amtIn, amtOut, address(vault)),
            approvalId
        );
    }

    // ── access + allowlist ───────────────────────────────────────────────

    function test_OnlyAgent() public {
        bytes memory d = _data(address(cngn), address(usdt), 13_615e6, 10e6, address(vault));
        vm.prank(stranger);
        vm.expectRevert(Vault.NotAgent.selector);
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(reactor), address(reactor), d, 0);
        vm.expectRevert(Vault.NotAgent.selector); // owner can't either
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(reactor), address(reactor), d, 0);
    }

    function test_RevertTargetNotAllowlisted() public {
        factory.setTextileTarget(address(reactor), false);
        vm.expectRevert(Vault.NotAllowlisted.selector);
        _sellNgn(10e6, 0);
    }

    function test_RevertSpenderNotAllowlisted() public {
        factory.setTextileSpender(address(reactor), false);
        vm.expectRevert(Vault.NotAllowlisted.selector);
        _sellNgn(10e6, 0);
    }

    function test_RevertTargetIsSupportedToken() public {
        factory.setTextileTarget(address(usdt), true);
        bytes memory d = abi.encodeCall(MockERC20.transfer, (stranger, 1e6));
        vm.prank(agent);
        vm.expectRevert(Vault.NotAllowlisted.selector);
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(usdt), address(reactor), d, 0);
    }

    function test_RevertPaused() public {
        vault.pause();
        vm.expectRevert(Vault.VaultPaused.selector);
        _sellNgn(10e6, 0);
    }

    // ── approvals reset ──────────────────────────────────────────────────

    function test_ApprovalZeroAfterSuccess_EvenIfPartiallyPulled() public {
        // Reactor only pulls half of what was approved; leftover allowance must be cleared.
        uint256 amtIn = 13_615e6;
        bytes memory d = _data(address(cngn), address(usdt), amtIn / 2, 10e6, address(vault));
        vm.prank(agent);
        vault.swapViaTextile(address(cngn), address(usdt), amtIn, 10e6, address(reactor), address(reactor), d, 0);
        assertEq(cngn.allowance(address(vault), address(reactor)), 0);
    }

    function test_ApprovalZeroAfterRevert() public {
        RevertingReactor bad = new RevertingReactor();
        factory.setTextileTarget(address(bad), true);
        factory.setTextileSpender(address(bad), true);
        bytes memory d = abi.encodeCall(
            RevertingReactor.fill, (_order(address(cngn), address(usdt), 13_615e6, 10e6, address(vault)))
        );
        uint256 balBefore = cngn.balanceOf(address(vault));
        vm.prank(agent);
        vm.expectRevert(RevertingReactor.Boom.selector);
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(bad), address(bad), d, 0);
        assertEq(cngn.allowance(address(vault), address(bad)), 0);
        assertEq(cngn.balanceOf(address(vault)), balBefore);
        assertEq(vault.dailySpentUsd(), 0);
    }

    // ── balance deltas ───────────────────────────────────────────────────

    function test_RevertRecipientDiversion() public {
        DivertingReactor dv = new DivertingReactor();
        factory.setTextileTarget(address(dv), true);
        factory.setTextileSpender(address(dv), true);
        usdt.mint(address(dv), 1e12);
        bytes memory d = abi.encodeCall(
            DivertingReactor.fill,
            (_order(address(cngn), address(usdt), 13_615e6, 10_003_674, address(vault)), stranger)
        );
        vm.prank(agent);
        vm.expectRevert(Vault.SlippageTooHigh.selector);
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(dv), address(dv), d, 0);
        assertEq(usdt.balanceOf(stranger), 0);
    }

    function test_RevertPullMoreThanAmountIn() public {
        // Calldata claims a bigger input than the vault approved: the exact approval stops it.
        bytes memory d = _data(address(cngn), address(usdt), 13_616e6, 10_003_674, address(vault));
        vm.prank(agent);
        vm.expectRevert();
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(reactor), address(reactor), d, 0);
    }

    function test_RevertOtherSupportedBalanceChanges() public {
        vault.addSupportedForTest(address(extra));
        SideEffectReactor fx = new SideEffectReactor();
        factory.setTextileTarget(address(fx), true);
        factory.setTextileSpender(address(fx), true);
        cngn.mint(address(fx), 1e12);
        usdt.mint(address(fx), 1e12);
        extra.mint(address(fx), 1e18);
        bytes memory d = abi.encodeCall(
            SideEffectReactor.fill,
            (_order(address(cngn), address(usdt), 13_615e6, 10_003_674, address(vault)), address(extra), 1)
        );
        vm.prank(agent);
        vm.expectRevert(Vault.BalanceMismatch.selector);
        vault.swapViaTextile(address(cngn), address(usdt), 13_615e6, 10e6, address(fx), address(fx), d, 0);
    }

    event Swapped(uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    function test_AmountOutEqualsBalanceChange() public {
        uint256 before = usdt.balanceOf(address(vault));
        uint256 cBefore = cngn.balanceOf(address(vault));
        vm.expectEmit(true, false, false, true, address(vault));
        emit Swapped(0, address(cngn), address(usdt), 13_615e6, 10_003_674);
        uint256 out = _sellNgn(10e6, 0);
        assertEq(out, usdt.balanceOf(address(vault)) - before);
        assertEq(out, 10_003_674);
        assertEq(cBefore - cngn.balanceOf(address(vault)), 13_615e6);
    }

    // ── rate floor (Chainlink) ───────────────────────────────────────────

    function test_RevertRateBelowFloor() public {
        // Feed fair value for ₦13,615 ≈ $10.2375; 3% floor ≈ $9.9304.
        uint256 floor = vault.minOutFloor(address(cngn), address(usdt), 13_615e6);
        assertApproxEqAbs(floor, 9_930_400, 2);
        vm.expectRevert(Vault.RateBelowFloor.selector);
        _sellNgn(floor - 1, 0);
        _sellNgn(floor, 0); // exactly at the floor passes (reactor still delivers $10.0037)
    }

    function test_BetterThanFeedPasses_OneSided() public {
        // Buying NGN at ₦1,361/$ is better than the feed's ₦1,330/$: never refused.
        uint256 amtIn = 10e6;
        uint256 out = 13_610e6;
        assertLt(vault.minOutFloor(address(usdt), address(cngn), amtIn), out);
        bytes memory d = _data(address(usdt), address(cngn), amtIn, out, address(vault));
        vm.prank(agent);
        uint256 got =
            vault.swapViaTextile(address(usdt), address(cngn), amtIn, out, address(reactor), address(reactor), d, 0);
        assertEq(got, out);
    }

    function test_TighterBandRejectsMarketRate() public {
        factory.setOracleParams(200, 1 hours); // 2% would refuse Textile's 2.3% gap
        vm.expectRevert(Vault.RateBelowFloor.selector);
        _sellNgn(10_003_674, 0);
    }

    function test_DecimalsReadFromFeed() public {
        MockChainlinkFeed f18 = new MockChainlinkFeed(18, 0.00075193e18);
        uint256 floor8 = vault.minOutFloor(address(cngn), address(usdt), 13_615e6);
        factory.setPriceFeed(address(f18));
        assertEq(vault.minOutFloor(address(cngn), address(usdt), 13_615e6), floor8);
    }

    function test_RevertStaleFeed() public {
        feed.setRound(FEED_ANSWER, block.timestamp - 1 hours - 1);
        vm.expectRevert(Vault.StalePrice.selector);
        _sellNgn(10e6, 0);
    }

    function test_RevertZeroFeed() public {
        feed.setAnswer(0);
        vm.expectRevert(Vault.BadPrice.selector);
        _sellNgn(10e6, 0);
    }

    function test_RevertNegativeFeed() public {
        feed.setAnswer(-1);
        vm.expectRevert(Vault.BadPrice.selector);
        _sellNgn(10e6, 0);
    }

    function test_FallbackRate_OwnerOnly_AndExpires() public {
        feed.setRound(FEED_ANSWER, block.timestamp - 2 hours);
        vm.prank(agent);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setFallbackRate(true, 75193, 8, 6 hours);

        factory.setFallbackRate(true, 75193, 8, 6 hours);
        _sellNgn(10e6, 0);

        vm.warp(block.timestamp + 6 hours + 1);
        vm.expectRevert(Vault.StalePrice.selector);
        _sellNgn(10e6, 0);
    }

    function test_OracleParamsCappedAt10Percent() public {
        vm.expectRevert(VaultFactory.InvalidParam.selector);
        factory.setOracleParams(1_001, 1 hours);
        factory.setOracleParams(1_000, 2 hours);
        assertEq(factory.oracleConfig().maxDeviationBps, 1_000);
        vm.prank(agent);
        vm.expectRevert(VaultFactory.NotOwner.selector);
        factory.setOracleParams(500, 1 hours);
    }

    function test_DefaultOracleParams() public view {
        assertEq(factory.oracleConfig().maxDeviationBps, 300);
        assertEq(factory.oracleConfig().maxFeedAge, 1 hours);
        assertEq(factory.approvalWindow(), 30 minutes);
    }

    // ── limits ───────────────────────────────────────────────────────────

    function test_RevertTradeTooLarge() public {
        uint256 amtIn = 101e6; // $101 > $100
        bytes memory d = _data(address(usdt), address(cngn), amtIn, 137_000e6, address(vault));
        vm.prank(agent);
        vm.expectRevert(Vault.TradeTooLarge.selector);
        vault.swapViaTextile(address(usdt), address(cngn), amtIn, 137_000e6, address(reactor), address(reactor), d, 0);
    }

    function test_RevertDailyLimit() public {
        for (uint256 i; i < 14; i++) {
            _sellNgn(10e6, 0); // ≈ $10.24 each
        }
        vm.expectRevert(Vault.DailyLimitExceeded.selector);
        _sellNgn(10e6, 0);
    }

    // ── approvals (propose / approve / window) ───────────────────────────

    function _propose(uint256 amtIn, uint256 minOut) internal returns (uint256 id) {
        vm.prank(agent);
        id = vault.proposeSwap(address(usdt), address(cngn), amtIn, minOut);
    }

    function _swapUsd(uint256 amtIn, uint256 minOut, uint256 out, uint256 id) internal returns (uint256) {
        bytes memory d = _data(address(usdt), address(cngn), amtIn, out, address(vault));
        vm.prank(agent);
        return
            vault.swapViaTextile(address(usdt), address(cngn), amtIn, minOut, address(reactor), address(reactor), d, id);
    }

    function test_RevertAboveThresholdWithoutApproval() public {
        vm.expectRevert(Vault.ApprovalRequired.selector);
        _swapUsd(30e6, 40_500e6, 40_830e6, 0);
    }

    function test_ApprovedTradeRunsOnceInWindow() public {
        uint256 id = _propose(30e6, 40_500e6); // "at least ₦1,350/$"
        vm.expectRevert(Vault.ApprovalNotApproved.selector);
        _swapUsd(30e6, 40_500e6, 40_830e6, id);

        uint64 exp = vault.approve(id);
        assertEq(exp, block.timestamp + 30 minutes);
        (,,, uint256 approvedMinOut,, uint64 expiresAt, bool approved,) = vault.approvals(id);
        assertEq(approvedMinOut, 40_500e6);
        assertEq(expiresAt, exp);
        assertTrue(approved);

        assertEq(_swapUsd(30e6, 40_830e6, 40_830e6, id), 40_830e6);
        vm.expectRevert(Vault.ApprovalAlreadyExecuted.selector);
        _swapUsd(30e6, 40_830e6, 40_830e6, id);
    }

    function test_RevertExpiredApproval() public {
        uint256 id = _propose(30e6, 40_500e6);
        vault.approve(id);
        vm.warp(block.timestamp + 30 minutes + 1);
        vm.expectRevert(Vault.ApprovalExpired.selector);
        _swapUsd(30e6, 40_830e6, 40_830e6, id);
    }

    function test_RevertApprovedBelowApprovedMinOut() public {
        uint256 id = _propose(30e6, 40_500e6);
        vault.approve(id);
        vm.expectRevert(Vault.SlippageTooHigh.selector);
        _swapUsd(30e6, 40_499e6, 40_499e6, id);
    }

    function test_RevertApprovedMismatch() public {
        uint256 id = _propose(30e6, 40_500e6);
        vault.approve(id);
        vm.expectRevert(Vault.ApprovalMismatch.selector);
        _swapUsd(31e6, 41_000e6, 41_000e6, id);
    }

    function test_ProposeRevertsBelowThreshold() public {
        vm.prank(agent);
        vm.expectRevert(Vault.BelowApprovalThreshold.selector);
        vault.proposeSwap(address(usdt), address(cngn), 10e6, 13_000e6);
    }

    function test_ProposeRevertsBelowFloor() public {
        vm.prank(agent);
        vm.expectRevert(Vault.RateBelowFloor.selector);
        vault.proposeSwap(address(cngn), address(usdt), 40_000e6, 1e6);
    }

    function test_ApproveOnlyOwner_AndProposalTtl() public {
        uint256 id = _propose(30e6, 40_500e6);
        vm.prank(agent);
        vm.expectRevert(Vault.NotOwner.selector);
        vault.approve(id);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(Vault.ApprovalExpired.selector);
        vault.approve(id);
    }

    function test_RejectBlocksApproveAndRun() public {
        uint256 id = _propose(30e6, 40_500e6);
        vault.reject(id);
        vm.expectRevert(Vault.ApprovalRejected.selector);
        vault.approve(id);
        vm.expectRevert(Vault.ApprovalRejected.selector);
        vault.reject(id);
    }

    function test_RejectAfterApproveBeforeRun() public {
        uint256 id = _propose(30e6, 40_500e6);
        vault.approve(id);
        vault.reject(id);
        vm.expectRevert(Vault.ApprovalRejected.selector);
        _swapUsd(30e6, 40_830e6, 40_830e6, id);
    }

    function test_ApprovalWindowTunable() public {
        factory.setApprovalWindow(10 minutes);
        uint256 id = _propose(30e6, 40_500e6);
        assertEq(vault.approve(id), block.timestamp + 10 minutes);
        vm.expectRevert(VaultFactory.InvalidParam.selector);
        factory.setApprovalWindow(0);
    }
}
