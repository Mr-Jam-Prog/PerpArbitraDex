// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IRiskManager} from "../interfaces/IRiskManager.sol";

contract MockRiskManager is IRiskManager {
    function validatePosition(uint256, uint256, uint256, uint256) external view override returns (bool, string memory) {
        return (true, "");
    }
    function validateLiquidation(uint256, uint256, uint256) external view override returns (bool, string memory) {
        return (true, "");
    }
    function calculateRequiredMargin(uint256, uint256, uint256) external view override returns (uint256) { return 0; }
    function calculateMaxPositionSize(uint256, uint256) external view override returns (uint256) { return 0; }
    function calculateLiquidationPrice(uint256, uint256, uint256, bool, int256) external view override returns (uint256) { return 0; }
    function checkCircuitBreaker(uint256, uint256, uint256, uint256) external override returns (bool) { return false; }
    function getCircuitBreakerStatus(uint256) external view override returns (bool, uint256, uint256, uint256) { return (false, 0, 0, 0); }
    function setGlobalRiskParams(GlobalRiskParams calldata) external override {}
    function setMarketRiskParams(uint256, RiskParams calldata) external override {}
    function emergencyResetCircuitBreaker(uint256) external override {}
}
