// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IStETH {
    function submit(address _referral) external payable returns (uint256);
    function getPooledEthByShares(uint256 _sharesAmount) external view returns (uint256);
    function getSharesByPooledEth(uint256 _ethAmount) external view returns (uint256);
    function sharesOf(address _account) external view returns (uint256);
    function transferShares(address _recipient, uint256 _sharesAmount) external returns (uint256);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * @title LidoStETHIntegrator
 * @notice Integration for Lido stETH as yield-bearing collateral
 * @dev Handles stETH wrapping, unwrapping, and conversion with rebase safety
 */
contract LidoStETHIntegrator is ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // ============ IMMUTABLES ============
    IStETH public immutable stETH;
    IERC20 public immutable wstETH; // Wrapped stETH if using wstETH
    address public immutable perpEngine;
    
    // ============ STATE VARIABLES ============
    bool public useWstETH; // Whether to use wstETH (non-rebasing) instead of stETH
    uint256 public minWrapAmount = 0.1 ether;
    uint256 public maxWrapAmount = 10_000 ether;
    
    mapping(address => uint256) public userShares;
    mapping(address => uint256) public lastUpdateTime;
    
    // Conversion rate tracking
    uint256 public lastConversionRate;
    uint256 public conversionRateUpdateTime;
    uint256 public conversionRateDecayPeriod = 24 hours;
    
    // ============ EVENTS ============
    event ETHWrapped(
        address indexed user,
        uint256 ethAmount,
        uint256 stETHAmount,
        uint256 shares,
        bool asWstETH
    );
    
    event stETHUnwrapped(
        address indexed user,
        uint256 stETHAmount,
        uint256 ethAmount,
        uint256 shares
    );
    
    event CollateralDeposited(
        address indexed user,
        uint256 amount,
        bool isStETH,
        uint256 timestamp
    );
    
    event CollateralWithdrawn(
        address indexed user,
        uint256 amount,
        bool isStETH,
        uint256 timestamp
    );
    
    event ConversionRateUpdated(
        uint256 oldRate,
        uint256 newRate,
        uint256 timestamp
    );
    
    event LimitsUpdated(uint256 minWrapAmount, uint256 maxWrapAmount);
    event WstETHModeUpdated(bool useWstETH);
    
    // ============ MODIFIERS ============
    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "Only PerpEngine");
        _;
    }
    
    modifier validAmount(uint256 amount) {
        require(amount >= minWrapAmount, "Below minimum");
        require(amount <= maxWrapAmount, "Above maximum");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        address _stETH,
        address _wstETH,
        address _perpEngine,
        bool _useWstETH
    ) {
        require(_stETH != address(0), "Invalid stETH");
        require(_wstETH != address(0), "Invalid wstETH");
        require(_perpEngine != address(0), "Invalid PerpEngine");
        
        stETH = IStETH(_stETH);
        wstETH = IERC20(_wstETH);
        perpEngine = _perpEngine;
        useWstETH = _useWstETH;
        
        // Initial conversion rate (1 stETH = 1 ETH)
        lastConversionRate = 1e18;
        conversionRateUpdateTime = block.timestamp;
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Wrap ETH to stETH (or wstETH)
     * @param referral Optional referral address
     */
    function wrapETH(address referral) external payable nonReentrant validAmount(msg.value) {
        uint256 ethAmount = msg.value;
        require(ethAmount > 0, "No ETH sent");
        
        if (useWstETH) {
            // Wrap to wstETH (non-rebasing)
            uint256 stETHAmount = _submitToLido{value: ethAmount}(referral);
            uint256 wstETHAmount = _stETHToWstETH(stETHAmount);
            
            // Transfer wstETH to user
            wstETH.safeTransfer(msg.sender, wstETHAmount);
            
            emit ETHWrapped(msg.sender, ethAmount, stETHAmount, 0, true);
        } else {
            // Direct stETH (rebasing)
            uint256 shares = _submitToLido{value: ethAmount}(referral);
            
            // Get stETH amount from shares
            uint256 stETHAmount = stETH.getPooledEthByShares(shares);
            
            // Transfer stETH to user
            require(stETH.transferFrom(address(this), msg.sender, stETHAmount), "Transfer failed");
            
            emit ETHWrapped(msg.sender, ethAmount, stETHAmount, shares, false);
        }
    }
    
    /**
     * @notice Unwrap stETH/wstETH to ETH
     * @param amount Amount to unwrap
     */
    function unwrapToETH(uint256 amount) external nonReentrant validAmount(amount) {
        require(amount > 0, "Invalid amount");
        
        if (useWstETH) {
            // Unwrap wstETH to ETH
            // Note: This requires withdrawal queue integration in production
            // For now, we simulate with a 1:1 conversion
            
            wstETH.safeTransferFrom(msg.sender, address(this), amount);
            
            // In production, would use Lido withdrawal queue
            // For this example, we assume immediate 1:1 conversion
            uint256 ethAmount = amount;
            
            (bool success, ) = msg.sender.call{value: ethAmount}("");
            require(success, "ETH transfer failed");
            
            emit stETHUnwrapped(msg.sender, amount, ethAmount, 0);
        } else {
            // Unwrap stETH to ETH
            // Note: stETH cannot be directly unwrapped to ETH
            // This would require withdrawal queue integration
            
            // For this example, we transfer stETH and mark for withdrawal
            stETH.transferFrom(msg.sender, address(this), amount);
            
            // In production, would queue withdrawal
            // Placeholder: emit event for off-chain processing
            
            emit stETHUnwrapped(msg.sender, amount, 0, 0);
        }
    }
    
    /**
     * @notice Deposit stETH/wstETH as collateral
     * @param amount Amount to deposit
     */
    function depositCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid amount");
        
        if (useWstETH) {
            // Deposit wstETH
            wstETH.safeTransferFrom(msg.sender, address(this), amount);
            userShares[msg.sender] += amount;
        } else {
            // Deposit stETH
            stETH.transferFrom(msg.sender, address(this), amount);
            
            // Convert stETH amount to shares for tracking
            uint256 shares = stETH.getSharesByPooledEth(amount);
            userShares[msg.sender] += shares;
        }
        
        lastUpdateTime[msg.sender] = block.timestamp;
        
        emit CollateralDeposited(msg.sender, amount, !useWstETH, block.timestamp);
    }
    
    /**
     * @notice Withdraw collateral
     * @param amount Amount to withdraw
     */
    function withdrawCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(userShares[msg.sender] >= amount, "Insufficient shares");
        
        userShares[msg.sender] -= amount;
        
        if (useWstETH) {
            // Withdraw wstETH
            wstETH.safeTransfer(msg.sender, amount);
        } else {
            // Withdraw stETH
            uint256 stETHAmount = stETH.getPooledEthByShares(amount);
            require(stETH.transfer(msg.sender, stETHAmount), "Transfer failed");
        }
        
        emit CollateralWithdrawn(msg.sender, amount, !useWstETH, block.timestamp);
    }
    
    /**
     * @notice Update conversion rate based on current stETH:ETH ratio
     */
    function updateConversionRate() external {
        require(
            block.timestamp >= conversionRateUpdateTime + conversionRateDecayPeriod,
            "Rate update too frequent"
        );
        
        uint256 newRate = _getCurrentConversionRate();
        uint256 oldRate = lastConversionRate;
        
        // Ensure rate doesn't change too drastically
        uint256 maxChange = (oldRate * 10) / 100; // 10% max change
        require(
            newRate <= oldRate + maxChange && newRate >= oldRate - maxChange,
            "Rate change too large"
        );
        
        lastConversionRate = newRate;
        conversionRateUpdateTime = block.timestamp;
        
        emit ConversionRateUpdated(oldRate, newRate, block.timestamp);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get current stETH:ETH conversion rate
     * @return rate Conversion rate (1e18 = 1:1)
     */
    function getConversionRate() external view returns (uint256) {
        return _getCurrentConversionRate();
    }
    
    /**
     * @notice Get collateral value for user
     * @param user User address
     * @return value Collateral value in ETH terms
     */
    function getCollateralValue(address user) external view returns (uint256) {
        uint256 shares = userShares[user];
        
        if (shares == 0) return 0;
        
        if (useWstETH) {
            // wstETH is non-rebasing, 1:1 with stETH at wrap time
            return shares;
        } else {
            // stETH is rebasing, convert shares to ETH
            return stETH.getPooledEthByShares(shares);
        }
    }
    
    /**
     * @notice Get amount of stETH/wstETH for given ETH value
     * @param ethValue ETH value
     * @return tokenAmount Corresponding token amount
     */
    function getTokenAmountForETH(uint256 ethValue) external view returns (uint256) {
        if (useWstETH) {
            // wstETH uses last conversion rate
            return (ethValue * 1e18) / lastConversionRate;
        } else {
            // stETH uses current rate
            uint256 currentRate = _getCurrentConversionRate();
            return (ethValue * 1e18) / currentRate;
        }
    }
    
    /**
     * @notice Check if user has sufficient collateral
     * @param user User address
     * @param requiredAmount Required ETH value
     * @return sufficient True if sufficient
     */
    function hasSufficientCollateral(address user, uint256 requiredAmount) 
        external 
        view 
        returns (bool) 
    {
        return getCollateralValue(user) >= requiredAmount;
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Update wrap/unwrap limits
     * @param newMinAmount New minimum amount
     * @param newMaxAmount New maximum amount
     */
    function updateLimits(uint256 newMinAmount, uint256 newMaxAmount) external onlyPerpEngine {
        require(newMinAmount > 0, "Invalid min amount");
        require(newMaxAmount > newMinAmount, "Invalid max amount");
        
        minWrapAmount = newMinAmount;
        maxWrapAmount = newMaxAmount;
        
        emit LimitsUpdated(newMinAmount, newMaxAmount);
    }
    
    /**
     * @notice Toggle wstETH mode
     * @param _useWstETH Whether to use wstETH
     */
    function setWstETHMode(bool _useWstETH) external onlyPerpEngine {
        require(useWstETH != _useWstETH, "Already in this mode");
        
        useWstETH = _useWstETH;
        
        emit WstETHModeUpdated(_useWstETH);
    }
    
    /**
     * @notice Emergency withdraw stuck ETH
     * @param amount Amount to withdraw
     */
    function emergencyWithdrawETH(uint256 amount) external onlyPerpEngine {
        require(address(this).balance >= amount, "Insufficient ETH");
        
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
    
    /**
     * @notice Emergency recover stuck tokens
     * @param token Token to recover
     * @param amount Amount to recover
     */
    function emergencyRecover(address token, uint256 amount) external onlyPerpEngine {
        require(token != address(stETH) && token != address(wstETH), "Cannot recover stETH/wstETH");
        
        IERC20(token).safeTransfer(msg.sender, amount);
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Submit ETH to Lido and receive stETH
     */
    function _submitToLido(address referral) internal returns (uint256) {
        uint256 balanceBefore = stETH.balanceOf(address(this));
        
        // Submit ETH to Lido
        stETH.submit{value: msg.value}(referral);
        
        uint256 balanceAfter = stETH.balanceOf(address(this));
        return balanceAfter - balanceBefore;
    }
    
    /**
     * @dev Convert stETH to wstETH
     */
    function _stETHToWstETH(uint256 stETHAmount) internal returns (uint256) {
        // In production, would use wstETH contract
        // For this example, we assume 1:1 conversion
        
        // Approve wstETH contract
        stETH.approve(address(wstETH), stETHAmount);
        
        // Convert (would call wstETH.wrap() in production)
        // Placeholder: return same amount
        return stETHAmount;
    }
    
    /**
     * @dev Get current conversion rate
     */
    function _getCurrentConversionRate() internal view returns (uint256) {
        // In production, would get from oracle or calculate
        // For this example, we use stETH pool ratio
        
        if (address(stETH) == address(0)) return 1e18;
        
        // Get total pooled ETH per share
        try stETH.getPooledEthByShares(1e18) returns (uint256 rate) {
            return rate;
        } catch {
            return 1e18;
        }
    }
    
    // ============ FALLBACK FUNCTIONS ============
    
    receive() external payable {
        // Accept ETH for wrapping
    }
    
    fallback() external payable {
        revert("Invalid call");
    }
}