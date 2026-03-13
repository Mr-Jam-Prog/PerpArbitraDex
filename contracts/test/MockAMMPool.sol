// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IAMMPool} from "../interfaces/IAMMPool.sol";

contract MockAMMPool is IAMMPool {
    function updateSkew(uint256, bool, int256) external override {}
    function updateFundingRate(uint256) external override returns (int256) { return 0; }
    function applyFunding(uint256, uint256, bool, uint256) external override returns (int256) { return 0; }
    function getMarkPrice(uint256, uint256) external view override returns (uint256) { return 0; }
    function getFundingRate(uint256) external view override returns (int256) { return 0; }
    function getMarketSkew(uint256) external view override returns (uint256, uint256, int256) { return (0, 0, 0); }
    function calculateFundingPayment(uint256, uint256, bool, uint256) external view override returns (int256) { return 0; }
    function getTWAFundingRate(uint256, uint256) external view override returns (int256) { return 0; }
    function updateSkewScale(uint256, uint256) external override {}
    function updateMaxFundingRate(uint256, uint256) external override {}
    function emergencyResetSkew(uint256) external override {}
    function getMarketConfig(uint256) external view override returns (MarketConfig memory) {
        return MarketConfig(100000 * 1e18, 0.01 * 1e18, 3600, true);
    }
}
