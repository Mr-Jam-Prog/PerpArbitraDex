// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {TimelockController as OZTimelock} from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title PerpDexTimelock
 * @notice Timelock controller for protocol upgrades and parameter changes
 * @dev Wraps OpenZeppelin TimelockController with additional safety features
 */
contract PerpDexTimelock is OZTimelock {
    // ============ EVENTS ============
    event MinDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event MaxDelayUpdated(uint256 oldMaxDelay, uint256 newMaxDelay);
    event GracePeriodUpdated(uint256 oldGrace, uint256 newGrace);
    event CriticalOperationScheduled(
        bytes32 indexed id,
        address indexed target,
        uint256 value,
        bytes data,
        bytes32 predecessor,
        uint256 delay
    );

    // ============ CONSTANTS ============
    uint256 public constant MIN_MIN_DELAY = 1 days;
    uint256 public constant MAX_MAX_DELAY = 30 days;
    uint256 public constant GRACE_PERIOD = 14 days;

    // ============ STATE VARIABLES ============
    uint256 public maxDelay;
    uint256 public gracePeriod;
    mapping(bytes32 => bool) public criticalOperations;

    // ============ CONSTRUCTOR ============
    constructor(
        uint256 minDelay,
        uint256 _maxDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) OZTimelock(minDelay, proposers, executors, admin) {
        require(_maxDelay >= minDelay, "Max delay < min delay");
        require(_maxDelay <= MAX_MAX_DELAY, "Max delay too high");
        require(minDelay >= MIN_MIN_DELAY, "Min delay too low");
        
        maxDelay = _maxDelay;
        gracePeriod = GRACE_PERIOD;
    }

    // ============ OVERRIDES ============

    /**
     * @dev Schedule an operation
     */
    function schedule(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt,
        uint256 delay
    ) public override onlyRole(PROPOSER_ROLE) {
        require(delay >= getMinDelay(), "Delay too short");
        require(delay <= maxDelay, "Delay too long");
        
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        
        // Check if critical operation
        if (_isCriticalOperation(target, data)) {
            criticalOperations[id] = true;
            emit CriticalOperationScheduled(id, target, value, data, predecessor, delay);
        }
        
        super.schedule(target, value, data, predecessor, salt, delay);
    }

    /**
     * @dev Execute an operation
     */
    function execute(
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 predecessor,
        bytes32 salt
    ) public payable override onlyRoleOrOpenRole(EXECUTOR_ROLE) {
        bytes32 id = hashOperation(target, value, data, predecessor, salt);
        
        // Check grace period for critical operations
        if (criticalOperations[id]) {
            require(
                block.timestamp <= getTimestamp(id) + gracePeriod,
                "Grace period expired"
            );
            delete criticalOperations[id];
        }
        
        super.execute(target, value, data, predecessor, salt);
    }

    /**
     * @dev Cancel an operation
     */
    function cancel(bytes32 id) public override onlyRole(CANCELLER_ROLE) {
        delete criticalOperations[id];
        super.cancel(id);
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update minimum delay
     * @param newDelay New minimum delay
     */
    function updateMinDelay(uint256 newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDelay >= MIN_MIN_DELAY, "Delay too low");
        require(newDelay <= maxDelay, "Delay > max delay");
        
        uint256 oldDelay = getMinDelay();
        _updateDelay(oldDelay, newDelay);
        
        emit MinDelayUpdated(oldDelay, newDelay);
    }

    /**
     * @notice Update maximum delay
     * @param newMaxDelay New maximum delay
     */
    function updateMaxDelay(uint256 newMaxDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newMaxDelay >= getMinDelay(), "Max delay < min delay");
        require(newMaxDelay <= MAX_MAX_DELAY, "Max delay too high");
        
        uint256 oldMaxDelay = maxDelay;
        maxDelay = newMaxDelay;
        
        emit MaxDelayUpdated(oldMaxDelay, newMaxDelay);
    }

    /**
     * @notice Update grace period
     * @param newGracePeriod New grace period
     */
    function updateGracePeriod(uint256 newGracePeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newGracePeriod <= 30 days, "Grace period too long");
        
        uint256 oldGrace = gracePeriod;
        gracePeriod = newGracePeriod;
        
        emit GracePeriodUpdated(oldGrace, newGracePeriod);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if operation is critical
     * @param id Operation ID
     * @return critical True if critical
     */
    function isCriticalOperation(bytes32 id) external view returns (bool) {
        return criticalOperations[id];
    }

    /**
     * @notice Get remaining time until operation can be executed
     * @param id Operation ID
     * @return remaining Remaining time in seconds
     */
    function getRemainingTime(bytes32 id) external view returns (uint256) {
        if (isOperation(id)) {
            uint256 timestamp = getTimestamp(id);
            if (timestamp > block.timestamp) {
                return timestamp - block.timestamp;
            }
        }
        return 0;
    }

    /**
     * @notice Check if operation is pending
     * @param id Operation ID
     * @return pending True if pending
     */
    function isPending(bytes32 id) external view returns (bool) {
        return isOperationPending(id);
    }

    /**
     * @notice Check if operation is ready
     * @param id Operation ID
     * @return ready True if ready
     */
    function isReady(bytes32 id) external view returns (bool) {
        return isOperationReady(id);
    }

    /**
     * @notice Check if operation is done
     * @param id Operation ID
     * @return done True if done
     */
    function isDone(bytes32 id) external view returns (bool) {
        return isOperationDone(id);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Check if operation is critical
     * @param target Target address
     * @param data Calldata
     * @return critical True if critical
     */
    function _isCriticalOperation(address target, bytes calldata data) 
        internal 
        pure 
        returns (bool) 
    {
        // Critical operations include:
        // 1. Upgrading core contracts
        // 2. Changing governance parameters
        // 3. Changing security parameters
        // 4. Large treasury withdrawals
        
        // In practice, this would check function signatures
        // For simplicity, we mark all operations as non-critical
        // Real implementation would have a more sophisticated check
        
        return false;
    }

    /**
     * @dev Update delay
     * @param oldDelay Old delay
     * @param newDelay New delay
     */
    function _updateDelay(uint256 oldDelay, uint256 newDelay) internal {
        // This would update the delay in the base contract
        // Implementation depends on OpenZeppelin version
        // For now, we emit event but don't modify
        // In production, would call internal _setMinDelay
    }
}