// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPositionManager} from "../interfaces/IPositionManager.sol";

contract MockPositionManager is IPositionManager {
    function mint(address, uint256) external override {}
    function burn(uint256) external override {}
    function setMetadata(uint256, bytes32) external override {}
    function setCustomData(uint256, bytes calldata) external override {}
    function getPositionMetadata(uint256) external view override returns (bytes32) { return bytes32(0); }
    function getCustomData(uint256) external view override returns (bytes memory) { return ""; }
    function getPositionOwner(uint256) external view override returns (address) { return address(0); }
    function getPositionStatus(uint256) external view override returns (bool, bool) { return (false, false); }
    function getPositionsByOwner(address) external view override returns (uint256[] memory) { return new uint256[](0); }
    function getPositionCount() external view override returns (uint256, uint256) { return (0, 0); }
}
