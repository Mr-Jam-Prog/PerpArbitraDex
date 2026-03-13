// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAMMPool} from "../interfaces/IAMMPool.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";

import {FundingRateCalculator} from "../libraries/FundingRateCalculator.sol";
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";
import {L2GasOptimized} from "../libraries/L2GasOptimized.sol";

/**
 * @title AMMPool
 * @notice Virtual AMM pool for funding rate calculation and skew management
 * @dev No real swaps, only tracks open interest and calculates funding
 */
contract AMMPool is IAMMPool, ERC20, Ownable {
    using SafeDecimalMath for uint256;
    using L2GasOptimized for uint256[];
    using FundingRateCalculator for FundingRateCalculator.FundingState;

    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_SKEW_SCALE = 1_000_000 * PRECISION; // $1M
    uint256 private constant MIN_SKEW_SCALE = 10_000 * PRECISION; // $10k
    uint256 private constant MAX_FUNDING_RATE = PRECISION / 100; // 1% per interval
    uint256 private constant FUNDING_INTERVAL = 1 hours;

    // ============ IMMUTABLES ============
    
    address public immutable perpEngine;
    address public immutable oracleAggregator;

    // ============ STATE VARIABLES ============
    
    // Market ID => MarketSkew
    mapping(uint256 => MarketSkew) private _marketSkews;
    
    // Market ID => FundingState
    mapping(uint256 => FundingRateCalculator.FundingState) private _fundingStates;
    
    // Market ID => configuration
    mapping(uint256 => IAMMPool.MarketConfig) private _marketConfigs;

    // ============ STRUCTS ============

    // ============ MODIFIERS ============
    
    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "AMMPool: only PerpEngine");
        _;
    }
    
    modifier marketExists(uint256 marketId) {
        require(_marketConfigs[marketId].isActive, "AMMPool: market inactive");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(address perpEngine_, address oracleAggregator_) ERC20("PerpDEX LP", "PLP") {
        _transferOwnership(msg.sender);
        require(perpEngine_ != address(0), "AMMPool: zero address");
        require(oracleAggregator_ != address(0), "AMMPool: zero address");
        
        perpEngine = perpEngine_;
        oracleAggregator = oracleAggregator_;
    }

    // ============ SKEW MANAGEMENT ============

    /**
     * @inheritdoc IAMMPool
     */
    function updateSkew(
        uint256 marketId,
        bool isLong,
        int256 sizeChange
    ) external override onlyPerpEngine marketExists(marketId) {
        MarketSkew storage skew = _marketSkews[marketId];
        
        if (isLong) {
            if (sizeChange > 0) {
                skew.longOpenInterest += uint256(sizeChange);
            } else {
                skew.longOpenInterest -= uint256(-sizeChange);
            }
        } else {
            if (sizeChange > 0) {
                skew.shortOpenInterest += uint256(sizeChange);
            } else {
                skew.shortOpenInterest -= uint256(-sizeChange);
            }
        }
        
        // Update net skew
        skew.netSkew = int256(skew.longOpenInterest) - int256(skew.shortOpenInterest);
        skew.totalOpenInterest = skew.longOpenInterest + skew.shortOpenInterest;
        
        // Update skew scale if needed (dynamic adjustment)
        _updateSkewScale(marketId, skew);
        
        emit SkewUpdated(
            marketId,
            skew.netSkew,
            skew.longOpenInterest,
            skew.shortOpenInterest
        );
    }

    // ============ FUNDING RATE CALCULATION ============

    /**
     * @inheritdoc IAMMPool
     */
    function updateFundingRate(uint256 marketId)
        external
        override
        onlyPerpEngine
        marketExists(marketId)
        returns (int256 fundingRate)
    {
        IAMMPool.MarketConfig storage config = _marketConfigs[marketId];
        MarketSkew storage skew = _marketSkews[marketId];
        FundingRateCalculator.FundingState storage state = _fundingStates[marketId];
        
        // Calculate time elapsed since last funding update
        uint256 timeElapsed = block.timestamp - state.lastFundingTime;
        if (timeElapsed < config.fundingInterval) {
            return state.currentFundingRate;
        }
        
        // Calculate new funding rate based on skew
        fundingRate = FundingRateCalculator.calculateFundingRate(
            skew.longOpenInterest,
            skew.shortOpenInterest,
            config.skewScale,
            timeElapsed
        );
        
        // Clamp to max funding rate
        if (fundingRate > int256(config.maxFundingRate)) {
            fundingRate = int256(config.maxFundingRate);
        } else if (fundingRate < -int256(config.maxFundingRate)) {
            fundingRate = -int256(config.maxFundingRate);
        }
        
        // Update funding state
        _fundingStates[marketId] = FundingRateCalculator.updateFundingState(
            state,
            fundingRate,
            block.timestamp
        );
        
        emit FundingUpdated(
            marketId,
            fundingRate,
            block.timestamp,
            state.fundingAccumulatedLong,
            state.fundingAccumulatedShort
        );
    }

    /**
     * @inheritdoc IAMMPool
     */
    function applyFunding(
        uint256 marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastFundingAccrued
    ) external override onlyPerpEngine returns (int256 fundingPayment) {
        FundingRateCalculator.FundingState storage state = _fundingStates[marketId];
        
        fundingPayment = FundingRateCalculator.calculateFundingPayment(
            positionSize,
            state.currentFundingRate,
            block.timestamp - lastFundingAccrued,
            isLong
        );
        
        // Update accumulated funding
        if (fundingPayment > 0) {
            if (isLong) {
                state.fundingAccumulatedLong += uint256(fundingPayment);
            } else {
                state.fundingAccumulatedShort += uint256(fundingPayment);
            }
        } else {
            uint256 paymentAbs = uint256(-fundingPayment);
            if (isLong) {
                state.fundingAccumulatedLong += paymentAbs;
            } else {
                state.fundingAccumulatedShort += paymentAbs;
            }
        }
    }

    // ============ MARK PRICE CALCULATION ============

    /**
     * @inheritdoc IAMMPool
     */
    function getMarkPrice(uint256 marketId, uint256 indexPrice)
        external
        view
        override
        marketExists(marketId)
        returns (uint256 markPrice)
    {
        FundingRateCalculator.FundingState storage state = _fundingStates[marketId];
        IAMMPool.MarketConfig storage config = _marketConfigs[marketId];
        
        // Calculate time to next funding
        uint256 timeToNextFunding = config.fundingInterval - 
            (block.timestamp - state.lastFundingTime) % config.fundingInterval;
        
        // Mark price = indexPrice * (1 + fundingRate * timeToNextFunding)
        markPrice = FundingRateCalculator.calculateMarkPrice(
            indexPrice,
            state.currentFundingRate,
            timeToNextFunding
        );
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get total liquidity in the pool
     */
    function totalLiquidity() public view returns (uint256) {
        return totalSupply(); // Simplified
    }

    /**
     * @notice Get LP balance
     */
    function getLpBalance(address lp) public view returns (uint256) {
        return balanceOf(lp); // Simplified
    }

    /**
     * @inheritdoc IAMMPool
     */
    function getFundingRate(uint256 marketId)
        external
        view
        override
        marketExists(marketId)
        returns (int256 fundingRate)
    {
        return _fundingStates[marketId].currentFundingRate;
    }

    /**
     * @inheritdoc IAMMPool
     */
    function getMarketSkew(uint256 marketId)
        external
        view
        override
        marketExists(marketId)
        returns (
            uint256 longOI,
            uint256 shortOI,
            int256 netSkew
        )
    {
        MarketSkew storage skew = _marketSkews[marketId];
        return (skew.longOpenInterest, skew.shortOpenInterest, skew.netSkew);
    }

    /**
     * @inheritdoc IAMMPool
     */
    function calculateFundingPayment(
        uint256 marketId,
        uint256 positionSize,
        bool isLong,
        uint256 lastFundingAccrued
    ) external view override returns (int256 fundingPayment) {
        FundingRateCalculator.FundingState storage state = _fundingStates[marketId];
        
        return FundingRateCalculator.calculateFundingPayment(
            positionSize,
            state.currentFundingRate,
            block.timestamp - lastFundingAccrued,
            isLong
        );
    }

    /**
     * @inheritdoc IAMMPool
     */
    function getTWAFundingRate(uint256 marketId, uint256 period)
        external
        view
        override
        returns (int256 avgFundingRate)
    {
        // Simplified implementation - in production would use oracle history
        return _fundingStates[marketId].currentFundingRate;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @inheritdoc IAMMPool
     */
    function updateSkewScale(uint256 marketId, uint256 newSkewScale) 
        external 
        override 
        onlyPerpEngine 
    {
        require(newSkewScale >= MIN_SKEW_SCALE, "AMMPool: skew scale too low");
        require(newSkewScale <= MAX_SKEW_SCALE, "AMMPool: skew scale too high");
        
        _marketConfigs[marketId].skewScale = newSkewScale;
        
        emit MarketParametersUpdated(marketId, newSkewScale, _marketConfigs[marketId].maxFundingRate);
    }

    /**
     * @inheritdoc IAMMPool
     */
    function updateMaxFundingRate(uint256 marketId, uint256 newMaxFundingRate) 
        external 
        override 
        onlyPerpEngine 
    {
        require(newMaxFundingRate <= MAX_FUNDING_RATE, "AMMPool: funding rate too high");
        require(newMaxFundingRate > 0, "AMMPool: zero funding rate");
        
        _marketConfigs[marketId].maxFundingRate = newMaxFundingRate;
        
        emit MarketParametersUpdated(marketId, _marketConfigs[marketId].skewScale, newMaxFundingRate);
    }

    /**
     * @inheritdoc IAMMPool
     */
    function emergencyResetSkew(uint256 marketId) external override onlyPerpEngine {
        MarketSkew storage skew = _marketSkews[marketId];
        
        // Only reset if skew is extremely unbalanced (10:1 ratio)
        if (skew.longOpenInterest > skew.shortOpenInterest * 10 || 
            skew.shortOpenInterest > skew.longOpenInterest * 10) {
            
            uint256 avgOI = (skew.longOpenInterest + skew.shortOpenInterest) / 2;
            skew.longOpenInterest = avgOI;
            skew.shortOpenInterest = avgOI;
            skew.netSkew = 0;
            skew.totalOpenInterest = avgOI * 2;
            
            emit SkewUpdated(marketId, 0, avgOI, avgOI);
        }
    }

    // ============ MARKET MANAGEMENT ============

    /**
     * @notice Initialize a new market
     */
    function initializeMarket(
        uint256 marketId,
        uint256 skewScale,
        uint256 maxFundingRate,
        uint256 fundingInterval
    ) external {
        require(msg.sender == perpEngine || msg.sender == owner(), "AMMPool: unauthorized");
        require(!_marketConfigs[marketId].isActive, "AMMPool: market already active");
        require(skewScale >= MIN_SKEW_SCALE && skewScale <= MAX_SKEW_SCALE, "AMMPool: invalid skew scale");
        require(maxFundingRate <= MAX_FUNDING_RATE, "AMMPool: funding rate too high");
        require(fundingInterval >= 1 hours && fundingInterval <= 24 hours, "AMMPool: invalid interval");
        
        _marketConfigs[marketId] = IAMMPool.MarketConfig({
            skewScale: skewScale,
            maxFundingRate: maxFundingRate,
            fundingInterval: fundingInterval,
            isActive: true
        });
        
        _fundingStates[marketId] = FundingRateCalculator.FundingState({
            currentFundingRate: 0,
            lastFundingTime: block.timestamp,
            fundingAccumulatedLong: 0,
            fundingAccumulatedShort: 0,
            skewScale: skewScale,
            maxFundingRate: maxFundingRate
        });
        
        emit MarketParametersUpdated(marketId, skewScale, maxFundingRate);
    }

    /**
     * @notice Deactivate a market
     */
    function deactivateMarket(uint256 marketId) external onlyPerpEngine {
        require(_marketConfigs[marketId].isActive, "AMMPool: market already inactive");
        
        // Can only deactivate if no open interest
        MarketSkew storage skew = _marketSkews[marketId];
        require(skew.totalOpenInterest == 0, "AMMPool: open interest not zero");
        
        _marketConfigs[marketId].isActive = false;
        
        emit MarketDeactivated(marketId);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Dynamically adjust skew scale based on open interest
     */
    function _updateSkewScale(uint256 marketId, MarketSkew storage skew) internal {
        IAMMPool.MarketConfig storage config = _marketConfigs[marketId];
        
        // Dynamic adjustment: if OI > 2x skew scale, increase skew scale
        // If OI < 0.5x skew scale, decrease skew scale
        if (skew.totalOpenInterest > config.skewScale * 2) {
            config.skewScale = config.skewScale * 105 / 100; // +5%
        } else if (skew.totalOpenInterest < config.skewScale / 2) {
            config.skewScale = config.skewScale * 95 / 100; // -5%
        }
        
        // Clamp to min/max
        if (config.skewScale < MIN_SKEW_SCALE) {
            config.skewScale = MIN_SKEW_SCALE;
        } else if (config.skewScale > MAX_SKEW_SCALE) {
            config.skewScale = MAX_SKEW_SCALE;
        }
    }

    // ============ GETTERS ============

    /**
     * @notice Get market configuration
     */
    function getMarketConfig(uint256 marketId) external view override returns (IAMMPool.MarketConfig memory) {
        return _marketConfigs[marketId];
    }

    /**
     * @notice Get funding state
     */
    function getFundingState(uint256 marketId) external view returns (FundingRateCalculator.FundingState memory) {
        return _fundingStates[marketId];
    }

    /**
     * @notice Get market skew data
     */
    function getMarketSkewData(uint256 marketId) external view returns (MarketSkew memory) {
        return _marketSkews[marketId];
    }
}