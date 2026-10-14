// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface ISwapRouter {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        returns (uint256 amountOut);
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

    struct Approval {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        uint64 expiresAt;
        bool executed;
    }

    address public owner;
    address public pendingOwner;
    address public agent;
    address public textileRouter;

    mapping(address token => bool) public supported;
    mapping(address router => bool) public swapRouters;
    mapping(uint256 id => Approval) public approvals;
    /// @dev USD notional for each proposal (needed to enforce daily limit at approve-time).
    mapping(uint256 id => uint256) public approvalUsdValue;

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
    error TransferFailed();
    error InvalidLimits();

    event Deposited(address indexed token, uint256 amount, address indexed from);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event Swapped(uint256 indexed id, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);
    event SwapProposed(uint256 indexed id, uint64 expiresAt);
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
    event SwapRouterUpdated(address indexed router, bool allowed);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(address _agent, address tokenA, address tokenB) {
        if (_agent == address(0) || tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();
        owner = msg.sender;
        agent = _agent;
        emit OwnershipTransferred(address(0), msg.sender);
        supported[tokenA] = true;
        supported[tokenB] = true;
        dayStart = block.timestamp;
        nextApprovalId = 1;
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

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    function setSwapRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        swapRouters[router] = allowed;
        if (allowed) {
            textileRouter = router;
        } else if (textileRouter == router) {
            textileRouter = address(0);
        }
        emit SwapRouterUpdated(router, allowed);
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

    /// @notice Agent swap below the approval threshold. Enforces router, trade, daily, and slippage limits.
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

    /// @notice Propose a swap at or above the approval threshold. Owner must `approve` before expiry.
    function proposeSwap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 usdValue)
        external
        onlyAgent
        returns (uint256 id)
    {
        if (paused) revert VaultPaused();
        if (usdValue < limits.approvalThresholdUsd) revert BelowApprovalThreshold();
        _validateSwapParams(tokenIn, tokenOut, amountIn, minOut);
        _enforceTradeLimit(usdValue);
        _enforceSlippage(tokenIn, tokenOut, amountIn, minOut);

        id = nextApprovalId++;
        uint64 expiresAt = uint64(block.timestamp) + APPROVAL_TTL;
        approvals[id] = Approval({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minOut: minOut,
            expiresAt: expiresAt,
            executed: false
        });
        approvalUsdValue[id] = usdValue;
        emit SwapProposed(id, expiresAt);
    }

    /// @notice Owner executes a proposed swap. Reverts if expired or already executed.
    function approve(uint256 id) external onlyOwner returns (uint256 amountOut) {
        if (paused) revert VaultPaused();
        Approval storage approval = approvals[id];
        if (approval.expiresAt == 0) revert ApprovalNotFound();
        if (approval.executed) revert ApprovalAlreadyExecuted();
        if (block.timestamp > approval.expiresAt) revert ApprovalExpired();

        uint256 usdValue = approvalUsdValue[id];
        approval.executed = true;
        // Re-check live limits at execution time (daily window may have moved).
        _enforceTradeLimit(usdValue);
        _enforceDailyLimit(usdValue);
        _enforceSlippage(approval.tokenIn, approval.tokenOut, approval.amountIn, approval.minOut);

        amountOut = _executeSwap(id, approval.tokenIn, approval.tokenOut, approval.amountIn, approval.minOut, usdValue);
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
        if (textileRouter == address(0) || !swapRouters[textileRouter]) revert RouterNotAllowed();
    }

    function _enforceTradeLimit(uint256 usdValue) internal view {
        if (usdValue > limits.maxTradeUsd) revert TradeTooLarge();
    }

    function _enforceDailyLimit(uint256 usdValue) internal {
        _rollDailyWindow();
        if (dailySpentUsd + usdValue > limits.maxDailyUsd) revert DailyLimitExceeded();
    }

    function _enforceSlippage(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) internal view {
        uint256 quoted = ISwapRouter(textileRouter).quote(tokenIn, tokenOut, amountIn);
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
        address router = textileRouter;
        if (router == address(0) || !swapRouters[router]) revert RouterNotAllowed();

        _rollDailyWindow();
        dailySpentUsd += usdValue;

        _push(tokenIn, router, amountIn);
        amountOut = ISwapRouter(router).swap(tokenIn, tokenOut, amountIn, minOut);
        if (amountOut < minOut) revert SlippageTooHigh();

        // Router pays tokenOut to this vault.
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
