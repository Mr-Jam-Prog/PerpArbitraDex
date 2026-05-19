// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

contract MockConfigRegistry is IConfigRegistry {
    function updateMarketConfig(uint256, MarketConfig calldata) external override {}
    function getMarketConfig(uint256) external view override returns (MarketConfig memory) {
        return MarketConfig(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, 0, 0);
    }
    function updateProtocolConfig(ProtocolConfig calldata) external override {}
    function getProtocolConfig() external view override returns (ProtocolConfig memory) {
        return ProtocolConfig(0, 0, 0, 0, 0, 0, 0, 0, address(0), address(0), address(0));
    }
    function updateRiskConfig(RiskConfig calldata) external override {}
    function getRiskConfig() external view override returns (RiskConfig memory) {
        return RiskConfig(0, 0, 0, 0, 0, 0);
    }
    function updateConfigGuardian(address) external override {}
    function getConfigGuardian() external view override returns (address) { return address(0); }
    function emergencyDisableMarket(uint256) external override {}
    function emergencyEnableMarket(uint256) external override {}
    function isMarketActive(uint256) external view override returns (bool) { return true; }
    function validateMarketParameters(uint256, uint256, uint256) external view override returns (bool) { return true; }
    function getMaxPositionSize(uint256) external view override returns (uint256) { return 0; }
    function getMinMargin(uint256, uint256) external view override returns (uint256) { return 0; }
    function scheduleConfigUpdate(bytes32, uint256) external override {}
    function executeConfigUpdate(bytes32) external override {}
    function cancelConfigUpdate(bytes32) external override {}
}
