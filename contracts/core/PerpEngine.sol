// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IAMMPool} from "../interfaces/IAMMPool.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IPositionManager} from "../interfaces/IPositionManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

import {PositionMath} from "../libraries/PositionMath.sol";
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";
import {FundingRateCalculator} from "../libraries/FundingRateCalculator.sol";

/**
 * @title PerpEngine
 * @notice Core perpetual DEX engine - manages positions, funding, and liquidations
 * @dev Central business logic with economic safety invariants
 */
contract PerpEngine is IPerpEngine, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;
    using PositionMath for uint256;

    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_LEVERAGE = 100 * PRECISION; // 100x max leverage
    uint256 private constant MIN_MARGIN_RATIO = PRECISION / 100; // 1% minimum margin
    uint256 private constant LIQUIDATION_THRESHOLD = PRECISION; // 100% health factor = liquidation

    // ============ IMMUTABLES ============
    
    address public immutable positionManager;
    address public immutable ammPool;
    address public immutable oracleAggregator;
    address public immutable liquidationEngine;
    address public immutable riskManager;
    address public immutable configRegistry;
    address public immutable insuranceFund;
    
    IERC20 public immutable baseToken;
    IERC20 public immutable quoteToken;

    // ============ STATE VARIABLES ============
    
    uint256 private _nextPositionId;
    
    // Position ID => Position data
    mapping(uint256 => Position) private _positions;
    
    // Market ID => Market state
    mapping(uint256 => Market) private _markets;
    
    // Trader address => array of position IDs
    mapping(address => uint256[]) private _traderPositions;
    
    // Funding state per market
    mapping(uint256 => FundingState) private _fundingStates;
    
    // Protocol fees collected
    mapping(address => uint256) private _protocolFees;
    
    // Total open interest per market
    mapping(uint256 => uint256) private _totalOpenInterest;

    // ============ STRUCTS ============
    
    struct Position {
        address trader;
        uint256 marketId;
        bool isLong;
        uint256 size;
        uint256 margin;
        uint256 entryPrice;
        uint256 leverage;
        uint256 lastFundingAccrued;
        uint256 openTime;
        uint256 lastUpdated;
        bool isActive;
    }
    
    struct Market {
        bool isActive;
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
        bytes32 oracleFeedId;
        uint256 lastPriceUpdate;
        uint256 lastFundingUpdate;
    }
    
    struct FundingState {
        int256 fundingRate;
        uint256 lastFundingTime;
        uint256 fundingAccumulatedLong;
        uint256 fundingAccumulatedShort;
    }

    // ============ MODIFIERS ============
    
    modifier onlyPositionManager() {
        require(msg.sender == positionManager, "PerpEngine: only PositionManager");
        _;
    }
    
    modifier onlyLiquidationEngine() {
        require(msg.sender == liquidationEngine, "PerpEngine: only LiquidationEngine");
        _;
    }
    
    modifier onlyGovernance() {
        // In production, this would check against governance contract
        require(msg.sender == address(this), "PerpEngine: only Governance");
        _;
    }
    
    modifier marketActive(uint256 marketId) {
        require(_markets[marketId].isActive, "PerpEngine: market inactive");
        _;
    }
    
    modifier validPosition(uint256 positionId) {
        require(_positions[positionId].isActive, "PerpEngine: invalid position");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(
        address positionManager_,
        address ammPool_,
        address oracleAggregator_,
        address liquidationEngine_,
        address riskManager_,
        address configRegistry_,
        address insuranceFund_,
        address baseToken_,
        address quoteToken_
    ) {
        require(positionManager_ != address(0), "PerpEngine: zero address");
        require(ammPool_ != address(0), "PerpEngine: zero address");
        require(oracleAggregator_ != address(0), "PerpEngine: zero address");
        require(liquidationEngine_ != address(0), "PerpEngine: zero address");
        require(riskManager_ != address(0), "PerpEngine: zero address");
        require(configRegistry_ != address(0), "PerpEngine: zero address");
        require(insuranceFund_ != address(0), "PerpEngine: zero address");
        require(baseToken_ != address(0), "PerpEngine: zero address");
        require(quoteToken_ != address(0), "PerpEngine: zero address");
        
        positionManager = positionManager_;
        ammPool = ammPool_;
        oracleAggregator = oracleAggregator_;
        liquidationEngine = liquidationEngine_;
        riskManager = riskManager_;
        configRegistry = configRegistry_;
        insuranceFund = insuranceFund_;
        
        baseToken = IERC20(baseToken_);
        quoteToken = IERC20(quoteToken_);
        
        _nextPositionId = 1;
    }

    // ============ POSITION MANAGEMENT ============

    /**
     * @inheritdoc IPerpEngine
     */
    function openPosition(TradeParams calldata params)
        external
        override
        nonReentrant
        whenNotPaused
        marketActive(params.marketId)
        returns (uint256 positionId)
    {
        // Validate parameters
        require(params.size > 0, "PerpEngine: zero size");
        require(params.margin > 0, "PerpEngine: zero margin");
        require(params.deadline >= block.timestamp, "PerpEngine: deadline passed");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(params.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Validate against acceptable price
        if (params.isLong) {
            require(currentPrice <= params.acceptablePrice, "PerpEngine: price too high");
        } else {
            require(currentPrice >= params.acceptablePrice, "PerpEngine: price too low");
        }
        
        // Calculate leverage
        uint256 leverage = params.size.mulDiv(PRECISION, params.margin);
        require(leverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        
        // Check risk parameters
        _validatePositionRisk(params.marketId, params.size, params.margin, leverage);
        
        // Transfer margin from trader
        quoteToken.safeTransferFrom(msg.sender, address(this), params.margin);
        
        // Accrue funding before opening
        _accrueFunding(params.marketId);
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            params.marketId,
            params.isLong,
            int256(params.size)
        );
        
        // Create position
        positionId = _nextPositionId++;
        
        _positions[positionId] = Position({
            trader: msg.sender,
            marketId: params.marketId,
            isLong: params.isLong,
            size: params.size,
            margin: params.margin,
            entryPrice: currentPrice,
            leverage: leverage,
            lastFundingAccrued: block.timestamp,
            openTime: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });
        
        // Update trader positions
        _traderPositions[msg.sender].push(positionId);
        
        // Update total open interest
        _totalOpenInterest[params.marketId] += params.size;
        
        // Mint position NFT
        IPositionManager(positionManager).mint(msg.sender, positionId);
        
        // Calculate and collect fees
        uint256 protocolFee = _collectFees(positionId, params.size, params.margin);
        
        emit PositionOpened(
            positionId,
            msg.sender,
            params.marketId,
            params.isLong,
            params.size,
            params.margin,
            currentPrice,
            leverage,
            protocolFee
        );
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function increasePosition(
        uint256 positionId,
        uint256 sizeAdded,
        uint256 marginAdded
    )
        external
        override
        nonReentrant
        whenNotPaused
        validPosition(positionId)
    {
        Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        require(sizeAdded > 0, "PerpEngine: zero size");
        require(marginAdded > 0, "PerpEngine: zero margin");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Accrue funding before modification
        _accrueFunding(position.marketId);
        
        // Calculate new values
        uint256 newSize = position.size + sizeAdded;
        uint256 newMargin = position.margin + marginAdded;
        uint256 newLeverage = newSize.mulDiv(PRECISION, newMargin);
        
        require(newLeverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        
        // Validate risk
        _validatePositionRisk(position.marketId, newSize, newMargin, newLeverage);
        
        // Transfer additional margin
        quoteToken.safeTransferFrom(msg.sender, address(this), marginAdded);
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            int256(sizeAdded)
        );
        
        // Update position
        uint256 oldSize = position.size;
        uint256 oldMargin = position.margin;
        
        position.size = newSize;
        position.margin = newMargin;
        position.leverage = newLeverage;
        position.entryPrice = _calculateNewEntryPrice(
            oldSize,
            oldMargin,
            position.entryPrice,
            sizeAdded,
            marginAdded,
            currentPrice
        );
        position.lastUpdated = block.timestamp;
        
        // Update total open interest
        _totalOpenInterest[position.marketId] += sizeAdded;
        
        // Calculate and collect fees
        uint256 protocolFee = _collectFees(positionId, sizeAdded, marginAdded);
        
        emit PositionIncreased(
            positionId,
            sizeAdded,
            marginAdded,
            position.entryPrice,
            protocolFee
        );
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function decreasePosition(
        uint256 positionId,
        uint256 sizeReduced,
        uint256 marginReduced
    )
        external
        override
        nonReentrant
        whenNotPaused
        validPosition(positionId)
    {
        Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        require(sizeReduced > 0 && sizeReduced <= position.size, "PerpEngine: invalid size reduction");
        require(marginReduced <= position.margin, "PerpEngine: invalid margin reduction");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Accrue funding before modification
        _accrueFunding(position.marketId);
        
        // Calculate PnL for reduced portion
        int256 pnl = position.calculatePnL(
            sizeReduced,
            position.entryPrice,
            currentPrice,
            position.isLong
        );
        
        // Calculate funding payment for reduced portion
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            sizeReduced,
            position.isLong,
            position.lastFundingAccrued
        );
        
        int256 totalPnl = pnl + fundingPayment;
        
        // Update position
        position.size -= sizeReduced;
        position.margin -= marginReduced;
        
        if (position.size == 0) {
            // Fully closed
            position.isActive = false;
        }
        
        position.lastUpdated = block.timestamp;
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            -int256(sizeReduced)
        );
        
        // Update total open interest
        _totalOpenInterest[position.marketId] -= sizeReduced;
        
        // Calculate amount to return to trader
        uint256 returnAmount;
        if (totalPnl > 0) {
            // Profit: margin + profit
            returnAmount = marginReduced + uint256(totalPnl);
        } else {
            // Loss: margin - loss (but not negative)
            int256 remainingMargin = int256(marginReduced) + totalPnl;
            require(remainingMargin >= 0, "PerpEngine: insufficient margin");
            returnAmount = uint256(remainingMargin);
        }
        
        // Transfer funds to trader
        if (returnAmount > 0) {
            quoteToken.safeTransfer(msg.sender, returnAmount);
        }
        
        emit PositionDecreased(
            positionId,
            sizeReduced,
            marginReduced,
            pnl,
            0 // Fee for decrease is 0
        );
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function closePosition(uint256 positionId)
        external
        override
        nonReentrant
        whenNotPaused
        validPosition(positionId)
    {
        Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Accrue funding before closing
        _accrueFunding(position.marketId);
        
        // Calculate PnL
        int256 pnl = position.calculatePnL(
            position.size,
            position.entryPrice,
            currentPrice,
            position.isLong
        );
        
        // Calculate funding payment
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingAccrued
        );
        
        int256 totalPnl = pnl + fundingPayment;
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            -int256(position.size)
        );
        
        // Update total open interest
        _totalOpenInterest[position.marketId] -= position.size;
        
        // Calculate amount to return to trader
        uint256 returnAmount;
        if (totalPnl > 0) {
            // Profit: margin + profit
            returnAmount = position.margin + uint256(totalPnl);
        } else {
            // Loss: margin - loss (but not negative)
            int256 remainingMargin = int256(position.margin) + totalPnl;
            require(remainingMargin >= 0, "PerpEngine: insufficient margin");
            returnAmount = uint256(remainingMargin);
        }
        
        // Mark position as closed
        position.isActive = false;
        position.lastUpdated = block.timestamp;
        
        // Transfer funds to trader
        if (returnAmount > 0) {
            quoteToken.safeTransfer(msg.sender, returnAmount);
        }
        
        // Burn position NFT
        IPositionManager(positionManager).burn(positionId);
        
        emit PositionClosed(
            positionId,
            currentPrice,
            pnl,
            0, // No fee on close
            returnAmount
        );
    }

    // ============ LIQUIDATION ============

    /**
     * @inheritdoc IPerpEngine
     */
    function liquidatePosition(LiquidateParams calldata params)
        external
        override
        nonReentrant
        returns (uint256 liquidationReward)
    {
        require(msg.sender == liquidationEngine, "PerpEngine: only LiquidationEngine");
        
        Position storage position = _positions[params.positionId];
        require(position.isActive, "PerpEngine: position inactive");
        require(position.trader == params.trader, "PerpEngine: trader mismatch");
        require(position.marketId == params.marketId, "PerpEngine: market mismatch");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Verify position is liquidatable
        require(
            position.isLiquidatable(
                position.margin,
                position.size,
                position.entryPrice,
                currentPrice,
                position.isLong,
                0 // Funding already accrued
            ),
            "PerpEngine: not liquidatable"
        );
        
        // Accrue funding before liquidation
        _accrueFunding(position.marketId);
        
        // Calculate liquidation
        uint256 liquidatedSize = params.sizeToLiquidate;
        if (liquidatedSize > position.size) {
            liquidatedSize = position.size;
        }
        
        // Calculate PnL for liquidated portion
        int256 pnl = position.calculatePnL(
            liquidatedSize,
            position.entryPrice,
            currentPrice,
            position.isLong
        );
        
        // Calculate liquidation penalty
        uint256 penalty = liquidatedSize.mulDiv(
            _markets[position.marketId].liquidationFeeRatio,
            PRECISION
        );
        
        // Calculate liquidation reward
        liquidationReward = penalty / 2; // 50% to liquidator, 50% to insurance fund
        
        // Update position
        position.size -= liquidatedSize;
        position.margin -= _calculateLiquidationMarginDeduction(
            position.margin,
            position.size,
            liquidatedSize,
            pnl,
            penalty
        );
        
        if (position.size == 0) {
            position.isActive = false;
            // Burn NFT
            IPositionManager(positionManager).burn(params.positionId);
        }
        
        position.lastUpdated = block.timestamp;
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            -int256(liquidatedSize)
        );
        
        // Update total open interest
        _totalOpenInterest[position.marketId] -= liquidatedSize;
        
        // Distribute liquidation rewards
        if (liquidationReward > 0) {
            // Transfer to liquidator
            quoteToken.safeTransfer(msg.sender, liquidationReward);
            // Transfer to insurance fund
            quoteToken.safeTransfer(insuranceFund, liquidationReward);
        }
        
        emit PositionLiquidated(
            params.positionId,
            msg.sender,
            currentPrice,
            penalty,
            liquidationReward
        );
    }

    // ============ FUNDING ============

    /**
     * @inheritdoc IPerpEngine
     */
    function accrueFunding(uint256 marketId)
        external
        override
        nonReentrant
        marketActive(marketId)
    {
        _accrueFunding(marketId);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function batchAccrueFunding(uint256[] calldata marketIds)
        external
        override
        nonReentrant
    {
        for (uint256 i = 0; i < marketIds.length; i++) {
            if (_markets[marketIds[i]].isActive) {
                _accrueFunding(marketIds[i]);
            }
        }
    }

    // ============ MARGIN MANAGEMENT ============

    /**
     * @inheritdoc IPerpEngine
     */
    function addMargin(uint256 positionId, uint256 amount)
        external
        override
        nonReentrant
        whenNotPaused
        validPosition(positionId)
    {
        Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        require(amount > 0, "PerpEngine: zero amount");
        
        // Transfer margin
        quoteToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Update position
        position.margin += amount;
        position.leverage = position.size.mulDiv(PRECISION, position.margin);
        position.lastUpdated = block.timestamp;
        
        // No event needed for simple margin add
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function removeMargin(uint256 positionId, uint256 amount)
        external
        override
        nonReentrant
        whenNotPaused
        validPosition(positionId)
    {
        Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        require(amount > 0, "PerpEngine: zero amount");
        require(amount <= position.margin, "PerpEngine: insufficient margin");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Accrue funding before modification
        _accrueFunding(position.marketId);
        
        // Calculate health factor after removal
        uint256 newMargin = position.margin - amount;
        uint256 healthFactor = position.calculateHealthFactor(
            newMargin,
            position.size,
            position.entryPrice,
            currentPrice,
            position.isLong,
            0 // Funding already accrued
        );
        
        require(healthFactor > LIQUIDATION_THRESHOLD, "PerpEngine: below liquidation threshold");
        
        // Update position
        position.margin = newMargin;
        position.leverage = position.size.mulDiv(PRECISION, position.margin);
        position.lastUpdated = block.timestamp;
        
        // Transfer margin to trader
        quoteToken.safeTransfer(msg.sender, amount);
        
        // No event needed for simple margin remove
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc IPerpEngine
     */
    function getHealthFactor(uint256 positionId)
        external
        view
        override
        returns (uint256 healthFactor)
    {
        Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Calculate funding payment
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingAccrued
        );
        
        healthFactor = position.calculateHealthFactor(
            position.margin,
            position.size,
            position.entryPrice,
            currentPrice,
            position.isLong,
            fundingPayment
        );
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function getLiquidationPrice(uint256 positionId)
        external
        view
        override
        returns (uint256 liquidationPrice)
    {
        Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        // Calculate funding payment
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingAccrued
        );
        
        liquidationPrice = position.calculateLiquidationPrice(
            position.size,
            position.margin,
            position.entryPrice,
            position.isLong,
            fundingPayment
        );
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function getUnrealizedPnl(uint256 positionId, uint256 currentPrice)
        external
        view
        override
        returns (int256 pnl)
    {
        Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        pnl = position.calculatePnL(
            position.size,
            position.entryPrice,
            currentPrice,
            position.isLong
        );
        
        // Add funding payment
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingAccrued
        );
        
        pnl += fundingPayment;
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function isPositionLiquidatable(uint256 positionId, uint256 currentPrice)
        external
        view
        override
        returns (bool liquidatable)
    {
        Position storage position = _positions[positionId];
        if (!position.isActive) return false;
        
        // Calculate funding payment
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingAccrued
        );
        
        liquidatable = position.isLiquidatable(
            position.margin,
            position.size,
            position.entryPrice,
            currentPrice,
            position.isLong,
            fundingPayment
        );
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @inheritdoc IPerpEngine
     */
    function updateProtocolFee(uint256 newProtocolFee) external override onlyGovernance {
        // Update in all markets
        // Implementation depends on storage structure
        // For simplicity, updating a global variable or per market
        emit ProtocolFeeUpdated(newProtocolFee);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function updateLiquidationPenalty(uint256 newLiquidationPenalty) external override onlyGovernance {
        // Update in all markets
        emit LiquidationPenaltyUpdated(newLiquidationPenalty);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function updateFundingParams(
        uint256 newFundingInterval,
        uint256 newMaxFundingRate
    ) external override onlyGovernance {
        // Update funding parameters in AMM pool
        IAMMPool(ammPool).updateFundingParams(newFundingInterval, newMaxFundingRate);
        emit FundingParamsUpdated(newFundingInterval, newMaxFundingRate);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Accrue funding for a market
     */
    function _accrueFunding(uint256 marketId) internal {
        // Update funding in AMM pool
        int256 fundingRate = IAMMPool(ammPool).updateFundingRate(marketId);
        
        if (fundingRate != 0) {
            _fundingStates[marketId].fundingRate = fundingRate;
            _fundingStates[marketId].lastFundingTime = block.timestamp;
            
            emit FundingAccrued(
                marketId,
                fundingRate,
                block.timestamp,
                _fundingStates[marketId].fundingAccumulatedLong,
                _fundingStates[marketId].fundingAccumulatedShort
            );
        }
    }

    /**
     * @dev Get current market price from oracle
     */
    function _getMarketPrice(uint256 marketId) internal view returns (uint256 price, bool valid) {
        Market storage market = _markets[marketId];
        require(market.isActive, "PerpEngine: market inactive");
        
        bytes32 feedId = market.oracleFeedId;
        price = IOracleAggregator(oracleAggregator).getPrice(feedId);
        
        // Check price freshness
        valid = price > 0 && !IOracleAggregator(oracleAggregator).isPriceStale(feedId);
    }

    /**
     * @dev Validate position against risk parameters
     */
    function _validatePositionRisk(
        uint256 marketId,
        uint256 size,
        uint256 margin,
        uint256 leverage
    ) internal view {
        Market storage market = _markets[marketId];
        
        require(leverage <= market.maxLeverage, "PerpEngine: leverage exceeds market max");
        require(margin >= size.mulDiv(market.minMarginRatio, PRECISION), "PerpEngine: margin too low");
        
        // Check against risk manager
        (bool riskOk, string memory reason) = IRiskManager(riskManager).validatePosition(
            marketId,
            size,
            margin,
            leverage
        );
        require(riskOk, reason);
    }

    /**
     * @dev Calculate new entry price when increasing position
     */
    function _calculateNewEntryPrice(
        uint256 oldSize,
        uint256 oldMargin,
        uint256 oldEntryPrice,
        uint256 sizeAdded,
        uint256 marginAdded,
        uint256 currentPrice
    ) internal pure returns (uint256 newEntryPrice) {
        // Volume-weighted average price
        uint256 totalSize = oldSize + sizeAdded;
        uint256 totalValue = oldSize.mulDiv(oldEntryPrice, PRECISION) +
                           sizeAdded.mulDiv(currentPrice, PRECISION);
        
        newEntryPrice = totalValue.mulDiv(PRECISION, totalSize);
    }

    /**
     * @dev Calculate margin deduction during liquidation
     */
    function _calculateLiquidationMarginDeduction(
        uint256 totalMargin,
        uint256 totalSize,
        uint256 liquidatedSize,
        int256 pnl,
        uint256 penalty
    ) internal pure returns (uint256 marginDeduction) {
        // Proportion of margin to deduct
        uint256 marginProportion = liquidatedSize.mulDiv(PRECISION, totalSize);
        marginDeduction = totalMargin.mulDiv(marginProportion, PRECISION);
        
        // Add PnL impact (negative if loss)
        if (pnl < 0) {
            marginDeduction += uint256(-pnl);
        } else if (pnl > 0) {
            // Should not happen for liquidatable positions
            if (uint256(pnl) > marginDeduction) {
                marginDeduction = 0;
            } else {
                marginDeduction -= uint256(pnl);
            }
        }
        
        // Add penalty
        marginDeduction += penalty;
    }

    /**
     * @dev Collect protocol fees
     */
    function _collectFees(
        uint256 positionId,
        uint256 size,
        uint256 margin
    ) internal returns (uint256 protocolFee) {
        Position storage position = _positions[positionId];
        Market storage market = _markets[position.marketId];
        
        protocolFee = size.mulDiv(market.protocolFeeRatio, PRECISION);
        
        if (protocolFee > 0) {
            _protocolFees[address(quoteToken)] += protocolFee;
            // In practice, fee might be taken from margin or charged separately
        }
        
        return protocolFee;
    }

    // ============ GETTERS ============

    /**
     * @notice Get position details
     */
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return _positions[positionId];
    }

    /**
     * @notice Get trader's positions
     */
    function getTraderPositions(address trader) external view returns (uint256[] memory) {
        return _traderPositions[trader];
    }

    /**
     * @notice Get market state
     */
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _markets[marketId];
    }

    /**
     * @notice Get total open interest for market
     */
    function getTotalOpenInterest(uint256 marketId) external view returns (uint256) {
        return _totalOpenInterest[marketId];
    }

    /**
     * @notice Get funding state for market
     */
    function getFundingState(uint256 marketId) external view returns (FundingState memory) {
        return _fundingStates[marketId];
    }

    /**
     * @notice Get collected protocol fees for a token
     */
    function getProtocolFees(address token) external view returns (uint256) {
        return _protocolFees[token];
    }
}