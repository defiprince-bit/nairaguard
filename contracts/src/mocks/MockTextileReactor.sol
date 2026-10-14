// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20R {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Sepolia stand-in for Textile's LimitOrderReactor (design.md §8). Like the real reactor, the taker
///      approves the spender (this contract), calls it with opaque calldata, the input is pulled from
///      msg.sender with transferFrom and the output is paid to msg.sender (the taker). No Permit2.
///      Calldata is `abi.encodeCall(fill, (order))`; the agent builds it from a mock quote.
contract MockTextileReactor {
    struct Order {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 deadline;
    }

    error Expired();
    error TransferFailed();

    event Fill(address indexed taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    function fill(Order calldata o) external {
        if (block.timestamp > o.deadline) revert Expired();
        if (!IERC20R(o.tokenIn).transferFrom(msg.sender, address(this), o.amountIn)) revert TransferFailed();
        if (!IERC20R(o.tokenOut).transfer(msg.sender, o.amountOut)) revert TransferFailed();
        emit Fill(msg.sender, o.tokenIn, o.tokenOut, o.amountIn, o.amountOut);
    }
}
