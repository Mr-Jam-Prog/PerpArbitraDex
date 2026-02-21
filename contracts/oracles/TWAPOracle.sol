// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ITWAPOracle} from "../interfaces/ITWAPOracle.sol";

/**
 * @title TWAPOracle
 * @notice Time-Weighted Average Price oracle resistant to flash loan manipulation
 * @dev Implements sliding window TWAP with incremental updates
 */
contract TWAPOracle is ITWAPOracle, Ownable {
    // ============ CONSTANTS ============
    
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant MAX_OBSERVATIONS = 1000;
    uint256 private constant MIN_OBSERVATIONS = 2;
    uint256 private constant MIN_WINDOW = 5 minutes;
    uint256 private constant MAX_WINDOW = 24 hours;
    
    // ============ STRUCTS ============
    
    struct Observation {
        uint256 timestamp;
        uint256 price;
        uint256 cumulativePrice;
        uint256 cumulativeTime;
    }
    
    struct TWAPConfig {
        uint256 windowSize;
        uint256 granularity;
        uint256 minObservations;
        bool isActive;
    }
    
    // ============ STATE VARIABLES ============
    
    // Observations array (circular buffer)
    Observation[] private _observations;
    uint256 private _nextIndex;
    
    // Configuration
    TWAPConfig private _config;
    
    // Source oracle (for price updates)
    address public sourceOracle;
    
    // Last update timestamp
    uint256 public lastUpdate;
    
    // Emergency price
    uint256 public emergencyPrice;
    bool public emergencyActive;
    
    // ============ EVENTS ============
    
    event ObservationRecorded(uint256 timestamp, uint256 price, uint256 index);
    event ConfigUpdated(
        uint256 windowSize,
        uint256 granularity,
        uint256 minObservations,
        bool isActive
    );
    event SourceOracleUpdated(address oldOracle, address newOracle);
    event EmergencyPriceSet(uint256 price, uint256 timestamp);
    event EmergencyPriceCleared(uint256 timestamp);
    
    // ============ CONSTRUCTOR ============
    
    constructor(
        uint256 windowSize_,
        uint256 granularity_,
        address sourceOracle_
    ) {
        require(windowSize_ >= MIN_WINDOW && windowSize_ <= MAX_WINDOW,
            "TWAPOracle: invalid window size");
        require(granularity_ > 0, "TWAPOracle: zero granularity");
        require(sourceOracle_ != address(0), "TWAPOracle: zero address");
        
        // Initialize observations array
        for (uint256 i = 0; i < granularity_; i++) {
            _observations.push(Observation(0, 0, 0, 0));
        }
        
        _config = TWAPConfig({
            windowSize: windowSize_,
            granularity: granularity_,
            minObservations: MIN_OBSERVATIONS,
            isActive: true
        });
        
        sourceOracle = sourceOracle_;
        lastUpdate = block.timestamp;
    }
    
    // ============ TWAP CALCULATION ============
    
    /**
     * @notice Get current TWAP price
     * @return valid True if TWAP is valid
     * @return price TWAP price (8 decimals)
     * @return timestamp Calculation timestamp
     * @return confidence Confidence based on observations count
     */
    function getPriceData()
        external
        view
        override
        returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (emergencyActive) {
            return (true, emergencyPrice, block.timestamp, 10000); // 100% confidence
        }
        
        if (!_config.isActive) {
            return (false, 0, 0, 0);
        }
        
        // Check if we have enough observations
        uint256 observationCount = _getObservationCount();
        if (observationCount < _config.minObservations) {
            return (false, 0, 0, 0);
        }
        
        // Calculate TWAP
        (bool twapValid, uint256 twapPrice) = _calculateTWAP();
        if (!twapValid) {
            return (false, 0, 0, 0);
        }
        
        // Calculate confidence based on observations
        confidence = _calculateConfidence(observationCount);
        
        return (true, twapPrice, block.timestamp, confidence);
    }
    
    /**
     * @notice Update oracle with new price observation
     * @param price Current price from source oracle
     * @return success True if observation was recorded
     */
    function update(uint256 price) external returns (bool success) {
        require(msg.sender == sourceOracle || msg.sender == owner(), 
            "TWAPOracle: unauthorized");
        
        if (!_config.isActive) {
            return false;
        }
        
        require(price > 0, "TWAPOracle: zero price");
        
        // Record observation
        _recordObservation(price);
        
        lastUpdate = block.timestamp;
        
        return true;
    }
    
    /**
     * @notice Force update from source oracle
     */
    function forceUpdate() external {
        // This would call the source oracle and update
        // Implementation depends on source oracle interface
        // For now, this is a placeholder
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Record a new price observation
     */
    function _recordObservation(uint256 price) internal {
        uint256 currentTime = block.timestamp;
        
        // Get last observation
        Observation memory lastObs;
        if (_observations.length > 0) {
            uint256 lastIndex = (_nextIndex == 0) ? _observations.length - 1 : _nextIndex - 1;
            lastObs = _observations[lastIndex];
        }
        
        // Calculate cumulative values
        uint256 timeElapsed = currentTime - lastObs.timestamp;
        uint256 cumulativePrice = lastObs.cumulativePrice + (lastObs.price * timeElapsed);
        uint256 cumulativeTime = lastObs.cumulativeTime + timeElapsed;
        
        // Create new observation
        Observation memory newObs = Observation({
            timestamp: currentTime,
            price: price,
            cumulativePrice: cumulativePrice,
            cumulativeTime: cumulativeTime
        });
        
        // Store observation
        _observations[_nextIndex] = newObs;
        
        // Update next index (circular buffer)
        _nextIndex = (_nextIndex + 1) % _config.granularity;
        
        emit ObservationRecorded(currentTime, price, _nextIndex);
    }
    
    /**
     * @dev Calculate TWAP over the window
     */
    function _calculateTWAP() internal view returns (bool valid, uint256 price) {
        uint256 currentTime = block.timestamp;
        uint256 windowStart = currentTime - _config.windowSize;
        
        // Find observations within window
        uint256 oldestIndex = _findOldestObservation(windowStart);
        if (oldestIndex == type(uint256).max) {
            return (false, 0);
        }
        
        // Get newest observation
        uint256 newestIndex = (_nextIndex == 0) ? _observations.length - 1 : _nextIndex - 1;
        Observation memory newestObs = _observations[newestIndex];
        Observation memory oldestObs = _observations[oldestIndex];
        
        // Calculate time-weighted average price
        uint256 timeRange = newestObs.cumulativeTime - oldestObs.cumulativeTime;
        uint256 priceRange = newestObs.cumulativePrice - oldestObs.cumulativePrice;
        
        if (timeRange == 0) {
            return (false, 0);
        }
        
        price = priceRange / timeRange;
        valid = true;
    }
    
    /**
     * @dev Find oldest observation within window
     */
    function _findOldestObservation(uint256 windowStart) internal view returns (uint256) {
        uint256 count = _observations.length;
        uint256 oldestIndex = type(uint256).max;
        uint256 oldestTimestamp = type(uint256).max;
        
        for (uint256 i = 0; i < count; i++) {
            Observation memory obs = _observations[i];
            if (obs.timestamp >= windowStart && obs.timestamp < oldestTimestamp) {
                oldestTimestamp = obs.timestamp;
                oldestIndex = i;
            }
        }
        
        return oldestIndex;
    }
    
    /**
     * @dev Calculate confidence based on observation count
     */
    function _calculateConfidence(uint256 observationCount) internal view returns (uint256) {
        // Confidence from 0-10000 (0-100%)
        // Max confidence at granularity/2 observations
        uint256 maxConfidenceObservations = _config.granularity / 2;
        
        if (observationCount >= maxConfidenceObservations) {
            return 10000; // 100% confidence
        }
        
        return (observationCount * 10000) / maxConfidenceObservations;
    }
    
    /**
     * @dev Get number of valid observations
     */
    function _getObservationCount() internal view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < _observations.length; i++) {
            if (_observations[i].timestamp > 0) {
                count++;
            }
        }
        return count;
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update TWAP configuration
     */
    function updateConfig(
        uint256 windowSize,
        uint256 granularity,
        uint256 minObservations
    ) external onlyOwner {
        require(windowSize >= MIN_WINDOW && windowSize <= MAX_WINDOW,
            "TWAPOracle: invalid window size");
        require(granularity > 0 && granularity <= MAX_OBSERVATIONS,
            "TWAPOracle: invalid granularity");
        require(minObservations >= MIN_OBSERVATIONS && minObservations <= granularity,
            "TWAPOracle: invalid min observations");
        
        // Resize observations array if needed
        if (granularity != _observations.length) {
            if (granularity > _observations.length) {
                while (_observations.length < granularity) {
                    _observations.push(Observation(0, 0, 0, 0));
                }
            } else {
                while (_observations.length > granularity) {
                    _observations.pop();
                }
            }
            _nextIndex = 0;
        }
        
        _config.windowSize = windowSize;
        _config.granularity = granularity;
        _config.minObservations = minObservations;
        
        emit ConfigUpdated(windowSize, granularity, minObservations, _config.isActive);
    }
    
    /**
     * @notice Set oracle active status
     */
    function setActive(bool active) external onlyOwner {
        _config.isActive = active;
        
        emit ConfigUpdated(
            _config.windowSize,
            _config.granularity,
            _config.minObservations,
            active
        );
    }
    
    /**
     * @notice Set source oracle address
     */
    function setSourceOracle(address newOracle) external onlyOwner {
        require(newOracle != address(0), "TWAPOracle: zero address");
        
        address oldOracle = sourceOracle;
        sourceOracle = newOracle;
        
        emit SourceOracleUpdated(oldOracle, newOracle);
    }
    
    /**
     * @notice Set emergency price
     */
    function setEmergencyPrice(uint256 price) external onlyOwner {
        require(price > 0, "TWAPOracle: zero price");
        
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
     * @notice Clear all observations (emergency only)
     */
    function clearObservations() external onlyOwner {
        for (uint256 i = 0; i < _observations.length; i++) {
            delete _observations[i];
        }
        _nextIndex = 0;
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get current TWAP configuration
     */
    function getConfig() external view returns (TWAPConfig memory) {
        return _config;
    }
    
    /**
     * @notice Get observation at index
     */
    function getObservation(uint256 index) external view returns (Observation memory) {
        require(index < _observations.length, "TWAPOracle: index out of bounds");
        return _observations[index];
    }
    
    /**
     * @notice Get all observations (for debugging)
     */
    function getAllObservations() external view returns (Observation[] memory) {
        return _observations;
    }
    
    /**
     * @notice Get observation count
     */
    function getObservationCount() external view returns (uint256) {
        return _getObservationCount();
    }
    
    /**
     * @notice Get next observation index
     */
    function getNextIndex() external view returns (uint256) {
        return _nextIndex;
    }
    
    /**
     * @notice Calculate current TWAP price
     */
    function calculateTWAP() external view returns (uint256 price, bool valid) {
        (valid, price) = _calculateTWAP();
    }
    
    /**
     * @notice Get time since last update
     */
    function getTimeSinceLastUpdate() external view returns (uint256) {
        if (lastUpdate == 0) {
            return type(uint256).max;
        }
        
        return block.timestamp - lastUpdate;
    }
    
    /**
     * @notice Check if oracle has enough observations
     */
    function hasEnoughObservations() external view returns (bool) {
        return _getObservationCount() >= _config.minObservations;
    }
    
    /**
     * @notice Get window boundaries
     */
    function getWindowBoundaries() external view returns (uint256 start, uint256 end) {
        end = block.timestamp;
        start = end - _config.windowSize;
    }

    function getPrice(bytes32 /*feedId*/, uint256 /*period*/) external view override returns (uint256) {
        (, uint256 price, , ) = this.getPriceData();
        return price;
    }
}