// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface ITimelockController {
    function schedule(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt, uint256 delay) external;
    function execute(address target, uint256 value, bytes calldata data, bytes32 predecessor, bytes32 salt) external payable;
}
