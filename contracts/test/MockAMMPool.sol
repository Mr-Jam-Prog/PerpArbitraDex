// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IAMMPool} from "../interfaces/IAMMPool.sol";

contract MockAMMPool is IAMMPool {
    mapping(uint256 => int256) private _cumulativeFundingIndices;
    mapping(uint256 => int256) private _fundingRates;

    function setCumulativeFundingIndex(uint256 marketId, int256 index) external {
        _cumulativeFundingIndices[marketId] = index;
    }

    function setFundingRate(uint256 marketId, int256 rate) external {
        _fundingRates[marketId] = rate;
    }

    function updateSkew(uint256, bool, int256) external override {}
    function updateFundingRate(uint256 marketId) external override returns (int256) {
        return _fundingRates[marketId];
    }
    function applyFunding(uint256, uint256, bool, int256) external override returns (int256) { return 0; }
    function getMarkPrice(uint256, uint256 indexPrice) external view override returns (uint256) { return indexPrice; }
    function getFundingRate(uint256 marketId) external view override returns (int256) {
        return _fundingRates[marketId];
    }
    function getMarketSkew(uint256) external view override returns (uint256, uint256, int256) { return (0, 0, 0); }

    function calculateFundingPayment(
        uint256 marketId,
        uint256 positionSize,
        bool isLong,
        int256 lastFundingIndex
    ) external view override returns (int256 fundingPayment) {
        int256 cumIndex = _cumulativeFundingIndices[marketId];
        int256 deltaIndex = cumIndex - lastFundingIndex;
        if (deltaIndex == 0 || positionSize == 0) return 0;
        int256 rawPayment = int256((positionSize * uint256(deltaIndex > 0 ? deltaIndex : -deltaIndex)) / 1e18);
        if (deltaIndex > 0) {
            return isLong ? rawPayment : -rawPayment;
        } else {
            return isLong ? -rawPayment : rawPayment;
        }
    }

    function getCumulativeFundingIndex(uint256 marketId) external view override returns (int256) {
        return _cumulativeFundingIndices[marketId];
    }
    function getTWAFundingRate(uint256, uint256) external view override returns (int256) { return 0; }
    function updateSkewScale(uint256, uint256) external override {}
    function updateMaxFundingRate(uint256, uint256) external override {}
    function emergencyResetSkew(uint256) external override {}
}
