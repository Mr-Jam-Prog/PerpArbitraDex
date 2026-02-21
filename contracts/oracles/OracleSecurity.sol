// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IOracleSecurity} from "../interfaces/IOracleSecurity.sol";

/**
 * @title OracleSecurity
 * @notice Security overlay for oracle system with freeze, emergency override, and rate limiting
 * @dev Time-bounded emergency overrides with guardian role
 */
contract OracleSecurity is IOracleSecurity, Ownable, Pausable {
    // ============ CONSTANTS ============
    
    uint256 private constant MAX_EMERGENCY_DURATION = 24 hours;
    uint256 private constant MIN_EMERGENCY_DURATION = 5 minutes;
    uint256 private constant MAX_RATE_LIMIT_PERIOD = 1 hours;
    
    // ============ STRUCTS ============
    
    struct EmergencyOverride {
        uint256 price;
        uint256 startTime;
        uint256 endTime;
        address setBy;
        bool isActive;
    }
    
    struct RateLimit {
        uint256 maxUpdates;
        uint256 period;
        uint256[] updateTimestamps;
    }
    
    // ============ STATE VARIABLES ============
    
    // Guardian role (can freeze but not set prices)
    address public guardian;
    
    // Feed ID => emergency override
    mapping(bytes32 => EmergencyOverride) private _emergencyOverrides;
    
    // Feed ID => rate limit
    mapping(bytes32 => RateLimit) private _rateLimits;
    
    // Feed ID => frozen status
    mapping(bytes32 => bool) private _frozenFeeds;
    
    // Aggregator contract
    address public oracleAggregator;
    
    // Sanity checker contract
    address public sanityChecker;
    
    // ============ EVENTS ============
    
    event GuardianUpdated(address oldGuardian, address newGuardian);
    event EmergencyOverrideSet(
        bytes32 indexed feedId,
        uint256 price,
        uint256 startTime,
        uint256 endTime,
        address setBy
    );
    event EmergencyOverrideCleared(bytes32 indexed feedId, address clearedBy);
    event FeedFrozen(bytes32 indexed feedId, address frozenBy);
    event FeedUnfrozen(bytes32 indexed feedId, address unfrozenBy);
    event RateLimitUpdated(
        bytes32 indexed feedId,
        uint256 maxUpdates,
        uint256 period
    );
    
    // ============ MODIFIERS ============
    
    modifier onlyGuardian() {
        require(msg.sender == guardian, "OracleSecurity: only guardian");
        _;
    }
    
    modifier onlyAggregator() {
        require(msg.sender == oracleAggregator, "OracleSecurity: only aggregator");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(
        address guardian_,
        address aggregator_,
        address sanityChecker_
    ) {
        require(guardian_ != address(0), "OracleSecurity: zero address");
        require(aggregator_ != address(0), "OracleSecurity: zero address");
        require(sanityChecker_ != address(0), "OracleSecurity: zero address");
        
        guardian = guardian_;
        oracleAggregator = aggregator_;
        sanityChecker = sanityChecker_;
    }
    
    // ============ SECURITY FUNCTIONS ============
    
    /**
     * @inheritdoc IOracleSecurity
     */
    function shouldFreeze(bytes32 feedId) 
        external 
        view 
        override 
        returns (bool) 
    {
        // Check if feed is already frozen
        if (_frozenFeeds[feedId]) {
            return false; // Already frozen
        }
        
        // Check for emergency override expiration
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        if (emOverride.isActive && block.timestamp > emOverride.endTime) {
            return true; // Freeze after emergency override expires
        }
        
        // Check rate limiting
        if (_isRateLimited(feedId)) {
            return true;
        }
        
        return false;
    }
    
    /**
     * @notice Freeze a feed (guardian only)
     */
    function freezeFeed(bytes32 feedId) external onlyGuardian {
        require(!_frozenFeeds[feedId], "OracleSecurity: already frozen");
        
        _frozenFeeds[feedId] = true;
        
        // Also freeze in sanity checker
        // This would call a function on the sanity checker contract
        
        emit FeedFrozen(feedId, msg.sender);
    }
    
    /**
     * @notice Unfreeze a feed (owner only)
     */
    function unfreezeFeed(bytes32 feedId) external onlyOwner {
        require(_frozenFeeds[feedId], "OracleSecurity: not frozen");
        
        _frozenFeeds[feedId] = false;
        
        // Also unfreeze in sanity checker
        
        emit FeedUnfrozen(feedId, msg.sender);
    }
    
    /**
     * @notice Set emergency price override (owner only)
     */
    function setEmergencyOverride(
        bytes32 feedId,
        uint256 price,
        uint256 duration
    ) external onlyOwner {
        require(price > 0, "OracleSecurity: zero price");
        require(duration >= MIN_EMERGENCY_DURATION && duration <= MAX_EMERGENCY_DURATION,
            "OracleSecurity: invalid duration");
        
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        
        emOverride.price = price;
        emOverride.startTime = block.timestamp;
        emOverride.endTime = block.timestamp + duration;
        emOverride.setBy = msg.sender;
        emOverride.isActive = true;
        
        emit EmergencyOverrideSet(
            feedId,
            price,
            emOverride.startTime,
            emOverride.endTime,
            msg.sender
        );
    }
    
    /**
     * @notice Clear emergency override
     */
    function clearEmergencyOverride(bytes32 feedId) external onlyOwner {
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        require(emOverride.isActive, "OracleSecurity: not active");
        
        emOverride.isActive = false;
        
        emit EmergencyOverrideCleared(feedId, msg.sender);
    }
    
    // ============ RATE LIMITING ============
    
    /**
     * @notice Record price update for rate limiting
     */
    function recordUpdate(bytes32 feedId) external onlyAggregator {
        RateLimit storage limit = _rateLimits[feedId];
        
        // Initialize if not set
        if (limit.period == 0) {
            limit.maxUpdates = 10; // Default: 10 updates per period
            limit.period = 5 minutes; // Default: 5 minutes
        }
        
        // Add timestamp
        limit.updateTimestamps.push(block.timestamp);
        
        // Clean old timestamps
        _cleanOldTimestamps(feedId);
    }
    
    /**
     * @notice Set rate limit for a feed
     */
    function setRateLimit(
        bytes32 feedId,
        uint256 maxUpdates,
        uint256 period
    ) external onlyOwner {
        require(maxUpdates > 0, "OracleSecurity: zero max updates");
        require(period <= MAX_RATE_LIMIT_PERIOD, "OracleSecurity: period too long");
        
        _rateLimits[feedId] = RateLimit({
            maxUpdates: maxUpdates,
            period: period,
            updateTimestamps: new uint256[](0)
        });
        
        emit RateLimitUpdated(feedId, maxUpdates, period);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Check if feed is rate limited
     */
    function _isRateLimited(bytes32 feedId) internal view returns (bool) {
        RateLimit storage limit = _rateLimits[feedId];
        
        if (limit.period == 0) {
            return false; // No rate limit set
        }
        
        uint256 recentUpdates = 0;
        uint256 cutoff = block.timestamp - limit.period;
        
        for (uint256 i = 0; i < limit.updateTimestamps.length; i++) {
            if (limit.updateTimestamps[i] > cutoff) {
                recentUpdates++;
            }
        }
        
        return recentUpdates > limit.maxUpdates;
    }
    
    /**
     * @dev Clean old timestamps from rate limit array
     */
    function _cleanOldTimestamps(bytes32 feedId) internal {
        RateLimit storage limit = _rateLimits[feedId];
        if (limit.period == 0) {
            return;
        }
        
        uint256 cutoff = block.timestamp - limit.period;
        uint256 validCount = 0;
        
        // Count valid timestamps
        for (uint256 i = 0; i < limit.updateTimestamps.length; i++) {
            if (limit.updateTimestamps[i] > cutoff) {
                validCount++;
            }
        }
        
        // Create new array with only valid timestamps
        uint256[] memory newTimestamps = new uint256[](validCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < limit.updateTimestamps.length; i++) {
            if (limit.updateTimestamps[i] > cutoff) {
                newTimestamps[index] = limit.updateTimestamps[i];
                index++;
            }
        }
        
        limit.updateTimestamps = newTimestamps;
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Check if feed is frozen
     */
    function isFeedFrozen(bytes32 feedId) external view returns (bool) {
        return _frozenFeeds[feedId];
    }
    
    /**
     * @notice Get emergency override for feed
     */
    function getEmergencyOverride(bytes32 feedId) 
        external 
        view 
        returns (EmergencyOverride memory) 
    {
        return _emergencyOverrides[feedId];
    }
    
    /**
     * @notice Check if emergency override is active
     */
    function isEmergencyActive(bytes32 feedId) external view returns (bool) {
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        return emOverride.isActive && block.timestamp <= emOverride.endTime;
    }
    
    /**
     * @notice Get emergency price if active
     */
    function getEmergencyPrice(bytes32 feedId) external view returns (uint256, bool) {
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        if (emOverride.isActive && block.timestamp <= emOverride.endTime) {
            return (emOverride.price, true);
        }
        return (0, false);
    }
    
    /**
     * @notice Get rate limit for feed
     */
    function getRateLimit(bytes32 feedId) external view returns (RateLimit memory) {
        return _rateLimits[feedId];
    }
    
    /**
     * @notice Check if feed would be rate limited
     */
    function checkRateLimit(bytes32 feedId) external view returns (bool limited, uint256 recentUpdates) {
        RateLimit storage limit = _rateLimits[feedId];
        
        if (limit.period == 0) {
            return (false, 0);
        }
        
        recentUpdates = 0;
        uint256 cutoff = block.timestamp - limit.period;
        
        for (uint256 i = 0; i < limit.updateTimestamps.length; i++) {
            if (limit.updateTimestamps[i] > cutoff) {
                recentUpdates++;
            }
        }
        
        limited = recentUpdates > limit.maxUpdates;
    }
    
    /**
     * @notice Get time until emergency override expires
     */
    function getEmergencyTimeRemaining(bytes32 feedId) external view returns (uint256) {
        EmergencyOverride storage emOverride = _emergencyOverrides[feedId];
        if (!emOverride.isActive || block.timestamp >= emOverride.endTime) {
            return 0;
        }
        
        return emOverride.endTime - block.timestamp;
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update guardian address
     */
    function updateGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "OracleSecurity: zero address");
        
        address oldGuardian = guardian;
        guardian = newGuardian;
        
        emit GuardianUpdated(oldGuardian, newGuardian);
    }
    
    /**
     * @notice Update aggregator address
     */
    function updateAggregator(address newAggregator) external onlyOwner {
        require(newAggregator != address(0), "OracleSecurity: zero address");
        oracleAggregator = newAggregator;
    }
    
    /**
     * @notice Update sanity checker address
     */
    function updateSanityChecker(address newChecker) external onlyOwner {
        require(newChecker != address(0), "OracleSecurity: zero address");
        sanityChecker = newChecker;
    }
    
    /**
     * @notice Emergency pause all security functions
     */
    function emergencyPause() external onlyGuardian {
        _pause();
    }
    
    /**
     * @notice Emergency unpause
     */
    function emergencyUnpause() external onlyOwner {
        _unpause();
    }

    /**
     * @inheritdoc IOracleSecurity
     */
    function validatePrice(bytes32 feedId, uint256 price) external view override returns (bool) {
        // Dummy implementation
        return true;
    }
}
