// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IAMMPool
 * @notice Interface for AMM funding rate mechanism
 * @dev Handles funding rate calculations based on market skew
 */
interface IAMMPool {
    // ============ STRUCTS ============
    
    struct MarketSkew {
        uint256 longOpenInterest;
        uint256 shortOpenInterest;
        int256 netSkew; // long - short
        uint256 totalOpenInterest;
        uint256 skewScale; // normalization factor
    }

    struct FundingInfo {
        int256 currentFundingRate;
        uint256 lastFundingTime;
        uint256 fundingAccumulatedLong;
        uint256 fundingAccumulatedShort;
        uint256 fundingVelocity; // rate of change per second
    }

    // ============ EVENTS ============

    event FundingUpdated(
        uint256 indexed marketId,
        int256 fundingRate,
        uint256 fundingTimestamp,
        uint256 longPayment,
        uint256 shortPayment
    );

    event SkewUpdated(
        uint256 indexed marketId,
        int256 netSkew,
        uint256 longOI,
        uint256 shortOI
    );

    event MarketParametersUpdated(
        uint256 indexed marketId,
        uint256 skewScale,
        uint256 maxFundingRate
    );

    event MarketDeactivated(uint256 indexed marketId);

    // ============ STATE-CHANGING FUNCTIONS ============

    /**
     * @notice Update market skew
     * @param marketId Market ID
     * @param isLong Whether position is long
     * @param sizeChange Change in position size (positive for open, negative for close)
     */
    function updateSkew(
        uint256 marketId,
        bool isLong,
        int256 sizeChange
    ) external;

    /**
     * @notice Calculate and update funding rate
     * @param marketId Market ID
     * @return fundingRate Calculated funding rate
     */
    function updateFundingRate(uint256 marketId)
        external
        returns (int256 fundingRate);

    /**
     * @notice Apply funding payment to a position
     * @param marketId Market ID
     * @param positionSize Size of position
     * @param isLong Whether position is long
     * @param lastFundingAccrued Last funding timestamp for position
     * @return fundingPayment Amount to pay/receive (positive = receive, negative = pay)
     */
    function applyFunding(
        uint256 marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastFundingAccrued
    ) external returns (int256 fundingPayment);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get current funding rate for market
     * @param marketId Market ID
     * @return fundingRate Current funding rate
     */
    function getFundingRate(uint256 marketId)
        external
        view
        returns (int256 fundingRate);

    /**
     * @notice Get market skew information
     * @param marketId Market ID
     * @return longOI Long open interest
     * @return shortOI Short open interest
     * @return netSkew Net skew (long - short)
     */
    function getMarketSkew(uint256 marketId)
        external
        view
        returns (
            uint256 longOI,
            uint256 shortOI,
            int256 netSkew
        );

    /**
     * @notice Get mark price (index price adjusted for funding)
     * @param marketId Market ID
     * @param indexPrice Current index price
     * @return markPrice Mark price for trading
     */
    function getMarkPrice(uint256 marketId, uint256 indexPrice)
        external
        view
        returns (uint256 markPrice);

    /**
     * @notice Calculate funding payment for a position
     * @param marketId Market ID
     * @param positionSize Size of position
     * @param isLong Whether position is long
     * @param lastFundingAccrued Last funding timestamp
     * @return fundingPayment Funding payment amount
     */
    function calculateFundingPayment(
        uint256 marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastFundingAccrued
    ) external view returns (int256 fundingPayment);

    /**
     * @notice Get time-weighted average funding rate
     * @param marketId Market ID
     * @param period Time period in seconds
     * @return avgFundingRate Average funding rate over period
     */
    function getTWAFundingRate(uint256 marketId, uint256 period)
        external
        view
        returns (int256 avgFundingRate);

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update skew scale for market
     * @param marketId Market ID
     * @param newSkewScale New skew scale
     */
    function updateSkewScale(uint256 marketId, uint256 newSkewScale) external;

    /**
     * @notice Update maximum funding rate
     * @param marketId Market ID
     * @param newMaxFundingRate New maximum funding rate (1e18 = 100%)
     */
    function updateMaxFundingRate(uint256 marketId, uint256 newMaxFundingRate)
        external;

    /**
     * @notice Emergency reset of market skew
     * @param marketId Market ID
     * @dev Only callable in emergency situations
     */
    function emergencyResetSkew(uint256 marketId) external;
}