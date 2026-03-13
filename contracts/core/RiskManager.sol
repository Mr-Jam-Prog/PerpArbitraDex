// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";

/**
 * @title RiskManager
 * @notice Centralized risk management for the perpetual DEX
 * @dev Pure risk calculations without position state
 */
contract RiskManager is IRiskManager, Ownable {
    using SafeDecimalMath for uint256;

    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_LEVERAGE = 100 * PRECISION; // 100x
    uint256 private constant MIN_MARGIN_RATIO = PRECISION / 100; // 1%
    uint256 private constant LIQUIDATION_THRESHOLD = PRECISION; // 100%
    uint256 private constant MAX_POSITION_CONCENTRATION = PRECISION / 10; // 10%

    // ============ IMMUTABLES ============
    
    address public immutable marketRegistry;
    address public immutable perpEngine;
    address public immutable configRegistry;

    // ============ STATE VARIABLES ============
    
    // Market ID => Risk parameters
    mapping(uint256 => IRiskManager.RiskParams) private _riskParams;
    
    // Global risk parameters
    IRiskManager.GlobalRiskParams private _globalParams;
    
    // Circuit breaker state
    mapping(uint256 => CircuitBreaker) private _circuitBreakers;

    // ============ STRUCTS ============
    
    struct CircuitBreaker {
        bool triggered;
        uint256 triggerTime;
        uint256 triggerPrice;
        uint256 cooldownUntil;
    }

    // ============ MODIFIERS ============
    
    modifier onlyGovernance() {
        require(msg.sender == owner() || msg.sender == configRegistry, 
            "RiskManager: only governance");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(
        address marketRegistry_,
        address perpEngine_,
        address configRegistry_
    ) {
        require(marketRegistry_ != address(0), "RiskManager: zero address");
        require(perpEngine_ != address(0), "RiskManager: zero address");
        require(configRegistry_ != address(0), "RiskManager: zero address");
        
        marketRegistry = marketRegistry_;
        perpEngine = perpEngine_;
        configRegistry = configRegistry_;
        
        // Initialize global parameters
        _globalParams = IRiskManager.GlobalRiskParams({
            maxLeverage: 50 * PRECISION, // 50x default
            minMarginRatio: PRECISION / 50, // 2%
            liquidationThreshold: PRECISION, // 100%
            liquidationFeeRatio: PRECISION / 100, // 1%
            protocolFeeRatio: PRECISION / 1000, // 0.1%
            maxPositionConcentration: PRECISION / 20, // 5%
            volatilityThreshold: PRECISION / 10, // 10%
            circuitBreakerThreshold: PRECISION / 5, // 20%
            recoveryPeriod: 1 hours
        });
    }

    // ============ RISK VALIDATION ============

    /**
     * @inheritdoc IRiskManager
     */
    function validatePosition(
        uint256 marketId,
        uint256 size,
        uint256 margin,
        uint256 leverage
    ) external view override returns (bool valid, string memory reason) {
        // Basic parameter validation
        if (size == 0) {
            return (false, "RiskManager: zero size");
        }
        if (margin == 0) {
            return (false, "RiskManager: zero margin");
        }
        
        // Check leverage against global max
        if (leverage > _globalParams.maxLeverage) {
            return (false, "RiskManager: exceeds max leverage");
        }
        
        // Check leverage against market-specific max
        IRiskManager.RiskParams storage params = _riskParams[marketId];
        uint256 marketMaxLeverage = params.maxLeverage > 0 ? params.maxLeverage : _globalParams.maxLeverage;
        if (leverage > marketMaxLeverage) {
            return (false, "RiskManager: exceeds market max leverage");
        }
        
        // Check minimum margin ratio
        uint256 requiredMargin = size.mulDiv(_globalParams.minMarginRatio, PRECISION);
        if (margin < requiredMargin) {
            return (false, "RiskManager: insufficient margin");
        }
        
        // Check position concentration
        (bool concentrationOk, string memory concentrationReason) = _checkPositionConcentration(
            marketId,
            size,
            msg.sender
        );
        if (!concentrationOk) {
            return (false, concentrationReason);
        }
        
        // Check circuit breaker
        if (_circuitBreakers[marketId].triggered) {
            if (block.timestamp < _circuitBreakers[marketId].cooldownUntil) {
                return (false, "RiskManager: circuit breaker active");
            }
        }
        
        // All checks passed
        return (true, "");
    }

    /**
     * @inheritdoc IRiskManager
     */
    function validateLiquidation(
        uint256 positionId,
        uint256 healthFactor,
        uint256 currentPrice
    ) external view override returns (bool valid, string memory reason) {
        // Basic validation
        if (healthFactor > _globalParams.liquidationThreshold) {
            return (false, "RiskManager: above liquidation threshold");
        }
        
        // Get position details (would need to be passed or fetched)
        // For simplicity, we assume healthFactor is calculated correctly
        
        // Check circuit breaker
        // Market ID would need to be passed or derived
        
        return (true, "");
    }

    // ============ RISK CALCULATIONS ============

    /**
     * @inheritdoc IRiskManager
     */
    function calculateRequiredMargin(
        uint256 marketId,
        uint256 size,
        uint256 leverage
    ) external view override returns (uint256 requiredMargin) {
        require(leverage > 0, "RiskManager: zero leverage");
        
        // Base calculation: margin = size / leverage
        requiredMargin = size.mulDiv(PRECISION, leverage);
        
        // Apply minimum margin ratio
        uint256 minMargin = size.mulDiv(_globalParams.minMarginRatio, PRECISION);
        if (requiredMargin < minMargin) {
            requiredMargin = minMargin;
        }
        
        // Apply market-specific minimum if exists
        IRiskManager.RiskParams storage params = _riskParams[marketId];
        if (params.minMarginRatio > 0) {
            uint256 marketMinMargin = size.mulDiv(params.minMarginRatio, PRECISION);
            if (requiredMargin < marketMinMargin) {
                requiredMargin = marketMinMargin;
            }
        }
    }

    /**
     * @inheritdoc IRiskManager
     */
    function calculateMaxPositionSize(
        uint256 marketId,
        uint256 availableMargin
    ) external view override returns (uint256 maxSize) {
        // Using global max leverage
        maxSize = availableMargin.mulDiv(_globalParams.maxLeverage, PRECISION);
        
        // Apply market-specific max leverage if exists
        IRiskManager.RiskParams storage params = _riskParams[marketId];
        if (params.maxLeverage > 0 && params.maxLeverage < _globalParams.maxLeverage) {
            maxSize = availableMargin.mulDiv(params.maxLeverage, PRECISION);
        }
        
        // Apply position concentration limits
        uint256 concentrationLimit = _getConcentrationLimit(marketId);
        if (maxSize > concentrationLimit) {
            maxSize = concentrationLimit;
        }
    }

    /**
     * @inheritdoc IRiskManager
     */
    function calculateLiquidationPrice(
        uint256 marketId,
        uint256 size,
        uint256 margin,
        bool isLong,
        int256 fundingPayment
    ) external view override returns (uint256 liquidationPrice) {
        // This would call PositionMath library
        // Simplified implementation
        uint256 maintenanceMargin = size.mulDiv(_globalParams.minMarginRatio, PRECISION);
        
        if (isLong) {
            // For long: price where (margin + PnL + funding) = maintenanceMargin
            // liquidationPrice = entryPrice * (1 - (margin - maintenanceMargin - funding)/size)
        } else {
            // For short: price where (margin + PnL + funding) = maintenanceMargin
            // liquidationPrice = entryPrice * (1 + (margin - maintenanceMargin - funding)/size)
        }
        
        // Return a placeholder
        liquidationPrice = 0;
    }

    // ============ CIRCUIT BREAKER ============

    /**
     * @inheritdoc IRiskManager
     */
    function checkCircuitBreaker(
        uint256 marketId,
        uint256 currentPrice,
        uint256 previousPrice,
        uint256 timeElapsed
    ) external override returns (bool shouldTrigger) {
        CircuitBreaker storage breaker = _circuitBreakers[marketId];
        
        // Skip if already triggered and in cooldown
        if (breaker.triggered && block.timestamp < breaker.cooldownUntil) {
            return false;
        }
        
        // Calculate price change percentage
        uint256 priceChange;
        if (currentPrice > previousPrice) {
            priceChange = (currentPrice - previousPrice).mulDiv(PRECISION, previousPrice);
        } else {
            priceChange = (previousPrice - currentPrice).mulDiv(PRECISION, previousPrice);
        }
        
        // Check against threshold
        if (priceChange > _globalParams.circuitBreakerThreshold) {
            breaker.triggered = true;
            breaker.triggerTime = block.timestamp;
            breaker.triggerPrice = currentPrice;
            breaker.cooldownUntil = block.timestamp + _globalParams.recoveryPeriod;
            
            emit CircuitBreakerTriggered(marketId, currentPrice, priceChange);
            return true;
        }
        
        // Reset if cooldown passed
        if (breaker.triggered && block.timestamp >= breaker.cooldownUntil) {
            breaker.triggered = false;
            emit CircuitBreakerReset(marketId);
        }
        
        return false;
    }

    /**
     * @inheritdoc IRiskManager
     */
    function getCircuitBreakerStatus(uint256 marketId)
        external
        view
        override
        returns (
            bool triggered,
            uint256 triggerTime,
            uint256 triggerPrice,
            uint256 cooldownUntil
        )
    {
        CircuitBreaker storage breaker = _circuitBreakers[marketId];
        return (
            breaker.triggered,
            breaker.triggerTime,
            breaker.triggerPrice,
            breaker.cooldownUntil
        );
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @inheritdoc IRiskManager
     */
    function setGlobalRiskParams(IRiskManager.GlobalRiskParams calldata newParams)
        external
        override
        onlyGovernance
    {
        // Validate parameters
        require(newParams.maxLeverage <= MAX_LEVERAGE, "RiskManager: leverage too high");
        require(newParams.minMarginRatio >= MIN_MARGIN_RATIO, "RiskManager: margin too low");
        require(newParams.liquidationThreshold >= PRECISION, "RiskManager: threshold too low");
        require(newParams.maxPositionConcentration <= MAX_POSITION_CONCENTRATION, 
            "RiskManager: concentration too high");
        
        // Save old params for event
        IRiskManager.GlobalRiskParams memory oldParams = _globalParams;
        
        // Update
        _globalParams = newParams;
        
        emit GlobalRiskParamsUpdated(oldParams, newParams);
    }

    /**
     * @inheritdoc IRiskManager
     */
    function setMarketRiskParams(uint256 marketId, IRiskManager.RiskParams calldata newParams)
        external
        override
        onlyGovernance
    {
        // Validate against global limits
        if (newParams.maxLeverage > 0) {
            require(newParams.maxLeverage <= _globalParams.maxLeverage, 
                "RiskManager: exceeds global max");
        }
        
        if (newParams.minMarginRatio > 0) {
            require(newParams.minMarginRatio >= _globalParams.minMarginRatio,
                "RiskManager: below global min");
        }
        
        // Save old params for event
        IRiskManager.RiskParams memory oldParams = _riskParams[marketId];
        
        // Update
        _riskParams[marketId] = newParams;
        
        emit MarketRiskParamsUpdated(marketId, oldParams, newParams);
    }

    /**
     * @inheritdoc IRiskManager
     */
    function emergencyResetCircuitBreaker(uint256 marketId) external override onlyGovernance {
        CircuitBreaker storage breaker = _circuitBreakers[marketId];
        breaker.triggered = false;
        breaker.cooldownUntil = 0;
        
        emit CircuitBreakerReset(marketId);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Check position concentration limits
     */
    function _checkPositionConcentration(
        uint256 marketId,
        uint256 positionSize,
        address /* trader */
    ) internal view returns (bool ok, string memory reason) {
        // Get total open interest for market
        uint256 totalOI = IPerpEngine(perpEngine).getTotalOpenInterest(marketId);
        
        if (totalOI > 0) {
            uint256 concentration = positionSize.mulDiv(PRECISION, totalOI);
            if (concentration > _globalParams.maxPositionConcentration) {
                return (false, "RiskManager: exceeds concentration limit");
            }
        }
        
        return (true, "");
    }

    /**
     * @dev Calculate concentration limit for a trader in a market
     */
    function _getConcentrationLimit(uint256 marketId) internal view returns (uint256 limit) {
        // Get total open interest
        uint256 totalOI = 0; // Placeholder from PerpEngine
        
        if (totalOI > 0) {
            limit = totalOI.mulDiv(_globalParams.maxPositionConcentration, PRECISION);
        } else {
            // No OI yet, use a default limit
            limit = 1000000 * PRECISION; // $1M default
        }
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get global risk parameters
     */
    function getGlobalRiskParams() external view returns (IRiskManager.GlobalRiskParams memory) {
        return _globalParams;
    }

    /**
     * @notice Get market risk parameters
     */
    function getMarketRiskParams(uint256 marketId) external view returns (IRiskManager.RiskParams memory) {
        return _riskParams[marketId];
    }

    /**
     * @notice Get effective risk parameters for a market
     */
    function getEffectiveRiskParams(uint256 marketId) external view returns (IRiskManager.EffectiveRiskParams memory) {
        IRiskManager.RiskParams storage marketParams = _riskParams[marketId];
        
        return IRiskManager.EffectiveRiskParams({
            maxLeverage: marketParams.maxLeverage > 0 ? marketParams.maxLeverage : _globalParams.maxLeverage,
            minMarginRatio: marketParams.minMarginRatio > 0 ? marketParams.minMarginRatio : _globalParams.minMarginRatio,
            liquidationFeeRatio: marketParams.liquidationFeeRatio > 0 ? marketParams.liquidationFeeRatio : _globalParams.liquidationFeeRatio,
            protocolFeeRatio: marketParams.protocolFeeRatio > 0 ? marketParams.protocolFeeRatio : _globalParams.protocolFeeRatio
        });
    }
}
