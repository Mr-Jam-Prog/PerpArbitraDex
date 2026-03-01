// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IRiskManager {
    struct RiskParams {
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
    }

    struct GlobalRiskParams {
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 liquidationThreshold;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
        uint256 maxPositionConcentration;
        uint256 volatilityThreshold;
        uint256 circuitBreakerThreshold;
        uint256 recoveryPeriod;
    }

    struct EffectiveRiskParams {
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
    }

    event GlobalRiskParamsUpdated(GlobalRiskParams oldParams, GlobalRiskParams newParams);
    event MarketRiskParamsUpdated(uint256 indexed marketId, RiskParams oldParams, RiskParams newParams);
    event CircuitBreakerTriggered(uint256 indexed marketId, uint256 triggerPrice, uint256 priceChange);
    event CircuitBreakerReset(uint256 indexed marketId);

    function validatePosition(uint256 marketId, uint256 size, uint256 margin, uint256 leverage) external view returns (bool valid, string memory reason);
    function validateLiquidation(uint256 positionId, uint256 healthFactor, uint256 currentPrice) external view returns (bool valid, string memory reason);
    function calculateRequiredMargin(uint256 marketId, uint256 size, uint256 leverage) external view returns (uint256 requiredMargin);
    function calculateMaxPositionSize(uint256 marketId, uint256 availableMargin) external view returns (uint256 maxSize);
    function calculateLiquidationPrice(uint256 marketId, uint256 size, uint256 margin, bool isLong, int256 fundingPayment) external view returns (uint256 liquidationPrice);
    function checkCircuitBreaker(uint256 marketId, uint256 currentPrice, uint256 previousPrice, uint256 timeElapsed) external returns (bool shouldTrigger);
    function getCircuitBreakerStatus(uint256 marketId) external view returns (bool triggered, uint256 triggerTime, uint256 triggerPrice, uint256 cooldownUntil);
    function setGlobalRiskParams(GlobalRiskParams calldata newParams) external;
    function setMarketRiskParams(uint256 marketId, RiskParams calldata newParams) external;
    function emergencyResetCircuitBreaker(uint256 marketId) external;
}
