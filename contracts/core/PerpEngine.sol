// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IPositionViewer} from "../interfaces/IPositionViewer.sol";
import {IAMMPool} from "../interfaces/IAMMPool.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IPositionManager} from "../interfaces/IPositionManager.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";
import {ILiquidityVault} from "../interfaces/ILiquidityVault.sol";

import {PositionMath} from "../libraries/PositionMath.sol";
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";
import {FundingRateCalculator} from "../libraries/FundingRateCalculator.sol";

/**
 * @title PerpEngine
 * @notice Core perpetual DEX engine - manages positions, funding, and liquidations according to ECONOMIC_SPEC.md (ADR-001)
 * @dev Central business logic with economic safety invariants using LiquidityVault as counterparty.
 */
contract PerpEngine is IPerpEngine, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;

    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant PRICE_NORMALIZATION = 10**10;
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
    address public immutable liquidityVault;
    
    IERC20 public immutable baseToken;
    IERC20 public immutable quoteToken;

    // ============ STATE VARIABLES ============
    
    uint256 private _nextPositionId;
    
    // Position ID => Position data
    mapping(uint256 => IPerpEngine.Position) private _positions;
    
    // Market ID => Market state
    mapping(uint256 => Market) private _markets;
    
    // Trader address => array of position IDs
    mapping(address => uint256[]) private _traderPositions;

    // Market ID => array of position IDs
    mapping(uint256 => uint256[]) private _marketPositions;
    
    // Funding state per market
    mapping(uint256 => FundingState) private _fundingStates;
    
    // Protocol fees collected
    mapping(address => uint256) private _protocolFees;
    
    // Total open interest per market
    mapping(uint256 => uint256) private _totalOpenInterest;

    // Admin and governance
    address public governance;

    // Economic metrics for invariants
    uint256 public totalCollateral;
    uint256 public totalPositionSize; // Total open interest across markets in base units
    int256 public totalFundingPaid;
    int256 public totalFundingReceived;
    uint256 public totalFeesAccrued;

    // ============ STRUCTS ============
    
    struct Market {
        bool isActive;
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 minPositionSize;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
        bytes32 oracleFeedId;
        uint256 lastPriceUpdate;
        uint256 lastFundingUpdate;
    }
    
    struct FundingState {
        int256 fundingRate;
        uint256 lastFundingTime;
        int256 cumulativeFundingIndex;
    }

    struct SettlementResult {
        uint256 sizeReduced;
        uint256 marginReduced;
        int256 realizedPnl;
        uint256 protocolFee;
        uint256 traderPayout;
        uint256 unlockedNotional;
    }

    struct BalanceSheet {
        uint256 totalTraderCollateral;
        uint256 totalLpAssets;
        uint256 lockedLiquidity;
        uint256 availableLiquidity;
        uint256 insuranceFundBalance;
        uint256 protocolFeeBalance;
        uint256 totalOpenInterestBase;
        uint256 vaultQuoteBalance;
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
        require(msg.sender == governance, "PerpEngine: only Governance");
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
        address liquidityVault_,
        address baseToken_,
        address quoteToken_
    ) {
        require(positionManager_ != address(0), "PerpEngine: zero address");
        require(ammPool_ != address(0), "PerpEngine: zero address");
        require(oracleAggregator_ != address(0), "PerpEngine: zero address");
        require(liquidationEngine_ != address(0), "PerpEngine: zero address");
        require(riskManager_ != address(0), "PerpEngine: zero address");
        require(configRegistry_ != address(0), "PerpEngine: zero address");
        require(liquidityVault_ != address(0), "PerpEngine: zero address");
        require(baseToken_ != address(0), "PerpEngine: zero address");
        require(quoteToken_ != address(0), "PerpEngine: zero address");
        
        positionManager = positionManager_;
        ammPool = ammPool_;
        oracleAggregator = oracleAggregator_;
        liquidationEngine = liquidationEngine_;
        riskManager = riskManager_;
        configRegistry = configRegistry_;
        liquidityVault = liquidityVault_;
        governance = msg.sender;
        
        baseToken = IERC20(baseToken_);
        quoteToken = IERC20(quoteToken_);
        
        _nextPositionId = 1;
    }

    /**
     * @notice Backward-compatible view for total position size
     */
    function totalPositionValue() external view returns (uint256) {
        return totalPositionSize;
    }

    /**
     * @notice Update governance address
     * @param newGovernance New governance address
     */
    function setGovernance(address newGovernance) external onlyGovernance {
        require(newGovernance != address(0), "PerpEngine: zero address");
        governance = newGovernance;
    }

    // ============ DECIMAL NORMALIZATION HELPERS ============

    function _toVaultUnits(uint256 wadAmount) internal view returns (uint256) {
        if (wadAmount == 0) return 0;
        uint8 vaultDec = ILiquidityVault(liquidityVault).decimals();
        if (vaultDec == 18) {
            return wadAmount;
        } else if (vaultDec < 18) {
            return wadAmount / (10 ** (18 - vaultDec));
        } else {
            return wadAmount * (10 ** (vaultDec - 18));
        }
    }

    function _fromVaultUnits(uint256 vaultAmount) internal view returns (uint256) {
        if (vaultAmount == 0) return 0;
        uint8 vaultDec = ILiquidityVault(liquidityVault).decimals();
        if (vaultDec == 18) {
            return vaultAmount;
        } else if (vaultDec < 18) {
            return vaultAmount * (10 ** (18 - vaultDec));
        } else {
            return vaultAmount / (10 ** (vaultDec - 18));
        }
    }

    // ============ CANONICAL FUNDING SETTLEMENT HELPER ============

    /**
     * @dev Settles pending funding payment for position's current pre-modification size.
     * Calculates funding payment based on deltaIndex between market.cumulativeFundingIndex
     * and position.lastFundingIndex. Updates position.margin and sets
     * position.lastFundingIndex = marketCumulativeIndex exactly once.
     * Returns the funding payment (positive = trader owed, reducing margin).
     */
    function _settleFunding(IPerpEngine.Position storage position) internal returns (int256 fundingPayment) {
        _accrueFunding(position.marketId);
        int256 marketCumIndex = IAMMPool(ammPool).getCumulativeFundingIndex(position.marketId);

        if (position.size > 0 && position.lastFundingIndex != marketCumIndex) {
            fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
                position.marketId,
                position.size,
                position.isLong,
                position.lastFundingIndex
            );
            if (fundingPayment != 0) {
                if (fundingPayment > 0) {
                    uint256 debt = uint256(fundingPayment);
                    if (position.margin >= debt) {
                        position.margin -= debt;
                    } else {
                        position.margin = 0;
                    }
                } else {
                    position.margin += uint256(-fundingPayment);
                }
            }
        }
        position.lastFundingIndex = marketCumIndex;
    }

    // ============ SINGLE INTERNAL SETTLEMENT HELPER ============

    /**
     * @dev Core internal settlement function for position reduction / closure according to ECONOMIC_SPEC.md.
     * Performs funding settlement on pre-modification size, calculates proportional margin,
     * realized PnL, closing fees, unlocks LP liquidity, applies state updates (CEI),
     * and interacts atomically with LiquidityVault.
     */
    function _settlePositionChange(
        uint256 positionId,
        uint256 sizeReduced,
        uint256 marginReduced,
        uint256 currentPrice
    ) internal returns (SettlementResult memory res) {
        IPerpEngine.Position storage position = _positions[positionId];

        // 1. Settle pending funding on pre-decrease position size
        _settleFunding(position);

        // If closing full position, marginReduced must equal post-funding position.margin
        if (sizeReduced == position.size) {
            marginReduced = position.margin;
        }

        res.sizeReduced = sizeReduced;
        res.marginReduced = marginReduced;

        // 2. Realized PnL for reduced portion (in quote WAD)
        res.realizedPnl = PositionMath.calculatePnL(
            position.entryPrice,
            currentPrice,
            sizeReduced,
            position.isLong
        );

        // 3. Protocol fee for reduced portion (in quote WAD)
        Market storage market = _markets[position.marketId];
        uint256 reducedNotional = sizeReduced.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        res.protocolFee = reducedNotional.mulDiv(market.protocolFeeRatio, PRECISION);

        // 4. Proportional LP liquidity unlocked based on stored lockedNotional
        res.unlockedNotional = position.size > 0
            ? position.lockedNotional.mulDiv(sizeReduced, position.size)
            : position.lockedNotional;

        // 5. Checks-Effects (state updates)
        position.size -= sizeReduced;
        position.margin -= marginReduced;
        position.lockedNotional -= res.unlockedNotional;
        if (position.size == 0) {
            position.isActive = false;
        }
        position.lastUpdated = block.timestamp;

        totalCollateral -= marginReduced;
        totalPositionSize -= sizeReduced;

        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            -int256(sizeReduced)
        );
        _totalOpenInterest[position.marketId] -= sizeReduced;

        // 6. Interactions (with LiquidityVault)
        ILiquidityVault(liquidityVault).unlockLiquidity(_toVaultUnits(res.unlockedNotional));

        if (res.protocolFee > 0) {
            _protocolFees[address(quoteToken)] += res.protocolFee;
            totalFeesAccrued += res.protocolFee;
            ILiquidityVault(liquidityVault).collectProtocolFees(_toVaultUnits(res.protocolFee));
        }

        uint256 netMargin = marginReduced > res.protocolFee ? marginReduced - res.protocolFee : 0;

        if (res.realizedPnl >= 0) {
            uint256 profit = uint256(res.realizedPnl);
            (uint256 profitPaidVaultUnits, ) = ILiquidityVault(liquidityVault).settleTraderProfit(
                position.trader,
                _toVaultUnits(netMargin),
                _toVaultUnits(profit)
            );
            res.traderPayout = netMargin + _fromVaultUnits(profitPaidVaultUnits);
        } else {
            uint256 loss = uint256(-res.realizedPnl);
            if (netMargin >= loss) {
                res.traderPayout = netMargin - loss;
                ILiquidityVault(liquidityVault).settleTraderLoss(
                    position.trader,
                    _toVaultUnits(res.traderPayout),
                    _toVaultUnits(loss)
                );
            } else {
                ILiquidityVault(liquidityVault).settleBadDebt(
                    position.trader,
                    _toVaultUnits(netMargin),
                    _toVaultUnits(loss)
                );
                res.traderPayout = 0;
            }
        }
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
        require(params.size >= _markets[params.marketId].minPositionSize, "Position size too small");
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
        
        // Calculate leverage: (size * price) / margin
        uint256 currentPriceNormalized = currentPrice * PRICE_NORMALIZATION;
        uint256 notionalValue = params.size.mulDiv(currentPriceNormalized, PRECISION);
        uint256 leverage = notionalValue.mulDiv(PRECISION, params.margin);
        require(leverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        
        // Check risk parameters using normalized quote notional value
        _validatePositionRisk(params.marketId, params.size, params.margin, leverage, currentPrice);
        
        // Lock LP liquidity backstop and deposit trader margin into vault
        ILiquidityVault(liquidityVault).lockLiquidity(_toVaultUnits(notionalValue));
        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, _toVaultUnits(params.margin));
        
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
        int256 marketCumIndex = IAMMPool(ammPool).getCumulativeFundingIndex(params.marketId);
        
        _positions[positionId] = IPerpEngine.Position({
            trader: msg.sender,
            marketId: params.marketId,
            isLong: params.isLong,
            size: params.size,
            margin: params.margin,
            entryPrice: currentPrice,
            leverage: leverage,
            lastFundingIndex: marketCumIndex,
            openTime: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true,
            lockedNotional: notionalValue
        });
        
        // Update trader positions, market positions & open interest
        _traderPositions[msg.sender].push(positionId);
        _marketPositions[params.marketId].push(positionId);
        _totalOpenInterest[params.marketId] += params.size;
        
        // Update global metrics
        totalCollateral += params.margin;
        totalPositionSize += params.size;

        // Calculate and collect fees
        uint256 protocolFee = _collectFees(positionId, params.size, params.margin);
        
        // Mint position NFT
        IPositionManager(positionManager).mint(msg.sender, positionId);
        
        emit PositionOpened(
            positionId,
            msg.sender,
            params.marketId,
            params.isLong,
            params.size,
            params.margin - protocolFee,
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
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        require(sizeAdded > 0, "PerpEngine: zero size");
        require(marginAdded > 0, "PerpEngine: zero margin");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Settle funding on pre-increase size Q before adding dQ
        _settleFunding(position);

        // Calculate new values
        uint256 newSize = position.size + sizeAdded;
        uint256 newMargin = position.margin + marginAdded;
        
        // Calculate leverage: (size * price) / margin
        uint256 newNotionalValue = newSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 newLeverage = newNotionalValue.mulDiv(PRECISION, newMargin);
        
        require(newLeverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        
        // Validate risk using normalized quote notional
        _validatePositionRisk(position.marketId, newSize, newMargin, newLeverage, currentPrice);
        
        // Lock additional LP liquidity and deposit additional margin
        uint256 addedNotional = sizeAdded.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        ILiquidityVault(liquidityVault).lockLiquidity(_toVaultUnits(addedNotional));
        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, _toVaultUnits(marginAdded));
        position.lockedNotional += addedNotional;
        
        // Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            int256(sizeAdded)
        );
        
        // Update position
        uint256 oldSize = position.size;
        
        // Update global metrics
        totalCollateral += marginAdded;
        totalPositionSize += sizeAdded;

        position.size = newSize;
        position.margin = newMargin;
        position.leverage = newLeverage;
        position.entryPrice = _calculateNewEntryPrice(
            oldSize,
            position.entryPrice,
            sizeAdded,
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
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        require(sizeReduced > 0 && sizeReduced <= position.size, "PerpEngine: invalid size reduction");
        require(marginReduced <= position.margin, "PerpEngine: invalid margin reduction");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Perform atomic settlement via internal settlement helper
        SettlementResult memory res = _settlePositionChange(positionId, sizeReduced, marginReduced, currentPrice);
        
        emit PositionDecreased(
            positionId,
            sizeReduced,
            marginReduced,
            uint256(res.realizedPnl >= 0 ? res.realizedPnl : -res.realizedPnl),
            res.protocolFee
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
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        
        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Perform full atomic settlement via internal settlement helper
        SettlementResult memory res = _settlePositionChange(
            positionId,
            position.size,
            position.margin,
            currentPrice
        );
        
        // Burn position NFT
        IPositionManager(positionManager).burn(positionId);
        
        emit PositionClosed(
            positionId,
            currentPrice,
            uint256(res.realizedPnl >= 0 ? res.realizedPnl : -res.realizedPnl),
            res.protocolFee,
            res.traderPayout
        );
    }

    // ============ LIQUIDATION ============

    function _settleLiquidationVault(
        address positionTrader,
        uint256 marginProportion,
        uint256 totalDeficit,
        uint256 pnlDeduction,
        uint256 penalty
    ) internal returns (uint256 liquidationReward) {
        uint256 vaultMarginProp = _toVaultUnits(marginProportion);
        uint256 vaultTotalDef = _toVaultUnits(totalDeficit);

        if (marginProportion >= totalDeficit) {
            liquidationReward = penalty / 2;
            uint256 insuranceShare = penalty - liquidationReward;

            ILiquidityVault(liquidityVault).settleTraderLoss(
                positionTrader,
                _toVaultUnits(marginProportion - totalDeficit),
                _toVaultUnits(pnlDeduction)
            );
            if (insuranceShare > 0) {
                ILiquidityVault(liquidityVault).fundInsuranceFund(_toVaultUnits(insuranceShare));
            }
            if (liquidationReward > 0) {
                ILiquidityVault(liquidityVault).withdrawTraderMargin(msg.sender, _toVaultUnits(liquidationReward));
            }
        } else {
            ILiquidityVault(liquidityVault).settleBadDebt(
                positionTrader,
                vaultMarginProp,
                vaultTotalDef
            );
            liquidationReward = penalty / 2;
            if (liquidationReward > 0) {
                try ILiquidityVault(liquidityVault).withdrawInsuranceFund(msg.sender, _toVaultUnits(liquidationReward)) {} catch {}
            }
        }
    }

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
        
        IPerpEngine.Position storage position = _positions[params.positionId];
        require(position.isActive, "PerpEngine: position inactive");
        require(position.trader == params.trader, "PerpEngine: trader mismatch");
        require(position.marketId == params.marketId, "PerpEngine: market mismatch");
        
        // Accrue funding before liquidation checks
        _accrueFunding(position.marketId);

        // Get current price
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Verify position is liquidatable using up-to-date accrued funding
        {
            int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
                position.marketId,
                position.size,
                position.isLong,
                position.lastFundingIndex
            );
            PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
                size: position.size,
                collateral: position.margin,
                entryPrice: position.entryPrice,
                isLong: position.isLong,
                fundingAccrued: fundingPayment
            });
            PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
                maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
                liquidationThresholdBps: 10000
            });
            require(
                PositionMath.isPositionLiquidatable(posParams, currentPrice, riskParams),
                "PerpEngine: not liquidatable"
            );
        }
        
        // Calculate liquidation
        uint256 liquidatedSize = params.sizeToLiquidate;
        if (liquidatedSize > position.size) {
            liquidatedSize = position.size;
        }
        
        // Calculate PnL for liquidated portion
        int256 pnl = PositionMath.calculatePnL(
            position.entryPrice,
            currentPrice,
            liquidatedSize,
            position.isLong
        );
        
        uint256 pnlDeduction = 0;
        if (pnl < 0) {
            pnlDeduction = uint256(-pnl);
        }
        
        // Calculate liquidation penalty
        uint256 liquidatedNotional = liquidatedSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 penalty = liquidatedNotional.mulDiv(
            _markets[position.marketId].liquidationFeeRatio,
            PRECISION
        );
        
        uint256 totalDeficit = pnlDeduction + penalty;

        // Unlock exact stored LP liquidity proportion
        uint256 unlockedNotional = position.size > 0
            ? position.lockedNotional.mulDiv(liquidatedSize, position.size)
            : position.lockedNotional;
        ILiquidityVault(liquidityVault).unlockLiquidity(_toVaultUnits(unlockedNotional));

        // Deduct margin proportion
        uint256 marginProportion = liquidatedSize.mulDiv(position.margin, position.size);
        if (marginProportion > position.margin) marginProportion = position.margin;

        liquidationReward = _settleLiquidationVault(
            position.trader,
            marginProportion,
            totalDeficit,
            pnlDeduction,
            penalty
        );
        
        // Update global metrics
        totalPositionSize -= liquidatedSize;
        totalCollateral -= marginProportion;

        position.size -= liquidatedSize;
        position.margin -= marginProportion;
        position.lockedNotional -= unlockedNotional;
        
        if (position.size == 0) {
            position.isActive = false;
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
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        require(amount > 0, "PerpEngine: zero amount");
        
        (uint256 currentPrice, ) = _getMarketPrice(position.marketId);
        
        // Settle funding on position before margin mutation
        _settleFunding(position);

        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, _toVaultUnits(amount));
        
        position.margin += amount;
        totalCollateral += amount;
        
        uint256 notionalValue = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        position.leverage = notionalValue.mulDiv(PRECISION, position.margin);
        
        position.lastUpdated = block.timestamp;
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
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.trader == msg.sender, "PerpEngine: not position owner");
        require(amount > 0, "PerpEngine: zero amount");
        
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        // Settle funding on position before margin mutation
        _settleFunding(position);
        require(amount <= position.margin, "PerpEngine: insufficient margin");

        uint256 newMargin = position.margin - amount;
        uint256 healthFactor;
        {
            PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
                size: position.size,
                collateral: newMargin,
                entryPrice: position.entryPrice,
                isLong: position.isLong,
                fundingAccrued: 0
            });
            PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
                maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
                liquidationThresholdBps: 10000
            });
            healthFactor = PositionMath.calculateHealthFactor(posParams, currentPrice, riskParams);
        }
        
        require(healthFactor > LIQUIDATION_THRESHOLD, "PerpEngine: below liquidation threshold");
        
        position.margin = newMargin;
        totalCollateral -= amount;
        
        uint256 notionalValue = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        position.leverage = notionalValue.mulDiv(PRECISION, position.margin);
        
        position.lastUpdated = block.timestamp;
        
        ILiquidityVault(liquidityVault).withdrawTraderMargin(msg.sender, _toVaultUnits(amount));
    }

    // ============ BALANCE SHEET & MONITORING VIEWS ============

    /**
     * @notice Balance sheet view for real-time risk monitoring
     */
    function getBalanceSheet() external view returns (BalanceSheet memory bs) {
        bs.totalTraderCollateral = totalCollateral;
        bs.totalLpAssets = ILiquidityVault(liquidityVault).totalLpAssets();
        bs.lockedLiquidity = ILiquidityVault(liquidityVault).lockedLiquidity();
        bs.availableLiquidity = ILiquidityVault(liquidityVault).availableLiquidity();
        bs.insuranceFundBalance = ILiquidityVault(liquidityVault).insuranceFundBalance();
        bs.protocolFeeBalance = ILiquidityVault(liquidityVault).protocolFeeBalance();
        bs.totalOpenInterestBase = totalPositionSize;
        bs.vaultQuoteBalance = quoteToken.balanceOf(liquidityVault);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc IPerpEngine
     */
    function getHealthFactor(uint256 positionId)
        public
        view
        override
        returns (uint256 healthFactor)
    {
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        require(priceValid, "PerpEngine: invalid price");
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );
        
        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });
        
        healthFactor = PositionMath.calculateHealthFactor(posParams, currentPrice, riskParams);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function getLiquidationPrice(uint256 positionId)
        public
        view
        override
        returns (uint256 liquidationPrice)
    {
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );
        
        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });
        
        PositionMath.LiquidationResult memory result = PositionMath.calculateLiquidationPriceSafe(posParams, riskParams);
        liquidationPrice = result.liquidationPrice;
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function getUnrealizedPnl(uint256 positionId, uint256 currentPrice)
        public
        view
        override
        returns (int256 pnl)
    {
        IPerpEngine.Position storage position = _positions[positionId];
        require(position.isActive, "PerpEngine: position inactive");
        
        pnl = PositionMath.calculatePnL(
            position.entryPrice,
            currentPrice,
            position.size,
            position.isLong
        );
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );
        
        // PnL net of funding owed by trader
        pnl -= fundingPayment;
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function previewLiquidation(uint256 positionId, uint256 currentPrice)
        external
        view
        override
        returns (uint256 reward, uint256 penalty, uint256 newHealthFactor)
    {
        return ILiquidationEngine(liquidationEngine).previewLiquidation(positionId, currentPrice);
    }

    function isPositionLiquidatable(uint256 positionId, uint256 currentPrice)
        public
        view
        override
        returns (bool liquidatable)
    {
        IPerpEngine.Position storage position = _positions[positionId];
        if (!position.isActive) return false;
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );
        
        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });
        
        liquidatable = PositionMath.isPositionLiquidatable(posParams, currentPrice, riskParams);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function getPositionInternal(uint256 positionId) external view override returns (IPerpEngine.Position memory) {
        return _positions[positionId];
    }

    /**
     * @inheritdoc IPositionViewer
     */
    function getPosition(uint256 positionId) public view override returns (PositionView memory viewData) {
        IPerpEngine.Position storage position = _positions[positionId];
        if (!position.isActive) return viewData;

        (uint256 currentPrice, ) = _getMarketPrice(position.marketId);
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: _markets[position.marketId].minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });

        PositionMath.LiquidationResult memory liqResult = PositionMath.calculateLiquidationPriceSafe(posParams, riskParams);
        uint256 healthFactor = PositionMath.calculateHealthFactor(posParams, currentPrice, riskParams);
        int256 pnl = PositionMath.calculatePnL(position.entryPrice, currentPrice, position.size, position.isLong) - fundingPayment;

        return PositionView({
            positionId: positionId,
            trader: position.trader,
            marketId: position.marketId,
            isLong: position.isLong,
            size: position.size,
            margin: position.margin,
            entryPrice: position.entryPrice,
            leverage: position.leverage,
            liquidationPrice: liqResult.liquidationPrice,
            healthFactor: healthFactor,
            unrealizedPnl: pnl,
            fundingAccrued: uint256(fundingPayment > 0 ? fundingPayment : int256(0)),
            openTime: position.openTime,
            lastUpdated: position.lastUpdated
        });
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @inheritdoc IPerpEngine
     */
    function updateProtocolFee(uint256 newProtocolFee) external override onlyGovernance {
        uint256 numMarkets = 100;
        for (uint256 i = 1; i <= numMarkets; i++) {
            if (_markets[i].isActive) {
                _markets[i].protocolFeeRatio = newProtocolFee;
            }
        }
        emit ProtocolFeeUpdated(newProtocolFee);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function updateLiquidationPenalty(uint256 newLiquidationPenalty) external override onlyGovernance {
        uint256 numMarkets = 100;
        for (uint256 i = 1; i <= numMarkets; i++) {
            if (_markets[i].isActive) {
                _markets[i].liquidationFeeRatio = newLiquidationPenalty;
            }
        }
        emit LiquidationPenaltyUpdated(newLiquidationPenalty);
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function updateFundingParams(
        uint256 newFundingInterval,
        uint256 newMaxFundingRate
    ) external override onlyGovernance {
        revert("PerpEngine: updateFundingParams unimlplemented");
    }

    /**
     * @inheritdoc IPerpEngine
     */
    function initializeMarket(
        uint256 marketId,
        bytes32 oracleFeedId,
        uint256 maxLeverage,
        uint256 minMarginRatio,
        uint256 minPositionSize,
        uint256 liquidationFeeRatio,
        uint256 protocolFeeRatio
    ) external override onlyGovernance {
        require(!_markets[marketId].isActive, "PerpEngine: market already active");
        
        _markets[marketId] = Market({
            isActive: true,
            maxLeverage: maxLeverage,
            minMarginRatio: minMarginRatio,
            minPositionSize: minPositionSize,
            liquidationFeeRatio: liquidationFeeRatio,
            protocolFeeRatio: protocolFeeRatio,
            oracleFeedId: oracleFeedId,
            lastPriceUpdate: block.timestamp,
            lastFundingUpdate: block.timestamp
        });
        
        emit MarketInitialized(marketId, oracleFeedId);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Accrue funding for a market
     */
    function _accrueFunding(uint256 marketId) internal {
        int256 fundingRate = IAMMPool(ammPool).updateFundingRate(marketId);
        int256 cumIndex = IAMMPool(ammPool).getCumulativeFundingIndex(marketId);

        _fundingStates[marketId].fundingRate = fundingRate;
        _fundingStates[marketId].lastFundingTime = block.timestamp;
        _fundingStates[marketId].cumulativeFundingIndex = cumIndex;
        
        if (fundingRate != 0) {
            emit FundingAccrued(
                marketId,
                fundingRate,
                block.timestamp,
                cumIndex
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
        
        valid = price > 0 && !IOracleAggregator(oracleAggregator).isPriceStale(feedId);
    }

    /**
     * @dev Validate position against risk parameters
     */
    function _validatePositionRisk(
        uint256 marketId,
        uint256 size,
        uint256 margin,
        uint256 leverage,
        uint256 currentPrice
    ) internal view {
        Market storage market = _markets[marketId];
        
        require(leverage <= market.maxLeverage, "PerpEngine: leverage exceeds market max");

        uint256 notionalValue = size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 minMarginRequired = notionalValue.mulDiv(market.minMarginRatio, PRECISION);
        require(margin >= minMarginRequired, "PerpEngine: margin too low");
        
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
        uint256 oldEntryPrice,
        uint256 sizeAdded,
        uint256 currentPrice
    ) internal pure returns (uint256 newEntryPrice) {
        uint256 totalSize = oldSize + sizeAdded;
        uint256 totalValue = oldSize.mulDiv(oldEntryPrice, PRECISION) +
                           sizeAdded.mulDiv(currentPrice, PRECISION);
        
        newEntryPrice = totalValue.mulDiv(PRECISION, totalSize);
    }

    /**
     * @dev Collect protocol fees
     */
    function _collectFees(
        uint256 positionId,
        uint256 size,
        uint256 margin
    ) internal returns (uint256 protocolFee) {
        IPerpEngine.Position storage position = _positions[positionId];
        Market storage market = _markets[position.marketId];
        
        uint256 currentPrice = IOracleAggregator(oracleAggregator).getPrice(market.oracleFeedId);
        uint256 notionalValue = size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        protocolFee = notionalValue.mulDiv(market.protocolFeeRatio, PRECISION);
        
        if (protocolFee > 0) {
            _protocolFees[address(quoteToken)] += protocolFee;
            totalFeesAccrued += protocolFee;
            require(position.margin >= protocolFee, "PerpEngine: margin too low for fees");
            position.margin -= protocolFee;
            totalCollateral -= protocolFee;
            ILiquidityVault(liquidityVault).collectProtocolFees(_toVaultUnits(protocolFee));
        }
        
        return protocolFee;
    }

    // ============ GETTERS ============

    /**
     * @notice Get trader's positions IDs
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

    // ============ IPOSITIONVIEWER IMPLEMENTATION ============

    function getPositionsByTrader(address trader, uint256 cursor, uint256 limit) external view override returns (PositionView[] memory positions, uint256 newCursor) {
        uint256[] storage ids = _traderPositions[trader];
        uint256 total = ids.length;
        if (cursor >= total) return (positions, total);
        
        uint256 end = cursor + limit;
        if (end > total) end = total;
        uint256 count = end - cursor;
        
        positions = new PositionView[](count);
        for (uint256 i = 0; i < count; i++) {
            positions[i] = getPosition(ids[cursor + i]);
        }
        return (positions, end);
    }

    function getPositionsByMarket(uint256 marketId, uint256 cursor, uint256 limit) external view override returns (PositionView[] memory positions, uint256 newCursor) {
        uint256[] storage ids = _marketPositions[marketId];
        uint256 total = ids.length;
        if (cursor >= total) return (positions, total);

        uint256 end = cursor + limit;
        if (end > total) end = total;
        uint256 count = end - cursor;

        positions = new PositionView[](count);
        for (uint256 i = 0; i < count; i++) {
            positions[i] = getPosition(ids[cursor + i]);
        }
        return (positions, end);
    }

    function getPositionStats() external view override returns (PositionStats memory stats) {
        stats.totalPositions = _nextPositionId - 1;
        stats.totalMargin = totalCollateral;
        return stats;
    }

    function getMarketStats(uint256 marketId) external view override returns (PositionStats memory stats) {
        (uint256 longOI, uint256 shortOI,) = IAMMPool(ammPool).getMarketSkew(marketId);
        stats.totalLongSize = longOI;
        stats.totalShortSize = shortOI;
        return stats;
    }

    function getAvailableMargin(uint256 positionId) external view override returns (uint256 availableMargin) {
        IPerpEngine.Position storage position = _positions[positionId];
        if (!position.isActive) return 0;

        (uint256 currentPrice, ) = _getMarketPrice(position.marketId);
        
        int256 fundingPayment = IAMMPool(ammPool).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        int256 pnl = PositionMath.calculatePnL(position.entryPrice, currentPrice, position.size, position.isLong);
        int256 equity = int256(position.margin) + pnl - fundingPayment;
        
        if (equity <= 0) return 0;

        uint256 maintenanceMargin = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION)
            .mulDiv(_markets[position.marketId].minMarginRatio, PRECISION);
            
        if (uint256(equity) <= maintenanceMargin) return 0;
        
        return uint256(equity) - maintenanceMargin;
    }

    function getMaxAdditionalSize(uint256 positionId, uint256 additionalMargin) external view override returns (uint256 maxAdditionalSize) {
        IPerpEngine.Position storage position = _positions[positionId];
        if (!position.isActive) return 0;

        (uint256 currentPrice, ) = _getMarketPrice(position.marketId);
        uint256 totalMargin = position.margin + additionalMargin;
        
        uint256 currentNotional = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 maxNotional = totalMargin.mulDiv(_markets[position.marketId].maxLeverage, PRECISION);
        
        if (maxNotional <= currentNotional) return 0;
        
        uint256 additionalNotional = maxNotional - currentNotional;
        return additionalNotional.mulDiv(PRECISION, currentPrice * PRICE_NORMALIZATION);
    }

    function batchGetPositions(uint256[] calldata positionIds) external view override returns (PositionView[] memory views) {
        views = new PositionView[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            views[i] = getPosition(positionIds[i]);
        }
        return views;
    }

    function batchGetHealthFactors(uint256[] calldata positionIds) external view override returns (uint256[] memory healthFactors) {
        healthFactors = new uint256[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            healthFactors[i] = getHealthFactor(positionIds[i]);
        }
        return healthFactors;
    }

    function batchIsLiquidatable(uint256[] calldata positionIds, uint256[] calldata currentPrices) external view override returns (bool[] memory liquidatable) {
        liquidatable = new bool[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            liquidatable[i] = isPositionLiquidatable(positionIds[i], currentPrices[i]);
        }
        return liquidatable;
    }
}