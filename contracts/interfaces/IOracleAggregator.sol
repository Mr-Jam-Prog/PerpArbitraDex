// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IOracleAggregator
 * @notice Multi-source oracle aggregation interface
 * @dev Provides robust price feeds with fallback mechanisms
 */
interface IOracleAggregator {
    // ============ ENUMS ============
    
    enum OracleType {
        CHAINLINK,
        PYTH,
        TWAP,
        BAND,
        CUSTOM
    }

    enum PriceStatus {
        ACTIVE,
        DISPUTED,
        FROZEN,
        INACTIVE
    }

    // ============ STRUCTS ============
    
    struct OracleSource {
        address oracleAddress;
        OracleType oracleType;
        uint256 decimals;
        uint256 heartbeat;
        bool isActive;
        uint256 lastUpdate;
        uint256 confidence; // Confidence interval in basis points
    }

    struct PriceData {
        uint256 price;
        uint256 timestamp;
        uint256 confidence;
        PriceStatus status;
        uint256 minPrice;
        uint256 maxPrice;
    }

    // ============ EVENTS ============

    event OracleAdded(
        bytes32 indexed feedId,
        address oracleAddress,
        OracleType oracleType
    );

    event OracleRemoved(bytes32 indexed feedId);

    event PriceUpdated(
        bytes32 indexed feedId,
        uint256 price,
        uint256 timestamp,
        uint256 confidence
    );

    event EmergencyPriceOverride(
        bytes32 indexed feedId,
        uint256 price,
        address overriddenBy
    );

    // ============ STATE-CHANGING FUNCTIONS ============

    /**
     * @notice Add a new oracle source
     * @param feedId Unique feed identifier
     * @param source Oracle source configuration
     */
    function addOracleSource(bytes32 feedId, OracleSource calldata source)
        external;

    /**
     * @notice Remove an oracle source
     * @param feedId Feed identifier to remove
     */
    function removeOracleSource(bytes32 feedId) external;

    /**
     * @notice Update price for a feed
     * @param feedId Feed identifier
     * @param price New price
     * @param timestamp Price timestamp
     * @param confidence Confidence interval
     */
    function updatePrice(
        bytes32 feedId,
        uint256 price,
        uint256 timestamp,
        uint256 confidence
    ) external;

    /**
     * @notice Emergency price override
     * @param feedId Feed identifier
     * @param price Override price
     * @dev Only callable by emergency multisig
     */
    function emergencyPriceOverride(bytes32 feedId, uint256 price) external;

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get latest price for a feed
     * @param feedId Feed identifier
     * @return price Latest price (8 decimals)
     */
    function getPrice(bytes32 feedId) external view returns (uint256 price);

    /**
     * @notice Get price with additional data
     * @param feedId Feed identifier
     * @return priceData Complete price data
     */
    function getPriceData(bytes32 feedId)
        external
        view
        returns (PriceData memory priceData);

    /**
     * @notice Get time-weighted average price
     * @param feedId Feed identifier
     * @param period TWAP period in seconds
     * @return twapPrice Time-weighted average price
     */
    function getTWAP(bytes32 feedId, uint256 period)
        external
        view
        returns (uint256 twapPrice);

    /**
     * @notice Get price confidence interval
     * @param feedId Feed identifier
     * @return confidence Confidence in basis points
     */
    function getConfidence(bytes32 feedId)
        external
        view
        returns (uint256 confidence);

    /**
     * @notice Get last price update timestamp
     * @param feedId Feed identifier
     * @return timestamp Last update timestamp
     */
    function getLastUpdate(bytes32 feedId)
        external
        view
        returns (uint256 timestamp);

    /**
     * @notice Get all active oracle sources for a feed
     * @param feedId Feed identifier
     * @return sources Array of active oracle sources
     */
    function getOracleSources(bytes32 feedId)
        external
        view
        returns (OracleSource[] memory sources);

    /**
     * @notice Check if price is stale
     * @param feedId Feed identifier
     * @return stale True if price is stale
     */
    function isPriceStale(bytes32 feedId) external view returns (bool stale);

    /**
     * @notice Get consensus price from multiple sources
     * @param feedId Feed identifier
     * @return consensusPrice Median price from all sources
     * @return numSources Number of sources used
     */
    function getConsensusPrice(bytes32 feedId)
        external
        view
        returns (uint256 consensusPrice, uint256 numSources);

    // ============ VALIDATION FUNCTIONS ============

    /**
     * @notice Validate price deviation between sources
     * @param feedId Feed identifier
     * @param maxDeviation Maximum allowed deviation in basis points
     * @return valid True if deviation is within limits
     */
    function validatePriceDeviation(bytes32 feedId, uint256 maxDeviation)
        external
        view
        returns (bool valid);

    /**
     * @notice Check if price is within reasonable bounds
     * @param feedId Feed identifier
     * @param minPrice Minimum acceptable price
     * @param maxPrice Maximum acceptable price
     * @return withinBounds True if price is within bounds
     */
    function isPriceWithinBounds(
        bytes32 feedId,
        uint256 minPrice,
        uint256 maxPrice
    ) external view returns (bool withinBounds);
}