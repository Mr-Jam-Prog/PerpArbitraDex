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

    function queueLiquidation(uint256 positionId, uint256 healthFactor) external;

    function executeLiquidation(uint256 positionId, uint256 minReward)
        external
        returns (LiquidationResult memory result);

    function executeBatchLiquidation(
        uint256[] calldata positionIds,
        uint256[] calldata minRewards
    ) external returns (LiquidationResult[] memory results);

    /**
     * @notice Batch liquidate positions for improved throughput and gas efficiency
     * @param positionIds Array of position IDs to liquidate
     */
    function liquidateBatch(uint256[] calldata positionIds) external;

    function flashLiquidate(
        uint256 positionId,
        uint256 loanAmount,
        uint256 minReward
    ) external returns (LiquidationResult memory);

    function processQueue(uint256 maxProcess) external returns (uint256 numProcessed);

    /**
     * @notice Process multiple liquidations from the queue automatically
     * @param maxCount Maximum number of liquidations to process
     */
    function processLiquidations(uint256 maxCount) external returns (uint256 numProcessed);

    // ============ VIEW FUNCTIONS ============

    function previewLiquidation(uint256 positionId, uint256 currentPrice)
        external
        view
        returns (
            uint256 reward,
            uint256 penalty,
            uint256 newHealthFactor
        );

    function estimateReward(
        uint256 positionId,
        uint256 liquidatedSize,
        uint256 liquidationPrice
    ) external view returns (uint256 reward);

    function getLiquidationQueue(uint256 cursor, uint256 limit)
        external
        view
        returns (LiquidationCandidate[] memory candidates, uint256 newCursor);

    function getQueueLength() external view returns (uint256 queueLength);

    function isInQueue(uint256 positionId) external view returns (bool inQueue);

    function getLiquidatorConfig()
        external
        view
        returns (LiquidatorConfig memory config);

    // ============ ADMIN FUNCTIONS ============

    function updateLiquidatorConfig(LiquidatorConfig calldata newConfig)
        external;

    function setIncentiveMultiplier(uint256 newMultiplier) external;

    function emergencyCancelLiquidation(uint256 positionId) external;
}
