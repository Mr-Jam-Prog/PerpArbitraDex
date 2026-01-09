// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title VotingEscrow
 * @notice veToken implementation for time-weighted voting power
 * @dev Inspired by Curve's veCRV model
 */
contract VotingEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ============ STRUCTS ============
    struct LockedBalance {
        uint256 amount;
        uint256 unlockTime;
    }

    struct Point {
        int128 bias;
        int128 slope;
        uint256 ts;
        uint256 blk;
    }

    // ============ CONSTANTS ============
    uint256 public constant MAX_TIME = 4 * 365 days; // 4 years
    uint256 public constant WEEK = 7 days;
    uint256 public constant MULTIPLIER = 1e18;

    // ============ IMMUTABLES ============
    IERC20 public immutable token;
    address public immutable feeDistributor;

    // ============ STATE VARIABLES ============
    mapping(address => LockedBalance) public locked;
    mapping(address => uint256) public epochOf;
    mapping(uint256 => Point) public pointHistory;
    mapping(address => mapping(uint256 => Point)) public userPointHistory;
    
    uint256 public epoch;
    uint256 public totalLocked;
    uint256 public totalVotingPower;
    
    string public name;
    string public symbol;
    uint8 public decimals;

    // ============ EVENTS ============
    event Deposit(
        address indexed provider,
        uint256 amount,
        uint256 unlockTime,
        uint256 indexed epoch,
        uint256 timestamp
    );
    event Withdraw(address indexed provider, uint256 amount, uint256 timestamp);
    event VotingPowerUpdated(
        address indexed user,
        uint256 oldPower,
        uint256 newPower,
        uint256 timestamp
    );
    event SupplyUpdated(uint256 oldSupply, uint256 newSupply, uint256 timestamp);

    // ============ MODIFIERS ============
    modifier notContract() {
        require(msg.sender == tx.origin, "No contracts");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _token,
        address _feeDistributor,
        string memory _name,
        string memory _symbol
    ) {
        require(_token != address(0), "Invalid token");
        require(_feeDistributor != address(0), "Invalid fee distributor");
        
        token = IERC20(_token);
        feeDistributor = _feeDistributor;
        name = _name;
        symbol = _symbol;
        decimals = 18;
        
        // Initialize point history
        pointHistory[0] = Point({
            bias: 0,
            slope: 0,
            ts: block.timestamp,
            blk: block.number
        });
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Lock tokens for voting power
     * @param amount Amount to lock
     * @param unlockTime Unix timestamp when tokens unlock
     */
    function createLock(uint256 amount, uint256 unlockTime) 
        external 
        nonReentrant 
        notContract 
    {
        require(amount > 0, "Zero amount");
        require(unlockTime > block.timestamp, "Unlock time in past");
        require(unlockTime <= block.timestamp + MAX_TIME, "Lock time too long");
        
        LockedBalance storage lockedBalance = locked[msg.sender];
        require(lockedBalance.amount == 0, "Already locked");
        
        // Transfer tokens
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate voting power
        uint256 votingPower = _calculateVotingPower(amount, unlockTime);
        
        // Update locked balance
        lockedBalance.amount = amount;
        lockedBalance.unlockTime = unlockTime;
        
        // Update totals
        totalLocked += amount;
        totalVotingPower += votingPower;
        
        // Update point history
        _updateUserPoint(msg.sender);
        _updateGlobalPoint();
        
        epoch++;
        epochOf[msg.sender] = epoch;
        
        emit Deposit(msg.sender, amount, unlockTime, epoch, block.timestamp);
        emit VotingPowerUpdated(msg.sender, 0, votingPower, block.timestamp);
        emit SupplyUpdated(totalLocked - amount, totalLocked, block.timestamp);
    }

    /**
     * @notice Increase lock amount
     * @param amount Additional amount to lock
     */
    function increaseAmount(uint256 amount) external nonReentrant notContract {
        require(amount > 0, "Zero amount");
        
        LockedBalance storage lockedBalance = locked[msg.sender];
        require(lockedBalance.amount > 0, "No lock");
        require(lockedBalance.unlockTime > block.timestamp, "Lock expired");
        
        // Transfer tokens
        token.safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate additional voting power
        uint256 additionalPower = _calculateVotingPower(
            amount, 
            lockedBalance.unlockTime
        );
        
        // Update locked balance
        uint256 oldAmount = lockedBalance.amount;
        lockedBalance.amount += amount;
        
        // Update totals
        totalLocked += amount;
        totalVotingPower += additionalPower;
        
        // Update point history
        _updateUserPoint(msg.sender);
        _updateGlobalPoint();
        
        emit Deposit(msg.sender, amount, lockedBalance.unlockTime, epoch, block.timestamp);
        emit VotingPowerUpdated(
            msg.sender, 
            _calculateVotingPower(oldAmount, lockedBalance.unlockTime),
            _calculateVotingPower(lockedBalance.amount, lockedBalance.unlockTime),
            block.timestamp
        );
        emit SupplyUpdated(totalLocked - amount, totalLocked, block.timestamp);
    }

    /**
     * @notice Increase lock duration
     * @param unlockTime New unlock time
     */
    function increaseUnlockTime(uint256 unlockTime) external nonReentrant notContract {
        LockedBalance storage lockedBalance = locked[msg.sender];
        require(lockedBalance.amount > 0, "No lock");
        require(unlockTime > lockedBalance.unlockTime, "Not increasing");
        require(unlockTime <= block.timestamp + MAX_TIME, "Lock time too long");
        
        uint256 oldUnlockTime = lockedBalance.unlockTime;
        uint256 amount = lockedBalance.amount;
        
        // Calculate old and new voting power
        uint256 oldPower = _calculateVotingPower(amount, oldUnlockTime);
        uint256 newPower = _calculateVotingPower(amount, unlockTime);
        
        // Update locked balance
        lockedBalance.unlockTime = unlockTime;
        
        // Update voting power
        totalVotingPower = totalVotingPower - oldPower + newPower;
        
        // Update point history
        _updateUserPoint(msg.sender);
        _updateGlobalPoint();
        
        emit Deposit(msg.sender, 0, unlockTime, epoch, block.timestamp);
        emit VotingPowerUpdated(msg.sender, oldPower, newPower, block.timestamp);
    }

    /**
     * @notice Withdraw locked tokens after unlock time
     */
    function withdraw() external nonReentrant notContract {
        LockedBalance storage lockedBalance = locked[msg.sender];
        require(lockedBalance.amount > 0, "No lock");
        require(block.timestamp >= lockedBalance.unlockTime, "Lock not expired");
        
        uint256 amount = lockedBalance.amount;
        
        // Calculate remaining voting power (should be 0 at unlock)
        uint256 oldPower = _calculateVotingPower(amount, lockedBalance.unlockTime);
        
        // Update totals
        totalLocked -= amount;
        totalVotingPower -= oldPower;
        
        // Clear locked balance
        delete locked[msg.sender];
        
        // Update point history
        _updateUserPoint(msg.sender);
        _updateGlobalPoint();
        
        // Transfer tokens
        token.safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, amount, block.timestamp);
        emit VotingPowerUpdated(msg.sender, oldPower, 0, block.timestamp);
        emit SupplyUpdated(totalLocked + amount, totalLocked, block.timestamp);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get voting power for address
     * @param account Address to check
     * @return power Current voting power
     */
    function getVotingPower(address account) external view returns (uint256) {
        LockedBalance memory lockedBalance = locked[account];
        if (lockedBalance.amount == 0) return 0;
        
        if (block.timestamp >= lockedBalance.unlockTime) return 0;
        
        return _calculateVotingPower(lockedBalance.amount, lockedBalance.unlockTime);
    }

    /**
     * @notice Get voting power at specific timestamp
     * @param account Address to check
     * @param timestamp Timestamp to check
     * @return power Voting power at timestamp
     */
    function getVotingPowerAt(address account, uint256 timestamp) 
        external 
        view 
        returns (uint256) 
    {
        LockedBalance memory lockedBalance = locked[account];
        if (lockedBalance.amount == 0) return 0;
        
        if (timestamp >= lockedBalance.unlockTime) return 0;
        
        return _calculateVotingPower(lockedBalance.amount, lockedBalance.unlockTime);
    }

    /**
     * @notice Get remaining lock time for address
     * @param account Address to check
     * @return remainingTime Remaining lock time in seconds
     */
    function getRemainingLockTime(address account) external view returns (uint256) {
        LockedBalance memory lockedBalance = locked[account];
        if (lockedBalance.amount == 0) return 0;
        if (block.timestamp >= lockedBalance.unlockTime) return 0;
        
        return lockedBalance.unlockTime - block.timestamp;
    }

    /**
     * @notice Get total voting power supply
     * @return totalSupply Total voting power
     */
    function totalSupply() external view returns (uint256) {
        return totalVotingPower;
    }

    /**
     * @notice Get balance (locked amount) for address
     * @param account Address to check
     * @return balance Locked token amount
     */
    function balanceOf(address account) external view returns (uint256) {
        return locked[account].amount;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Calculate voting power based on amount and unlock time
     * @param amount Locked amount
     * @param unlockTime Unlock timestamp
     * @return votingPower Calculated voting power
     */
    function _calculateVotingPower(uint256 amount, uint256 unlockTime) 
        internal 
        view 
        returns (uint256) 
    {
        if (amount == 0) return 0;
        if (block.timestamp >= unlockTime) return 0;
        
        uint256 lockDuration = unlockTime - block.timestamp;
        uint256 maxDuration = MAX_TIME;
        
        // Linear decay: power = amount * (time_remaining / max_time)
        return (amount * lockDuration) / maxDuration;
    }

    /**
     * @dev Update user point history
     * @param user User address
     */
    function _updateUserPoint(address user) internal {
        LockedBalance memory lockedBalance = locked[user];
        uint256 userEpoch = epochOf[user];
        
        int128 bias = 0;
        int128 slope = 0;
        
        if (lockedBalance.amount > 0 && block.timestamp < lockedBalance.unlockTime) {
            uint256 remainingTime = lockedBalance.unlockTime - block.timestamp;
            bias = int128(int256((lockedBalance.amount * remainingTime) / MAX_TIME));
            slope = int128(int256(lockedBalance.amount / MAX_TIME));
        }
        
        userPointHistory[user][userEpoch] = Point({
            bias: bias,
            slope: slope,
            ts: block.timestamp,
            blk: block.number
        });
    }

    /**
     * @dev Update global point history
     */
    function _updateGlobalPoint() internal {
        pointHistory[epoch] = Point({
            bias: int128(int256(totalVotingPower)),
            slope: 0, // Would need slope calculation for global decay
            ts: block.timestamp,
            blk: block.number
        });
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Emergency withdraw for expired locks
     * @dev Only callable after lock expiration
     */
    function emergencyWithdrawExpired() external nonReentrant {
        LockedBalance storage lockedBalance = locked[msg.sender];
        require(lockedBalance.amount > 0, "No lock");
        require(block.timestamp >= lockedBalance.unlockTime, "Lock not expired");
        
        uint256 amount = lockedBalance.amount;
        
        // Clear locked balance
        delete locked[msg.sender];
        
        // Update totals (voting power should already be 0)
        totalLocked -= amount;
        
        // Transfer tokens
        token.safeTransfer(msg.sender, amount);
        
        emit Withdraw(msg.sender, amount, block.timestamp);
        emit SupplyUpdated(totalLocked + amount, totalLocked, block.timestamp);
    }
}