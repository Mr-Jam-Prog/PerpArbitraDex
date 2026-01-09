// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AccessControlManager
 * @notice Centralized access control for protocol roles
 * @dev Manages role hierarchy and permissions
 */
contract AccessControlManager is AccessControl {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ============ ROLES ============
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UNPAUSER_ROLE = keccak256("UNPAUSER_ROLE");

    // ============ STATE VARIABLES ============
    mapping(bytes32 => EnumerableSet.AddressSet) private roleMembers;
    mapping(address => uint256) public roleGrantTimestamps;
    
    uint256 public roleExpiryDuration = 365 days;
    bool public expiryEnabled = false;

    // ============ EVENTS ============
    event RoleGrantedWithExpiry(
        bytes32 indexed role,
        address indexed account,
        address indexed sender,
        uint256 expiryTimestamp
    );
    event RoleRevokedByExpiry(
        bytes32 indexed role,
        address indexed account,
        uint256 timestamp
    );
    event ExpiryDurationUpdated(uint256 oldDuration, uint256 newDuration);
    event ExpiryEnabledUpdated(bool enabled);

    // ============ CONSTRUCTOR ============
    constructor(address initialAdmin) {
        require(initialAdmin != address(0), "Invalid admin");
        
        _setupRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _setupRole(GOVERNOR_ROLE, initialAdmin);
        _setupRole(GUARDIAN_ROLE, initialAdmin);
        
        // Set up role hierarchy
        _setRoleAdmin(GOVERNOR_ROLE, DEFAULT_ADMIN_ROLE);
        _setRoleAdmin(GUARDIAN_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(KEEPER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(LIQUIDATOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(OPERATOR_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(UPGRADER_ROLE, GOVERNOR_ROLE);
        _setRoleAdmin(PAUSER_ROLE, GUARDIAN_ROLE);
        _setRoleAdmin(UNPAUSER_ROLE, GUARDIAN_ROLE);
    }

    // ============ OVERRIDES ============

    /**
     * @dev Grant role with expiry tracking
     */
    function grantRole(bytes32 role, address account) 
        public 
        override 
        onlyRole(getRoleAdmin(role)) 
    {
        super.grantRole(role, account);
        
        roleMembers[role].add(account);
        roleGrantTimestamps[account] = block.timestamp;
        
        uint256 expiryTimestamp = expiryEnabled ? 
            block.timestamp + roleExpiryDuration : 
            type(uint256).max;
        
        emit RoleGrantedWithExpiry(role, account, msg.sender, expiryTimestamp);
    }

    /**
     * @dev Revoke role with cleanup
     */
    function revokeRole(bytes32 role, address account) 
        public 
        override 
        onlyRole(getRoleAdmin(role)) 
    {
        super.revokeRole(role, account);
        
        roleMembers[role].remove(account);
    }

    /**
     * @dev Renounce role
     */
    function renounceRole(bytes32 role, address account) public override {
        super.renounceRole(role, account);
        
        roleMembers[role].remove(account);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Check if role is expired for account
     * @param role Role to check
     * @param account Account to check
     * @return expired True if expired
     */
    function isRoleExpired(bytes32 role, address account) 
        external 
        view 
        returns (bool) 
    {
        if (!expiryEnabled) return false;
        if (!hasRole(role, account)) return true;
        
        uint256 grantTime = roleGrantTimestamps[account];
        return block.timestamp > grantTime + roleExpiryDuration;
    }

    /**
     * @notice Check and revoke expired roles
     * @param role Role to check
     * @param accounts Accounts to check
     * @return revokedCount Number of roles revoked
     */
    function revokeExpiredRoles(bytes32 role, address[] calldata accounts) 
        external 
        returns (uint256 revokedCount) 
    {
        require(expiryEnabled, "Expiry not enabled");
        
        for (uint256 i = 0; i < accounts.length; i++) {
            address account = accounts[i];
            
            if (hasRole(role, account)) {
                uint256 grantTime = roleGrantTimestamps[account];
                
                if (block.timestamp > grantTime + roleExpiryDuration) {
                    revokeRole(role, account);
                    revokedCount++;
                    
                    emit RoleRevokedByExpiry(role, account, block.timestamp);
                }
            }
        }
        
        return revokedCount;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get role members
     * @param role Role to query
     * @return members Array of role members
     */
    function getRoleMembers(bytes32 role) external view returns (address[] memory) {
        return roleMembers[role].values();
    }

    /**
     * @notice Get role member count
     * @param role Role to query
     * @return count Number of role members
     */
    function getRoleMemberCount(bytes32 role) external view returns (uint256) {
        return roleMembers[role].length();
    }

    /**
     * @notice Check if account has any role
     * @param account Account to check
     * @return hasAnyRole True if has any role
     */
    function hasAnyRole(address account) external view returns (bool) {
        bytes32[] memory roles = getAllRoles();
        
        for (uint256 i = 0; i < roles.length; i++) {
            if (hasRole(roles[i], account)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * @notice Get all roles for account
     * @param account Account to check
     * @return roles Array of role bytes32
     */
    function getRolesForAccount(address account) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        bytes32[] memory allRoles = getAllRoles();
        bytes32[] memory userRoles = new bytes32[](allRoles.length);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allRoles.length; i++) {
            if (hasRole(allRoles[i], account)) {
                userRoles[count] = allRoles[i];
                count++;
            }
        }
        
        // Resize array
        bytes32[] memory result = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = userRoles[i];
        }
        
        return result;
    }

    /**
     * @notice Get remaining time until role expiry
     * @param role Role to check
     * @param account Account to check
     * @return remainingTime Remaining time in seconds
     */
    function getRemainingRoleTime(bytes32 role, address account) 
        external 
        view 
        returns (uint256) 
    {
        if (!expiryEnabled || !hasRole(role, account)) {
            return 0;
        }
        
        uint256 grantTime = roleGrantTimestamps[account];
        uint256 expiryTime = grantTime + roleExpiryDuration;
        
        if (block.timestamp >= expiryTime) {
            return 0;
        }
        
        return expiryTime - block.timestamp;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update role expiry duration
     * @param newDuration New duration in seconds
     */
    function updateExpiryDuration(uint256 newDuration) 
        external 
        onlyRole(DEFAULT_ADMIN_ROLE) 
    {
        require(newDuration >= 30 days, "Duration too short");
        require(newDuration <= 2 * 365 days, "Duration too long");
        
        emit ExpiryDurationUpdated(roleExpiryDuration, newDuration);
        roleExpiryDuration = newDuration;
    }

    /**
     * @notice Enable/disable role expiry
     * @param enabled Whether expiry is enabled
     */
    function setExpiryEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        expiryEnabled = enabled;
        
        emit ExpiryEnabledUpdated(enabled);
    }

    /**
     * @notice Batch grant roles
     * @param role Role to grant
     * @param accounts Accounts to grant to
     */
    function batchGrantRole(bytes32 role, address[] calldata accounts) 
        external 
        onlyRole(getRoleAdmin(role)) 
    {
        for (uint256 i = 0; i < accounts.length; i++) {
            grantRole(role, accounts[i]);
        }
    }

    /**
     * @notice Batch revoke roles
     * @param role Role to revoke
     * @param accounts Accounts to revoke from
     */
    function batchRevokeRole(bytes32 role, address[] calldata accounts) 
        external 
        onlyRole(getRoleAdmin(role)) 
    {
        for (uint256 i = 0; i < accounts.length; i++) {
            revokeRole(role, accounts[i]);
        }
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Get all defined roles
     */
    function getAllRoles() internal pure returns (bytes32[] memory) {
        bytes32[] memory roles = new bytes32[](9);
        roles[0] = DEFAULT_ADMIN_ROLE;
        roles[1] = GOVERNOR_ROLE;
        roles[2] = GUARDIAN_ROLE;
        roles[3] = KEEPER_ROLE;
        roles[4] = LIQUIDATOR_ROLE;
        roles[5] = OPERATOR_ROLE;
        roles[6] = UPGRADER_ROLE;
        roles[7] = PAUSER_ROLE;
        roles[8] = UNPAUSER_ROLE;
        
        return roles;
    }
}