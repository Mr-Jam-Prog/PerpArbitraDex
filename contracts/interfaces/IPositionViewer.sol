// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title IPositionViewer
 * @notice Read-only interface for position viewing
 * @dev Separated from state-changing functions for gas efficiency
 */
interface IPositionViewer {
    // ============ STRUCTS ============
    
    struct PositionView {
        uint256 positionId;
        address trader;
        uint256 marketId;
        bool isLong;
        uint256 size;
        uint256 margin;
        uint256 entryPrice;
        uint256 leverage;
        uint256 liquidationPrice;
        uint256 healthFactor;
        int256 unrealizedPnl;
        uint256 fundingAccrued;
        uint256 openTime;
        uint256 lastUpdated;
    }

    struct PositionStats {
        uint256 totalPositions;
        uint256 totalLongSize;
        uint256 totalShortSize;
        uint256 totalMargin;
        uint256 totalPnl;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get position details
     * @param positionId Position ID
     * @return viewData Complete position view
     */
    function getPosition(uint256 positionId)
        external
        view
        returns (PositionView memory viewData);

    /**
     * @notice Get positions for a trader
     * @param trader Trader address
     * @param cursor Pagination cursor
     * @param limit Maximum positions to return
     * @return positions Array of position views
     * @return newCursor New cursor position
     */
    function getPositionsByTrader(
        address trader,
        uint256 cursor,
        uint256 limit
    )
        external
        view
        returns (PositionView[] memory positions, uint256 newCursor);

    /**
     * @notice Get positions for a market
     * @param marketId Market ID
     * @param cursor Pagination cursor
     * @param limit Maximum positions to return
     * @return positions Array of position views
     * @return newCursor New cursor position
     */
    function getPositionsByMarket(
        uint256 marketId,
        uint256 cursor,
        uint256 limit
    )
        external
        view
        returns (PositionView[] memory positions, uint256 newCursor);

    /**
     * @notice Get total position statistics
     * @return stats Aggregated position statistics
     */
    function getPositionStats() external view returns (PositionStats memory stats);

    /**
     * @notice Get market position statistics
     * @param marketId Market ID
     * @return stats Market-specific statistics
     */
    function getMarketStats(uint256 marketId)
        external
        view
        returns (PositionStats memory stats);

    /**
     * @notice Get health factor for position
     * @param positionId Position ID
     * @return healthFactor Health factor (1e18 = 100%)
     */
    function getHealthFactor(uint256 positionId)
        external
        view
        returns (uint256 healthFactor);

    /**
     * @notice Get liquidation price for position
     * @param positionId Position ID
     * @return liquidationPrice Price at which position becomes liquidatable
     */
    function getLiquidationPrice(uint256 positionId)
        external
        view
        returns (uint256 liquidationPrice);

    /**
     * @notice Get unrealized PnL for position
     * @param positionId Position ID
     * @param currentPrice Current market price
     * @return pnl Unrealized profit/loss
     */
    function getUnrealizedPnl(uint256 positionId, uint256 currentPrice)
        external
        view
        returns (int256 pnl);

    /**
     * @notice Check if position is liquidatable
     * @param positionId Position ID
     * @param currentPrice Current market price
     * @return liquidatable True if position can be liquidated
     */
    function isPositionLiquidatable(uint256 positionId, uint256 currentPrice)
        external
        view
        returns (bool liquidatable);

    /**
     * @notice Get available margin for position
     * @param positionId Position ID
     * @return availableMargin Available margin to withdraw
     */
    function getAvailableMargin(uint256 positionId)
        external
        view
        returns (uint256 availableMargin);

    /**
     * @notice Get maximum additional size for position
     * @param positionId Position ID
     * @param additionalMargin Additional margin to add
     * @return maxAdditionalSize Maximum additional size
     */
    function getMaxAdditionalSize(uint256 positionId, uint256 additionalMargin)
        external
        view
        returns (uint256 maxAdditionalSize);

    /**
     * @notice Get current status of a position
     * @param positionId Position ID
     * @return isActive True if position is active
     * @return isLiquidatable True if position is liquidatable
     * @return healthFactor Current health factor
     */
    function getPositionStatus(uint256 positionId)
        external
        view
        returns (
            bool isActive,
            bool isLiquidatable,
            uint256 healthFactor
        );

    // ============ BATCH VIEW FUNCTIONS ============

    /**
     * @notice Batch get position details
     * @param positionIds Array of position IDs
     * @return views Array of position views
     */
    function batchGetPositions(uint256[] calldata positionIds)
        external
        view
        returns (PositionView[] memory views);

    /**
     * @notice Batch get health factors
     * @param positionIds Array of position IDs
     * @return healthFactors Array of health factors
     */
    function batchGetHealthFactors(uint256[] calldata positionIds)
        external
        view
        returns (uint256[] memory healthFactors);

    /**
     * @notice Batch check liquidatability
     * @param positionIds Array of position IDs
     * @param currentPrices Array of current prices
     * @return liquidatable Array of boolean results
     */
    function batchIsLiquidatable(
        uint256[] calldata positionIds,
        uint256[] calldata currentPrices
    ) external view returns (bool[] memory liquidatable);
}