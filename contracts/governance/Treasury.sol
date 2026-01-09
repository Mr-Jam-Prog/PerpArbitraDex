// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title Treasury
 * @notice Protocol treasury with timelocked withdrawals
 * @dev All withdrawals require timelock delay
 */
contract Treasury is AccessControl {
    using SafeERC20 for IERC20;

    // ============ ROLES ============
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    // ============ IMMUTABLES ============
    TimelockController public immutable timelock;
    uint256 public immutable minDelay;

    // ============ STATE VARIABLES ============
    mapping(bytes32 => bool) public scheduledWithdrawals;
    mapping(address => uint256) public totalWithdrawn;
    uint256 public totalRevenue;

    // ============ EVENTS ============
    event FundsReceived(address indexed token, uint256 amount, address from);
    event WithdrawalScheduled(
        bytes32 indexed operationId,
        address indexed token,
        address indexed to,
        uint256 amount,
        bytes32 salt,
        uint256 delay
    );
    event WithdrawalExecuted(
        bytes32 indexed operationId,
        address indexed token,
        address indexed to,
        uint256 amount
    );
    event WithdrawalCancelled(bytes32 indexed operationId, address indexed cancelledBy);
    event EmergencyWithdrawal(
        address indexed token,
        address indexed to,
        uint256 amount,
        address indexed by
    );

    // ============ CONSTRUCTOR ============
    constructor(
        address _timelock,
        uint256 _minDelay,
        address initialGuardian
    ) {
        require(_timelock != address(0), "Invalid timelock");
        require(_minDelay > 0, "Invalid min delay");
        
        timelock = TimelockController(payable(_timelock));
        minDelay = _minDelay;
        
        _setupRole(GUARDIAN_ROLE, initialGuardian);
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ============ RECEIVE FUNCTIONS ============

    /**
     * @notice Receive protocol fees
     * @param token Token address
     * @param amount Amount received
     */
    function receiveFunds(address token, uint256 amount) external {
        require(amount > 0, "Invalid amount");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalRevenue += amount;
        
        emit FundsReceived(token, amount, msg.sender);
    }

    /**
     * @notice Receive native ETH
     */
    receive() external payable {
        require(msg.value > 0, "Invalid amount");
        totalRevenue += msg.value;
        
        emit FundsReceived(address(0), msg.value, msg.sender);
    }

    // ============ WITHDRAWAL FUNCTIONS ============

    /**
     * @notice Schedule a withdrawal
     * @param token Token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     * @param salt Unique salt
     * @return operationId Scheduled operation ID
     */
    function scheduleWithdrawal(
        address token,
        address to,
        uint256 amount,
        bytes32 salt
    ) external onlyRole(PROPOSER_ROLE) returns (bytes32 operationId) {
        require(token != address(0), "Invalid token");
        require(to != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");
        require(
            IERC20(token).balanceOf(address(this)) >= amount,
            "Insufficient balance"
        );

        operationId = keccak256(
            abi.encode(token, to, amount, salt, block.timestamp)
        );
        
        require(!scheduledWithdrawals[operationId], "Already scheduled");
        
        // Schedule via timelock
        bytes memory data = abi.encodeWithSelector(
            this.executeWithdrawal.selector,
            token,
            to,
            amount
        );
        
        timelock.schedule(address(this), 0, data, bytes32(0), salt, minDelay);
        
        scheduledWithdrawals[operationId] = true;
        
        emit WithdrawalScheduled(operationId, token, to, amount, salt, minDelay);
        
        return operationId;
    }

    /**
     * @notice Execute scheduled withdrawal
     * @param token Token to withdraw
     * @param to Recipient address
     * @param amount Amount to withdraw
     */
    function executeWithdrawal(
        address token,
        address to,
        uint256 amount
    ) external onlyRole(EXECUTOR_ROLE) {
        bytes32 operationId = keccak256(
            abi.encode(token, to, amount, bytes32(0), block.timestamp)
        );
        
        require(scheduledWithdrawals[operationId], "Not scheduled");
        
        // Execute withdrawal
        if (token == address(0)) {
            (bool success, ) = to.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        
        totalWithdrawn[token] += amount;
        delete scheduledWithdrawals[operationId];
        
        emit WithdrawalExecuted(operationId, token, to, amount);
    }

    /**
     * @notice Cancel scheduled withdrawal
     * @param operationId Operation to cancel
     */
    function cancelWithdrawal(bytes32 operationId) external onlyRole(GUARDIAN_ROLE) {
        require(scheduledWithdrawals[operationId], "Not scheduled");
        
        delete scheduledWithdrawals[operationId];
        
        emit WithdrawalCancelled(operationId, msg.sender);
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @notice Emergency withdrawal (only guardian, only to timelock)
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawal(address token, uint256 amount) 
        external 
        onlyRole(GUARDIAN_ROLE) 
    {
        require(amount > 0, "Invalid amount");
        
        address timelockAddress = address(timelock);
        
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH");
            (bool success, ) = timelockAddress.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            require(
                IERC20(token).balanceOf(address(this)) >= amount,
                "Insufficient balance"
            );
            IERC20(token).safeTransfer(timelockAddress, amount);
        }
        
        emit EmergencyWithdrawal(token, timelockAddress, amount, msg.sender);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get token balance
     * @param token Token address
     * @return balance Token balance
     */
    function getBalance(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Check if withdrawal is scheduled
     * @param operationId Operation ID
     * @return scheduled True if scheduled
     */
    function isScheduled(bytes32 operationId) external view returns (bool) {
        return scheduledWithdrawals[operationId];
    }

    /**
     * @notice Get total withdrawn per token
     * @param token Token address
     * @return total Total withdrawn
     */
    function getTotalWithdrawn(address token) external view returns (uint256) {
        return totalWithdrawn[token];
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update timelock roles
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
}