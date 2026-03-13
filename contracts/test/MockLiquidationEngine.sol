// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";

contract MockLiquidationEngine is ILiquidationEngine {
    function queueLiquidation(uint256, uint256) external override {}
    function executeLiquidation(uint256, uint256) external override returns (LiquidationResult memory) {
        return LiquidationResult(0, address(0), 0, 0, 0, 0, false);
    }
    function executeBatchLiquidation(uint256[] calldata, uint256[] calldata) external override returns (LiquidationResult[] memory) {
        return new LiquidationResult[](0);
    }
    function liquidateBatch(uint256[] calldata) external override {}
    function flashLiquidate(uint256, uint256, uint256) external override returns (LiquidationResult memory) {
        return LiquidationResult(0, address(0), 0, 0, 0, 0, false);
    }
    function processQueue(uint256) external override returns (uint256) { return 0; }
    function processLiquidations(uint256) external override returns (uint256) { return 0; }
    function previewLiquidation(uint256, uint256) external view override returns (uint256, uint256, uint256) {
        return (0, 0, 0);
    }
    function estimateReward(uint256, uint256, uint256) external view override returns (uint256) { return 0; }
    function getLiquidationQueue(uint256, uint256) external view override returns (LiquidationCandidate[] memory, uint256) {
        return (new LiquidationCandidate[](0), 0);
    }
    function getQueueLength() external view override returns (uint256) { return 0; }
    function isInQueue(uint256) external view override returns (bool) { return false; }
    function getLiquidatorConfig() external view override returns (LiquidatorConfig memory) {
        return LiquidatorConfig(0, 0, 0, 0, 0);
    }
    function updateLiquidatorConfig(LiquidatorConfig calldata) external override {}
    function setIncentiveMultiplier(uint256) external override {}
    function emergencyCancelLiquidation(uint256) external override {}

    receive() external payable {}
}
