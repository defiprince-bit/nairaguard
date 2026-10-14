// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Chainlink AggregatorV3 stand-in with settable answer and updatedAt (Sepolia + tests).
contract MockChainlinkFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;
    address public owner;

    error NotOwner();

    constructor(uint8 _decimals, int256 _answer) {
        decimals = _decimals;
        owner = msg.sender;
        _set(_answer, block.timestamp);
    }

    /// @notice Push a new answer stamped now.
    function setAnswer(int256 _answer) external {
        if (msg.sender != owner) revert NotOwner();
        _set(_answer, block.timestamp);
    }

    function setRound(int256 _answer, uint256 _updatedAt) external {
        if (msg.sender != owner) revert NotOwner();
        _set(_answer, _updatedAt);
    }

    function transferOwnership(address newOwner) external {
        if (msg.sender != owner) revert NotOwner();
        owner = newOwner;
    }

    function _set(int256 _answer, uint256 _updatedAt) internal {
        answer = _answer;
        updatedAt = _updatedAt;
        roundId++;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
