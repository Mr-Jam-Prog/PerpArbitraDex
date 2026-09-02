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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

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
        uint256 preSize;
        uint256 postFundingPreChangeMargin;
        uint256 sizeReduced;
        uint256 proportionalMarginReleased;
        int256 realizedPnl;
        uint256 unpaidFundingDebt;
        uint256 protocolFee;
        uint256 traderPayout;
        uint256 extraMarginDebit;
        uint256 totalTraderCollateralConsumed;
        int256 collateralDelta;
        uint256 grossTradingDeficit;
        uint256 lossCoveredByCollateral;
        uint256 residualBadDebt;
        uint256 unlockedNotional;
        uint256 remainingPositionMargin;
        uint256 remainingPositionSize;
    }

    struct BalanceSheet {
        uint256 totalTraderCollateral;   // WAD Quote (1e18)
        uint256 totalLpAssets;          // WAD Quote (1e18)
        uint256 lockedLiquidity;        // WAD Quote (1e18)
        uint256 availableLiquidity;     // WAD Quote (1e18)
        uint256 insuranceFundBalance;   // WAD Quote (1e18)
        uint256 protocolFeeBalance;     // WAD Quote (1e18)
        uint256 totalOpenInterestBase;  // WAD Base  (1e18)
        uint256 vaultQuoteBalance;      // WAD Quote (1e18)
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

    function _toVaultUnitsCeil(uint256 wadAmount) internal view returns (uint256) {
        if (wadAmount == 0) return 0;
        uint8 vaultDec = ILiquidityVault(liquidityVault).decimals();
        if (vaultDec == 18) {
            return wadAmount;
        } else if (vaultDec < 18) {
            uint256 divisor = 10 ** (18 - vaultDec);
            return Math.ceilDiv(wadAmount, divisor);
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

    function _signedMarginDelta(
        uint256 beforeMargin,
        uint256 afterMargin
    ) internal pure returns (int256) {
        if (afterMargin >= beforeMargin) {
            uint256 increase = afterMargin - beforeMargin;
            require(increase <= uint256(type(int256).max), "PerpEngine: margin delta overflow");
            return int256(increase);
        }

        uint256 decrease = beforeMargin - afterMargin;
        require(decrease <= uint256(type(int256).max), "PerpEngine: margin delta overflow");
        return -int256(decrease);
    }

    // ============ CANONICAL FUNDING SETTLEMENT HELPER ============

    /**
     * @dev Settles pending funding payment for position's current pre-modification size.
     * Calculates funding payment based on deltaIndex between market.cumulativeFundingIndex
     * and position.lastFundingIndex. Updates position.margin, engine totalCollateral,
     * and Vault traderMarginTotal / totalLpAssets atomically. Returns unpaid funding debt if funding debt exceeds margin.
     */
    function _settleFunding(IPerpEngine.Position storage position) internal returns (int256 fundingPayment, uint256 unpaidFundingDebt) {
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
                    uint256 debtWad = uint256(fundingPayment);
                    uint256 nativeDebt = _toVaultUnitsCeil(debtWad);
                    uint256 chargedDebtWad = _fromVaultUnits(nativeDebt);

                    if (position.margin >= chargedDebtWad) {
                        position.margin -= chargedDebtWad;
                        totalCollateral -= chargedDebtWad;
                        ILiquidityVault(liquidityVault).settleTraderLoss(position.trader, 0, nativeDebt);
                        unpaidFundingDebt = 0;
                    } else {
                        uint256 nativeMarginAvailable = _toVaultUnits(position.margin);
                        uint256 marginForfeitedWad = _fromVaultUnits(nativeMarginAvailable);

                        unpaidFundingDebt = debtWad > marginForfeitedWad ? debtWad - marginForfeitedWad : 0;
                        totalCollateral -= marginForfeitedWad;
                        position.margin -= marginForfeitedWad;

                        if (nativeMarginAvailable > 0) {
                            ILiquidityVault(liquidityVault).settleTraderLoss(position.trader, 0, nativeMarginAvailable);
                        }
                    }
                } else {
                    uint256 creditWad = uint256(-fundingPayment);
                    uint256 nativeCredit = _toVaultUnits(creditWad);
                    uint256 creditedWad = _fromVaultUnits(nativeCredit);

                    position.margin += creditedWad;
                    totalCollateral += creditedWad;
                    if (nativeCredit > 0) {
                        ILiquidityVault(liquidityVault).creditTraderMarginFromLP(position.trader, nativeCredit);
                    }
                    unpaidFundingDebt = 0;
                }
            }
        }
        position.lastFundingIndex = marketCumIndex;
    }

    // ============ SINGLE INTERNAL SETTLEMENT HELPER ============

    /**
     * @dev Core internal settlement function for position reduction / closure according to ECONOMIC_SPEC.md.
     * Performs funding settlement on pre-modification size, computes canonical proportional margin release,
     * realized PnL, closing fees, applies priority order (Trading Loss -> Protocol Fee -> Bad Debt),
     * applies state updates (CEI), and interacts atomically with LiquidityVault.
     */
    function _settlePositionChange(
        uint256 positionId,
        uint256 sizeReduced,
        uint256 requestedMarginReduced,
        uint256 currentPrice
    ) internal returns (SettlementResult memory res) {
        IPerpEngine.Position storage position = _positions[positionId];

        uint256 preTransactionMargin = position.margin;

        // 1. Settle pending funding on pre-decrease position size
        (int256 fundingPayment, uint256 unpaidFunding) = _settleFunding(position);

        // For non-terminal partial decrease, funding debt must not exceed position margin
        if (sizeReduced < position.size) {
            require(unpaidFunding == 0 && position.margin > 0, "PerpEngine: margin exhausted by funding");
        }

        res.preSize = position.size;
        res.postFundingPreChangeMargin = position.margin;
        res.sizeReduced = sizeReduced;
        res.unpaidFundingDebt = unpaidFunding;

        // Canonical proportional margin release per ECONOMIC_SPEC.md §5.2
        if (sizeReduced == position.size) {
            res.proportionalMarginReleased = position.margin;
        } else {
            uint256 rawRel = position.size > 0
                ? position.margin.mulDiv(sizeReduced, position.size)
                : 0;
            res.proportionalMarginReleased = _fromVaultUnits(_toVaultUnits(rawRel));
            if (requestedMarginReduced > 0) {
                require(
                    requestedMarginReduced == res.proportionalMarginReleased,
                    "PerpEngine: invalid margin reduction"
                );
            }
        }

        // 2. Realized PnL for reduced size portion (in quote WAD)
        res.realizedPnl = PositionMath.calculatePnL(
            position.entryPrice,
            currentPrice,
            sizeReduced,
            position.isLong
        );

        // 3. Protocol fee for reduced size portion (in quote WAD with Ceil rounding)
        Market storage market = _markets[position.marketId];
        uint256 reducedNotional = sizeReduced.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 nominalProtocolFee = Math.mulDiv(reducedNotional, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);

        // 4. Proportional LP locked liquidity released based on stored lockedNotional (Native-backed)
        uint256 rawUnlock = position.size > 0
            ? (position.lockedNotional * sizeReduced) / position.size
            : position.lockedNotional;
        uint256 nativeUnlock = sizeReduced == position.size
            ? _toVaultUnits(position.lockedNotional)
            : _toVaultUnits(rawUnlock);
        res.unlockedNotional = _fromVaultUnits(nativeUnlock);

        // 5. Canonical Signed Netting & Priority Order
        int256 netPnl = res.realizedPnl - int256(res.unpaidFundingDebt);

        if (netPnl >= 0) {
            uint256 netProfit = uint256(netPnl);
            uint256 grossEquity = res.proportionalMarginReleased + netProfit;

            uint256 nominalNative = _toVaultUnitsCeil(nominalProtocolFee);
            uint256 capacityNative = _toVaultUnits(grossEquity);
            uint256 nativeFee = nominalNative < capacityNative ? nominalNative : capacityNative;

            uint256 chargedFeeWad = _fromVaultUnits(nativeFee);
            res.protocolFee = chargedFeeWad;

            uint256 feeFromMargin = chargedFeeWad < res.proportionalMarginReleased
                ? chargedFeeWad
                : res.proportionalMarginReleased;
            uint256 feeFromProfit = chargedFeeWad - feeFromMargin;

            uint256 nativeMarginToReturn = _toVaultUnits(res.proportionalMarginReleased - feeFromMargin);
            uint256 effectiveMarginToReturn = _fromVaultUnits(nativeMarginToReturn);
            uint256 profitToPayout = netProfit - feeFromProfit;

            res.traderPayout = effectiveMarginToReturn + profitToPayout;
            res.totalTraderCollateralConsumed = res.proportionalMarginReleased;
            res.lossCoveredByCollateral = 0;
            res.residualBadDebt = 0;

            res.remainingPositionMargin = position.margin > res.proportionalMarginReleased
                ? position.margin - res.proportionalMarginReleased
                : 0;
            res.remainingPositionSize = position.size - sizeReduced;

            if (sizeReduced < position.size) {
                require(res.remainingPositionMargin > 0, "PerpEngine: remaining margin zero");
                uint256 remainingNotional = res.remainingPositionSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
                uint256 minMarginRequired = Math.mulDiv(remainingNotional, market.minMarginRatio, PRECISION, Math.Rounding.Up);
                require(res.remainingPositionMargin >= minMarginRequired, "PerpEngine: remaining margin too low");
            }

            // 6. CHECKS-EFFECTS
            position.size = res.remainingPositionSize;
            position.margin = res.remainingPositionMargin;
            if (position.lockedNotional >= res.unlockedNotional) {
                position.lockedNotional -= res.unlockedNotional;
            } else {
                position.lockedNotional = 0;
            }
            if (position.size == 0) {
                position.isActive = false;
            }
            position.lastUpdated = block.timestamp;

            totalCollateral -= res.totalTraderCollateralConsumed;
            totalPositionSize -= sizeReduced;

            IAMMPool(ammPool).updateSkew(position.marketId, position.isLong, -int256(sizeReduced));
            _totalOpenInterest[position.marketId] -= sizeReduced;

            // 7. INTERACTIONS
            ILiquidityVault(liquidityVault).unlockLiquidity(nativeUnlock);

            if (nativeFee > 0) {
                _protocolFees[address(quoteToken)] += chargedFeeWad;
                totalFeesAccrued += chargedFeeWad;
                if (feeFromProfit > 0) {
                    ILiquidityVault(liquidityVault).creditTraderMarginFromLP(position.trader, _toVaultUnits(feeFromProfit));
                }
                ILiquidityVault(liquidityVault).collectProtocolFees(nativeFee);
            }

            if (netProfit > 0) {
                (uint256 profitPaidVaultUnits, uint256 unbackedProfitVaultUnits) = ILiquidityVault(liquidityVault).settleTraderProfit(
                    position.trader,
                    nativeMarginToReturn,
                    _toVaultUnits(profitToPayout)
                );
                require(unbackedProfitVaultUnits == 0, "PerpEngine: unbacked profit");
                res.traderPayout = effectiveMarginToReturn + _fromVaultUnits(profitPaidVaultUnits);
            } else if (nativeMarginToReturn > 0) {
                ILiquidityVault(liquidityVault).withdrawTraderMargin(position.trader, nativeMarginToReturn);
            }
        } else {
            // netPnl < 0
            uint256 netDeficit = uint256(-netPnl);
            res.grossTradingDeficit = netDeficit;

            uint256 posMarginAvailable = position.margin;

            uint256 nominalNativeFee = _toVaultUnitsCeil(nominalProtocolFee);
            uint256 chargedFeeNominalWad = _fromVaultUnits(nominalNativeFee);

            uint256 nativeLossNominal = _toVaultUnitsCeil(netDeficit);
            uint256 chargedLossNominalWad = _fromVaultUnits(nativeLossNominal);

            if (res.proportionalMarginReleased >= chargedLossNominalWad + chargedFeeNominalWad) {
                // Case 1: Proportional released margin covers deficit + fee fully
                res.protocolFee = chargedFeeNominalWad;
                res.lossCoveredByCollateral = chargedLossNominalWad;

                uint256 nativeRel = _toVaultUnits(res.proportionalMarginReleased);
                uint256 nativePayout = nativeRel - nativeLossNominal - nominalNativeFee;
                uint256 effectivePayoutWad = _fromVaultUnits(nativePayout);

                res.traderPayout = effectivePayoutWad;
                res.totalTraderCollateralConsumed = res.proportionalMarginReleased;
                res.residualBadDebt = 0;

                if (nominalNativeFee > 0) {
                    _protocolFees[address(quoteToken)] += chargedFeeNominalWad;
                    totalFeesAccrued += chargedFeeNominalWad;
                    ILiquidityVault(liquidityVault).collectProtocolFees(nominalNativeFee);
                }
            } else {
                // Shortfall exceeds proportional released margin -> trader payout is 0, consume extra from retained collateral
                res.traderPayout = 0;

                uint256 nativeLossCap = _toVaultUnitsCeil(netDeficit);
                uint256 chargedLossWad = _fromVaultUnits(nativeLossCap);

                uint256 posMarginNative = _toVaultUnits(posMarginAvailable);
                uint256 posMarginWad = _fromVaultUnits(posMarginNative);

                if (chargedLossNominalWad <= posMarginWad) {
                    res.lossCoveredByCollateral = chargedLossNominalWad;
                    uint256 remainingCollateralAfterLoss = posMarginWad - chargedLossNominalWad;

                    uint256 capacityNative = _toVaultUnits(remainingCollateralAfterLoss);
                    uint256 nativeFee = nominalNativeFee < capacityNative ? nominalNativeFee : capacityNative;
                    uint256 chargedFeeWad = _fromVaultUnits(nativeFee);

                    res.protocolFee = chargedFeeWad;
                    res.totalTraderCollateralConsumed = res.lossCoveredByCollateral + res.protocolFee;
                    res.residualBadDebt = 0;

                    if (nativeFee > 0) {
                        _protocolFees[address(quoteToken)] += chargedFeeWad;
                        totalFeesAccrued += chargedFeeWad;
                        ILiquidityVault(liquidityVault).collectProtocolFees(nativeFee);
                    }
                } else {
                    res.lossCoveredByCollateral = posMarginWad;
                    res.protocolFee = 0;
                    res.totalTraderCollateralConsumed = posMarginWad;
                    res.residualBadDebt = netDeficit > posMarginWad ? netDeficit - posMarginWad : 0;
                }
            }

            res.remainingPositionMargin = position.margin > res.totalTraderCollateralConsumed
                ? position.margin - res.totalTraderCollateralConsumed
                : 0;
            res.remainingPositionSize = position.size - sizeReduced;

            if (sizeReduced < position.size) {
                require(res.remainingPositionMargin > 0, "PerpEngine: remaining margin zero");
                uint256 remainingNotional = res.remainingPositionSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
                uint256 minMarginRequired = Math.mulDiv(remainingNotional, market.minMarginRatio, PRECISION, Math.Rounding.Up);
                require(res.remainingPositionMargin >= minMarginRequired, "PerpEngine: remaining margin too low");
            }

            // 6. CHECKS-EFFECTS
            position.size = res.remainingPositionSize;
            position.margin = res.remainingPositionMargin;
            if (position.lockedNotional >= res.unlockedNotional) {
                position.lockedNotional -= res.unlockedNotional;
            } else {
                position.lockedNotional = 0;
            }
            if (position.size == 0) {
                position.isActive = false;
            }
            position.lastUpdated = block.timestamp;

            totalCollateral -= res.totalTraderCollateralConsumed;
            totalPositionSize -= sizeReduced;

            IAMMPool(ammPool).updateSkew(position.marketId, position.isLong, -int256(sizeReduced));
            _totalOpenInterest[position.marketId] -= sizeReduced;

            // 7. INTERACTIONS
            ILiquidityVault(liquidityVault).unlockLiquidity(_toVaultUnits(res.unlockedNotional));

            if (res.residualBadDebt == 0) {
                ILiquidityVault(liquidityVault).settleTraderLoss(
                    position.trader,
                    _toVaultUnits(res.traderPayout),
                    _toVaultUnits(res.lossCoveredByCollateral)
                );
            } else {
                ILiquidityVault(liquidityVault).settleBadDebt(
                    position.trader,
                    _toVaultUnits(res.lossCoveredByCollateral),
                    _toVaultUnitsCeil(netDeficit)
                );
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

        // 1. Derive native-backed gross margin deposit
        uint256 nativeMarginDeposit = _toVaultUnits(params.margin);
        uint256 effectiveGrossMarginWad = _fromVaultUnits(nativeMarginDeposit);

        // 2. Derive opening protocol fee using canonical ceil pipeline
        Market storage market = _markets[params.marketId];
        uint256 currentPriceNormalized = currentPrice * PRICE_NORMALIZATION;
        uint256 notionalValue = params.size.mulDiv(currentPriceNormalized, PRECISION);
        uint256 nominalFeeWad = Math.mulDiv(notionalValue, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);
        
        uint256 feeNative = 0;
        uint256 chargedFeeWad = 0;
        if (nominalFeeWad > 0) {
            feeNative = _toVaultUnitsCeil(nominalFeeWad);
            chargedFeeWad = _fromVaultUnits(feeNative);
        }

        require(effectiveGrossMarginWad >= chargedFeeWad, "PerpEngine: margin too low for fees");
        uint256 finalMarginWad = effectiveGrossMarginWad - chargedFeeWad;

        // 3. Calculate leverage and validate risk on actual final post-fee native-backed margin
        uint256 leverage = notionalValue.mulDiv(PRECISION, finalMarginWad);
        require(leverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        _validatePositionRisk(params.marketId, params.size, finalMarginWad, leverage, currentPrice);

        // 4. Derive native-backed LP locked liquidity
        uint256 nativeLocked = _toVaultUnits(notionalValue);
        uint256 effectiveLockedWad = _fromVaultUnits(nativeLocked);

        // 5. External transfers and fee collection
        ILiquidityVault(liquidityVault).lockLiquidity(nativeLocked);
        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, nativeMarginDeposit);

        if (feeNative > 0) {
            _protocolFees[address(quoteToken)] += chargedFeeWad;
            totalFeesAccrued += chargedFeeWad;
            ILiquidityVault(liquidityVault).collectProtocolFees(feeNative);
        }

        // 6. Accrue funding before opening
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
            margin: finalMarginWad,
            entryPrice: currentPrice,
            leverage: leverage,
            lastFundingIndex: marketCumIndex,
            openTime: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true,
            lockedNotional: effectiveLockedWad
        });
        
        // Update trader positions & open interest
        _traderPositions[msg.sender].push(positionId);
        _totalOpenInterest[params.marketId] += params.size;
        
        // Update global metrics
        totalCollateral += finalMarginWad;
        totalPositionSize += params.size;

        // Mint position NFT
        IPositionManager(positionManager).mint(msg.sender, positionId);
        
        emit PositionOpened(
            positionId,
            msg.sender,
            params.marketId,
            params.isLong,
            params.size,
            finalMarginWad,
            currentPrice,
            leverage,
            chargedFeeWad
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
        (, uint256 unpaidFunding) = _settleFunding(position);
        require(unpaidFunding == 0, "PerpEngine: unpaid funding debt");

        // 1. Derive native-backed margin added
        uint256 nativeMarginDeposit = _toVaultUnits(marginAdded);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeMarginDeposit);

        // 2. Derive increase protocol fee using canonical ceil pipeline
        Market storage market = _markets[position.marketId];
        uint256 addedNotional = sizeAdded.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 nominalFeeWad = Math.mulDiv(addedNotional, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);

        uint256 feeNative = 0;
        uint256 chargedFeeWad = 0;
        if (nominalFeeWad > 0) {
            feeNative = _toVaultUnitsCeil(nominalFeeWad);
            chargedFeeWad = _fromVaultUnits(feeNative);
        }

        uint256 grossNewMargin = position.margin + effectiveMarginAdded;
        require(grossNewMargin >= chargedFeeWad, "PerpEngine: margin too low for fees");
        uint256 finalNewMargin = grossNewMargin - chargedFeeWad;

        // 3. Calculate new leverage and validate risk on actual final post-fee native-backed margin
        uint256 newSize = position.size + sizeAdded;
        uint256 newNotionalValue = newSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        require(finalNewMargin > 0, "PerpEngine: margin too low");
        uint256 newLeverage = newNotionalValue.mulDiv(PRECISION, finalNewMargin);

        require(newLeverage <= MAX_LEVERAGE, "PerpEngine: leverage too high");
        _validatePositionRisk(position.marketId, newSize, finalNewMargin, newLeverage, currentPrice);

        // 4. Derive native-backed LP locked liquidity
        uint256 nativeAddedLocked = _toVaultUnits(addedNotional);
        uint256 effectiveAddedLockedWad = _fromVaultUnits(nativeAddedLocked);

        // 5. External transfers and fee collection
        ILiquidityVault(liquidityVault).lockLiquidity(nativeAddedLocked);
        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, nativeMarginDeposit);

        if (feeNative > 0) {
            _protocolFees[address(quoteToken)] += chargedFeeWad;
            totalFeesAccrued += chargedFeeWad;
            ILiquidityVault(liquidityVault).collectProtocolFees(feeNative);
        }

        // 6. Update AMM pool skew
        IAMMPool(ammPool).updateSkew(
            position.marketId,
            position.isLong,
            int256(sizeAdded)
        );
        
        // Update position
        uint256 oldSize = position.size;
        
        // Update global metrics
        totalCollateral = totalCollateral + effectiveMarginAdded - chargedFeeWad;
        totalPositionSize += sizeAdded;

        position.size = newSize;
        position.margin = finalNewMargin;
        position.leverage = newLeverage;
        position.lockedNotional += effectiveAddedLockedWad;
        position.entryPrice = _calculateNewEntryPrice(
            oldSize,
            position.entryPrice,
            sizeAdded,
            currentPrice
        );
        position.lastUpdated = block.timestamp;
        
        // Update total open interest
        _totalOpenInterest[position.marketId] += sizeAdded;
        
        emit PositionIncreased(
            positionId,
            sizeAdded,
            effectiveMarginAdded,
            position.entryPrice,
            chargedFeeWad
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
        
        uint256 preTransactionMargin = position.margin;

        // Perform atomic settlement via internal settlement helper
        SettlementResult memory res = _settlePositionChange(positionId, sizeReduced, marginReduced, currentPrice);
        
        res.collateralDelta = _signedMarginDelta(preTransactionMargin, position.margin);

        emit PositionDecreased(
            positionId,
            sizeReduced,
            res.totalTraderCollateralConsumed,
            res.collateralDelta,
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
        uint256 vaultTotalDef = _toVaultUnitsCeil(totalDeficit);

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
        (, uint256 unpaidFunding) = _settleFunding(position);
        require(unpaidFunding == 0, "PerpEngine: unpaid funding debt");

        uint256 nativeDeposit = _toVaultUnits(amount);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeDeposit);

        ILiquidityVault(liquidityVault).depositTraderMargin(msg.sender, nativeDeposit);
        
        position.margin += effectiveMarginAdded;
        totalCollateral += effectiveMarginAdded;
        
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
        (, uint256 unpaidFunding) = _settleFunding(position);
        require(unpaidFunding == 0, "PerpEngine: unpaid funding debt");

        uint256 nativePayout = _toVaultUnits(amount);
        uint256 effectivePayoutWad = _fromVaultUnits(nativePayout);

        require(effectivePayoutWad <= position.margin, "PerpEngine: insufficient margin");

        uint256 newMargin = position.margin - effectivePayoutWad;
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
        totalCollateral -= effectivePayoutWad;
        
        uint256 notionalValue = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        position.leverage = notionalValue.mulDiv(PRECISION, position.margin);
        
        position.lastUpdated = block.timestamp;
        
        if (nativePayout > 0) {
            ILiquidityVault(liquidityVault).withdrawTraderMargin(msg.sender, nativePayout);
        }
    }

    // ============ BALANCE SHEET & MONITORING VIEWS ============

    /**
     * @notice Balance sheet view for real-time risk monitoring
     * @dev All quote-denominated values are normalized to WAD Quote (1e18 decimals).
     *      totalOpenInterestBase is in WAD Base asset units (1e18 decimals).
     */
    function getBalanceSheet() external view returns (BalanceSheet memory bs) {
        bs.totalTraderCollateral = totalCollateral; // Quote WAD 1e18
        bs.totalLpAssets = _fromVaultUnits(ILiquidityVault(liquidityVault).totalLpAssets()); // Quote WAD 1e18
        bs.lockedLiquidity = _fromVaultUnits(ILiquidityVault(liquidityVault).lockedLiquidity()); // Quote WAD 1e18
        bs.availableLiquidity = _fromVaultUnits(ILiquidityVault(liquidityVault).availableLiquidity()); // Quote WAD 1e18
        bs.insuranceFundBalance = _fromVaultUnits(ILiquidityVault(liquidityVault).insuranceFundBalance()); // Quote WAD 1e18
        bs.protocolFeeBalance = _fromVaultUnits(ILiquidityVault(liquidityVault).protocolFeeBalance()); // Quote WAD 1e18
        bs.totalOpenInterestBase = totalPositionSize; // Base WAD 1e18
        bs.vaultQuoteBalance = _fromVaultUnits(quoteToken.balanceOf(liquidityVault)); // Quote WAD 1e18
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
        uint256 minMarginRequired = Math.mulDiv(notionalValue, market.minMarginRatio, PRECISION, Math.Rounding.Up);
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
        uint256 nominalFeeWad = Math.mulDiv(notionalValue, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);

        if (nominalFeeWad > 0) {
            uint256 feeNative = _toVaultUnitsCeil(nominalFeeWad);
            uint256 chargedFeeWad = _fromVaultUnits(feeNative);

            require(position.margin >= chargedFeeWad, "PerpEngine: margin too low for fees");
            position.margin -= chargedFeeWad;
            totalCollateral -= chargedFeeWad;

            _protocolFees[address(quoteToken)] += chargedFeeWad;
            totalFeesAccrued += chargedFeeWad;

            ILiquidityVault(liquidityVault).collectProtocolFees(feeNative);
            protocolFee = chargedFeeWad;
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
        uint256 totalAllocated = _nextPositionId - 1;

        // First pass: count total positions matching marketId
        uint256 matchingCount = 0;
        for (uint256 i = 1; i <= totalAllocated; i++) {
            if (_positions[i].marketId == marketId) {
                matchingCount++;
            }
        }

        if (cursor >= matchingCount || limit == 0) {
            return (new PositionView[](0), matchingCount);
        }

        uint256 end = cursor + limit;
        if (end > matchingCount) {
            end = matchingCount;
        }
        uint256 count = end - cursor;

        positions = new PositionView[](count);

        // Second pass: fill page results for matching index in range [cursor, end)
        uint256 currentMatchIndex = 0;
        uint256 resultIndex = 0;

        for (uint256 i = 1; i <= totalAllocated && resultIndex < count; i++) {
            if (_positions[i].marketId == marketId) {
                if (currentMatchIndex >= cursor && currentMatchIndex < end) {
                    positions[resultIndex] = getPosition(i);
                    resultIndex++;
                }
                currentMatchIndex++;
            }
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

        uint256 maintenanceNotional = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 maintenanceMargin = Math.mulDiv(maintenanceNotional, _markets[position.marketId].minMarginRatio, PRECISION, Math.Rounding.Up);
            
        if (uint256(equity) <= maintenanceMargin) return 0;
        
        return uint256(equity) - maintenanceMargin;
    }

    /**
     * @dev Previews post-funding position margin and unpaid funding debt without state mutation
     */
    function _previewPostFundingMargin(
        IPerpEngine.Position storage position
    ) internal view returns (uint256 postFundingMargin, uint256 unpaidFundingDebt) {
        postFundingMargin = position.margin;
        if (position.size == 0) return (postFundingMargin, 0);

        (int256 previewCumIndex, ) = IAMMPool(ammPool).previewCumulativeFundingIndex(position.marketId);
        if (position.lastFundingIndex == previewCumIndex) return (postFundingMargin, 0);

        int256 fundingPayment = FundingRateCalculator.calculateFundingPayment(
            position.size,
            position.lastFundingIndex,
            previewCumIndex,
            position.isLong
        );

        if (fundingPayment == 0) return (postFundingMargin, 0);

        if (fundingPayment > 0) {
            uint256 debtWad = uint256(fundingPayment);
            uint256 nativeDebt = _toVaultUnitsCeil(debtWad);
            uint256 chargedDebtWad = _fromVaultUnits(nativeDebt);

            if (postFundingMargin >= chargedDebtWad) {
                postFundingMargin -= chargedDebtWad;
                unpaidFundingDebt = 0;
            } else {
                uint256 nativeMarginAvailable = _toVaultUnits(postFundingMargin);
                uint256 marginForfeitedWad = _fromVaultUnits(nativeMarginAvailable);

                unpaidFundingDebt = debtWad > marginForfeitedWad ? debtWad - marginForfeitedWad : 0;
                postFundingMargin -= marginForfeitedWad;
            }
        } else {
            uint256 creditWad = uint256(-fundingPayment);
            uint256 nativeCredit = _toVaultUnits(creditWad);
            uint256 creditedWad = _fromVaultUnits(nativeCredit);

            postFundingMargin += creditedWad;
            unpaidFundingDebt = 0;
        }
    }

    /**
     * @dev Internal helper to test if increasePosition(positionId, candidateSize, additionalMargin) is executable
     */
    function _canIncreasePosition(
        IPerpEngine.Position storage position,
        uint256 candidateSize,
        uint256 additionalMargin,
        uint256 currentPrice,
        uint256 previewPostFundingMargin
    ) internal view returns (bool) {
        if (candidateSize == 0) return true;

        Market storage market = _markets[position.marketId];

        // 1. Derive effective native-backed additional margin
        uint256 nativeMarginDeposit = _toVaultUnits(additionalMargin);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeMarginDeposit);

        // 2. Derive increase protocol fee
        uint256 addedNotional = candidateSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 nominalFeeWad = Math.mulDiv(addedNotional, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);

        uint256 chargedFeeWad = 0;
        if (nominalFeeWad > 0) {
            chargedFeeWad = _fromVaultUnits(_toVaultUnitsCeil(nominalFeeWad));
        }

        uint256 grossNewMargin = previewPostFundingMargin + effectiveMarginAdded;
        if (grossNewMargin < chargedFeeWad) return false;
        uint256 finalNewMargin = grossNewMargin - chargedFeeWad;
        if (finalNewMargin == 0) return false;

        // 3. Leverage and minimum margin checks
        uint256 newSize = position.size + candidateSize;
        uint256 newNotionalValue = newSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 newLeverage = newNotionalValue.mulDiv(PRECISION, finalNewMargin);

        uint256 effectiveMaxLeverage = market.maxLeverage < MAX_LEVERAGE ? market.maxLeverage : MAX_LEVERAGE;
        if (newLeverage > effectiveMaxLeverage) return false;

        uint256 minMarginRequired = Math.mulDiv(newNotionalValue, market.minMarginRatio, PRECISION, Math.Rounding.Up);
        if (finalNewMargin < minMarginRequired) return false;

        // 4. External RiskManager check
        (bool riskOk, ) = IRiskManager(riskManager).validatePosition(
            position.marketId,
            newSize,
            finalNewMargin,
            newLeverage
        );
        return riskOk;
    }

    function getMaxAdditionalSize(uint256 positionId, uint256 additionalMargin) external view override returns (uint256 maxAdditionalSize) {
        IPerpEngine.Position storage position = _positions[positionId];
        if (!position.isActive) return 0;

        (uint256 currentPrice, bool priceValid) = _getMarketPrice(position.marketId);
        if (!priceValid) return 0;

        // Derive preview post-funding margin
        (uint256 previewMargin, uint256 unpaidFundingDebt) = _previewPostFundingMargin(position);
        if (unpaidFundingDebt > 0) return 0;

        // Effective max leverage cap
        Market storage market = _markets[position.marketId];
        uint256 effectiveMaxLeverage = market.maxLeverage < MAX_LEVERAGE ? market.maxLeverage : MAX_LEVERAGE;

        uint256 nativeMarginDeposit = _toVaultUnits(additionalMargin);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeMarginDeposit);

        uint256 grossNewMargin = previewMargin + effectiveMarginAdded;
        uint256 theoreticalMaxNotional = grossNewMargin.mulDiv(effectiveMaxLeverage, PRECISION);
        uint256 currentNotional = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);

        if (theoreticalMaxNotional <= currentNotional) return 0;

        uint256 maxAdditionalNotional = theoreticalMaxNotional - currentNotional;
        uint256 upperBoundSize = maxAdditionalNotional.mulDiv(PRECISION, currentPrice * PRICE_NORMALIZATION);

        if (upperBoundSize == 0) return 0;

        // Deterministic binary search over size range [0, upperBoundSize] to find max size that passes _canIncreasePosition
        uint256 low = 0;
        uint256 high = upperBoundSize;
        uint256 best = 0;

        while (low <= high) {
            uint256 mid = low + (high - low) / 2;
            if (_canIncreasePosition(position, mid, additionalMargin, currentPrice, previewMargin)) {
                best = mid;
                low = mid + 1;
            } else {
                if (mid == 0) break;
                high = mid - 1;
            }
        }

        return best;
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