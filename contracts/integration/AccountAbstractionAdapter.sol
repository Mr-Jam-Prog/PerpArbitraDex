// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// ERC-4337 interfaces (simplified)
interface IEntryPoint {
    struct UserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes paymasterAndData;
        bytes signature;
    }
    
    function handleOps(UserOperation[] calldata ops, address payable beneficiary) external;
}

interface IPaymaster {
    function validatePaymasterUserOp(
        UserOperation calldata op,
        bytes32 requestId,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);
    
    function postOp(
        bytes calldata context,
        uint256 actualGasCost
    ) external;
}

/**
 * @title AccountAbstractionAdapter
 * @notice ERC-4337 Account Abstraction support for PerpArbitraDEX
 * @dev Enables gasless transactions and paymaster functionality
 */
contract AccountAbstractionAdapter is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    
    // ============ IMMUTABLES ============
    IEntryPoint public immutable entryPoint;
    address public immutable perpEngine;
    IERC20 public immutable quoteToken;
    
    // ============ CONSTANTS ============
    bytes32 public constant USER_OP_TYPEHASH = keccak256(
        "UserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData)"
    );
    
    // ============ STATE VARIABLES ============
    mapping(address => uint256) public userNonces;
    mapping(address => bool) public paymasters;
    mapping(address => uint256) public paymasterDeposits;
    mapping(bytes32 => bool) public executedOps;
    
    uint256 public maxGasPrice = 1000 gwei;
    uint256 public maxGasPerOp = 10_000_000;
    uint256 public paymasterStakeRequired = 1 ether;
    
    // ============ EVENTS ============
    event UserOperationExecuted(
        address indexed sender,
        uint256 nonce,
        bytes callData,
        uint256 actualGasCost,
        bool success
    );
    
    event PaymasterRegistered(address indexed paymaster, uint256 deposit);
    event PaymasterUnregistered(address indexed paymaster, uint256 refund);
    event PaymasterDeposited(address indexed paymaster, uint256 amount);
    event PaymasterWithdrawn(address indexed paymaster, uint256 amount);
    event GasLimitsUpdated(uint256 maxGasPrice, uint256 maxGasPerOp);
    event StakeRequirementUpdated(uint256 newStake);
    
    // ============ MODIFIERS ============
    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "Only EntryPoint");
        _;
    }
    
    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "Only PerpEngine");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        address _entryPoint,
        address _perpEngine,
        address _quoteToken
    ) EIP712("PerpArbitraDEX", "1") {
        require(_entryPoint != address(0), "Invalid EntryPoint");
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(_quoteToken != address(0), "Invalid quote token");
        
        entryPoint = IEntryPoint(_entryPoint);
        perpEngine = _perpEngine;
        quoteToken = IERC20(_quoteToken);
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Execute a user operation
     * @param op User operation to execute
     * @param requestId Operation request ID
     * @param maxCost Maximum gas cost
     */
    function executeUserOp(
        IEntryPoint.UserOperation calldata op,
        bytes32 requestId,
        uint256 maxCost
    ) external onlyEntryPoint nonReentrant returns (uint256 validationData) {
        // Verify operation hasn't been executed
        require(!executedOps[requestId], "Operation already executed");
        
        // Verify signature
        _validateSignature(op, requestId);
        
        // Verify gas limits
        require(op.maxFeePerGas <= maxGasPrice, "Gas price too high");
        require(op.callGasLimit <= maxGasPerOp, "Gas limit too high");
        
        // Verify nonce
        require(op.nonce == userNonces[op.sender], "Invalid nonce");
        
        // Mark as executed
        executedOps[requestId] = true;
        
        // Increment nonce
        userNonces[op.sender]++;
        
        // Execute the operation
        (bool success, ) = _executeCallData(op.sender, op.callData);
        
        // Handle paymaster if present
        if (op.paymasterAndData.length > 0) {
            _handlePaymaster(op, requestId, maxCost, success);
        }
        
        // Calculate actual gas cost (simplified)
        uint256 actualGasCost = _calculateGasCost(op);
        
        emit UserOperationExecuted(
            op.sender,
            op.nonce,
            op.callData,
            actualGasCost,
            success
        );
        
        // Return validation data (0 = valid)
        return 0;
    }
    
    /**
     * @notice Register as a paymaster
     * @param deposit Initial deposit amount
     */
    function registerPaymaster(uint256 deposit) external nonReentrant {
        require(!paymasters[msg.sender], "Already registered");
        require(deposit >= paymasterStakeRequired, "Insufficient deposit");
        
        paymasters[msg.sender] = true;
        paymasterDeposits[msg.sender] = deposit;
        
        // Transfer deposit
        quoteToken.safeTransferFrom(msg.sender, address(this), deposit);
        
        emit PaymasterRegistered(msg.sender, deposit);
    }
    
    /**
     * @notice Unregister as a paymaster
     */
    function unregisterPaymaster() external nonReentrant {
        require(paymasters[msg.sender], "Not registered");
        
        uint256 deposit = paymasterDeposits[msg.sender];
        
        // Remove paymaster
        paymasters[msg.sender] = false;
        delete paymasterDeposits[msg.sender];
        
        // Refund deposit
        quoteToken.safeTransfer(msg.sender, deposit);
        
        emit PaymasterUnregistered(msg.sender, deposit);
    }
    
    /**
     * @notice Deposit more funds as paymaster
     * @param amount Amount to deposit
     */
    function depositPaymasterFunds(uint256 amount) external nonReentrant {
        require(paymasters[msg.sender], "Not registered");
        require(amount > 0, "Invalid amount");
        
        paymasterDeposits[msg.sender] += amount;
        quoteToken.safeTransferFrom(msg.sender, address(this), amount);
        
        emit PaymasterDeposited(msg.sender, amount);
    }
    
    /**
     * @notice Withdraw paymaster funds
     * @param amount Amount to withdraw
     */
    function withdrawPaymasterFunds(uint256 amount) external nonReentrant {
        require(paymasters[msg.sender], "Not registered");
        require(amount > 0, "Invalid amount");
        require(paymasterDeposits[msg.sender] >= amount, "Insufficient balance");
        
        // Ensure minimum stake remains
        require(
            paymasterDeposits[msg.sender] - amount >= paymasterStakeRequired,
            "Below minimum stake"
        );
        
        paymasterDeposits[msg.sender] -= amount;
        quoteToken.safeTransfer(msg.sender, amount);
        
        emit PaymasterWithdrawn(msg.sender, amount);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Validate a user operation
     * @param op User operation to validate
     * @param requestId Operation request ID
     * @param maxCost Maximum gas cost
     */
    function validateUserOp(
        IEntryPoint.UserOperation calldata op,
        bytes32 requestId,
        uint256 maxCost
    ) external view returns (uint256 validationData) {
        // Check if already executed
        if (executedOps[requestId]) {
            return 1; // Invalid
        }
        
        // Check signature
        if (!_isValidSignature(op, requestId)) {
            return 1; // Invalid
        }
        
        // Check nonce
        if (op.nonce != userNonces[op.sender]) {
            return 1; // Invalid
        }
        
        // Check gas limits
        if (op.maxFeePerGas > maxGasPrice || op.callGasLimit > maxGasPerOp) {
            return 1; // Invalid
        }
        
        // Check paymaster if present
        if (op.paymasterAndData.length > 0) {
            address paymaster = address(bytes20(op.paymasterAndData[0:20]));
            if (!paymasters[paymaster] || paymasterDeposits[paymaster] < maxCost) {
                return 1; // Invalid
            }
        }
        
        return 0; // Valid
    }
    
    /**
     * @notice Get user nonce
     * @param user User address
     * @return nonce Current nonce
     */
    function getNonce(address user) external view returns (uint256) {
        return userNonces[user];
    }
    
    /**
     * @notice Check if operation is executed
     * @param requestId Operation request ID
     * @return executed True if executed
     */
    function isOpExecuted(bytes32 requestId) external view returns (bool) {
        return executedOps[requestId];
    }
    
    /**
     * @notice Get paymaster info
     * @param paymaster Paymaster address
     * @return registered True if registered
     * @return deposit Current deposit
     */
    function getPaymasterInfo(address paymaster) 
        external 
        view 
        returns (bool registered, uint256 deposit) 
    {
        return (paymasters[paymaster], paymasterDeposits[paymaster]);
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update gas limits
     * @param newMaxGasPrice New maximum gas price
     * @param newMaxGasPerOp New maximum gas per operation
     */
    function updateGasLimits(uint256 newMaxGasPrice, uint256 newMaxGasPerOp) 
        external 
        onlyPerpEngine 
    {
        require(newMaxGasPrice > 0, "Invalid gas price");
        require(newMaxGasPerOp > 0, "Invalid gas limit");
        
        emit GasLimitsUpdated(maxGasPrice, newMaxGasPrice);
        emit GasLimitsUpdated(maxGasPerOp, newMaxGasPerOp);
        
        maxGasPrice = newMaxGasPrice;
        maxGasPerOp = newMaxGasPerOp;
    }
    
    /**
     * @notice Update paymaster stake requirement
     * @param newStake New stake requirement
     */
    function updateStakeRequirement(uint256 newStake) external onlyPerpEngine {
        require(newStake > 0, "Invalid stake");
        
        emit StakeRequirementUpdated(newStake);
        paymasterStakeRequired = newStake;
    }
    
    /**
     * @notice Emergency refund paymaster
     * @param paymaster Paymaster address
     * @param amount Amount to refund
     */
    function emergencyRefundPaymaster(address paymaster, uint256 amount) 
        external 
        onlyPerpEngine 
    {
        require(paymasters[paymaster], "Not registered");
        require(amount > 0, "Invalid amount");
        require(paymasterDeposits[paymaster] >= amount, "Insufficient balance");
        
        paymasterDeposits[paymaster] -= amount;
        quoteToken.safeTransfer(paymaster, amount);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Validate user operation signature
     */
    function _validateSignature(
        IEntryPoint.UserOperation calldata op,
        bytes32 requestId
    ) internal view {
        require(_isValidSignature(op, requestId), "Invalid signature");
    }
    
    /**
     * @dev Check if signature is valid
     */
    function _isValidSignature(
        IEntryPoint.UserOperation calldata op,
        bytes32 requestId
    ) internal view returns (bool) {
        bytes32 hash = _hashUserOp(op);
        address recovered = hash.recover(op.signature);
        return recovered == op.sender;
    }
    
    /**
     * @dev Hash user operation for EIP-712
     */
    function _hashUserOp(IEntryPoint.UserOperation calldata op) 
        internal 
        view 
        returns (bytes32) 
    {
        return _hashTypedDataV4(keccak256(abi.encode(
            USER_OP_TYPEHASH,
            op.sender,
            op.nonce,
            keccak256(op.initCode),
            keccak256(op.callData),
            op.callGasLimit,
            op.verificationGasLimit,
            op.preVerificationGas,
            op.maxFeePerGas,
            op.maxPriorityFeePerGas,
            keccak256(op.paymasterAndData)
        )));
    }
    
    /**
     * @dev Execute call data
     */
    function _executeCallData(address sender, bytes memory callData) 
        internal 
        returns (bool, bytes memory) 
    {
        // Parse call data
        // In production, would decode and call appropriate functions
        // For now, we simulate execution
        
        bool success = true;
        bytes memory result = "";
        
        // Check if call is to PerpEngine
        // This is a simplified example
        if (callData.length >= 4) {
            bytes4 selector;
            assembly {
                selector := mload(add(callData, 0x20))
            }
            
            // Simulate execution
            // In production, would make actual calls
            success = true;
        }
        
        return (success, result);
    }
    
    /**
     * @dev Handle paymaster payment
     */
    function _handlePaymaster(
        IEntryPoint.UserOperation calldata op,
        bytes32 requestId,
        uint256 maxCost,
        bool success
    ) internal {
        address paymaster = address(bytes20(op.paymasterAndData[0:20]));
        require(paymasters[paymaster], "Invalid paymaster");
        
        // Calculate actual cost
        uint256 actualCost = _calculateGasCost(op);
        
        // Ensure paymaster has enough funds
        require(paymasterDeposits[paymaster] >= actualCost, "Insufficient paymaster funds");
        
        // Deduct from paymaster deposit
        paymasterDeposits[paymaster] -= actualCost;
        
        // Transfer to beneficiary (EntryPoint)
        quoteToken.safeTransfer(address(entryPoint), actualCost);
        
        // Call paymaster postOp if present
        if (op.paymasterAndData.length > 20) {
            bytes memory paymasterData = op.paymasterAndData[20:];
            // In production, would call paymaster.postOp
        }
    }
    
    /**
     * @dev Calculate gas cost for operation
     */
    function _calculateGasCost(IEntryPoint.UserOperation calldata op) 
        internal 
        pure 
        returns (uint256) 
    {
        // Simplified calculation
        uint256 totalGas = op.callGasLimit + op.verificationGasLimit + op.preVerificationGas;
        return totalGas * op.maxFeePerGas;
    }
}