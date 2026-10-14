// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ISwapRouter {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut);
}

interface IChainlinkFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IVaultFactory {
    struct OracleConfig {
        address feed;
        uint32 maxFeedAge;
        uint16 maxDeviationBps;
        bool fallbackEnabled;
        uint8 fallbackDecimals;
        uint32 fallbackMaxAge;
        uint64 fallbackSetAt;
        uint256 fallbackRate;
    }

    function isRouter(address router) external view returns (bool);
    function textileRouter() external view returns (address);
    function isAllowedVenue(address target, address spender) external view returns (bool);
    function approvalWindow() external view returns (uint64);
    function oracleConfig() external view returns (OracleConfig memory);
}

/// @title NairaGuard Vault
/// @notice Holds cNGN/USD₮ and enforces agent spend limits. See docs/design.md §1.
contract Vault {
    uint256 public constant BPS = 10_000;
    uint64 public constant APPROVAL_TTL = 1 days;

    struct Limits {
        uint256 maxTradeUsd;
        uint256 maxDailyUsd;
        uint256 approvalThresholdUsd;
        uint16 maxSlippageBps;
        uint16 targetNgnBps;
    }

    /// @dev `proposalExpiresAt`: owner must approve before this. `expiresAt`: set by `approve`,
    ///      end of the window in which the agent may execute it once (design.md §8).
    struct Approval {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 approvedMinOut;
        uint64 proposalExpiresAt;
        uint64 expiresAt;
        bool approved;
        bool executed;
    }

    address public owner;
    address public pendingOwner;
    address public agent;
    /// @notice Factory that created this vault; holds the Textile router allowlist.
    address public factory;
    bool private _initialized;
    bool private _locked;
    /// @notice The NGN-denominated token (cNGN). The other supported token is treated as $1.
    address public ngnToken;
    address[] public supportedTokens;

    mapping(address token => bool) public supported;
    mapping(uint256 id => Approval) public approvals;
    /// @dev USD notional for each proposal (needed to enforce daily limit at approve-time).
    mapping(uint256 id => uint256) public approvalUsdValue;
    /// @notice Owner rejected this proposal. Final: it can never be approved or rejected again.
    mapping(uint256 id => bool) public rejected;

    Limits public limits;
    uint256 public dailySpentUsd;
    uint256 public dayStart;
    uint256 public nextApprovalId;

    bool public paused;

    error NotOwner();
    error NotAgent();
    error TokenNotSupported();
    error ZeroAmount();
    error ZeroAddress();
    error VaultPaused();
    error RouterNotAllowed();
    error TradeTooLarge();
    error DailyLimitExceeded();
    error ApprovalRequired();
    error BelowApprovalThreshold();
    error SlippageTooHigh();
    error ApprovalExpired();
    error ApprovalAlreadyExecuted();
    error ApprovalNotFound();
    error ApprovalRejected();
    error TransferFailed();
    error InvalidLimits();
    error AlreadyInitialized();
    error NotAllowlisted();
    error StalePrice();
    error BadPrice();
    error RateBelowFloor();
    error ApprovalMismatch();
    error ApprovalNotApproved();
    error AlreadyApproved();
    error BalanceMismatch();
    error CallFailed();
    error ApproveFailed();
    error Reentrancy();

    event Deposited(address indexed token, uint256 amount, address indexed from);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event Swapped(uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event SwapProposed(uint256 indexed id, uint64 expiresAt);
    event SwapRejected(uint256 indexed id);
    event SwapApproved(uint256 indexed id, uint256 approvedMinOut, uint64 expiresAt);
    event LimitsUpdated(
        uint256 maxTradeUsd,
        uint256 maxDailyUsd,
        uint256 approvalThresholdUsd,
        uint16 maxSlippageBps,
        uint16 targetNgnBps
    );
    event Paused(bool isPaused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AgentUpdated(address indexed agent);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent || msg.sender == address(0)) revert NotAgent();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    /// @dev Locks the implementation so only clones can be initialized.
    constructor() {
        _initialized = true;
    }

    /// @notice One-time setup for a clone. `msg.sender` is recorded as the factory.
    function initialize(address _owner, address _agent, address tokenA, address tokenB, Limits calldata initLimits)
        external
    {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0) || _agent == address(0) || tokenA == address(0) || tokenB == address(0)) {
            revert ZeroAddress();
        }
        _initialized = true;
        factory = msg.sender;
        owner = _owner;
        agent = _agent;
        emit OwnershipTransferred(address(0), _owner);
        if (tokenA == tokenB) revert TokenNotSupported();
        ngnToken = tokenA;
        _addSupported(tokenA);
        _addSupported(tokenB);
        dayStart = block.timestamp;
        nextApprovalId = 1;
        _setLimits(initLimits);
    }

    /// @notice Current Textile router, read from the factory allowlist.
    function textileRouter() public view returns (address) {
        return IVaultFactory(factory).textileRouter();
    }

    function _activeRouter() internal view returns (address router) {
        router = IVaultFactory(factory).textileRouter();
        if (router == address(0) || !IVaultFactory(factory).isRouter(router)) revert RouterNotAllowed();
    }

    function deposit(address token, uint256 amount) external onlyOwner {
        if (!supported[token]) revert TokenNotSupported();
        if (amount == 0) revert ZeroAmount();
        _pull(token, msg.sender, amount);
        emit Deposited(token, amount, msg.sender);
    }

    /// @notice Owner withdrawal. Always allowed, including while paused.
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        if (!supported[token]) revert TokenNotSupported();
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        _push(token, to, amount);
        emit Withdrawn(token, amount, to);
    }

    function setLimits(Limits calldata newLimits) external onlyOwner {
        _setLimits(newLimits);
    }

    function _setLimits(Limits calldata newLimits) internal {
        if (newLimits.maxSlippageBps > BPS) revert InvalidLimits();
        if (newLimits.targetNgnBps > BPS) revert InvalidLimits();
        limits = newLimits;
        emit LimitsUpdated(
            newLimits.maxTradeUsd,
            newLimits.maxDailyUsd,
            newLimits.approvalThresholdUsd,
            newLimits.maxSlippageBps,
            newLimits.targetNgnBps
        );
    }

    /// @notice Set or revoke (address(0)) the agent allowed to trade this vault.
    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Paused(false);
    }

    /// @notice Start a two-step ownership transfer. New owner must call acceptOwnership.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Complete ownership transfer. Caller must be pendingOwner.
    function acceptOwnership() external {
        address newOwner = pendingOwner;
        if (msg.sender != newOwner) revert NotOwner();
        address old = owner;
        owner = newOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, newOwner);
    }

    /// @notice Legacy agent swap through the factory router (pre-Textile), below the approval threshold. Enforces router, trade, daily, and slippage limits.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue)
        external
        onlyAgent
        returns (uint256 amountOut)
    {
        if (paused) revert VaultPaused();
        if (usdValue >= limits.approvalThresholdUsd) revert ApprovalRequired();
        _validateSwap(tokenIn, tokenOut, amountIn, minOut, usdValue);
        amountOut = _executeSwap(0, tokenIn, tokenOut, amountIn, minOut, usdValue);
    }

    /// @notice Propose a swap at or above the approval threshold. USD value and the rate floor come from
    ///         the on-chain reference rate. Owner must `approve` before `proposalExpiresAt`.
    function proposeSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        onlyAgent
        returns (uint256 id)
    {
        if (paused) revert VaultPaused();
        _validatePair(tokenIn, tokenOut, amountIn, minOut);
        (uint256 price, uint8 priceDecimals) = referencePrice();
        uint256 usdValue = _usdValue(tokenIn, amountIn, price, priceDecimals);
        if (usdValue < limits.approvalThresholdUsd) revert BelowApprovalThreshold();
        _enforceTradeLimit(usdValue);
        _enforceRateFloor(tokenIn, tokenOut, amountIn, minOut, price, priceDecimals);

        id = nextApprovalId++;
        uint64 proposalExpiresAt = uint64(block.timestamp) + APPROVAL_TTL;
        approvals[id] = Approval({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            approvedMinOut: minOut,
            proposalExpiresAt: proposalExpiresAt,
            expiresAt: 0,
            approved: false,
            executed: false
        });
        approvalUsdValue[id] = usdValue;
        emit SwapProposed(id, proposalExpiresAt);
    }

    /// @notice Owner approves a proposal. Starts the execution window (`factory.approvalWindow()`) during
    ///         which the agent may run it once via `swapViaRfq` at `approvedMinOut` or better.
    function approve(uint256 id) external onlyOwner returns (uint64 expiresAt) {
        if (paused) revert VaultPaused();
        Approval storage approval = approvals[id];
        if (approval.proposalExpiresAt == 0) revert ApprovalNotFound();
        if (rejected[id]) revert ApprovalRejected();
        if (approval.executed) revert ApprovalAlreadyExecuted();
        if (approval.approved) revert AlreadyApproved();
        if (block.timestamp > approval.proposalExpiresAt) revert ApprovalExpired();
        expiresAt = uint64(block.timestamp) + IVaultFactory(factory).approvalWindow();
        approval.approved = true;
        approval.expiresAt = expiresAt;
        emit SwapApproved(id, approval.approvedMinOut, expiresAt);
    }

    /// @notice Owner declines a pending proposal. Final state; reverts if the id is not pending.
    function reject(uint256 id) external onlyOwner {
        Approval storage approval = approvals[id];
        if (approval.proposalExpiresAt == 0) revert ApprovalNotFound();
        if (rejected[id]) revert ApprovalRejected();
        if (approval.executed) revert ApprovalAlreadyExecuted();
        if (block.timestamp > (approval.approved ? approval.expiresAt : approval.proposalExpiresAt)) {
            revert ApprovalExpired();
        }
        rejected[id] = true;
        emit SwapRejected(id);
    }

    // ── RFQ / venue path (design.md §8) ──────────────────────────────────

    /// @notice Agent-only swap through an allowlisted (target, spender) venue pair using quote calldata
    ///         (Textile RFQ today; any venue the factory owner allowlists later).
    /// @param approvalId 0 for trades below the approval threshold; otherwise an approved, unexpired proposal.
    function swapViaRfq(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address target,
        address spender,
        bytes calldata data,
        uint256 approvalId
    ) external onlyAgent nonReentrant returns (uint256 amountOut) {
        if (paused) revert VaultPaused();
        IVaultFactory f = IVaultFactory(factory);
        if (!f.isAllowedVenue(target, spender)) revert NotAllowlisted();
        if (supported[target] || target == address(this)) revert NotAllowlisted();
        _checkTextileTrade(tokenIn, tokenOut, amountIn, minOut, approvalId);
        amountOut = _callReactor(tokenIn, tokenOut, amountIn, minOut, target, spender, data);
        emit Swapped(approvalId, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Reference USD-per-NGN price and its decimals: the Chainlink feed, or the owner-set fallback
    ///         when the factory owner has switched it on. Reverts `StalePrice` / `BadPrice`.
    function referencePrice() public view returns (uint256 price, uint8 priceDecimals) {
        IVaultFactory.OracleConfig memory c = IVaultFactory(factory).oracleConfig();
        if (c.fallbackEnabled) {
            if (c.fallbackRate == 0) revert BadPrice();
            if (block.timestamp > uint256(c.fallbackSetAt) + c.fallbackMaxAge) revert StalePrice();
            return (c.fallbackRate, c.fallbackDecimals);
        }
        if (c.feed == address(0)) revert BadPrice();
        (, int256 answer,, uint256 updatedAt,) = IChainlinkFeed(c.feed).latestRoundData();
        if (answer <= 0) revert BadPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > c.maxFeedAge) revert StalePrice();
        return (uint256(answer), IChainlinkFeed(c.feed).decimals());
    }

    /// @notice Lowest `minOut` the vault accepts for this trade (reference rate minus `maxDeviationBps`).
    function minOutFloor(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256) {
        if (!supported[tokenIn] || !supported[tokenOut] || tokenIn == tokenOut) revert TokenNotSupported();
        (uint256 price, uint8 priceDecimals) = referencePrice();
        return _floor(tokenIn, tokenOut, amountIn, price, priceDecimals);
    }

    function supportedTokenCount() external view returns (uint256) {
        return supportedTokens.length;
    }

    /// @dev Pair, rate floor, per-trade, approval and daily checks; books the daily spend.
    function _checkTextileTrade(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 approvalId)
        internal
    {
        _validatePair(tokenIn, tokenOut, amountIn, minOut);
        (uint256 price, uint8 priceDecimals) = referencePrice();
        uint256 usdValue = _usdValue(tokenIn, amountIn, price, priceDecimals);
        _enforceTradeLimit(usdValue);
        _enforceRateFloor(tokenIn, tokenOut, amountIn, minOut, price, priceDecimals);
        if (approvalId != 0) {
            _consumeApproval(approvalId, tokenIn, tokenOut, amountIn, minOut);
        } else if (usdValue >= limits.approvalThresholdUsd) {
            revert ApprovalRequired();
        }
        _enforceDailyLimit(usdValue);
        dailySpentUsd += usdValue;
    }

    /// @dev Snapshot balances, exact-approve, call, reset approval, check every supported balance delta.
    function _callReactor(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address target,
        address spender,
        bytes calldata data
    ) internal returns (uint256 amountOut) {
        uint256 n = supportedTokens.length;
        uint256[] memory before = new uint256[](n);
        for (uint256 i; i < n; i++) {
            before[i] = IERC20(supportedTokens[i]).balanceOf(address(this));
        }

        _forceApprove(tokenIn, spender, amountIn);
        _rawCall(target, data);
        _forceApprove(tokenIn, spender, 0);

        for (uint256 i; i < n; i++) {
            address t = supportedTokens[i];
            uint256 nowBal = IERC20(t).balanceOf(address(this));
            if (t == tokenIn) {
                if (nowBal > before[i] || before[i] - nowBal > amountIn) revert BalanceMismatch();
            } else if (t == tokenOut) {
                if (nowBal < before[i]) revert BalanceMismatch();
                amountOut = nowBal - before[i];
                if (amountOut < minOut) revert SlippageTooHigh();
            } else if (nowBal != before[i]) {
                revert BalanceMismatch();
            }
        }
    }

    function _rawCall(address target, bytes calldata data) private {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            if (ret.length == 0) revert CallFailed();
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    function _consumeApproval(uint256 id, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
    {
        Approval storage a = approvals[id];
        if (a.proposalExpiresAt == 0) revert ApprovalNotFound();
        if (rejected[id]) revert ApprovalRejected();
        if (a.executed) revert ApprovalAlreadyExecuted();
        if (!a.approved) revert ApprovalNotApproved();
        if (block.timestamp > a.expiresAt) revert ApprovalExpired();
        if (a.tokenIn != tokenIn || a.tokenOut != tokenOut || amountIn > a.amountIn) revert ApprovalMismatch();
        if (minOut < a.approvedMinOut) revert SlippageTooHigh();
        a.executed = true;
    }

    function _validatePair(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal view {
        if (!supported[tokenIn] || !supported[tokenOut]) revert TokenNotSupported();
        if (tokenIn == tokenOut) revert TokenNotSupported();
        if (amountIn == 0 || minOut == 0) revert ZeroAmount();
    }

    /// @dev USD value in 1e18 units (same unit as `limits`). The non-NGN token is treated as $1.
    function _usdValue(address tokenIn, uint256 amountIn, uint256 price, uint8 priceDecimals)
        internal
        view
        returns (uint256)
    {
        uint256 inScale = 10 ** IERC20(tokenIn).decimals();
        if (tokenIn == ngnToken) return (amountIn * price * 1e18) / (10 ** priceDecimals) / inScale;
        return (amountIn * 1e18) / inScale;
    }

    function _floor(address tokenIn, address tokenOut, uint256 amountIn, uint256 price, uint8 priceDecimals)
        internal
        view
        returns (uint256)
    {
        uint256 inScale = 10 ** IERC20(tokenIn).decimals();
        uint256 outScale = 10 ** IERC20(tokenOut).decimals();
        uint256 pScale = 10 ** priceDecimals;
        uint256 fair;
        if (tokenIn == ngnToken) {
            fair = (amountIn * price * outScale) / pScale / inScale; // NGN -> USD
        } else if (tokenOut == ngnToken) {
            fair = (amountIn * pScale * outScale) / price / inScale; // USD -> NGN
        } else {
            fair = (amountIn * outScale) / inScale; // USD -> USD (both treated as $1)
        }
        uint16 maxDev = IVaultFactory(factory).oracleConfig().maxDeviationBps;
        return (fair * (BPS - maxDev)) / BPS;
    }

    /// @dev One-sided: only rates worse for the vault than reference minus `maxDeviationBps` are refused.
    function _enforceRateFloor(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 price,
        uint8 priceDecimals
    ) internal view {
        if (minOut < _floor(tokenIn, tokenOut, amountIn, price, priceDecimals)) revert RateBelowFloor();
    }

    function _addSupported(address token) internal {
        if (supported[token]) return;
        supported[token] = true;
        supportedTokens.push(token);
    }

    /// @dev approve(0) then approve(amount); tolerates tokens that return nothing.
    function _forceApprove(address token, address spender, uint256 amount) internal {
        _approveCall(token, spender, 0);
        if (amount != 0) _approveCall(token, spender, amount);
    }

    function _approveCall(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert ApproveFailed();
    }

    function _validateSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue)
        internal
    {
        _validateSwapParams(tokenIn, tokenOut, amountIn, minOut);
        _enforceTradeLimit(usdValue);
        _enforceDailyLimit(usdValue);
        _enforceSlippage(tokenIn, tokenOut, amountIn, minOut);
    }

    function _validateSwapParams(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal view {
        if (!supported[tokenIn] || !supported[tokenOut]) revert TokenNotSupported();
        if (tokenIn == tokenOut) revert TokenNotSupported();
        if (amountIn == 0) revert ZeroAmount();
        if (minOut == 0) revert ZeroAmount();
        _activeRouter();
    }

    function _enforceTradeLimit(uint256 usdValue) internal view {
        if (usdValue > limits.maxTradeUsd) revert TradeTooLarge();
    }

    function _enforceDailyLimit(uint256 usdValue) internal {
        _rollDailyWindow();
        if (dailySpentUsd + usdValue > limits.maxDailyUsd) revert DailyLimitExceeded();
    }

    function _enforceSlippage(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal view {
        uint256 quoted = ISwapRouter(_activeRouter()).quote(tokenIn, tokenOut, amountIn);
        uint256 floor = (quoted * (BPS - limits.maxSlippageBps)) / BPS;
        if (minOut < floor) revert SlippageTooHigh();
    }

    function _rollDailyWindow() internal {
        if (block.timestamp >= dayStart + 1 days) {
            dayStart = block.timestamp;
            dailySpentUsd = 0;
        }
    }

    function _executeSwap(
        uint256 id,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        uint256 usdValue
    ) internal returns (uint256 amountOut) {
        address router = _activeRouter();

        _rollDailyWindow();
        dailySpentUsd += usdValue;

        // amountOut is what actually arrived (vault's tokenOut balance change), not the router's return value.
        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        _push(tokenIn, router, amountIn);
        ISwapRouter(router).swap(tokenIn, tokenOut, amountIn, minOut);
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;
        if (amountOut < minOut) revert SlippageTooHigh();

        emit Swapped(id, tokenIn, tokenOut, amountIn, amountOut);
    }

    function _pull(address token, address from, uint256 amount) internal {
        bool ok = IERC20(token).transferFrom(from, address(this), amount);
        if (!ok) revert TransferFailed();
    }

    function _push(address token, address to, uint256 amount) internal {
        bool ok = IERC20(token).transfer(to, amount);
        if (!ok) revert TransferFailed();
    }
}
