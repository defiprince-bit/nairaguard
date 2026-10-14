// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault} from "./Vault.sol";

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
    mapping(address owner => address vault) public vaultOf;
    address[] public allVaults;

    error NotOwner();
    error ZeroAddress();
    error VaultExists();

    event VaultCreated(address indexed owner, address indexed vault);
    event AgentUpdated(address indexed agent);
    event RouterUpdated(address indexed router, bool allowed);
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
