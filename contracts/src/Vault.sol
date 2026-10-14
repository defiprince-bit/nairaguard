// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NairaGuard Vault (placeholder)
/// @notice Will hold cNGN/USDT and enforce spend limits for the agent. See docs/design.md.
contract Vault {
    address public owner;
    address public agent;
    uint256 public dailyLimit;

    error NotOwner();

    constructor(address _agent, uint256 _dailyLimit) {
        owner = msg.sender;
        agent = _agent;
        dailyLimit = _dailyLimit;
    }

    function setDailyLimit(uint256 _limit) external {
        if (msg.sender != owner) revert NotOwner();
        dailyLimit = _limit;
    }
}
