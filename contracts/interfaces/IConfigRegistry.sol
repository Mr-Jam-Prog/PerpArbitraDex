// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IConfigRegistry
 * @notice Interface for protocol configuration registry
 * @dev Centralized configuration management for upgradeability
 */
interface IConfigRegistry {
    // ============ STRUCTS ============
    
    struct MarketConfig {
        uint256 initialMarginRatio; // 1e18 = 100%
        uint256 maintenanceMarginRatio; // 1e18 = 100%
        uint256 liquidationFeeRatio; // 1e18 = 100%
        uint256 maxLeverage; // 1e18 = 100x
        uint256 maxPositionSize; // In quote token units
        uint256 maxOpenInterest; // Total OI cap
        uint256 minPositionSize; // Minimum size
        uint256 fundingInterval; // Seconds between funding
        uint256 maxFundingRate; // 1e18 = 100%
        uint256 priceImpactK; // Price impact coefficient
        bool isActive; // Market status
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct ProtocolConfig {
        uint256 protocolFeeRatio; // 1e18 = 100%
        uint256 insuranceFundRatio; // 1e18 = 100%
        uint256 referralRewardRatio; // 1e18 = 100%
        uint256 minLiquidationReward; // Minimum reward
        uint256 maxLiquidationReward; // Maximum reward
        uint256 liquidationGracePeriod; // Seconds
        uint256 oracleHeartbeat; // Max oracle staleness
        uint256 maxPriceDeviation; // 1e18 = 100%
        address insuranceFund;
        address feeCollector;
        address emergencyAdmin;
    }

    struct RiskConfig {
        uint256 volatilityThreshold; // 1e18 = 100%
        uint256 circuitBreakerThreshold; // 1e18 = 100%
        uint256 maxDrawdown; // Maximum drawdown allowed
        uint256 recoveryPeriod; // Circuit breaker cooldown
        uint256 positionConcentration; // Max % of OI per trader
        uint256 marginCallThreshold; // Health factor for margin call
    }

    // ============ EVENTS ============

    event MarketConfigUpdated(
        uint256 indexed marketId,
        MarketConfig oldConfig,
        MarketConfig newConfig
    );

    event ProtocolConfigUpdated(
        ProtocolConfig oldConfig,
        ProtocolConfig newConfig
    );

    event RiskConfigUpdated(
        RiskConfig oldConfig,
        RiskConfig newConfig
    );

    event ConfigGuardianUpdated(
        address oldGuardian,
        address newGuardian
    );

    event MarketStatusChanged(uint256 indexed marketId, bool isActive);
    event ConfigUpdateScheduled(bytes32 indexed configHash, uint256 eta);
    event ConfigUpdateExecuted(bytes32 indexed configHash);
    event ConfigUpdateCancelled(bytes32 indexed configHash);
    event MarketInitialized(uint256 indexed marketId, MarketConfig config);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get market configuration
     * @param marketId Market ID
     * @return config Market configuration
     */
    function getMarketConfig(uint256 marketId)
        external
        view
        returns (MarketConfig memory config);

    /**
     * @notice Get protocol configuration
     * @return config Protocol configuration
     */
    function getProtocolConfig()
        external
        view
        returns (ProtocolConfig memory config);

    /**
     * @notice Get risk configuration
     * @return config Risk configuration
     */
    function getRiskConfig()
        external
        view
        returns (RiskConfig memory config);

    /**
     * @notice Get configuration guardian
     * @return guardian Guardian address
     */
    function getConfigGuardian() external view returns (address guardian);

    /**
     * @notice Check if market is active
     * @param marketId Market ID
     * @return active True if market is active
     */
    function isMarketActive(uint256 marketId) external view returns (bool active);

    /**
     * @notice Validate market parameters
     * @param marketId Market ID
     * @param size Position size
     * @param leverage Leverage
     * @return valid True if parameters are valid
     */
    function validateMarketParameters(
        uint256 marketId,
        uint256 size,
        uint256 leverage
    ) external view returns (bool valid);

    /**
     * @notice Get maximum position size for market
     * @param marketId Market ID
     * @return maxSize Maximum position size
     */
    function getMaxPositionSize(uint256 marketId)
        external
        view
        returns (uint256 maxSize);

    /**
     * @notice Get minimum margin for position
     * @param marketId Market ID
     * @param size Position size
     * @return minMargin Minimum margin required
     */
    function getMinMargin(uint256 marketId, uint256 size)
        external
        view
        returns (uint256 minMargin);

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update market configuration
     * @param marketId Market ID
     * @param newConfig New market configuration
     */
    function updateMarketConfig(uint256 marketId, MarketConfig calldata newConfig)
        external;

    /**
     * @notice Update protocol configuration
     * @param newConfig New protocol configuration
     */
    function updateProtocolConfig(ProtocolConfig calldata newConfig) external;

    /**
     * @notice Update risk configuration
     * @param newConfig New risk configuration
     */
    function updateRiskConfig(RiskConfig calldata newConfig) external;

    /**
     * @notice Update configuration guardian
     * @param newGuardian New guardian address
     */
    function updateConfigGuardian(address newGuardian) external;

    /**
     * @notice Emergency disable market
     * @param marketId Market ID
     */
    function emergencyDisableMarket(uint256 marketId) external;

    /**
     * @notice Emergency enable market
     * @param marketId Market ID
     */
    function emergencyEnableMarket(uint256 marketId) external;

    // ============ TIMELOCK FUNCTIONS ============

    /**
     * @notice Schedule config update
     * @param configHash Hash of configuration
     * @param eta Execution timestamp
     */
    function scheduleConfigUpdate(bytes32 configHash, uint256 eta) external;

    /**
     * @notice Execute scheduled update
     * @param configHash Hash of configuration
     */
    function executeConfigUpdate(bytes32 configHash) external;

    /**
     * @notice Cancel scheduled update
     * @param configHash Hash of configuration
     */
    function cancelConfigUpdate(bytes32 configHash) external;
}