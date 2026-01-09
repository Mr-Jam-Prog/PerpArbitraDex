// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title ILiquidationEngine
 * @notice Interface for liquidation system
 * @dev Handles underwater position liquidations with MEV protection
 */
interface ILiquidationEngine {
    // ============ STRUCTS ============
    
    struct LiquidationCandidate {
        uint256 positionId;
        address trader;
        uint256 marketId;
        uint256 healthFactor;
        uint256 liquidationPrice;
        uint256 estimatedReward;
        uint256 timestamp;
    }

    struct LiquidationResult {
        uint256 positionId;
        address liquidator;
        uint256 liquidationPrice;
        uint256 penalty;
        uint256 reward;
        uint256 remainingSize;
        bool fullyLiquidated;
    }

    struct LiquidatorConfig {
        uint256 minReward; // Minimum reward to incentivize
        uint256 maxReward; // Maximum reward cap
        uint256 penaltyRatio; // Penalty as % of position
        uint256 gracePeriod; // Time before liquidation
        uint256 batchSize; // Max positions per batch
    }

    // ============ EVENTS ============

    event LiquidationQueued(
        uint256 indexed positionId,
        address indexed trader,
        uint256 healthFactor,
        uint256 queueTimestamp
    );

    event LiquidationExecuted(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 reward,
        uint256 penalty,
        bool fullyLiquidated
    );

    event LiquidationSkipped(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 skippedReason // 1: not profitable, 2: too small, 3: others
    );

    event LiquidatorConfigUpdated(
        uint256 minReward,
        uint256 maxReward,
        uint256 penaltyRatio,
        uint256 gracePeriod
    );

    // ============ STATE-CHANGING FUNCTIONS ============

    /**
     * @notice Queue position for liquidation
     * @param positionId Position to queue
     * @param healthFactor Current health factor
     */
    function queueLiquidation(uint256 positionId, uint256 healthFactor) external;

    /**
     * @notice Execute liquidation of a position
     * @param positionId Position to liquidate
     * @param minReward Minimum acceptable reward
     * @return result Liquidation result
     */
    function executeLiquidation(uint256 positionId, uint256 minReward)
        external
        returns (LiquidationResult memory result);

    /**
     * @notice Execute batch liquidations
     * @param positionIds Array of positions to liquidate
     * @param minRewards Array of minimum rewards
     * @return results Array of liquidation results
     */
    function executeBatchLiquidation(
        uint256[] calldata positionIds,
        uint256[] calldata minRewards
    ) external returns (LiquidationResult[] memory results);

    /**
     * @notice Flash liquidation with Aave flash loans
     * @param positionId Position to liquidate
     * @param loanAmount Flash loan amount
     * @param minReward Minimum acceptable reward
     */
    function flashLiquidate(
        uint256 positionId,
        uint256 loanAmount,
        uint256 minReward
    ) external returns (LiquidationResult memory);

    /**
     * @notice Process liquidation queue
     * @param maxProcess Maximum positions to process
     * @return numProcessed Number of positions processed
     */
    function processQueue(uint256 maxProcess) external returns (uint256 numProcessed);

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Preview liquidation
     * @param positionId Position to preview
     * @param currentPrice Current market price
     * @return reward Estimated liquidation reward
     * @return penalty Estimated liquidation penalty
     * @return newHealthFactor Health factor after liquidation
     */
    function previewLiquidation(uint256 positionId, uint256 currentPrice)
        external
        view
        returns (
            uint256 reward,
            uint256 penalty,
            uint256 newHealthFactor
        );

    /**
     * @notice Estimate liquidation reward
     * @param positionId Position ID
     * @param liquidatedSize Size to liquidate
     * @param liquidationPrice Price at liquidation
     * @return reward Estimated reward
     */
    function estimateReward(
        uint256 positionId,
        uint256 liquidatedSize,
        uint256 liquidationPrice
    ) external view returns (uint256 reward);

    /**
     * @notice Get liquidation queue
     * @param cursor Start cursor
     * @param limit Maximum to return
     * @return candidates Array of liquidation candidates
     * @return newCursor New cursor position
     */
    function getLiquidationQueue(uint256 cursor, uint256 limit)
        external
        view
        returns (LiquidationCandidate[] memory candidates, uint256 newCursor);

    /**
     * @notice Get number of positions in queue
     * @return queueLength Queue length
     */
    function getQueueLength() external view returns (uint256 queueLength);

    /**
     * @notice Check if position is in liquidation queue
     * @param positionId Position ID
     * @return inQueue True if in queue
     */
    function isInQueue(uint256 positionId) external view returns (bool inQueue);

    /**
     * @notice Get liquidator configuration
     * @return config Current liquidator config
     */
    function getLiquidatorConfig()
        external
        view
        returns (LiquidatorConfig memory config);

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update liquidator configuration
     * @param newConfig New configuration
     */
    function updateLiquidatorConfig(LiquidatorConfig calldata newConfig)
        external;

    /**
     * @notice Set liquidation incentive multiplier
     * @param newMultiplier New incentive multiplier (1e18 = 100%)
     */
    function setIncentiveMultiplier(uint256 newMultiplier) external;

    /**
     * @notice Emergency cancel liquidation
     * @param positionId Position to remove from queue
     * @dev Only for mispriced liquidations
     */
    function emergencyCancelLiquidation(uint256 positionId) external;
}