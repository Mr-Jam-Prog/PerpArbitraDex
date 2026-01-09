// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import {IFlashLoanReceiver} from "../interfaces/IFlashLoanReceiver.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IAavePool} from "../interfaces/external/IAavePool.sol";

/**
 * @title FlashLiquidator
 * @notice Flash loan enabled liquidator for capital-efficient liquidations
 * @dev Integrates with Aave V3 for atomic liquidation + flash loan repayment
 */
contract FlashLiquidator is IFlashLoanReceiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ IMMUTABLES ============
    IAavePool public immutable aavePool;
    ILiquidationEngine public immutable liquidationEngine;
    IPerpEngine public immutable perpEngine;
    IERC20 public immutable quoteToken;
    
    // ============ CONSTANTS ============
    uint256 public constant FLASH_LOAN_PREMIUM = 9; // 0.09% for Aave V3
    uint256 public constant PREMIUM_SCALE = 10000;
    
    // ============ STATE VARIABLES ============
    mapping(address => bool) public approvedLiquidators;
    mapping(bytes32 => FlashLoanRequest) public flashLoanRequests;
    
    // ============ STRUCTS ============
    struct FlashLoanRequest {
        address initiator;
        uint256 positionId;
        uint256 minReward;
        uint256 timestamp;
        bool executed;
    }
    
    // ============ EVENTS ============
    event FlashLiquidationExecuted(
        uint256 indexed positionId,
        address indexed liquidator,
        uint256 loanAmount,
        uint256 premium,
        uint256 reward,
        bool success
    );
    
    event LiquidatorApproved(address indexed liquidator, bool approved);
    
    // ============ MODIFIERS ============
    modifier onlyApprovedLiquidator() {
        require(approvedLiquidators[msg.sender], "Not approved liquidator");
        _;
    }
    
    modifier onlyAavePool() {
        require(msg.sender == address(aavePool), "Only Aave Pool");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _aavePool,
        address _liquidationEngine,
        address _perpEngine,
        address _quoteToken
    ) {
        require(_aavePool != address(0), "Invalid Aave Pool");
        require(_liquidationEngine != address(0), "Invalid Liquidation Engine");
        require(_perpEngine != address(0), "Invalid Perp Engine");
        require(_quoteToken != address(0), "Invalid Quote Token");
        
        aavePool = IAavePool(_aavePool);
        liquidationEngine = ILiquidationEngine(_liquidationEngine);
        perpEngine = IPerpEngine(_perpEngine);
        quoteToken = IERC20(_quoteToken);
        
        // Approve Aave Pool for quote token
        quoteToken.safeApprove(_aavePool, type(uint256).max);
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Execute flash liquidation
     * @param positionId Position to liquidate
     * @param loanAmount Amount to flash loan
     * @param minReward Minimum acceptable reward
     */
    function executeFlashLiquidation(
        uint256 positionId,
        uint256 loanAmount,
        uint256 minReward
    ) external nonReentrant onlyApprovedLiquidator returns (bool) {
        require(loanAmount > 0, "Invalid loan amount");
        require(positionId > 0, "Invalid position");
        
        // Store request for callback verification
        bytes32 requestId = keccak256(abi.encodePacked(positionId, msg.sender, block.timestamp));
        flashLoanRequests[requestId] = FlashLoanRequest({
            initiator: msg.sender,
            positionId: positionId,
            minReward: minReward,
            timestamp: block.timestamp,
            executed: false
        });
        
        // Prepare assets and amounts for flash loan
        address[] memory assets = new address[](1);
        assets[0] = address(quoteToken);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;
        
        // 0 = no debt, 1 = stable, 2 = variable
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;
        
        // Encode position data for callback
        bytes memory params = abi.encode(positionId, minReward, requestId);
        
        // Execute flash loan
        aavePool.flashLoan(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            params,
            0
        );
        
        // Verify execution
        require(flashLoanRequests[requestId].executed, "Flash loan not executed");
        
        // Clean up
        delete flashLoanRequests[requestId];
        
        return true;
    }

    /**
     * @inheritdoc IFlashLoanReceiver
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external override onlyAavePool nonReentrant returns (bool) {
        // Decode parameters
        (uint256 positionId, uint256 minReward, bytes32 requestId) = 
            abi.decode(params, (uint256, uint256, bytes32));
        
        // Validate request
        FlashLoanRequest storage request = flashLoanRequests[requestId];
        require(request.initiator == initiator, "Invalid initiator");
        require(!request.executed, "Already executed");
        require(block.timestamp <= request.timestamp + 1 hours, "Request expired");
        
        // Validate assets
        require(assets.length == 1, "Invalid assets length");
        require(assets[0] == address(quoteToken), "Invalid asset");
        require(amounts.length == 1, "Invalid amounts length");
        require(premiums.length == 1, "Invalid premiums length");
        
        uint256 loanAmount = amounts[0];
        uint256 premium = premiums[0];
        
        // Calculate required amount for repayment
        uint256 repayAmount = loanAmount + premium;
        
        // Execute liquidation
        try liquidationEngine.executeLiquidation(positionId, minReward) 
            returns (ILiquidationEngine.LiquidationResult memory result) {
            
            require(result.reward >= minReward, "Insufficient reward");
            
            // Ensure we have enough to repay flash loan
            uint256 contractBalance = quoteToken.balanceOf(address(this));
            require(contractBalance >= repayAmount, "Insufficient funds for repayment");
            
            // Mark as executed
            request.executed = true;
            
            // Transfer profit to liquidator (if any)
            uint256 profit = contractBalance - repayAmount;
            if (profit > 0) {
                quoteToken.safeTransfer(initiator, profit);
            }
            
            emit FlashLiquidationExecuted(
                positionId,
                initiator,
                loanAmount,
                premium,
                result.reward,
                true
            );
            
            return true;
            
        } catch Error(string memory reason) {
            // Log error and revert
            emit FlashLiquidationExecuted(
                positionId,
                initiator,
                loanAmount,
                premium,
                0,
                false
            );
            
            revert(string(abi.encodePacked("Flash liquidation failed: ", reason)));
        }
    }

    /**
     * @inheritdoc IFlashLoanReceiver
     */
    function getMaxFlashLoan(address asset) external view override returns (uint256) {
        if (asset != address(quoteToken)) return 0;
        
        // Get available liquidity from Aave
        uint256 availableLiquidity = quoteToken.balanceOf(address(aavePool));
        
        // Cap at reasonable amount to prevent manipulation
        uint256 maxLiquidity = 1_000_000 * 10**18; // 1M tokens
        
        return availableLiquidity > maxLiquidity ? maxLiquidity : availableLiquidity;
    }

    /**
     * @inheritdoc IFlashLoanReceiver
     */
    function getFlashLoanFee(address asset) external pure override returns (uint256) {
        if (asset != address(quoteToken)) return type(uint256).max;
        return FLASH_LOAN_PREMIUM;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Approve or revoke liquidator
     * @param liquidator Address to update
     * @param approved Whether approved
     */
    function setApprovedLiquidator(address liquidator, bool approved) external {
        // Only PerpEngine can approve liquidators
        require(msg.sender == address(perpEngine), "Only PerpEngine");
        
        approvedLiquidators[liquidator] = approved;
        emit LiquidatorApproved(liquidator, approved);
    }

    /**
     * @notice Emergency recover tokens
     * @param token Token to recover
     * @param amount Amount to recover
     */
    function emergencyRecover(address token, uint256 amount) external {
        require(msg.sender == address(perpEngine), "Only PerpEngine");
        require(token != address(quoteToken), "Cannot recover quote token");
        
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Update Aave Pool approval
     * @param approveAmount New approval amount
     */
    function updateAaveApproval(uint256 approveAmount) external {
        require(msg.sender == address(perpEngine), "Only PerpEngine");
        
        quoteToken.safeApprove(address(aavePool), 0);
        quoteToken.safeApprove(address(aavePool), approveAmount);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if flash liquidation is profitable
     * @param positionId Position to check
     * @param loanAmount Flash loan amount
     * @return profitable True if profitable
     * @return estimatedProfit Estimated profit amount
     */
    function checkProfitability(
        uint256 positionId,
        uint256 loanAmount
    ) external view returns (bool profitable, uint256 estimatedProfit) {
        // Get liquidation reward estimate
        uint256 marketId = perpEngine.getPosition(positionId).marketId;
        bytes32 feedId = bytes32(marketId);
        
        // Simple estimation - in practice would use oracle price
        uint256 estimatedReward = liquidationEngine.estimateReward(
            positionId,
            perpEngine.getPosition(positionId).size,
            1000 * 10**8 // Placeholder price
        );
        
        // Calculate flash loan premium
        uint256 premium = (loanAmount * FLASH_LOAN_PREMIUM) / PREMIUM_SCALE;
        
        // Check profitability
        estimatedProfit = estimatedReward > premium ? estimatedReward - premium : 0;
        profitable = estimatedProfit > 0;
    }

    /**
     * @notice Get approved liquidators count
     * @return count Number of approved liquidators
     */
    function getApprovedLiquidatorsCount() external view returns (uint256 count) {
        // This would require iterating, so we return 0 for simplicity
        // In production, would maintain a list
        return 0;
    }
}