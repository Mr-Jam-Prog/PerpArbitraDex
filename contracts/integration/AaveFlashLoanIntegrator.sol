// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {IFlashLoanReceiver} from "../interfaces/IFlashLoanReceiver.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";

interface IAavePool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
    
    function FLASHLOAN_PREMIUM_TOTAL() external view returns (uint256);
}

/**
 * @title AaveFlashLoanIntegrator
 * @notice Aave V3 flash loan integration for capital-efficient liquidations
 * @dev Acts as a secure intermediary between Aave V3 and FlashLiquidator
 */
contract AaveFlashLoanIntegrator is IFlashLoanReceiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    
    // ============ IMMUTABLES ============
    IAavePool public immutable aavePool;
    address public immutable flashLiquidator;
    IPerpEngine public immutable perpEngine;
    IERC20 public immutable quoteToken;
    
    // ============ CONSTANTS ============
    uint256 public constant PREMIUM_SCALE = 10000;
    
    // ============ STATE VARIABLES ============
    mapping(address => bool) public approvedAssets;
    mapping(bytes32 => FlashLoanRequest) public activeRequests;
    
    uint256 public maxFlashLoanAmount = 1_000_000 ether; // 1M tokens cap
    uint256 public minFlashLoanAmount = 1_000 ether; // 1k tokens minimum
    
    // ============ STRUCTS ============
    struct FlashLoanRequest {
        address initiator;
        uint256 positionId;
        uint256 minReward;
        uint256 timestamp;
        bool executed;
        bytes32 requestId;
    }
    
    // ============ EVENTS ============
    event FlashLoanInitiated(
        bytes32 indexed requestId,
        address indexed initiator,
        uint256 positionId,
        uint256 loanAmount,
        uint256 premium
    );
    
    event FlashLoanExecuted(
        bytes32 indexed requestId,
        address indexed initiator,
        uint256 positionId,
        uint256 reward,
        uint256 premium,
        bool success
    );
    
    event AssetApprovalUpdated(address indexed asset, bool approved);
    event FlashLoanLimitsUpdated(uint256 minAmount, uint256 maxAmount);
    
    // ============ MODIFIERS ============
    modifier onlyFlashLiquidator() {
        require(msg.sender == flashLiquidator, "Only FlashLiquidator");
        _;
    }
    
    modifier onlyAavePool() {
        require(msg.sender == address(aavePool), "Only Aave Pool");
        _;
    }
    
    modifier validAmount(uint256 amount) {
        require(amount >= minFlashLoanAmount, "Below minimum");
        require(amount <= maxFlashLoanAmount, "Above maximum");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        address _aavePool,
        address _flashLiquidator,
        address _perpEngine,
        address _quoteToken
    ) {
        require(_aavePool != address(0), "Invalid Aave Pool");
        require(_flashLiquidator != address(0), "Invalid FlashLiquidator");
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(_quoteToken != address(0), "Invalid quote token");
        
        aavePool = IAavePool(_aavePool);
        flashLiquidator = _flashLiquidator;
        perpEngine = IPerpEngine(_perpEngine);
        quoteToken = IERC20(_quoteToken);
        
        // Initially approve only quote token
        approvedAssets[_quoteToken] = true;
        
        // Approve Aave Pool for quote token
        quoteToken.safeApprove(_aavePool, type(uint256).max);
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Initiate a flash loan for liquidation
     * @param positionId Position to liquidate
     * @param loanAmount Amount to flash loan
     * @param minReward Minimum acceptable reward
     * @return requestId Unique request identifier
     */
    function initiateFlashLoan(
        uint256 positionId,
        uint256 loanAmount,
        uint256 minReward
    ) external onlyFlashLiquidator validAmount(loanAmount) returns (bytes32) {
        require(positionId > 0, "Invalid position");
        require(loanAmount > 0, "Invalid loan amount");
        
        // Generate request ID
        bytes32 requestId = keccak256(
            abi.encodePacked(positionId, msg.sender, block.timestamp, loanAmount)
        );
        
        // Store request
        activeRequests[requestId] = FlashLoanRequest({
            initiator: msg.sender,
            positionId: positionId,
            minReward: minReward,
            timestamp: block.timestamp,
            executed: false,
            requestId: requestId
        });
        
        // Prepare assets and amounts for flash loan
        address[] memory assets = new address[](1);
        assets[0] = address(quoteToken);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = loanAmount;
        
        // 0 = no debt, 1 = stable, 2 = variable
        uint256[] memory modes = new uint256[](1);
        modes[0] = 0;
        
        // Encode request data for callback
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
        
        emit FlashLoanInitiated(
            requestId,
            msg.sender,
            positionId,
            loanAmount,
            _calculatePremium(loanAmount)
        );
        
        return requestId;
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
        require(initiator == address(this), "Invalid initiator");
        bytes32 rid;
        (,, rid) = abi.decode(params, (uint256, uint256, bytes32));
        FlashLoanRequest storage req = activeRequests[rid];
        require(req.initiator != address(0) && !req.executed, "Invalid request");
        uint256 repay = amounts[0] + premiums[0];
        require(quoteToken.balanceOf(address(this)) >= repay, "Insufficient balance");
        req.executed = true;
        (bool success, bytes memory res) = flashLiquidator.call(
            abi.encodeWithSignature("executeFlashLiquidation(address,uint256,uint256,uint256,bytes32)",
                assets[0], amounts[0], req.positionId, req.minReward, rid));
        if (success) {
            (uint256 rew, bool ok) = abi.decode(res, (uint256, bool));
            require(rew >= req.minReward && ok, "Liquidation failed");
            if (quoteToken.balanceOf(address(this)) > repay) {
                quoteToken.safeTransfer(req.initiator, quoteToken.balanceOf(address(this)) - repay);
            }
            _emitLoanExecuted(rid, rew, premiums[0], true);
            return true;
        } else {
            _emitLoanExecuted(rid, 0, premiums[0], false);
            revert("Flash liquidation execution failed");
        }
    }

    function _emitLoanExecuted(bytes32 rid, uint256 rew, uint256 prem, bool success) internal {
        FlashLoanRequest storage req = activeRequests[rid];
        emit FlashLoanExecuted(rid, req.initiator, req.positionId, rew, prem, success);
    }
    
    /**
     * @inheritdoc IFlashLoanReceiver
     */
    function getMaxFlashLoan(address asset) external view override returns (uint256) {
        if (!approvedAssets[asset]) return 0;
        
        // Get available liquidity from Aave
        uint256 availableLiquidity = quoteToken.balanceOf(address(aavePool));
        
        // Cap at maxFlashLoanAmount
        return availableLiquidity > maxFlashLoanAmount ? maxFlashLoanAmount : availableLiquidity;
    }
    
    /**
     * @inheritdoc IFlashLoanReceiver
     */
    function getFlashLoanFee(address asset) external view override returns (uint256) {
        if (!approvedAssets[asset]) return type(uint256).max;
        return aavePool.FLASHLOAN_PREMIUM_TOTAL();
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Approve or revoke asset for flash loans
     * @param asset Asset address
     * @param approved Whether approved
     */
    function setApprovedAsset(address asset, bool approved) external onlyFlashLiquidator {
        require(asset != address(0), "Invalid asset");
        
        approvedAssets[asset] = approved;
        
        if (approved) {
            // Approve Aave Pool for this asset
            IERC20(asset).safeApprove(address(aavePool), type(uint256).max);
        } else {
            // Revoke approval
            IERC20(asset).safeApprove(address(aavePool), 0);
        }
        
        emit AssetApprovalUpdated(asset, approved);
    }
    
    /**
     * @notice Update flash loan limits
     * @param newMinAmount New minimum flash loan amount
     * @param newMaxAmount New maximum flash loan amount
     */
    function updateFlashLoanLimits(uint256 newMinAmount, uint256 newMaxAmount) 
        external 
        onlyFlashLiquidator 
    {
        require(newMinAmount > 0, "Invalid min amount");
        require(newMaxAmount > newMinAmount, "Invalid max amount");
        
        minFlashLoanAmount = newMinAmount;
        maxFlashLoanAmount = newMaxAmount;
        
        emit FlashLoanLimitsUpdated(newMinAmount, newMaxAmount);
    }
    
    /**
     * @notice Emergency cancel flash loan request
     * @param requestId Request to cancel
     */
    function emergencyCancelRequest(bytes32 requestId) external onlyFlashLiquidator {
        FlashLoanRequest storage request = activeRequests[requestId];
        require(request.initiator != address(0), "Invalid request");
        require(!request.executed, "Already executed");
        
        delete activeRequests[requestId];
    }
    
    /**
     * @notice Emergency recover tokens
     * @param token Token to recover
     * @param amount Amount to recover
     */
    function emergencyRecover(address token, uint256 amount) external onlyFlashLiquidator {
        require(token != address(quoteToken), "Cannot recover quote token");
        
        IERC20(token).safeTransfer(msg.sender, amount);
    }
    
    /**
     * @notice Update Aave Pool approval
     * @param asset Asset to update
     * @param amount New approval amount
     */
    function updateAaveApproval(address asset, uint256 amount) external onlyFlashLiquidator {
        require(approvedAssets[asset], "Asset not approved");
        
        IERC20(asset).safeApprove(address(aavePool), 0);
        IERC20(asset).safeApprove(address(aavePool), amount);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Check if request is active
     * @param requestId Request ID
     * @return active True if active
     */
    function isRequestActive(bytes32 requestId) external view returns (bool) {
        FlashLoanRequest memory request = activeRequests[requestId];
        return request.initiator != address(0) && !request.executed;
    }
    
    /**
     * @notice Calculate premium for flash loan amount
     * @param amount Loan amount
     * @return premium Premium amount
     */
    function calculatePremium(uint256 amount) external view returns (uint256) {
        return _calculatePremium(amount);
    }
    
    /**
     * @notice Estimate profitability of flash liquidation
     * @param positionId Position to check
     * @param loanAmount Flash loan amount
     * @return profitable True if profitable
     * @return estimatedProfit Estimated profit amount
     */
    function estimateProfitability(
        uint256 positionId,
        uint256 loanAmount
    ) external view returns (bool profitable, uint256 estimatedProfit) {
        // Get liquidation reward estimate
        (uint256 estimatedReward,,) = perpEngine.previewLiquidation(
            positionId,
            _getOraclePrice(positionId)
        );
        
        // Calculate flash loan premium
        uint256 premium = _calculatePremium(loanAmount);
        
        // Check profitability
        estimatedProfit = estimatedReward > premium ? estimatedReward - premium : 0;
        profitable = estimatedProfit > 0;
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Calculate premium for flash loan
     */
    function _calculatePremium(uint256 amount) internal view returns (uint256) {
        uint256 premiumRate = aavePool.FLASHLOAN_PREMIUM_TOTAL();
        return (amount * premiumRate) / PREMIUM_SCALE;
    }
    
    /**
     * @dev Get oracle price for position
     */
    function _getOraclePrice(uint256 positionId) internal view returns (uint256) {
        // Simplified - in production would fetch from OracleAggregator
        return 1000 * 1e8; // Placeholder
    }
}