// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

interface IOracle {
    function getPrice(bytes32 feedId) external view returns (uint256);
}

/**
 * @title CollateralWrapper
 * @notice Wrapper for RWA and other collateral with timelocked redemptions
 * @dev Provides secure wrapping of real-world assets with oracle price feeds
 */
contract CollateralWrapper is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // ============ IMMUTABLES ============
    IERC20 public immutable underlying;
    IOracle public immutable oracle;
    bytes32 public immutable feedId;
    
    // ============ STATE VARIABLES ============
    uint256 public minWrapAmount = 1000; // Minimum wrap amount
    uint256 public maxWrapAmount = 1_000_000 * 10**18; // Maximum wrap amount
    uint256 public redemptionDelay = 7 days; // Timelock for redemptions
    uint256 public oracleDeviationThreshold = 5 * 10**16; // 5% deviation
    
    mapping(address => RedemptionRequest) public redemptionRequests;
    uint256 public totalWrapped;
    
    // ============ STRUCTS ============
    struct RedemptionRequest {
        uint256 amount;
        uint256 requestTime;
        uint256 oraclePrice;
        bool processed;
    }
    
    // ============ EVENTS ============
    event Wrapped(
        address indexed user,
        uint256 underlyingAmount,
        uint256 wrappedAmount,
        uint256 oraclePrice
    );
    
    event RedemptionRequested(
        address indexed user,
        uint256 wrappedAmount,
        uint256 underlyingAmount,
        uint256 oraclePrice,
        uint256 unlockTime
    );
    
    event RedemptionCompleted(
        address indexed user,
        uint256 wrappedAmount,
        uint256 underlyingAmount,
        uint256 oraclePrice
    );
    
    event RedemptionCancelled(address indexed user, uint256 wrappedAmount);
    event LimitsUpdated(uint256 minAmount, uint256 maxAmount);
    event RedemptionDelayUpdated(uint256 oldDelay, uint256 newDelay);
    event OracleDeviationUpdated(uint256 oldThreshold, uint256 newThreshold);
    
    // ============ MODIFIERS ============
    modifier validAmount(uint256 amount) {
        require(amount >= minWrapAmount, "Below minimum");
        require(amount <= maxWrapAmount, "Above maximum");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        string memory name,
        string memory symbol,
        address _underlying,
        address _oracle,
        bytes32 _feedId,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        require(_underlying != address(0), "Invalid underlying");
        require(_oracle != address(0), "Invalid oracle");
        
        underlying = IERC20(_underlying);
        oracle = IOracle(_oracle);
        feedId = _feedId;
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Wrap underlying tokens
     * @param amount Amount to wrap
     * @return wrappedAmount Amount of wrapped tokens minted
     */
    function wrap(uint256 amount) 
        external 
        nonReentrant 
        validAmount(amount) 
        returns (uint256 wrappedAmount) 
    {
        require(amount > 0, "Invalid amount");
        
        // Get oracle price
        uint256 oraclePrice = oracle.getPrice(feedId);
        require(oraclePrice > 0, "Invalid oracle price");
        
        // Transfer underlying tokens
        underlying.safeTransferFrom(msg.sender, address(this), amount);
        
        // Calculate wrapped amount (1:1 based on oracle price)
        wrappedAmount = amount;
        
        // Mint wrapped tokens
        _mint(msg.sender, wrappedAmount);
        
        // Update total wrapped
        totalWrapped += amount;
        
        emit Wrapped(msg.sender, amount, wrappedAmount, oraclePrice);
        
        return wrappedAmount;
    }
    
    /**
     * @notice Request redemption of wrapped tokens
     * @param amount Amount to redeem
     */
    function requestRedemption(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        
        // Check for existing request
        RedemptionRequest storage request = redemptionRequests[msg.sender];
        require(!request.processed && request.amount == 0, "Existing request");
        
        // Get oracle price
        uint256 oraclePrice = oracle.getPrice(feedId);
        require(oraclePrice > 0, "Invalid oracle price");
        
        // Calculate underlying amount
        uint256 underlyingAmount = amount; // 1:1 for this implementation
        
        // Burn wrapped tokens
        _burn(msg.sender, amount);
        
        // Store redemption request
        redemptionRequests[msg.sender] = RedemptionRequest({
            amount: underlyingAmount,
            requestTime: block.timestamp,
            oraclePrice: oraclePrice,
            processed: false
        });
        
        emit RedemptionRequested(
            msg.sender,
            amount,
            underlyingAmount,
            oraclePrice,
            block.timestamp + redemptionDelay
        );
    }
    
    /**
     * @notice Complete redemption after delay
     */
    function completeRedemption() external nonReentrant {
        RedemptionRequest storage request = redemptionRequests[msg.sender];
        require(request.amount > 0, "No redemption request");
        require(!request.processed, "Already processed");
        require(
            block.timestamp >= request.requestTime + redemptionDelay,
            "Redemption delay not passed"
        );
        
        // Verify oracle price hasn't deviated too much
        uint256 currentPrice = oracle.getPrice(feedId);
        uint256 deviation = _calculateDeviation(request.oraclePrice, currentPrice);
        require(deviation <= oracleDeviationThreshold, "Oracle deviation too high");
        
        // Mark as processed
        request.processed = true;
        
        // Transfer underlying tokens
        underlying.safeTransfer(msg.sender, request.amount);
        
        // Update total wrapped
        totalWrapped -= request.amount;
        
        emit RedemptionCompleted(
            msg.sender,
            request.amount,
            request.amount,
            currentPrice
        );
    }
    
    /**
     * @notice Cancel redemption request
     */
    function cancelRedemption() external nonReentrant {
        RedemptionRequest storage request = redemptionRequests[msg.sender];
        require(request.amount > 0, "No redemption request");
        require(!request.processed, "Already processed");
        
        uint256 amount = request.amount;
        
        // Delete request
        delete redemptionRequests[msg.sender];
        
        // Mint wrapped tokens back
        _mint(msg.sender, amount);
        
        emit RedemptionCancelled(msg.sender, amount);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get redemption request info
     * @param user User address
     * @return amount Requested amount
     * @return requestTime Request timestamp
     * @return unlockTime When redemption unlocks
     * @return processed Whether processed
     */
    function getRedemptionInfo(address user) 
        external 
        view 
        returns (
            uint256 amount,
            uint256 requestTime,
            uint256 unlockTime,
            bool processed
        ) 
    {
        RedemptionRequest memory request = redemptionRequests[user];
        return (
            request.amount,
            request.requestTime,
            request.requestTime + redemptionDelay,
            request.processed
        );
    }
    
    /**
     * @notice Check if redemption is ready
     * @param user User address
     * @return ready True if ready
     * @return remainingTime Remaining time if not ready
     */
    function isRedemptionReady(address user) 
        external 
        view 
        returns (bool ready, uint256 remainingTime) 
    {
        RedemptionRequest memory request = redemptionRequests[user];
        
        if (request.amount == 0 || request.processed) {
            return (false, 0);
        }
        
        if (block.timestamp >= request.requestTime + redemptionDelay) {
            return (true, 0);
        } else {
            remainingTime = request.requestTime + redemptionDelay - block.timestamp;
            return (false, remainingTime);
        }
    }
    
    /**
     * @notice Get conversion rate
     * @return rate Conversion rate (1e18 = 1:1)
     */
    function getConversionRate() external view returns (uint256) {
        return oracle.getPrice(feedId);
    }
    
    /**
     * @notice Get total underlying value
     * @return value Total underlying value
     */
    function getTotalUnderlyingValue() external view returns (uint256) {
        return totalWrapped;
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update wrap/unwrap limits
     * @param newMinAmount New minimum amount
     * @param newMaxAmount New maximum amount
     */
    function updateLimits(uint256 newMinAmount, uint256 newMaxAmount) external onlyOwner {
        require(newMinAmount > 0, "Invalid min amount");
        require(newMaxAmount > newMinAmount, "Invalid max amount");
        
        minWrapAmount = newMinAmount;
        maxWrapAmount = newMaxAmount;
        
        emit LimitsUpdated(newMinAmount, newMaxAmount);
    }
    
    /**
     * @notice Update redemption delay
     * @param newDelay New delay in seconds
     */
    function updateRedemptionDelay(uint256 newDelay) external onlyOwner {
        require(newDelay <= 30 days, "Delay too long");
        
        emit RedemptionDelayUpdated(redemptionDelay, newDelay);
        redemptionDelay = newDelay;
    }
    
    /**
     * @notice Update oracle deviation threshold
     * @param newThreshold New threshold (1e18 = 100%)
     */
    function updateOracleDeviation(uint256 newThreshold) external onlyOwner {
        require(newThreshold <= 20 * 10**16, "Threshold too high"); // Max 20%
        
        emit OracleDeviationUpdated(oracleDeviationThreshold, newThreshold);
        oracleDeviationThreshold = newThreshold;
    }
    
    /**
     * @notice Emergency withdraw underlying tokens
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid amount");
        require(underlying.balanceOf(address(this)) >= amount, "Insufficient balance");
        
        underlying.safeTransfer(owner(), amount);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Calculate price deviation
     */
    function _calculateDeviation(uint256 oldPrice, uint256 newPrice) 
        internal 
        pure 
        returns (uint256) 
    {
        if (oldPrice == 0 || newPrice == 0) return type(uint256).max;
        
        uint256 difference = oldPrice > newPrice ? oldPrice - newPrice : newPrice - oldPrice;
        return (difference * 1e18) / oldPrice;
    }
}