// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Stand-in for Textile while real addresses / interface are TBD.
///      Price is `outAmount = inAmount * rateOut / rateIn` (both rates in 1e18).
contract MockSwapRouter {
    /// @notice Per-token rate used for quoting (1e18 scale).
    mapping(address => uint256) public ratePerToken;

    error ZeroAmount();
    error ZeroRate();
    error Slippage();
    error TransferFailed();

    function setRate(address token, uint256 rate) external {
        ratePerToken[token] = rate;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256 amountOut) {
        uint256 rateIn = ratePerToken[tokenIn];
        uint256 rateOut = ratePerToken[tokenOut];
        if (rateIn == 0 || rateOut == 0) revert ZeroRate();
        amountOut = (amountIn * rateOut) / rateIn;
    }

    /// @notice Accepts `tokenIn` already sent (or pulls remainder), pays `tokenOut` to caller.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        virtual
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (amountOut < minOut) revert Slippage();

        uint256 bal = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (bal < amountIn) {
            bool pulled = IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountIn - bal);
            if (!pulled) revert TransferFailed();
        }

        bool paid = IERC20Minimal(tokenOut).transfer(msg.sender, amountOut);
        if (!paid) revert TransferFailed();
    }
}
