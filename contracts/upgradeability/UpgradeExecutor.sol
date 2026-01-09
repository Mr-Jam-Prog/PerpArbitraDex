// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IProxyAdmin {
    function upgrade(address proxy, address implementation) external;
    function upgradeAndCall(
        address proxy,
        address implementation,
        bytes memory data
    ) external payable;
    function changeAdmin(address proxy, address newAdmin) external;
}

/**
 * @title UpgradeExecutor
 * @notice Atomic batch upgrade executor with rollback protection
 * @dev Executes multiple upgrades atomically with success verification
 */
contract UpgradeExecutor is AccessControl, ReentrancyGuard {
    // ============ ROLES ============
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    
    // ============ STRUCTS ============
    struct UpgradeOperation {
        address proxy;
        address implementation;
        bytes data;
        uint256 value;
        bool executed;
    }
    
    struct BatchUpgrade {
        bytes32 batchId;
        UpgradeOperation[] operations;
        uint256 createdAt;
        uint256 executedAt;
        bool executed;
        bool rolledBack;
    }
    
    // ============ STATE VARIABLES ============
    IProxyAdmin public proxyAdmin;
    
    mapping(bytes32 => BatchUpgrade) public batches;
    mapping(address => bool) public approvedImplementations;
    mapping(address => uint256) public lastUpgradeTime;
    
    uint256 public upgradeCooldown = 1 days;
    uint256 public maxBatchSize = 10;
    uint256 public executionTimeout = 7 days;
    
    // ============ EVENTS ============
    event BatchCreated(
        bytes32 indexed batchId,
        address indexed creator,
        uint256 operationCount,
        uint256 createdAt
    );
    
    event BatchExecuted(
        bytes32 indexed batchId,
        address indexed executor,
        uint256 executedAt
    );
    
    event BatchRolledBack(
        bytes32 indexed batchId,
        address indexed executor,
        uint256 rolledBackAt
    );
    
    event UpgradeOperationAdded(
        bytes32 indexed batchId,
        address proxy,
        address implementation,
        bytes data,
        uint256 value
    );
    
    event ImplementationApproved(address indexed implementation, bool approved);
    event ProxyAdminUpdated(address oldAdmin, address newAdmin);
    event ParametersUpdated(
        uint256 upgradeCooldown,
        uint256 maxBatchSize,
        uint256 executionTimeout
    );
    
    // ============ MODIFIERS ============
    modifier onlyGovernor() {
        require(hasRole(GOVERNOR_ROLE, msg.sender), "Only governor");
        _;
    }
    
    modifier onlyExecutor() {
        require(hasRole(EXECUTOR_ROLE, msg.sender), "Only executor");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        address _proxyAdmin,
        address initialGovernor,
        address initialExecutor
    ) {
        require(_proxyAdmin != address(0), "Invalid proxy admin");
        require(initialGovernor != address(0), "Invalid governor");
        require(initialExecutor != address(0), "Invalid executor");
        
        proxyAdmin = IProxyAdmin(_proxyAdmin);
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(GOVERNOR_ROLE, initialGovernor);
        _setupRole(EXECUTOR_ROLE, initialExecutor);
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Create a new upgrade batch
     * @param operations Array of upgrade operations
     * @return batchId Unique batch identifier
     */
    function createBatch(UpgradeOperation[] calldata operations) 
        external 
        onlyGovernor 
        returns (bytes32) 
    {
        require(operations.length > 0, "Empty operations");
        require(operations.length <= maxBatchSize, "Exceeds batch size");
        
        // Generate batch ID
        bytes32 batchId = keccak256(abi.encode(operations, block.timestamp, msg.sender));
        require(batches[batchId].createdAt == 0, "Batch already exists");
        
        // Create batch
        BatchUpgrade storage batch = batches[batchId];
        batch.batchId = batchId;
        batch.createdAt = block.timestamp;
        
        // Add operations
        for (uint256 i = 0; i < operations.length; i++) {
            _validateOperation(operations[i]);
            batch.operations.push(operations[i]);
            
            emit UpgradeOperationAdded(
                batchId,
                operations[i].proxy,
                operations[i].implementation,
                operations[i].data,
                operations[i].value
            );
        }
        
        emit BatchCreated(batchId, msg.sender, operations.length, block.timestamp);
        
        return batchId;
    }
    
    /**
     * @notice Execute upgrade batch
     * @param batchId Batch to execute
     */
    function executeBatch(bytes32 batchId) external onlyExecutor nonReentrant {
        BatchUpgrade storage batch = batches[batchId];
        require(batch.createdAt > 0, "Batch not found");
        require(!batch.executed, "Already executed");
        require(!batch.rolledBack, "Already rolled back");
        require(
            block.timestamp <= batch.createdAt + executionTimeout,
            "Execution timeout"
        );
        
        // Store original implementations for rollback
        address[] memory originalImplementations = new address[](batch.operations.length);
        
        for (uint256 i = 0; i < batch.operations.length; i++) {
            UpgradeOperation storage operation = batch.operations[i];
            
            // Store original implementation
            originalImplementations[i] = _getProxyImplementation(operation.proxy);
            
            // Check cooldown
            require(
                block.timestamp >= lastUpgradeTime[operation.proxy] + upgradeCooldown,
                "Upgrade cooldown"
            );
            
            // Execute upgrade
            if (operation.data.length > 0) {
                // Upgrade and call
                proxyAdmin.upgradeAndCall{value: operation.value}(
                    operation.proxy,
                    operation.implementation,
                    operation.data
                );
            } else {
                // Simple upgrade
                proxyAdmin.upgrade(operation.proxy, operation.implementation);
            }
            
            // Update last upgrade time
            lastUpgradeTime[operation.proxy] = block.timestamp;
            
            // Mark as executed
            operation.executed = true;
            
            // Verify upgrade was successful
            address newImplementation = _getProxyImplementation(operation.proxy);
            require(
                newImplementation == operation.implementation,
                "Upgrade verification failed"
            );
        }
        
        // Mark batch as executed
        batch.executed = true;
        batch.executedAt = block.timestamp;
        
        // Store original implementations for potential rollback
        // In production, would store in separate mapping
        
        emit BatchExecuted(batchId, msg.sender, block.timestamp);
    }
    
    /**
     * @notice Rollback batch
     * @param batchId Batch to rollback
     * @param originalImplementations Original implementation addresses
     */
    function rollbackBatch(
        bytes32 batchId,
        address[] calldata originalImplementations
    ) external onlyGovernor nonReentrant {
        BatchUpgrade storage batch = batches[batchId];
        require(batch.executed, "Not executed");
        require(!batch.rolledBack, "Already rolled back");
        require(
            originalImplementations.length == batch.operations.length,
            "Invalid implementations length"
        );
        
        // Rollback each operation
        for (uint256 i = 0; i < batch.operations.length; i++) {
            UpgradeOperation storage operation = batch.operations[i];
            
            // Rollback to original implementation
            proxyAdmin.upgrade(operation.proxy, originalImplementations[i]);
            
            // Verify rollback
            address currentImplementation = _getProxyImplementation(operation.proxy);
            require(
                currentImplementation == originalImplementations[i],
                "Rollback verification failed"
            );
        }
        
        // Mark as rolled back
        batch.rolledBack = true;
        
        emit BatchRolledBack(batchId, msg.sender, block.timestamp);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get batch details
     * @param batchId Batch ID
     * @return batch Batch details
     */
    function getBatch(bytes32 batchId) 
        external 
        view 
        returns (BatchUpgrade memory) 
    {
        return batches[batchId];
    }
    
    /**
     * @notice Check if batch can be executed
     * @param batchId Batch ID
     * @return executable True if executable
     * @return reason Reason if not executable
     */
    function canExecuteBatch(bytes32 batchId) 
        external 
        view 
        returns (bool executable, string memory reason) 
    {
        BatchUpgrade storage batch = batches[batchId];
        
        if (batch.createdAt == 0) {
            return (false, "Batch not found");
        }
        
        if (batch.executed) {
            return (false, "Already executed");
        }
        
        if (batch.rolledBack) {
            return (false, "Already rolled back");
        }
        
        if (block.timestamp > batch.createdAt + executionTimeout) {
            return (false, "Execution timeout");
        }
        
        // Check each operation
        for (uint256 i = 0; i < batch.operations.length; i++) {
            UpgradeOperation memory operation = batch.operations[i];
            
            if (!approvedImplementations[operation.implementation]) {
                return (false, "Implementation not approved");
            }
            
            if (block.timestamp < lastUpgradeTime[operation.proxy] + upgradeCooldown) {
                return (false, "Upgrade cooldown active");
            }
        }
        
        return (true, "");
    }
    
    /**
     * @notice Get proxy implementation
     * @param proxy Proxy address
     * @return implementation Current implementation
     */
    function getProxyImplementation(address proxy) external view returns (address) {
        return _getProxyImplementation(proxy);
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Approve or revoke implementation
     * @param implementation Implementation address
     * @param approved Whether approved
     */
    function setApprovedImplementation(address implementation, bool approved) 
        external 
        onlyGovernor 
    {
        require(implementation != address(0), "Invalid implementation");
        
        approvedImplementations[implementation] = approved;
        
        emit ImplementationApproved(implementation, approved);
    }
    
    /**
     * @notice Update proxy admin
     * @param newProxyAdmin New proxy admin address
     */
    function updateProxyAdmin(address newProxyAdmin) external onlyGovernor {
        require(newProxyAdmin != address(0), "Invalid proxy admin");
        
        emit ProxyAdminUpdated(address(proxyAdmin), newProxyAdmin);
        proxyAdmin = IProxyAdmin(newProxyAdmin);
    }
    
    /**
     * @notice Update parameters
     * @param newCooldown New upgrade cooldown
     * @param newBatchSize New maximum batch size
     * @param newTimeout New execution timeout
     */
    function updateParameters(
        uint256 newCooldown,
        uint256 newBatchSize,
        uint256 newTimeout
    ) external onlyGovernor {
        require(newCooldown <= 7 days, "Cooldown too long");
        require(newBatchSize <= 20, "Batch size too large");
        require(newTimeout <= 30 days, "Timeout too long");
        
        upgradeCooldown = newCooldown;
        maxBatchSize = newBatchSize;
        executionTimeout = newTimeout;
        
        emit ParametersUpdated(newCooldown, newBatchSize, newTimeout);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Validate upgrade operation
     */
    function _validateOperation(UpgradeOperation calldata operation) internal view {
        require(operation.proxy != address(0), "Invalid proxy");
        require(operation.implementation != address(0), "Invalid implementation");
        require(approvedImplementations[operation.implementation], "Implementation not approved");
    }
    
    /**
     * @dev Get proxy implementation
     */
    function _getProxyImplementation(address proxy) internal view returns (address) {
        // Static call to get implementation
        (bool success, bytes memory data) = proxy.staticcall(
            abi.encodeWithSignature("implementation()")
        );
        
        if (success && data.length == 32) {
            return abi.decode(data, (address));
        }
        
        return address(0);
    }
    
    /**
     * @dev Emergency recover ETH
     */
    function emergencyRecoverETH(uint256 amount) external onlyGovernor {
        require(address(this).balance >= amount, "Insufficient balance");
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
}