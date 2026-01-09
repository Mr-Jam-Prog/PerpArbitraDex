// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPositionViewer} from "./IPositionViewer.sol";

/**
 * @title IPerpEngine
 * @notice Interface for the Perpetual DEX Engine
 * @dev Core engine interface - all state-changing operations
 *      Must remain backward compatible for upgrades
 */
interface IPerpEngine is IPositionViewer {
    // ============ STRUCTS ============
    
    struct PositionParams {
        address trader;
        uint256 marketId;
        bool isLong;
        uint256 size;
        uint256 margin;
        uint256 entryPrice;
        uint256 leverage;
        uint256 lastFundingAccrued;
        uint256 openTime;
    }

    struct TradeParams {
        uint256 marketId;
        bool isLong;
        uint256 size;
        uint256 margin;
        uint256 acceptablePrice;
        uint256 deadline;
        bytes32 referralCode;
    }

    struct LiquidateParams {
        address trader;
        uint256 marketId;
        uint256 sizeToLiquidate;
        uint256 minReward;
    }

    // ============ EVENTS ============

    event PositionOpened(
        uint256 indexed positionId,
        address indexed trader,
        uint256 indexed marketId,
        bool isLong,
        uint256 size,
        uint256 margin,
        uint256 entryPrice,
        uint256 leverage,
        uint256 fee
    );

    event PositionIncreased(
        uint256 indexed positionId,
        uint256 sizeAdded,
        uint256 marginAdded,
        uint256 newEntryPrice,
        uint256 fee
    );

    event PositionDecreased(
        uint256 indexed positionId,
        uint256 sizeReduced,
        uint256 marginReduced,
        uint256 pnl,
        uint256 fee
    );

    event PositionClosed(
        uint256 indexed positionId,
        uint256 exitPrice,
        uint256 pnl,
        uint256 fee,
        uint256 returnedMargin
    );

    event PositionLiquidated(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 liquidationPrice,
        uint256 penalty,
        uint256 reward
    );

    event FundingAccrued(
        uint256 indexed marketId,
        int256 fundingRate,
        uint256 fundingTimestamp,
        uint256 longFundingPayment,
        uint256 shortFundingPayment
    );

    // ============ STATE-CHANGING FUNCTIONS ============

    /**
     * @notice Open a new position
     * @param params Trade parameters
     * @return positionId New position ID
     */
    function openPosition(TradeParams calldata params) 
        external 
        returns (uint256 positionId);

    /**
     * @notice Increase existing position
     * @param positionId Position to increase
     * @param sizeAdded Additional size
     * @param marginAdded Additional margin
     */
    function increasePosition(
        uint256 positionId,
        uint256 sizeAdded,
        uint256 marginAdded
    ) external;

    /**
     * @notice Decrease existing position
     * @param positionId Position to decrease
     * @param sizeReduced Size to reduce
     * @param marginReduced Margin to withdraw
     */
    function decreasePosition(
        uint256 positionId,
        uint256 sizeReduced,
        uint256 marginReduced
    ) external;

    /**
     * @notice Close position entirely
     * @param positionId Position to close
     */
    function closePosition(uint256 positionId) external;

    /**
     * @notice Liquidate an underwater position
     * @param params Liquidation parameters
     * @return liquidationReward Amount rewarded to liquidator
     */
    function liquidatePosition(LiquidateParams calldata params)
        external
        returns (uint256 liquidationReward);

    /**
     * @notice Accrue funding for a market
     * @param marketId Market to accrue funding for
     */
    function accrueFunding(uint256 marketId) external;

    /**
     * @notice Batch accrue funding for multiple markets
     * @param marketIds Array of market IDs
     */
    function batchAccrueFunding(uint256[] calldata marketIds) external;

    /**
     * @notice Deposit additional margin to position
     * @param positionId Position to add margin to
     * @param amount Amount to deposit
     */
    function addMargin(uint256 positionId, uint256 amount) external;

    /**
     * @notice Withdraw excess margin from position
     * @param positionId Position to withdraw from
     * @param amount Amount to withdraw
     */
    function removeMargin(uint256 positionId, uint256 amount) external;

    // ============ VIEW FUNCTIONS (from IPositionViewer) ============
    
    /**
     * @notice Get health factor for position (1e18 = 100% healthy)
     * @param positionId Position ID
     * @return healthFactor Health factor scaled to 1e18
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
     * @return pnl Positive for profit, negative for loss
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

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update protocol fees
     * @param newProtocolFee New protocol fee (1e18 = 100%)
     */
    function updateProtocolFee(uint256 newProtocolFee) external;

    /**
     * @notice Update liquidation penalty
     * @param newLiquidationPenalty New liquidation penalty (1e18 = 100%)
     */
    function updateLiquidationPenalty(uint256 newLiquidationPenalty) external;

    /**
     * @notice Update funding rate parameters
     * @param newFundingInterval New funding interval in seconds
     * @param newMaxFundingRate New maximum funding rate (1e18 = 100%)
     */
    function updateFundingParams(
        uint256 newFundingInterval,
        uint256 newMaxFundingRate
    ) external;
}