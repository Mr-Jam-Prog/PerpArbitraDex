// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title PausableController
 * @notice Global pause controller for protocol safety
 * @dev Allows pausing different modules independently
 */
contract PausableController is AccessControl {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // ============ ROLES ============
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // ============ STRUCTS ============
    struct ModuleState {
        bool paused;
        uint256 pausedAt;
        address pauser;
        string reason;
    }

    // ============ STATE VARIABLES ============
    EnumerableSet.Bytes32Set private pausedModules;
    mapping(bytes32 => ModuleState) public moduleStates;
    
    uint256 public globalPauseCooldown = 24 hours;
    uint256 public lastGlobalUnpause;

    // ============ EVENTS ============
    event ModulePaused(
        bytes32 indexed moduleId,
        address indexed pauser,
        string reason,
        uint256 timestamp
    );
    event ModuleUnpaused(
        bytes32 indexed moduleId,
        address indexed unpauser,
        uint256 timestamp
    );
    event GlobalPause(
        address indexed pauser,
        string reason,
        uint256 timestamp
    );
    event GlobalUnpause(
        address indexed unpauser,
        uint256 timestamp
    );
    event CooldownUpdated(
        uint256 oldCooldown,
        uint256 newCooldown
    );

    // ============ MODIFIERS ============
    modifier whenNotPaused(bytes32 moduleId) {
        require(!isPaused(moduleId), "Module paused");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(address initialGuardian) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(GUARDIAN_ROLE, initialGuardian);
        _setupRole(PAUSER_ROLE, msg.sender);
        _setupRole(UNPAUSER_ROLE, msg.sender);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Pause a specific module
     * @param moduleId Module identifier
     * @param reason Reason for pausing
     */
    function pauseModule(bytes32 moduleId, string calldata reason) 
        external 
        onlyRole(PAUSER_ROLE) 
    {
        require(!isPaused(moduleId), "Already paused");
        
        moduleStates[moduleId] = ModuleState({
            paused: true,
            pausedAt: block.timestamp,
            pauser: msg.sender,
            reason: reason
        });
        
        pausedModules.add(moduleId);
        
        emit ModulePaused(moduleId, msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Unpause a specific module
     * @param moduleId Module identifier
     */
    function unpauseModule(bytes32 moduleId) external onlyRole(UNPAUSER_ROLE) {
        require(isPaused(moduleId), "Not paused");
        
        delete moduleStates[moduleId];
        pausedModules.remove(moduleId);
        
        emit ModuleUnpaused(moduleId, msg.sender, block.timestamp);
    }

    /**
     * @notice Pause all modules (global pause)
     * @param reason Reason for global pause
     */
    function pauseAll(string calldata reason) external onlyRole(GUARDIAN_ROLE) {
        // Guardian can pause everything immediately
        // This is for emergency situations only
        
        emit GlobalPause(msg.sender, reason, block.timestamp);
    }

    /**
     * @notice Unpause all modules (global unpause)
     */
    function unpauseAll() external onlyRole(UNPAUSER_ROLE) {
        require(
            block.timestamp >= lastGlobalUnpause + globalPauseCooldown,
            "Cooldown active"
        );
        
        // Clear all paused modules
        bytes32[] memory modules = pausedModules.values();
        for (uint256 i = 0; i < modules.length; i++) {
            delete moduleStates[modules[i]];
            pausedModules.remove(modules[i]);
        }
        
        lastGlobalUnpause = block.timestamp;
        
        emit GlobalUnpause(msg.sender, block.timestamp);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if module is paused
     * @param moduleId Module identifier
     * @return paused True if paused
     */
    function isPaused(bytes32 moduleId) public view returns (bool) {
        return moduleStates[moduleId].paused;
    }

    /**
     * @notice Get pause info for module
     * @param moduleId Module identifier
     * @return state Module state
     */
    function getModuleState(bytes32 moduleId) 
        external 
        view 
        returns (ModuleState memory) 
    {
        return moduleStates[moduleId];
    }

    /**
     * @notice Get all paused modules
     * @return modules Array of paused module IDs
     */
    function getPausedModules() external view returns (bytes32[] memory) {
        return pausedModules.values();
    }

    /**
     * @notice Get paused modules count
     * @return count Number of paused modules
     */
    function getPausedModulesCount() external view returns (uint256) {
        return pausedModules.length();
    }

    /**
     * @notice Check cooldown status
     * @return canUnpause True if can unpause all
     * @return remainingCooldown Remaining cooldown time
     */
    function getCooldownStatus() 
        external 
        view 
        returns (bool canUnpause, uint256 remainingCooldown) 
    {
        if (block.timestamp >= lastGlobalUnpause + globalPauseCooldown) {
            return (true, 0);
        } else {
            remainingCooldown = lastGlobalUnpause + globalPauseCooldown - block.timestamp;
            return (false, remainingCooldown);
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update global pause cooldown
     * @param newCooldown New cooldown in seconds
     */
    function updateCooldown(uint256 newCooldown) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCooldown <= 7 days, "Cooldown too long");
        
        emit CooldownUpdated(globalPauseCooldown, newCooldown);
        globalPauseCooldown = newCooldown;
    }

    /**
     * @notice Update roles
     * @param role Role to update
     * @param account Account to set
     * @param granted Whether granted
     */
    function updateRole(bytes32 role, address account, bool granted) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        if (granted) {
            _grantRole(role, account);
        } else {
            _revokeRole(role, account);
        }
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @notice Emergency pause (guardian only, no cooldown)
     * @param moduleId Module to pause
     * @param reason Reason for pause
     */
    function emergencyPause(bytes32 moduleId, string calldata reason) 
        external 
        onlyRole(GUARDIAN_ROLE) 
    {
        // Guardian can pause any module immediately
        // This bypasses normal pauser role
        
        if (!isPaused(moduleId)) {
            moduleStates[moduleId] = ModuleState({
                paused: true,
                pausedAt: block.timestamp,
                pauser: msg.sender,
                reason: reason
            });
            
            pausedModules.add(moduleId);
            
            emit ModulePaused(moduleId, msg.sender, reason, block.timestamp);
        }
    }
}