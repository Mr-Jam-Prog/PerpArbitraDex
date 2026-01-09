// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IOracleSanityChecker} from "../interfaces/IOracleSanityChecker.sol";

/**
 * @title OracleSanityChecker
 * @notice Final price validation layer with absolute bounds and deviation checks
 * @dev Rejects prices that fail sanity checks
 */
contract OracleSanityChecker is IOracleSanityChecker, Ownable {
    // ============ CONSTANTS ============
    
    uint256 private constant BPS = 10000;
    uint256 private constant MAX_DEVIATION_BPS = 500; // 5% max deviation
    uint256 private constant MAX_BOUND_MULTIPLIER = 1000; // 1000x max/min bounds
    
    // ============ STRUCTS ============
    
    struct FeedBounds {
        uint256 minPrice;
        uint256 maxPrice;
        uint256 maxDeviationBps;
        bool isActive;
    }
    
    // ============ STATE VARIABLES ============
    
    // Feed ID => bounds configuration
    mapping(bytes32 => FeedBounds) private _feedBounds;
    
    // Default bounds
    FeedBounds private _defaultBounds;
    
    // Security module (can freeze feeds)
    address public securityModule;
    
    // Frozen feeds
    mapping(bytes32 => bool) private _frozenFeeds;
    
    // ============ EVENTS ============
    
    event FeedBoundsUpdated(
        bytes32 indexed feedId,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 maxDeviationBps
    );
    event DefaultBoundsUpdated(
        uint256 minPrice,
        uint256 maxPrice,
        uint256 maxDeviationBps
    );
    event FeedFrozen(bytes32 indexed feedId, address frozenBy);
    event FeedUnfrozen(bytes32 indexed feedId, address unfrozenBy);
    event SecurityModuleUpdated(address oldModule, address newModule);
    
    // ============ CONSTRUCTOR ============
    
    constructor(
        uint256 defaultMinPrice,
        uint256 defaultMaxPrice,
        uint256 defaultMaxDeviationBps
    ) {
        require(defaultMinPrice < defaultMaxPrice, "OracleSanityChecker: invalid bounds");
        require(defaultMaxDeviationBps <= MAX_DEVIATION_BPS, 
            "OracleSanityChecker: deviation too high");
        
        _defaultBounds = FeedBounds({
            minPrice: defaultMinPrice,
            maxPrice: defaultMaxPrice,
            maxDeviationBps: defaultMaxDeviationBps,
            isActive: true
        });
    }
    
    // ============ VALIDATION FUNCTIONS ============
    
    /**
     * @inheritdoc IOracleSanityChecker
     */
    function validatePrice(
        bytes32 feedId,
        uint256 price,
        uint256 minPrice,
        uint256 maxPrice
    ) external view override returns (bool valid) {
        // Check if feed is frozen
        if (_frozenFeeds[feedId]) {
            return false;
        }
        
        // Get bounds for this feed (or defaults)
        FeedBounds storage bounds = _feedBounds[feedId];
        if (!bounds.isActive) {
            bounds = _defaultBounds;
        }
        
        // Check absolute bounds
        if (price < bounds.minPrice || price > bounds.maxPrice) {
            return false;
        }
        
        // Check min/max range if provided
        if (minPrice > 0 && maxPrice > 0) {
            if (price < minPrice || price > maxPrice) {
                return false;
            }
            
            // Check deviation between min and max
            uint256 deviation = (maxPrice - minPrice) * BPS / minPrice;
            if (deviation > bounds.maxDeviationBps) {
                return false;
            }
        }
        
        // Additional sanity checks
        if (!_additionalChecks(feedId, price)) {
            return false;
        }
        
        return true;
    }
    
    /**
     * @inheritdoc IOracleSanityChecker
     */
    function validatePriceWithReference(
        bytes32 feedId,
        uint256 price,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) external view override returns (bool valid) {
        // Check if feed is frozen
        if (_frozenFeeds[feedId]) {
            return false;
        }
        
        require(referencePrice > 0, "OracleSanityChecker: zero reference price");
        
        // Calculate deviation from reference price
        uint256 deviation;
        if (price >= referencePrice) {
            deviation = (price - referencePrice) * BPS / referencePrice;
        } else {
            deviation = (referencePrice - price) * BPS / referencePrice;
        }
        
        // Use provided deviation or feed's default
        if (maxDeviationBps == 0) {
            FeedBounds storage bounds = _feedBounds[feedId];
            if (!bounds.isActive) {
                bounds = _defaultBounds;
            }
            maxDeviationBps = bounds.maxDeviationBps;
        }
        
        return deviation <= maxDeviationBps;
    }
    
    // ============ BOUNDS MANAGEMENT ============
    
    /**
     * @notice Set bounds for a specific feed
     */
    function setFeedBounds(
        bytes32 feedId,
        uint256 minPrice,
        uint256 maxPrice,
        uint256 maxDeviationBps
    ) external onlyOwner {
        require(minPrice < maxPrice, "OracleSanityChecker: invalid bounds");
        require(maxDeviationBps <= MAX_DEVIATION_BPS, 
            "OracleSanityChecker: deviation too high");
        require(maxPrice <= minPrice * MAX_BOUND_MULTIPLIER,
            "OracleSanityChecker: bounds too wide");
        
        _feedBounds[feedId] = FeedBounds({
            minPrice: minPrice,
            maxPrice: maxPrice,
            maxDeviationBps: maxDeviationBps,
            isActive: true
        });
        
        emit FeedBoundsUpdated(feedId, minPrice, maxPrice, maxDeviationBps);
    }
    
    /**
     * @notice Set default bounds for all feeds
     */
    function setDefaultBounds(
        uint256 minPrice,
        uint256 maxPrice,
        uint256 maxDeviationBps
    ) external onlyOwner {
        require(minPrice < maxPrice, "OracleSanityChecker: invalid bounds");
        require(maxDeviationBps <= MAX_DEVIATION_BPS, 
            "OracleSanityChecker: deviation too high");
        
        _defaultBounds = FeedBounds({
            minPrice: minPrice,
            maxPrice: maxPrice,
            maxDeviationBps: maxDeviationBps,
            isActive: true
        });
        
        emit DefaultBoundsUpdated(minPrice, maxPrice, maxDeviationBps);
    }
    
    /**
     * @notice Disable custom bounds for a feed (use defaults)
     */
    function disableFeedBounds(bytes32 feedId) external onlyOwner {
        delete _feedBounds[feedId];
    }
    
    // ============ SECURITY FUNCTIONS ============
    
    /**
     * @notice Freeze a feed (emergency only)
     */
    function freezeFeed(bytes32 feedId) external {
        require(msg.sender == owner() || msg.sender == securityModule,
            "OracleSanityChecker: unauthorized");
        
        _frozenFeeds[feedId] = true;
        
        emit FeedFrozen(feedId, msg.sender);
    }
    
    /**
     * @notice Unfreeze a feed
     */
    function unfreezeFeed(bytes32 feedId) external onlyOwner {
        _frozenFeeds[feedId] = false;
        
        emit FeedUnfrozen(feedId, msg.sender);
    }
    
    /**
     * @notice Set security module address
     */
    function setSecurityModule(address module) external onlyOwner {
        require(module != address(0), "OracleSanityChecker: zero address");
        
        address oldModule = securityModule;
        securityModule = module;
        
        emit SecurityModuleUpdated(oldModule, module);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Additional sanity checks
     */
    function _additionalChecks(bytes32 feedId, uint256 price) 
        internal 
        pure 
        returns (bool) 
    {
        // Check for zero price
        if (price == 0) {
            return false;
        }
        
        // Check for extremely large prices (potential overflow)
        if (price > type(uint128).max) {
            return false;
        }
        
        // Feed-specific checks could be added here
        // For example, check if price is a multiple of tick size
        
        return true;
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get bounds for a feed
     */
    function getFeedBounds(bytes32 feedId) 
        external 
        view 
        returns (FeedBounds memory bounds) 
    {
        bounds = _feedBounds[feedId];
        if (!bounds.isActive) {
            bounds = _defaultBounds;
        }
    }
    
    /**
     * @notice Get default bounds
     */
    function getDefaultBounds() external view returns (FeedBounds memory) {
        return _defaultBounds;
    }
    
    /**
     * @notice Check if feed is frozen
     */
    function isFeedFrozen(bytes32 feedId) external view returns (bool) {
        return _frozenFeeds[feedId];
    }
    
    /**
     * @notice Validate price against absolute bounds only
     */
    function validateBounds(
        bytes32 feedId,
        uint256 price
    ) external view returns (bool) {
        FeedBounds storage bounds = _feedBounds[feedId];
        if (!bounds.isActive) {
            bounds = _defaultBounds;
        }
        
        return price >= bounds.minPrice && price <= bounds.maxPrice;
    }
    
    /**
     * @notice Calculate deviation between two prices
     */
    function calculateDeviation(
        uint256 price1,
        uint256 price2
    ) external pure returns (uint256 deviationBps) {
        require(price1 > 0 && price2 > 0, "OracleSanityChecker: zero price");
        
        if (price1 >= price2) {
            deviationBps = (price1 - price2) * BPS / price2;
        } else {
            deviationBps = (price2 - price1) * BPS / price1;
        }
    }
    
    /**
     * @notice Check if price change is within limits
     */
    function isPriceChangeWithinLimits(
        bytes32 feedId,
        uint256 newPrice,
        uint256 oldPrice,
        uint256 maxChangeBps
    ) external view returns (bool) {
        require(oldPrice > 0, "OracleSanityChecker: zero old price");
        
        uint256 changeBps;
        if (newPrice >= oldPrice) {
            changeBps = (newPrice - oldPrice) * BPS / oldPrice;
        } else {
            changeBps = (oldPrice - newPrice) * BPS / oldPrice;
        }
        
        if (maxChangeBps == 0) {
            FeedBounds storage bounds = _feedBounds[feedId];
            if (!bounds.isActive) {
                bounds = _defaultBounds;
            }
            maxChangeBps = bounds.maxDeviationBps;
        }
        
        return changeBps <= maxChangeBps;
    }
}