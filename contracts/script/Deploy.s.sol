// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vault} from "../src/Vault.sol";

interface Vm {
    function envUint(string calldata) external view returns (uint256);
    function envAddress(string calldata) external view returns (address);
    function startBroadcast(uint256) external;
    function stopBroadcast() external;
}

/// Placeholder deploy script. Real version follows docs/design.md.
contract Deploy {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (Vault vault) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        vm.startBroadcast(pk);
        vault = new Vault(agent, 0);
        vm.stopBroadcast();
    }
}
