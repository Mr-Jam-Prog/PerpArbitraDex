// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title RateLimiter
 * @notice Rate limiting for spam protection
 * @dev Implements sliding window rate limiting per address
 */
contract RateLimiter {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ============ STRUCTS ============
    struct RateLimit {
        uint256 count;
        uint256 lastReset;
        uint256 windowStart;
    }

    struct LimitConfig {
        uint256 maxCount;
        uint256 windowSize;
        bool enabled;
    }

    // ============ STATE VARIABLES ============
    mapping(bytes32 => mapping(address => RateLimit)) public rateLimits;
    mapping(bytes32 => LimitConfig) public limitConfigs;
    mapping(address => bool) public exemptAddresses;
    
    EnumerableSet.AddressSet private governors;
    
    address public admin;

    // ============ EVENTS ============
    event RateLimitHit(
        bytes32 indexed limitId,
        address indexed account,
        uint256 count,
        uint256 maxCount,
        uint256 windowSize
    );
    event LimitConfigUpdated(
        bytes32 indexed limitId,
        LimitConfig oldConfig,
        LimitConfig newConfig
    );
    event AddressExempted(address indexed account, bool exempt);
    event GovernorAdded(address indexed governor);
    event GovernorRemoved(address indexed governor);
    event AdminUpdated(address oldAdmin, address newAdmin);

    // ============ MODIFIERS ============
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyGovernor() {
        require(governors.contains(msg.sender), "Only governor");
        _;
    }

    modifier checkRateLimit(bytes32 limitId, address account) {
        if (!exemptAddresses[account]) {
            _checkRateLimit(limitId, account);
        }
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(address _admin) {
        require(_admin != address(0), "Invalid admin");
        admin = _admin;
        governors.add(_admin);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Check and update rate limit
     * @param limitId Limit identifier
     * @param account Account to check
     */
    function checkAndUpdate(bytes32 limitId, address account) 
        external 
        checkRateLimit(limitId, account) 
    {
        _updateRateLimit(limitId, account);
    }

    /**
     * @notice Check if account is rate limited
     * @param limitId Limit identifier
     * @param account Account to check
     * @return limited True if rate limited
     * @return remaining Remaining calls in window
     */
    function isRateLimited(bytes32 limitId, address account) 
        external 
        view 
        returns (bool limited, uint256 remaining) 
    {
        if (exemptAddresses[account]) {
            return (false, type(uint256).max);
        }
        
        RateLimit memory limit = rateLimits[limitId][account];
        LimitConfig memory config = limitConfigs[limitId];
        
        if (!config.enabled) {
            return (false, type(uint256).max);
        }
        
        uint256 currentWindow = _getCurrentWindow(limit.windowStart, config.windowSize);
        
        if (currentWindow > limit.windowStart) {
            // New window
            return (false, config.maxCount);
        } else {
            // Same window
            if (limit.count >= config.maxCount) {
                return (true, 0);
            } else {
                return (false, config.maxCount - limit.count);
            }
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update rate limit configuration
     * @param limitId Limit identifier
     * @param maxCount Maximum calls per window
     * @param windowSize Window size in seconds
     * @param enabled Whether limit is enabled
     */
    function updateLimitConfig(
        bytes32 limitId,
        uint256 maxCount,
        uint256 windowSize,
        bool enabled
    ) external onlyGovernor {
        require(windowSize > 0, "Invalid window size");
        require(maxCount > 0, "Invalid max count");
        
        LimitConfig memory oldConfig = limitConfigs[limitId];
        LimitConfig memory newConfig = LimitConfig({
            maxCount: maxCount,
            windowSize: windowSize,
            enabled: enabled
        });
        
        limitConfigs[limitId] = newConfig;
        
        emit LimitConfigUpdated(limitId, oldConfig, newConfig);
    }

    /**
     * @notice Exempt address from rate limits
     * @param account Address to exempt
     * @param exempt Whether exempt
     */
    function setExemptAddress(address account, bool exempt) external onlyAdmin {
        exemptAddresses[account] = exempt;
        
        emit AddressExempted(account, exempt);
    }

    /**
     * @notice Add governor
     * @param governor Address to add
     */
    function addGovernor(address governor) external onlyAdmin {
        require(governor != address(0), "Invalid governor");
        require(!governors.contains(governor), "Already governor");
        
        governors.add(governor);
        
        emit GovernorAdded(governor);
    }

    /**
     * @notice Remove governor
     * @param governor Address to remove
     */
    function removeGovernor(address governor) external onlyAdmin {
        require(governors.contains(governor), "Not governor");
        
        governors.remove(governor);
        
        emit GovernorRemoved(governor);
    }

    /**
     * @notice Update admin
     * @param newAdmin New admin address
     */
    function updateAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin");
        
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    /**
     * @notice Reset rate limit for account
     * @param limitId Limit identifier
     * @param account Account to reset
     */
    function resetRateLimit(bytes32 limitId, address account) external onlyAdmin {
        delete rateLimits[limitId][account];
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get rate limit info
     * @param limitId Limit identifier
     * @param account Account to check
     * @return count Current count
     * @return maxCount Maximum count
     * @return windowStart Window start time
     * @return windowSize Window size
     * @return enabled Whether limit is enabled
     */
    function getRateLimitInfo(bytes32 limitId, address account)
        external
        view
        returns (
            uint256 count,
            uint256 maxCount,
            uint256 windowStart,
            uint256 windowSize,
            bool enabled
        )
    {
        RateLimit memory limit = rateLimits[limitId][account];
        LimitConfig memory config = limitConfigs[limitId];
        
        return (
            limit.count,
            config.maxCount,
            limit.windowStart,
            config.windowSize,
            config.enabled
        );
    }

    /**
     * @notice Check if address is exempt
     * @param account Address to check
     * @return exempt True if exempt
     */
    function isExempt(address account) external view returns (bool) {
        return exemptAddresses[account];
    }

    /**
     * @notice Check if address is governor
     * @param account Address to check
     * @return governor True if governor
     */
    function isGovernor(address account) external view returns (bool) {
        return governors.contains(account);
    }

    /**
     * @notice Get all governors
     * @return governorsArray Array of governor addresses
     */
    function getGovernors() external view returns (address[] memory) {
        return governors.values();
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Check rate limit
     */
    function _checkRateLimit(bytes32 limitId, address account) internal view {
        RateLimit memory limit = rateLimits[limitId][account];
        LimitConfig memory config = limitConfigs[limitId];
        
        if (!config.enabled) return;
        
        uint256 currentWindow = _getCurrentWindow(limit.windowStart, config.windowSize);
        
        if (currentWindow > limit.windowStart) {
            // New window, allowed
            return;
        } else {
            // Same window, check count
            require(limit.count < config.maxCount, "Rate limited");
        }
    }

    /**
     * @dev Update rate limit
     */
    function _updateRateLimit(bytes32 limitId, address account) internal {
        RateLimit storage limit = rateLimits[limitId][account];
        LimitConfig memory config = limitConfigs[limitId];
        
        if (!config.enabled) return;
        
        uint256 currentWindow = _getCurrentWindow(limit.windowStart, config.windowSize);
        
        if (currentWindow > limit.windowStart) {
            // New window
            limit.count = 1;
            limit.windowStart = currentWindow;
            limit.lastReset = block.timestamp;
        } else {
            // Same window
            limit.count++;
            
            if (limit.count >= config.maxCount) {
                emit RateLimitHit(
                    limitId,
                    account,
                    limit.count,
                    config.maxCount,
                    config.windowSize
                );
            }
        }
    }

    /**
     * @dev Get current window start time
     */
    function _getCurrentWindow(uint256 lastWindowStart, uint256 windowSize) 
        internal 
        view 
        returns (uint256) 
    {
        if (lastWindowStart == 0) {
            return block.timestamp;
        }
        
        uint256 windowsPassed = (block.timestamp - lastWindowStart) / windowSize;
        return lastWindowStart + (windowsPassed * windowSize);
    }
}