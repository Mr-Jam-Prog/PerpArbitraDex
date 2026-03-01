// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IChainlinkOracle} from "../interfaces/IChainlinkOracle.sol";

/**
 * @title ChainlinkOracle
 * @notice Chainlink price feed adapter with heartbeat and staleness detection
 * @dev Normalizes prices to 8 decimals and validates round completeness
 */
contract ChainlinkOracle is IChainlinkOracle, Ownable {
    // ============ CONSTANTS ============
    
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant MAX_HEARTBEAT = 24 hours;
    uint256 private constant MIN_HEARTBEAT = 5 minutes;
    
    // Chainlink-specific constants
    uint256 private constant CHAINLINK_DECIMALS = 8; // Most Chainlink feeds use 8 decimals
    
    // ============ IMMUTABLES ============
    
    AggregatorV3Interface public immutable priceFeed;
    
    // ============ STATE VARIABLES ============
    
    uint256 public heartbeat;
    uint256 public maxDeviationBps;
    uint256 public lastValidRoundId;
    uint256 public lastValidTimestamp;
    uint256 public lastValidPrice;
    bool public isActive;
    
    // Emergency fallback price
    uint256 public emergencyPrice;
    bool public emergencyActive;
    
    // ============ EVENTS ============
    
    event HeartbeatUpdated(uint256 oldHeartbeat, uint256 newHeartbeat);
    event MaxDeviationUpdated(uint256 oldDeviation, uint256 newDeviation);
    event StatusUpdated(bool oldStatus, bool newStatus);
    event EmergencyPriceSet(uint256 price, uint256 timestamp);
    event EmergencyPriceCleared(uint256 timestamp);
    
    // ============ CONSTRUCTOR ============
    
    constructor(
        address chainlinkAggregator,
        uint256 heartbeat_,
        uint256 maxDeviationBps_
    ) {
        require(chainlinkAggregator != address(0), "ChainlinkOracle: zero address");
        require(heartbeat_ >= MIN_HEARTBEAT && heartbeat_ <= MAX_HEARTBEAT, 
            "ChainlinkOracle: invalid heartbeat");
        require(maxDeviationBps_ <= 1000, "ChainlinkOracle: deviation too high"); // 10% max
        
        priceFeed = AggregatorV3Interface(chainlinkAggregator);
        heartbeat = heartbeat_;
        maxDeviationBps = maxDeviationBps_;
        isActive = true;
        
        // Initialize with current price
        updatePrice();
    }
    
    // ============ PRICE FETCHING ============
    
    /**
     * @notice Get latest price data from Chainlink
     * @return valid True if price is valid
     * @return price Normalized price (8 decimals)
     * @return timestamp Price timestamp
     * @return confidence Confidence interval (0 for Chainlink)
     */
    function getPriceData()
        external
        view
        override
        returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (emergencyActive) {
            return (true, emergencyPrice, block.timestamp, 0);
        }
        
        if (!isActive) {
            return (false, 0, 0, 0);
        }
        
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Chainlink validation checks
            valid = _validateRoundData(
                roundId,
                answer,
                updatedAt,
                answeredInRound
            );
            
            if (!valid) {
                // Return last valid price if available and not too stale
                if (lastValidPrice > 0 && block.timestamp - lastValidTimestamp <= heartbeat * 2) {
                    return (true, lastValidPrice, lastValidTimestamp, 0);
                }
                return (false, 0, 0, 0);
            }
            
            // Normalize price to 8 decimals
            price = _normalizePrice(uint256(answer), CHAINLINK_DECIMALS);
            timestamp = updatedAt;
            confidence = 0; // Chainlink doesn't provide confidence intervals
            
            // Additional staleness check
            if (block.timestamp - timestamp > heartbeat) {
                // Price is stale, return last valid if available
                if (lastValidPrice > 0 && block.timestamp - lastValidTimestamp <= heartbeat * 2) {
                    return (true, lastValidPrice, lastValidTimestamp, 0);
                }
                return (false, 0, 0, 0);
            }
            
            return (true, price, timestamp, confidence);
            
        } catch {
            // Chainlink call failed
            if (lastValidPrice > 0 && block.timestamp - lastValidTimestamp <= heartbeat * 2) {
                return (true, lastValidPrice, lastValidTimestamp, 0);
            }
            return (false, 0, 0, 0);
        }
    }
    
    /**
     * @notice Update and cache the current price
     * @return success True if price was updated
     */
    function updatePrice() public override returns (bool success) {
        if (!isActive) {
            return false;
        }
        
        try priceFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            // Validate round data
            bool valid = _validateRoundData(
                roundId,
                answer,
                updatedAt,
                answeredInRound
            );
            
            if (!valid) {
                return false;
            }
            
            // Check staleness
            if (block.timestamp - updatedAt > heartbeat) {
                return false;
            }
            
            // Update cached price
            uint256 price = _normalizePrice(uint256(answer), CHAINLINK_DECIMALS);
            
            lastValidRoundId = roundId;
            lastValidTimestamp = updatedAt;
            lastValidPrice = price;
            
            return true;
            
        } catch {
            return false;
        }
    }
    
    // ============ VALIDATION FUNCTIONS ============
    
    /**
     * @dev Validate Chainlink round data
     */
    function _validateRoundData(
        uint80 roundId,
        int256 answer,
        uint256 updatedAt,
        uint80 answeredInRound
    ) internal view returns (bool) {
        // Check for negative price
        if (answer <= 0) {
            return false;
        }
        
        // Check for stale round
        if (updatedAt == 0) {
            return false;
        }
        
        // Check round completeness
        if (answeredInRound < roundId) {
            return false;
        }
        
        // Check round progression
        if (roundId <= lastValidRoundId && lastValidRoundId > 0) {
            return false;
        }
        
        // Check timestamp progression (should not go backwards)
        if (updatedAt < lastValidTimestamp && lastValidTimestamp > 0) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @dev Normalize price to target decimals
     */
    function _normalizePrice(uint256 price, uint256 sourceDecimals) 
        internal 
        pure 
        returns (uint256) 
    {
        if (sourceDecimals > PRICE_DECIMALS) {
            return price / (10 ** (sourceDecimals - PRICE_DECIMALS));
        } else if (sourceDecimals < PRICE_DECIMALS) {
            return price * (10 ** (PRICE_DECIMALS - sourceDecimals));
        } else {
            return price;
        }
    }
    
    /**
     * @notice Check if price is stale
     */
    function isPriceStale() external view returns (bool) {
        if (lastValidTimestamp == 0) {
            return true;
        }
        
        return block.timestamp - lastValidTimestamp > heartbeat;
    }
    
    /**
     * @notice Get price decimals
     */
    function decimals() external pure returns (uint8) {
        return uint8(PRICE_DECIMALS);
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Set heartbeat period
     */
    function setHeartbeat(uint256 newHeartbeat) external onlyOwner {
        require(newHeartbeat >= MIN_HEARTBEAT && newHeartbeat <= MAX_HEARTBEAT,
            "ChainlinkOracle: invalid heartbeat");
        
        uint256 oldHeartbeat = heartbeat;
        heartbeat = newHeartbeat;
        
        emit HeartbeatUpdated(oldHeartbeat, newHeartbeat);
    }
    
    /**
     * @notice Set maximum deviation threshold
     */
    function setMaxDeviation(uint256 newDeviationBps) external onlyOwner {
        require(newDeviationBps <= 1000, "ChainlinkOracle: deviation too high");
        
        uint256 oldDeviation = maxDeviationBps;
        maxDeviationBps = newDeviationBps;
        
        emit MaxDeviationUpdated(oldDeviation, newDeviationBps);
    }
    
    /**
     * @notice Set oracle active status
     */
    function setActive(bool active) external onlyOwner {
        bool oldStatus = isActive;
        isActive = active;
        
        emit StatusUpdated(oldStatus, active);
    }
    
    /**
     * @notice Set emergency price
     * @dev Only use when Chainlink feed is compromised
     */
    function setEmergencyPrice(uint256 price) external onlyOwner {
        require(price > 0, "ChainlinkOracle: zero price");
        
        emergencyPrice = price;
        emergencyActive = true;
        
        emit EmergencyPriceSet(price, block.timestamp);
    }
    
    /**
     * @notice Clear emergency price
     */
    function clearEmergencyPrice() external onlyOwner {
        emergencyActive = false;
        
        emit EmergencyPriceCleared(block.timestamp);
    }
    
    /**
     * @notice Force update of cached price
     */
    function forceUpdate() external onlyOwner returns (bool) {
        return updatePrice();
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get Chainlink aggregator address
     */
    function getAggregator() external view returns (address) {
        return address(priceFeed);
    }
    
    /**
     * @notice Get last valid price data
     */
    function getLastValidPrice() external view returns (
        uint256 price,
        uint256 timestamp,
        uint80 roundId
    ) {
        return (lastValidPrice, lastValidTimestamp, uint80(lastValidRoundId));
    }
    
    /**
     * @notice Get oracle configuration
     */
    function getConfig() external view returns (
        uint256 heartbeat_,
        uint256 maxDeviationBps_,
        bool isActive_,
        bool emergencyActive_
    ) {
        return (heartbeat, maxDeviationBps, isActive, emergencyActive);
    }
    
    /**
     * @notice Get emergency price status
     */
    function getEmergencyStatus() external view returns (
        bool active,
        uint256 price
    ) {
        return (emergencyActive, emergencyPrice);
    }
    
    /**
     * @notice Get time since last update
     */
    function getTimeSinceLastUpdate() external view returns (uint256) {
        if (lastValidTimestamp == 0) {
            return type(uint256).max;
        }
        
        return block.timestamp - lastValidTimestamp;
    }
}