// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault, IVaultFactory} from "./Vault.sol";

/// @dev Minimal EIP-1167 clone deployer (same bytecode as OpenZeppelin `Clones.clone`).
library Clones {
    error CloneFailed();

    function clone(address impl) internal returns (address instance) {
        assembly ("memory-safe") {
            mstore(0x00, or(shr(0xe8, shl(0x60, impl)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000))
            mstore(0x20, or(shl(0x78, impl), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create(0, 0x09, 0x37)
        }
        if (instance == address(0)) revert CloneFailed();
    }
}

/// @title NairaGuard VaultFactory
/// @notice One vault per owner, deployed as EIP-1167 clones of `Vault`. See docs/design.md §7.
contract VaultFactory {
    address public immutable implementation;
    address public owner;
    address public pendingOwner;
    /// @notice Default agent for new vaults. Changing it does not affect existing vaults.
    address public agent;
    address public cNGN;
    address public usdt;
    /// @notice Router vaults trade through. Must also be allowlisted in `isRouter`.
    address public textileRouter;

    mapping(address router => bool) public isRouter;
    /// @notice Allowlisted (target, spender) venue pairs for `Vault.swapViaRfq`, keyed on
    ///         keccak256(abi.encode(target, spender)). New venues (e.g. a DEX) need no vault redeploy.
    mapping(bytes32 pairKey => bool) public isVenuePair;
    /// @notice Label per pair, e.g. "textile".
    mapping(bytes32 pairKey => string) public venuePairLabel;
    /// @notice Label of the most recently allowlisted pair for a target. The API maps `Swapped.target` → venue with it.
    mapping(address target => string) public venueLabelOf;

    uint16 public constant MAX_DEVIATION_CAP_BPS = 1_000; // 10%
    /// @notice How long the agent has to execute an approved proposal.
    uint64 public approvalWindow = 30 minutes;
    IVaultFactory.OracleConfig internal _oracle;
    mapping(address owner => address vault) public vaultOf;
    address[] public allVaults;

    error NotOwner();
    error ZeroAddress();
    error VaultExists();
    error InvalidParam();

    event VaultCreated(address indexed owner, address indexed vault);
    event AgentUpdated(address indexed agent);
    event RouterUpdated(address indexed router, bool allowed);
    event VenueUpdated(address indexed target, address indexed spender, bool allowed, string label);
    event PriceFeedUpdated(address indexed feed);
    event OracleParamsUpdated(uint16 maxDeviationBps, uint32 maxFeedAge);
    event FallbackRateUpdated(bool enabled, uint256 rate, uint8 decimals, uint32 maxAge);
    event ApprovalWindowUpdated(uint64 window);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _implementation, address _agent, address _cNGN, address _usdt) {
        if (_implementation == address(0) || _agent == address(0) || _cNGN == address(0) || _usdt == address(0)) {
            revert ZeroAddress();
        }
        implementation = _implementation;
        agent = _agent;
        cNGN = _cNGN;
        usdt = _usdt;
        owner = msg.sender;
        _oracle.maxDeviationBps = 300; // 3%
        _oracle.maxFeedAge = 1 hours;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function createVault(Vault.Limits calldata limits) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert VaultExists();
        vault = Clones.clone(implementation);
        vaultOf[msg.sender] = vault;
        allVaults.push(vault);
        Vault(vault).initialize(msg.sender, agent, cNGN, usdt, limits);
        emit VaultCreated(msg.sender, vault);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    /// @notice Allowlist (or remove) a Textile router. Allowing makes it the active router.
    function setRouter(address router, bool allowed) external onlyOwner {
        if (router == address(0)) revert ZeroAddress();
        isRouter[router] = allowed;
        if (allowed) {
            textileRouter = router;
        } else if (textileRouter == router) {
            textileRouter = address(0);
        }
        emit RouterUpdated(router, allowed);
    }

    function venueKey(address target, address spender) public pure returns (bytes32) {
        return keccak256(abi.encode(target, spender));
    }

    function isAllowedVenue(address target, address spender) external view returns (bool) {
        return isVenuePair[venueKey(target, spender)];
    }

    /// @notice Allowlist (or remove) a (target, spender) pair, e.g. (reactor, reactor). Never add Permit2.
    function setVenue(address target, address spender, bool allowed, string calldata label) external onlyOwner {
        if (target == address(0) || spender == address(0)) revert ZeroAddress();
        if (allowed && bytes(label).length == 0) revert InvalidParam();
        bytes32 key = venueKey(target, spender);
        isVenuePair[key] = allowed;
        venuePairLabel[key] = label;
        if (allowed) venueLabelOf[target] = label;
        emit VenueUpdated(target, spender, allowed, label);
    }

    /// @notice Chainlink NGN/USD feed (Celo mainnet: 0xc17cbe2db40e53f4984c46f608da6da1ff074c11).
    function setPriceFeed(address feed) external onlyOwner {
        if (feed == address(0)) revert ZeroAddress();
        _oracle.feed = feed;
        emit PriceFeedUpdated(feed);
    }

    /// @notice One-sided rate floor (bps below the reference, capped at 10%) and feed staleness bound.
    function setOracleParams(uint16 maxDeviationBps, uint32 maxFeedAge) external onlyOwner {
        if (maxDeviationBps > MAX_DEVIATION_CAP_BPS || maxFeedAge == 0) revert InvalidParam();
        _oracle.maxDeviationBps = maxDeviationBps;
        _oracle.maxFeedAge = maxFeedAge;
        emit OracleParamsUpdated(maxDeviationBps, maxFeedAge);
    }

    /// @notice Owner-only manual reference rate (USD per NGN, `decimals` places) for when the feed is dead.
    ///         While enabled it replaces the feed; it goes stale `maxAge` seconds after being set.
    function setFallbackRate(bool enabled, uint256 rate, uint8 decimals, uint32 maxAge) external onlyOwner {
        if (enabled && (rate == 0 || maxAge == 0 || decimals > 36)) revert InvalidParam();
        _oracle.fallbackEnabled = enabled;
        _oracle.fallbackRate = rate;
        _oracle.fallbackDecimals = decimals;
        _oracle.fallbackMaxAge = maxAge;
        _oracle.fallbackSetAt = uint64(block.timestamp);
        emit FallbackRateUpdated(enabled, rate, decimals, maxAge);
    }

    function setApprovalWindow(uint64 window) external onlyOwner {
        if (window == 0 || window > 1 days) revert InvalidParam();
        approvalWindow = window;
        emit ApprovalWindowUpdated(window);
    }

    function oracleConfig() external view returns (IVaultFactory.OracleConfig memory) {
        return _oracle;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        address newOwner = pendingOwner;
        if (msg.sender != newOwner) revert NotOwner();
        address old = owner;
        owner = newOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, newOwner);
    }
}
