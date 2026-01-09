// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title EmergencyGuardian
 * @notice Temporary emergency powers for crisis situations
 * @dev Time-limited emergency authority with restricted powers
 */
contract EmergencyGuardian is AccessControl {
    // ============ ROLES ============
    bytes32 public constant EMERGENCY_GUARDIAN_ROLE = keccak256("EMERGENCY_GUARDIAN_ROLE");
    bytes32 public constant EMERGENCY_OVERRIDE_ROLE = keccak256("EMERGENCY_OVERRIDE_ROLE");

    // ============ STRUCTS ============
    struct EmergencySession {
        address guardian;
        uint256 startTime;
        uint256 endTime;
        uint256 actionsTaken;
        bool active;
    }

    // ============ STATE VARIABLES ============
    EmergencySession public activeSession;
    uint256 public maxSessionDuration = 7 days;
    uint256 public minSessionCooldown = 30 days;
    uint256 public lastSessionEnd;
    
    mapping(address => uint256) public guardianLastSession;
    uint256 public maxActionsPerSession = 10;

    // ============ EVENTS ============
    event EmergencySessionStarted(
        address indexed guardian,
        uint256 startTime,
        uint256 endTime
    );
    event EmergencySessionEnded(
        address indexed guardian,
        uint256 endTime,
        uint256 actionsTaken
    );
    event EmergencyActionTaken(
        address indexed guardian,
        string action,
        bytes data,
        uint256 timestamp
    );
    event EmergencyOverridden(
        address indexed overrider,
        address indexed guardian,
        uint256 timestamp
    );
    event ParametersUpdated(
        uint256 maxSessionDuration,
        uint256 minSessionCooldown,
        uint256 maxActionsPerSession
    );

    // ============ MODIFIERS ============
    modifier onlyEmergencyGuardian() {
        require(
            hasRole(EMERGENCY_GUARDIAN_ROLE, msg.sender),
            "Only emergency guardian"
        );
        _;
    }

    modifier onlyDuringEmergency() {
        require(isEmergencyActive(), "No active emergency");
        require(msg.sender == activeSession.guardian, "Not active guardian");
        require(block.timestamp <= activeSession.endTime, "Session expired");
        _;
    }

    modifier onlyEmergencyOverride() {
        require(
            hasRole(EMERGENCY_OVERRIDE_ROLE, msg.sender),
            "Only emergency override"
        );
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(address initialGuardian, address initialOverride) {
        require(initialGuardian != address(0), "Invalid guardian");
        require(initialOverride != address(0), "Invalid override");
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(EMERGENCY_GUARDIAN_ROLE, initialGuardian);
        _setupRole(EMERGENCY_OVERRIDE_ROLE, initialOverride);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Start emergency session
     */
    function startEmergency() external onlyEmergencyGuardian {
        require(!isEmergencyActive(), "Emergency already active");
        require(
            block.timestamp >= lastSessionEnd + minSessionCooldown,
            "Cooldown active"
        );
        require(
            block.timestamp >= guardianLastSession[msg.sender] + minSessionCooldown,
            "Guardian cooldown"
        );
        
        activeSession = EmergencySession({
            guardian: msg.sender,
            startTime: block.timestamp,
            endTime: block.timestamp + maxSessionDuration,
            actionsTaken: 0,
            active: true
        });
        
        guardianLastSession[msg.sender] = block.timestamp;
        
        emit EmergencySessionStarted(
            msg.sender,
            block.timestamp,
            block.timestamp + maxSessionDuration
        );
    }

    /**
     * @notice End emergency session
     */
    function endEmergency() external onlyDuringEmergency {
        activeSession.active = false;
        lastSessionEnd = block.timestamp;
        
        emit EmergencySessionEnded(
            msg.sender,
            block.timestamp,
            activeSession.actionsTaken
        );
    }

    /**
     * @notice Take emergency action
     * @param action Action description
     * @param data Action data
     */
    function takeEmergencyAction(string calldata action, bytes calldata data) 
        external 
        onlyDuringEmergency 
    {
        require(
            activeSession.actionsTaken < maxActionsPerSession,
            "Max actions reached"
        );
        
        activeSession.actionsTaken++;
        
        // Emergency actions would be implemented here
        // For example: pausing contracts, freezing funds, etc.
        
        emit EmergencyActionTaken(msg.sender, action, data, block.timestamp);
    }

    /**
     * @notice Override emergency session
     */
    function overrideEmergency() external onlyEmergencyOverride {
        require(isEmergencyActive(), "No active emergency");
        
        address guardian = activeSession.guardian;
        activeSession.active = false;
        lastSessionEnd = block.timestamp;
        
        emit EmergencyOverridden(msg.sender, guardian, block.timestamp);
        emit EmergencySessionEnded(
            guardian,
            block.timestamp,
            activeSession.actionsTaken
        );
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if emergency is active
     * @return active True if emergency active
     */
    function isEmergencyActive() public view returns (bool) {
        return activeSession.active && block.timestamp <= activeSession.endTime;
    }

    /**
     * @notice Get remaining session time
     * @return remainingTime Remaining time in seconds
     */
    function getRemainingSessionTime() external view returns (uint256) {
        if (!isEmergencyActive()) return 0;
        
        if (block.timestamp >= activeSession.endTime) return 0;
        
        return activeSession.endTime - block.timestamp;
    }

    /**
     * @notice Get remaining actions
     * @return remainingActions Remaining actions allowed
     */
    function getRemainingActions() external view returns (uint256) {
        if (!isEmergencyActive()) return 0;
        
        return maxActionsPerSession - activeSession.actionsTaken;
    }

    /**
     * @notice Get cooldown status for guardian
     * @param guardian Guardian address
     * @return canStart True if can start session
     * @return remainingCooldown Remaining cooldown time
     */
    function getGuardianCooldown(address guardian) 
        external 
        view 
        returns (bool canStart, uint256 remainingCooldown) 
    {
        if (isEmergencyActive()) {
            return (false, 0);
        }
        
        uint256 lastSession = guardianLastSession[guardian];
        uint256 cooldownEnd = lastSession + minSessionCooldown;
        
        if (block.timestamp >= cooldownEnd) {
            return (true, 0);
        } else {
            return (false, cooldownEnd - block.timestamp);
        }
    }

    /**
     * @notice Get global cooldown status
     * @return canStart True if can start session
     * @return remainingCooldown Remaining cooldown time
     */
    function getGlobalCooldown() 
        external 
        view 
        returns (bool canStart, uint256 remainingCooldown) 
    {
        if (isEmergencyActive()) {
            return (false, 0);
        }
        
        uint256 cooldownEnd = lastSessionEnd + minSessionCooldown;
        
        if (block.timestamp >= cooldownEnd) {
            return (true, 0);
        } else {
            return (false, cooldownEnd - block.timestamp);
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update emergency parameters
     * @param newMaxDuration New max session duration
     * @param newMinCooldown New min cooldown between sessions
     * @param newMaxActions New max actions per session
     */
    function updateParameters(
        uint256 newMaxDuration,
        uint256 newMinCooldown,
        uint256 newMaxActions
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMaxDuration <= 14 days, "Duration too long");
        require(newMinCooldown >= 7 days, "Cooldown too short");
        require(newMaxActions <= 20, "Max actions too high");
        
        maxSessionDuration = newMaxDuration;
        minSessionCooldown = newMinCooldown;
        maxActionsPerSession = newMaxActions;
        
        emit ParametersUpdated(newMaxDuration, newMinCooldown, newMaxActions);
    }

    /**
     * @notice Update emergency roles
     * @param role Role to update
     * @param account Account to set
     * @param granted Whether granted
     */
    function updateRole(bytes32 role, address account, bool granted) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(
            role == EMERGENCY_GUARDIAN_ROLE || role == EMERGENCY_OVERRIDE_ROLE,
            "Invalid role"
        );
        
        if (granted) {
            grantRole(role, account);
        } else {
            revokeRole(role, account);
        }
    }

    /**
     * @notice Emergency reset (admin only)
     * @dev Only for corrupted state recovery
     */
    function emergencyReset() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isEmergencyActive(), "No active emergency");
        
        activeSession.active = false;
        lastSessionEnd = block.timestamp;
        
        emit EmergencySessionEnded(
            activeSession.guardian,
            block.timestamp,
            activeSession.actionsTaken
        );
    }
}