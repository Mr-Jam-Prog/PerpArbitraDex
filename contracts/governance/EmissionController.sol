// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title EmissionController
 * @notice Controls token emissions with schedule and caps
 * @dev Implements emission schedule with decay
 */
contract EmissionController {
    using SafeERC20 for IERC20;

    // ============ STRUCTS ============
    struct EmissionSchedule {
        uint256 startTime;
        uint256 endTime;
        uint256 totalAmount;
        uint256 claimedAmount;
        uint256 decayRate; // Per second decay (1e18 = 100%)
        bool active;
    }

    // ============ IMMUTABLES ============
    IERC20 public immutable token;
    address public immutable treasury;
    
    // ============ STATE VARIABLES ============
    mapping(uint256 => EmissionSchedule) public schedules;
    mapping(address => mapping(uint256 => uint256)) public userClaims;
    
    uint256 public scheduleCount;
    uint256 public totalEmitted;
    uint256 public maxEmissionRate = 1e18; // 1 token per second max
    
    address public governor;

    // ============ EVENTS ============
    event ScheduleCreated(
        uint256 indexed scheduleId,
        uint256 startTime,
        uint256 endTime,
        uint256 totalAmount,
        uint256 decayRate
    );
    event ScheduleUpdated(
        uint256 indexed scheduleId,
        uint256 newEndTime,
        uint256 newTotalAmount,
        uint256 newDecayRate
    );
    event ScheduleCancelled(uint256 indexed scheduleId);
    event TokensClaimed(
        address indexed user,
        uint256 indexed scheduleId,
        uint256 amount,
        uint256 timestamp
    );
    event GovernorUpdated(address oldGovernor, address newGovernor);
    event MaxEmissionRateUpdated(uint256 oldRate, uint256 newRate);

    // ============ MODIFIERS ============
    modifier onlyGovernor() {
        require(msg.sender == governor, "Only governor");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _token,
        address _treasury,
        address _governor
    ) {
        require(_token != address(0), "Invalid token");
        require(_treasury != address(0), "Invalid treasury");
        require(_governor != address(0), "Invalid governor");
        
        token = IERC20(_token);
        treasury = _treasury;
        governor = _governor;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Create emission schedule
     * @param startTime Schedule start time
     * @param endTime Schedule end time
     * @param totalAmount Total tokens to emit
     * @param decayRate Emission decay rate per second (1e18 = 100%)
     * @return scheduleId New schedule ID
     */
    function createSchedule(
        uint256 startTime,
        uint256 endTime,
        uint256 totalAmount,
        uint256 decayRate
    ) external onlyGovernor returns (uint256) {
        require(startTime >= block.timestamp, "Start time in past");
        require(endTime > startTime, "Invalid end time");
        require(totalAmount > 0, "Invalid amount");
        require(decayRate <= 1e18, "Decay rate too high");
        
        // Check emission rate
        uint256 duration = endTime - startTime;
        uint256 averageRate = totalAmount / duration;
        require(averageRate <= maxEmissionRate, "Emission rate too high");
        
        scheduleCount++;
        uint256 scheduleId = scheduleCount;
        
        schedules[scheduleId] = EmissionSchedule({
            startTime: startTime,
            endTime: endTime,
            totalAmount: totalAmount,
            claimedAmount: 0,
            decayRate: decayRate,
            active: true
        });
        
        emit ScheduleCreated(scheduleId, startTime, endTime, totalAmount, decayRate);
        
        return scheduleId;
    }

    /**
     * @notice Claim emissions from schedule
     * @param scheduleId Schedule ID
     * @param amount Amount to claim
     */
    function claim(uint256 scheduleId, uint256 amount) external {
        require(scheduleId > 0 && scheduleId <= scheduleCount, "Invalid schedule");
        
        EmissionSchedule storage schedule = schedules[scheduleId];
        require(schedule.active, "Schedule inactive");
        require(block.timestamp >= schedule.startTime, "Not started");
        
        // Calculate available amount
        uint256 available = _calculateAvailable(scheduleId, msg.sender);
        require(amount <= available, "Amount exceeds available");
        
        // Update claims
        userClaims[msg.sender][scheduleId] += amount;
        schedule.claimedAmount += amount;
        totalEmitted += amount;
        
        // Transfer tokens
        token.safeTransferFrom(treasury, msg.sender, amount);
        
        emit TokensClaimed(msg.sender, scheduleId, amount, block.timestamp);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Calculate available tokens for user
     * @param scheduleId Schedule ID
     * @param user User address
     * @return available Available tokens
     */
    function calculateAvailable(uint256 scheduleId, address user) 
        external 
        view 
        returns (uint256) 
    {
        return _calculateAvailable(scheduleId, user);
    }

    /**
     * @notice Get schedule info
     * @param scheduleId Schedule ID
     * @return schedule Schedule details
     */
    function getSchedule(uint256 scheduleId) 
        external 
        view 
        returns (EmissionSchedule memory) 
    {
        require(scheduleId > 0 && scheduleId <= scheduleCount, "Invalid schedule");
        return schedules[scheduleId];
    }

    /**
     * @notice Get user claims for schedule
     * @param scheduleId Schedule ID
     * @param user User address
     * @return claimedAmount Claimed amount
     */
    function getUserClaims(uint256 scheduleId, address user) 
        external 
        view 
        returns (uint256) 
    {
        return userClaims[user][scheduleId];
    }

    /**
     * @notice Calculate emission rate at current time
     * @param scheduleId Schedule ID
     * @return rate Current emission rate
     */
    function getCurrentRate(uint256 scheduleId) external view returns (uint256) {
        require(scheduleId > 0 && scheduleId <= scheduleCount, "Invalid schedule");
        
        EmissionSchedule memory schedule = schedules[scheduleId];
        if (!schedule.active || block.timestamp < schedule.startTime) {
            return 0;
        }
        
        if (block.timestamp >= schedule.endTime) {
            return 0;
        }
        
        // Calculate base rate
        uint256 timeElapsed = block.timestamp - schedule.startTime;
        uint256 totalDuration = schedule.endTime - schedule.startTime;
        
        // Apply decay
        uint256 decayFactor = (schedule.decayRate * timeElapsed) / totalDuration;
        uint256 baseRate = schedule.totalAmount / totalDuration;
        
        return baseRate * (1e18 - decayFactor) / 1e18;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update schedule parameters
     * @param scheduleId Schedule ID
     * @param newEndTime New end time
     * @param newTotalAmount New total amount
     * @param newDecayRate New decay rate
     */
    function updateSchedule(
        uint256 scheduleId,
        uint256 newEndTime,
        uint256 newTotalAmount,
        uint256 newDecayRate
    ) external onlyGovernor {
        require(scheduleId > 0 && scheduleId <= scheduleCount, "Invalid schedule");
        
        EmissionSchedule storage schedule = schedules[scheduleId];
        require(schedule.active, "Schedule inactive");
        require(block.timestamp < schedule.startTime, "Already started");
        
        require(newEndTime > schedule.startTime, "Invalid end time");
        require(newTotalAmount > schedule.claimedAmount, "Amount < claimed");
        require(newDecayRate <= 1e18, "Decay rate too high");
        
        // Check emission rate
        uint256 duration = newEndTime - schedule.startTime;
        uint256 averageRate = newTotalAmount / duration;
        require(averageRate <= maxEmissionRate, "Emission rate too high");
        
        schedule.endTime = newEndTime;
        schedule.totalAmount = newTotalAmount;
        schedule.decayRate = newDecayRate;
        
        emit ScheduleUpdated(scheduleId, newEndTime, newTotalAmount, newDecayRate);
    }

    /**
     * @notice Cancel schedule
     * @param scheduleId Schedule ID
     */
    function cancelSchedule(uint256 scheduleId) external onlyGovernor {
        require(scheduleId > 0 && scheduleId <= scheduleCount, "Invalid schedule");
        
        EmissionSchedule storage schedule = schedules[scheduleId];
        require(schedule.active, "Already inactive");
        require(block.timestamp < schedule.startTime, "Already started");
        
        schedule.active = false;
        
        emit ScheduleCancelled(scheduleId);
    }

    /**
     * @notice Update governor
     * @param newGovernor New governor address
     */
    function updateGovernor(address newGovernor) external onlyGovernor {
        require(newGovernor != address(0), "Invalid governor");
        
        emit GovernorUpdated(governor, newGovernor);
        governor = newGovernor;
    }

    /**
     * @notice Update max emission rate
     * @param newMaxRate New max emission rate
     */
    function updateMaxEmissionRate(uint256 newMaxRate) external onlyGovernor {
        require(newMaxRate > 0, "Invalid rate");
        
        emit MaxEmissionRateUpdated(maxEmissionRate, newMaxRate);
        maxEmissionRate = newMaxRate;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Calculate available tokens for user
     */
    function _calculateAvailable(uint256 scheduleId, address user) 
        internal 
        view 
        returns (uint256) 
    {
        EmissionSchedule memory schedule = schedules[scheduleId];
        if (!schedule.active || block.timestamp < schedule.startTime) {
            return 0;
        }
        
        uint256 totalClaimable;
        
        if (block.timestamp >= schedule.endTime) {
            // Schedule ended, all remaining is claimable
            totalClaimable = schedule.totalAmount - schedule.claimedAmount;
        } else {
            // Calculate claimable based on time and decay
            uint256 timeElapsed = block.timestamp - schedule.startTime;
            uint256 totalDuration = schedule.endTime - schedule.startTime;
            
            // Apply decay
            uint256 decayFactor = (schedule.decayRate * timeElapsed) / totalDuration;
            uint256 claimableRatio = timeElapsed * (1e18 - decayFactor) / totalDuration;
            
            totalClaimable = (schedule.totalAmount * claimableRatio) / 1e18 - schedule.claimedAmount;
        }
        
        uint256 userClaimed = userClaims[user][scheduleId];
        
        return totalClaimable > userClaimed ? totalClaimable - userClaimed : 0;
    }
}