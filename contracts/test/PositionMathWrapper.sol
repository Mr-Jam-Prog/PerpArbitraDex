// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "../libraries/PositionMath.sol";

contract PositionMathWrapper {
    function calculatePnL(
        uint256 entryPrice,
        uint256 currentPrice,
        uint256 size,
        bool isLong
    ) external pure returns (int256) {
        return PositionMath.calculatePnL(entryPrice, currentPrice, size, isLong);
    }

    function calculateHealthFactor(
        PositionMath.PositionParams memory params,
        uint256 currentPrice,
        PositionMath.PositionRiskParams memory riskParams
    ) external pure returns (uint256) {
        return PositionMath.calculateHealthFactor(params, currentPrice, riskParams);
    }

    function calculateLiquidationPriceSafe(
        PositionMath.PositionParams memory params,
        PositionMath.PositionRiskParams memory riskParams
    ) external pure returns (PositionMath.LiquidationResult memory) {
        return PositionMath.calculateLiquidationPriceSafe(params, riskParams);
    }
}
