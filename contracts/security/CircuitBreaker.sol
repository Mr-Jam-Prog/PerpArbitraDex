// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title CircuitBreaker
 * @notice Circuit breaker for extreme volatility protection
 * @dev Monitors price deviations and triggers pauses automatically
 */
contract CircuitBreaker {
    using Math for uint256;

    // ============ STRUCTS ============
    struct MarketState {
        uint256 lastPrice;
        uint256 lastUpdate;
        uint256 volatility;
        uint256 volume24h;
        bool triggered;
        uint256 triggerTime;
    }

    struct BreakerConfig {
        uint256 priceDeviationThreshold; // 1e18 = 100%
        uint256 volatilityThreshold;     // 1e18 = 100%
        uint256 volumeThreshold;         // In quote token units
        uint256 cooldownPeriod;          // Seconds
        uint256 observationWindow;       // Seconds
        bool autoTrigger;
    }

    // ============ IMMUTABLES ============
    address public immutable pausableController;
    
    // ============ STATE VARIABLES ============
    mapping(uint256 => MarketState) public marketStates;
    mapping(uint256 => BreakerConfig) public marketConfigs;
    
    mapping(uint256 => uint256[]) public priceHistory;
    mapping(uint256 => uint256) public lastPriceIndex;
    
    address public guardian;
    bool public globalTriggered;

    // ============ EVENTS ============
    event BreakerTriggered(
        uint256 indexed marketId,
        uint256 priceDeviation,
        uint256 volatility,
        uint256 volume,
        address triggeredBy,
        bool autoTriggered
    );
    event BreakerReset(uint256 indexed marketId, address resetBy);
    event GlobalBreakerTriggered(address triggeredBy, string reason);
    event GlobalBreakerReset(address resetBy);
    event ConfigUpdated(
        uint256 indexed marketId,
        BreakerConfig oldConfig,
        BreakerConfig newConfig
    );
    event GuardianUpdated(address oldGuardian, address newGuardian);

    // ============ MODIFIERS ============
    modifier onlyGuardian() {
        require(msg.sender == guardian, "Only guardian");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(address _pausableController, address _guardian) {
        require(_pausableController != address(0), "Invalid pausable controller");
        require(_guardian != address(0), "Invalid guardian");
        
        pausableController = _pausableController;
        guardian = _guardian;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Update price and check circuit breaker
     * @param marketId Market ID
     * @param price New price
     * @param volume Trade volume
     * @return shouldTrigger True if circuit breaker should trigger
     */
    function updatePrice(
        uint256 marketId,
        uint256 price,
        uint256 volume
    ) external returns (bool shouldTrigger) {
        require(price > 0, "Invalid price");
        
        MarketState storage state = marketStates[marketId];
        BreakerConfig memory config = marketConfigs[marketId];
        
        // Update price history
        _updatePriceHistory(marketId, price);
        
        // Calculate metrics
        uint256 priceDeviation = _calculatePriceDeviation(marketId, price);
        uint256 volatility = _calculateVolatility(marketId);
        uint256 volume24h = _updateVolume(marketId, volume);
        
        // Check thresholds
        bool trigger = false;
        string memory reason = "";
        
        if (priceDeviation > config.priceDeviationThreshold) {
            trigger = true;
            reason = "Price deviation";
        }
        
        if (volatility > config.volatilityThreshold) {
            trigger = true;
            reason = string(abi.encodePacked(reason, trigger ? "+" : "", "Volatility"));
        }
        
        if (volume24h > config.volumeThreshold) {
            trigger = true;
            reason = string(abi.encodePacked(reason, trigger ? "+" : "", "Volume"));
        }
        
        // Update state
        state.lastPrice = price;
        state.lastUpdate = block.timestamp;
        state.volatility = volatility;
        state.volume24h = volume24h;
        
        if (trigger && !state.triggered && config.autoTrigger) {
            state.triggered = true;
            state.triggerTime = block.timestamp;
            
            emit BreakerTriggered(
                marketId,
                priceDeviation,
                volatility,
                volume24h,
                msg.sender,
                true
            );
            
            return true;
        }
        
        return false;
    }

    /**
     * @notice Manually trigger circuit breaker
     * @param marketId Market ID
     * @param reason Reason for manual trigger
     */
    function triggerBreaker(uint256 marketId, string calldata reason) 
        external 
        onlyGuardian 
    {
        MarketState storage state = marketStates[marketId];
        require(!state.triggered, "Already triggered");
        
        state.triggered = true;
        state.triggerTime = block.timestamp;
        
        emit BreakerTriggered(marketId, 0, 0, 0, msg.sender, false);
    }

    /**
     * @notice Reset circuit breaker
     * @param marketId Market ID
     */
    function resetBreaker(uint256 marketId) external onlyGuardian {
        MarketState storage state = marketStates[marketId];
        require(state.triggered, "Not triggered");
        
        BreakerConfig memory config = marketConfigs[marketId];
        require(
            block.timestamp >= state.triggerTime + config.cooldownPeriod,
            "Cooldown active"
        );
        
        state.triggered = false;
        state.triggerTime = 0;
        
        emit BreakerReset(marketId, msg.sender);
    }

    /**
     * @notice Trigger global circuit breaker
     * @param reason Reason for global trigger
     */
    function triggerGlobalBreaker(string calldata reason) external onlyGuardian {
        require(!globalTriggered, "Already triggered");
        
        globalTriggered = true;
        
        emit GlobalBreakerTriggered(msg.sender, reason);
    }

    /**
     * @notice Reset global circuit breaker
     */
    function resetGlobalBreaker() external onlyGuardian {
        require(globalTriggered, "Not triggered");
        
        globalTriggered = false;
        
        emit GlobalBreakerReset(msg.sender);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if market circuit breaker is triggered
     * @param marketId Market ID
     * @return triggered True if triggered
     */
    function isTriggered(uint256 marketId) external view returns (bool) {
        return marketStates[marketId].triggered;
    }

    /**
     * @notice Get market metrics
     * @param marketId Market ID
     * @return priceDeviation Current price deviation
     * @return volatility Current volatility
     * @return volume24h 24-hour volume
     */
    function getMarketMetrics(uint256 marketId)
        external
        view
        returns (uint256 priceDeviation, uint256 volatility, uint256 volume24h)
    {
        MarketState memory state = marketStates[marketId];
        return (
            _calculatePriceDeviation(marketId, state.lastPrice),
            state.volatility,
            state.volume24h
        );
    }

    /**
     * @notice Check if market is in cooldown
     * @param marketId Market ID
     * @return inCooldown True if in cooldown
     * @return remainingCooldown Remaining cooldown time
     */
    function getCooldownStatus(uint256 marketId)
        external
        view
        returns (bool inCooldown, uint256 remainingCooldown)
    {
        MarketState memory state = marketStates[marketId];
        BreakerConfig memory config = marketConfigs[marketId];
        
        if (state.triggered) {
            uint256 elapsed = block.timestamp - state.triggerTime;
            if (elapsed < config.cooldownPeriod) {
                return (true, config.cooldownPeriod - elapsed);
            }
        }
        
        return (false, 0);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update circuit breaker config
     * @param marketId Market ID
     * @param newConfig New configuration
     */
    function updateConfig(uint256 marketId, BreakerConfig calldata newConfig) 
        external 
        onlyGuardian 
    {
        require(newConfig.priceDeviationThreshold > 0, "Invalid price threshold");
        require(newConfig.volatilityThreshold > 0, "Invalid volatility threshold");
        require(newConfig.cooldownPeriod <= 24 hours, "Cooldown too long");
        require(newConfig.observationWindow >= 1 hours, "Window too short");
        
        BreakerConfig memory oldConfig = marketConfigs[marketId];
        marketConfigs[marketId] = newConfig;
        
        emit ConfigUpdated(marketId, oldConfig, newConfig);
    }

    /**
     * @notice Update guardian
     * @param newGuardian New guardian address
     */
    function updateGuardian(address newGuardian) external onlyGuardian {
        require(newGuardian != address(0), "Invalid guardian");
        
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Update price history
     */
    function _updatePriceHistory(uint256 marketId, uint256 price) internal {
        if (priceHistory[marketId].length == 0) {
            priceHistory[marketId].push(price);
        } else {
            if (priceHistory[marketId].length >= 100) {
                // Remove oldest price
                for (uint256 i = 0; i < priceHistory[marketId].length - 1; i++) {
                    priceHistory[marketId][i] = priceHistory[marketId][i + 1];
                }
                priceHistory[marketId][priceHistory[marketId].length - 1] = price;
            } else {
                priceHistory[marketId].push(price);
            }
        }
        
        lastPriceIndex[marketId] = priceHistory[marketId].length - 1;
    }

    /**
     * @dev Calculate price deviation
     */
    function _calculatePriceDeviation(uint256 marketId, uint256 currentPrice) 
        internal 
        view 
        returns (uint256) 
    {
        if (priceHistory[marketId].length < 2) return 0;
        
        uint256 sum = 0;
        for (uint256 i = 0; i < priceHistory[marketId].length; i++) {
            sum += priceHistory[marketId][i];
        }
        uint256 average = sum / priceHistory[marketId].length;
        
        if (average == 0) return type(uint256).max;
        
        uint256 deviation = currentPrice > average ? 
            currentPrice - average : average - currentPrice;
        
        return (deviation * 1e18) / average;
    }

    /**
     * @dev Calculate volatility (standard deviation)
     */
    function _calculateVolatility(uint256 marketId) internal view returns (uint256) {
        if (priceHistory[marketId].length < 2) return 0;
        
        uint256 sum = 0;
        for (uint256 i = 0; i < priceHistory[marketId].length; i++) {
            sum += priceHistory[marketId][i];
        }
        uint256 mean = sum / priceHistory[marketId].length;
        
        uint256 varianceSum = 0;
        for (uint256 i = 0; i < priceHistory[marketId].length; i++) {
            uint256 diff = priceHistory[marketId][i] > mean ? 
                priceHistory[marketId][i] - mean : mean - priceHistory[marketId][i];
            varianceSum += diff * diff;
        }
        uint256 variance = varianceSum / priceHistory[marketId].length;
        uint256 stdDev = sqrt(variance);
        
        if (mean == 0) return type(uint256).max;
        
        return (stdDev * 1e18) / mean;
    }

    /**
     * @dev Update 24-hour volume
     */
    function _updateVolume(uint256 marketId, uint256 newVolume) 
        internal 
        returns (uint256) 
    {
        // Simplified volume tracking
        // In production, would use circular buffer for time-weighted volume
        
        MarketState storage state = marketStates[marketId];
        uint256 volume24h = state.volume24h;
        
        // Simulate decay over time
        uint256 timeElapsed = block.timestamp - state.lastUpdate;
        if (timeElapsed > 24 hours) {
            volume24h = newVolume;
        } else {
            // Exponential decay
            uint256 decayFactor = (timeElapsed * 1e18) / 24 hours;
            volume24h = (volume24h * (1e18 - decayFactor)) / 1e18 + newVolume;
        }
        
        return volume24h;
    }

    /**
     * @dev Square root implementation
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}