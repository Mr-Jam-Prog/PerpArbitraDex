// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {LiquidationQueue} from "./LiquidationQueue.sol";
import {IncentiveDistributor} from "./IncentiveDistributor.sol";

/**
 * @title LiquidationEngine
 * @notice Core liquidation engine for PerpArbitraDEX
 * @dev Handles underwater position liquidations with MEV resistance and economic safety
 */
contract LiquidationEngine is ILiquidationEngine, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ============ CONSTANTS ============
    uint256 public constant HEALTH_FACTOR_SCALE = 1e18;
    uint256 public constant MAX_LIQUIDATION_PENALTY = 0.5e18; // 50%
    uint256 public constant MIN_HEALTH_FACTOR = 0.95e18; // 95%
    
    // ============ IMMUTABLES ============
    IPerpEngine public immutable perpEngine;
    IConfigRegistry public immutable configRegistry;
    IOracleAggregator public immutable oracleAggregator;
    LiquidationQueue public immutable liquidationQueue;
    IncentiveDistributor public immutable incentiveDistributor;
    IERC20 public immutable quoteToken;

    // ============ STATE VARIABLES ============
    mapping(uint256 => bool) public isPositionLiquidated;
    mapping(uint256 => uint256) public lastLiquidationTime;
    mapping(address => uint256) public liquidatorRewards;
    
    uint256 public totalLiquidations;
    uint256 public totalLiquidationVolume;
    uint256 public totalBadDebt;
    
    LiquidatorConfig public liquidatorConfig;

    // ============ MODIFIERS ============
    modifier onlyPerpEngine() {
        require(msg.sender == address(perpEngine), "Only PerpEngine");
        _;
    }

    modifier onlyValidPosition(uint256 positionId) {
        require(!isPositionLiquidated[positionId], "Position already liquidated");
        require(perpEngine.getHealthFactor(positionId) > 0, "Invalid position");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _perpEngine,
        address _configRegistry,
        address _oracleAggregator,
        address _quoteToken,
        address _liquidationQueue,
        address _incentiveDistributor
    ) {
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(_configRegistry != address(0), "Invalid ConfigRegistry");
        require(_oracleAggregator != address(0), "Invalid OracleAggregator");
        
        perpEngine = IPerpEngine(_perpEngine);
        configRegistry = IConfigRegistry(_configRegistry);
        oracleAggregator = IOracleAggregator(_oracleAggregator);
        quoteToken = IERC20(_quoteToken);
        liquidationQueue = LiquidationQueue(_liquidationQueue);
        incentiveDistributor = IncentiveDistributor(_incentiveDistributor);
        
        // Initialize with safe defaults
        liquidatorConfig = LiquidatorConfig({
            minReward: 10e18, // 10 quote tokens
            maxReward: 1000e18, // 1000 quote tokens
            penaltyRatio: 0.05e18, // 5%
            gracePeriod: 300, // 5 minutes
            batchSize: 10
        });
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @inheritdoc ILiquidationEngine
     */
    function queueLiquidation(uint256 positionId, uint256 healthFactor) 
        external 
        override 
        onlyPerpEngine
        whenNotPaused
    {
        require(healthFactor < HEALTH_FACTOR_SCALE, "Not liquidatable");
        require(!isPositionLiquidated[positionId], "Already liquidated");
        
        liquidationQueue.enqueue(
            LiquidationCandidate({
                positionId: positionId,
                trader: perpEngine.getPosition(positionId).trader,
                marketId: perpEngine.getPosition(positionId).marketId,
                healthFactor: healthFactor,
                liquidationPrice: perpEngine.getLiquidationPrice(positionId),
                estimatedReward: _estimateLiquidationReward(positionId, healthFactor),
                timestamp: block.timestamp
            })
        );
        
        emit LiquidationQueued(positionId, perpEngine.getPosition(positionId).trader, healthFactor, block.timestamp);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function executeLiquidation(uint256 positionId, uint256 minReward)
        external
        override
        nonReentrant
        whenNotPaused
        onlyValidPosition(positionId)
        returns (LiquidationResult memory result)
    {
        // Check position is in queue and grace period passed
        require(liquidationQueue.isQueued(positionId), "Not in queue");
        require(
            block.timestamp >= liquidationQueue.getQueueTime(positionId) + liquidatorConfig.gracePeriod,
            "Grace period not passed"
        );

        // Get current price and health factor
        uint256 marketId = perpEngine.getPosition(positionId).marketId;
        uint256 currentPrice = _getValidatedPrice(marketId);
        uint256 healthFactor = perpEngine.getHealthFactor(positionId);
        
        require(healthFactor < HEALTH_FACTOR_SCALE, "Position healthy");
        
        // Calculate liquidation details
        (uint256 reward, uint256 penalty, uint256 newHealthFactor) = _calculateLiquidation(
            positionId,
            currentPrice,
            healthFactor
        );
        
        require(reward >= minReward, "Reward below minimum");
        require(reward <= liquidatorConfig.maxReward, "Reward exceeds maximum");
        
        // Execute liquidation via PerpEngine
        uint256 positionSizeBefore = perpEngine.getPosition(positionId).size;
        uint256 remainingSize = _executePerpLiquidation(positionId, currentPrice, penalty);
        
        // Update state
        isPositionLiquidated[positionId] = remainingSize == 0;
        lastLiquidationTime[positionId] = block.timestamp;
        totalLiquidations++;
        totalLiquidationVolume += positionSizeBefore - remainingSize;
        
        // Distribute rewards
        _distributeLiquidationRewards(positionId, reward, penalty, msg.sender);
        
        // Prepare result
        result = LiquidationResult({
            positionId: positionId,
            liquidator: msg.sender,
            liquidationPrice: currentPrice,
            penalty: penalty,
            reward: reward,
            remainingSize: remainingSize,
            fullyLiquidated: remainingSize == 0
        });
        
        // Remove from queue if fully liquidated
        if (remainingSize == 0) {
            liquidationQueue.remove(positionId);
        }
        
        emit LiquidationExecuted(positionId, msg.sender, reward, penalty, remainingSize == 0);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function executeBatchLiquidation(
        uint256[] calldata positionIds,
        uint256[] calldata minRewards
    ) external override nonReentrant whenNotPaused returns (LiquidationResult[] memory results) {
        require(positionIds.length == minRewards.length, "Array length mismatch");
        require(positionIds.length <= liquidatorConfig.batchSize, "Exceeds batch size");
        
        results = new LiquidationResult[](positionIds.length);
        
        for (uint256 i = 0; i < positionIds.length; i++) {
            try this.executeLiquidation(positionIds[i], minRewards[i]) returns (LiquidationResult memory result) {
                results[i] = result;
            } catch {
                // Skip failed liquidations but continue with batch
                results[i] = LiquidationResult({
                    positionId: positionIds[i],
                    liquidator: address(0),
                    liquidationPrice: 0,
                    penalty: 0,
                    reward: 0,
                    remainingSize: 0,
                    fullyLiquidated: false
                });
                emit LiquidationSkipped(positionIds[i], msg.sender, 3); // Other reason
            }
        }
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function flashLiquidate(
        uint256 positionId,
        uint256 loanAmount,
        uint256 minReward
    ) external override nonReentrant whenNotPaused returns (LiquidationResult memory) {
        // This function would integrate with FlashLiquidator.sol
        // For now, it calls executeLiquidation with additional checks
        require(loanAmount > 0, "Loan amount required");
        
        // Verify flash loan capability
        _validateFlashLoan(loanAmount);
        
        return executeLiquidation(positionId, minReward);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function processQueue(uint256 maxProcess) external override nonReentrant whenNotPaused returns (uint256 numProcessed) {
        require(maxProcess > 0, "Invalid max process");
        
        for (uint256 i = 0; i < maxProcess; i++) {
            (bool hasNext, uint256 nextPositionId) = liquidationQueue.getNext();
            if (!hasNext) break;
            
            // Skip if still in grace period
            if (block.timestamp < liquidationQueue.getQueueTime(nextPositionId) + liquidatorConfig.gracePeriod) {
                continue;
            }
            
            try this.executeLiquidation(nextPositionId, liquidatorConfig.minReward) {
                numProcessed++;
            } catch {
                // Skip and continue
                continue;
            }
            
            if (numProcessed >= liquidatorConfig.batchSize) break;
        }
        
        return numProcessed;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc ILiquidationEngine
     */
    function previewLiquidation(uint256 positionId, uint256 currentPrice)
        public
        view
        override
        returns (uint256 reward, uint256 penalty, uint256 newHealthFactor)
    {
        uint256 healthFactor = perpEngine.getHealthFactor(positionId);
        require(healthFactor < HEALTH_FACTOR_SCALE, "Position healthy");
        
        return _calculateLiquidation(positionId, currentPrice, healthFactor);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function estimateReward(
        uint256 positionId,
        uint256 liquidatedSize,
        uint256 liquidationPrice
    ) public view override returns (uint256 reward) {
        // Get position details
        IPerpEngine.PositionView memory position = perpEngine.getPosition(positionId);
        
        // Calculate penalty based on liquidated size
        uint256 penalty = (liquidatedSize * liquidatorConfig.penaltyRatio) / HEALTH_FACTOR_SCALE;
        
        // Calculate reward (penalty + incentive)
        uint256 baseReward = penalty;
        uint256 incentive = (baseReward * _getIncentiveMultiplier()) / HEALTH_FACTOR_SCALE;
        
        reward = baseReward + incentive;
        
        // Apply caps
        reward = reward > liquidatorConfig.maxReward ? liquidatorConfig.maxReward : reward;
        reward = reward < liquidatorConfig.minReward ? liquidatorConfig.minReward : reward;
        
        return reward;
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function getLiquidationQueue(uint256 cursor, uint256 limit)
        external
        view
        override
        returns (LiquidationCandidate[] memory candidates, uint256 newCursor)
    {
        return liquidationQueue.getQueue(cursor, limit);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function getQueueLength() external view override returns (uint256) {
        return liquidationQueue.getLength();
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function isInQueue(uint256 positionId) external view override returns (bool) {
        return liquidationQueue.isQueued(positionId);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function getLiquidatorConfig() external view override returns (LiquidatorConfig memory) {
        return liquidatorConfig;
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Calculate liquidation details
     */
    function _calculateLiquidation(
        uint256 positionId,
        uint256 currentPrice,
        uint256 healthFactor
    ) internal view returns (uint256 reward, uint256 penalty, uint256 newHealthFactor) {
        IPerpEngine.PositionView memory position = perpEngine.getPosition(positionId);
        
        // Calculate how much to liquidate to bring health factor to MIN_HEALTH_FACTOR
        uint256 targetHealthFactor = MIN_HEALTH_FACTOR;
        uint256 liquidationRatio = (HEALTH_FACTOR_SCALE - healthFactor) * HEALTH_FACTOR_SCALE / 
                                  (HEALTH_FACTOR_SCALE - targetHealthFactor);
        
        // Cap at 100%
        liquidationRatio = liquidationRatio > HEALTH_FACTOR_SCALE ? HEALTH_FACTOR_SCALE : liquidationRatio;
        
        uint256 liquidatedSize = (position.size * liquidationRatio) / HEALTH_FACTOR_SCALE;
        
        // Calculate penalty (based on liquidated size)
        penalty = (liquidatedSize * liquidatorConfig.penaltyRatio) / HEALTH_FACTOR_SCALE;
        
        // Calculate reward
        reward = estimateReward(positionId, liquidatedSize, currentPrice);
        
        // Estimate new health factor after partial liquidation
        if (liquidatedSize < position.size) {
            uint256 remainingSize = position.size - liquidatedSize;
            uint256 remainingMargin = position.margin - (position.margin * liquidationRatio) / HEALTH_FACTOR_SCALE;
            
            // Simplified health factor calculation
            uint256 remainingLiqPrice = (remainingMargin * HEALTH_FACTOR_SCALE) / (remainingSize * 2); // Approximation
            newHealthFactor = (currentPrice * HEALTH_FACTOR_SCALE) / remainingLiqPrice;
        } else {
            newHealthFactor = HEALTH_FACTOR_SCALE; // Fully liquidated
        }
    }

    /**
     * @dev Execute liquidation through PerpEngine
     */
    function _executePerpLiquidation(
        uint256 positionId,
        uint256 liquidationPrice,
        uint256 penalty
    ) internal returns (uint256 remainingSize) {
        // Get position before liquidation
        IPerpEngine.PositionView memory positionBefore = perpEngine.getPosition(positionId);
        
        // Call PerpEngine to liquidate
        perpEngine.liquidatePosition(
            IPerpEngine.LiquidateParams({
                trader: positionBefore.trader,
                marketId: positionBefore.marketId,
                sizeToLiquidate: positionBefore.size,
                minReward: 0
            })
        );
        
        // Get position after liquidation
        IPerpEngine.PositionView memory positionAfter = perpEngine.getPosition(positionId);
        
        return positionAfter.size;
    }

    /**
     * @dev Distribute liquidation rewards
     */
    function _distributeLiquidationRewards(
        uint256 positionId,
        uint256 reward,
        uint256 penalty,
        address liquidator
    ) internal {
        // Transfer reward to liquidator
        quoteToken.safeTransfer(liquidator, reward);
        
        // Record liquidator rewards for tracking
        liquidatorRewards[liquidator] += reward;
        
        // Distribute penalty to insurance fund and protocol
        incentiveDistributor.distributeLiquidationPenalty(positionId, penalty);
    }

    /**
     * @dev Get validated price from oracle with safety checks
     */
    function _getValidatedPrice(uint256 marketId) internal view returns (uint256) {
        // Convert marketId to feedId (implementation specific)
        bytes32 feedId = bytes32(marketId);
        
        // Get price with validation
        uint256 price = oracleAggregator.getPrice(feedId);
        require(price > 0, "Invalid price");
        require(!oracleAggregator.isPriceStale(feedId), "Price stale");
        
        // Additional validation
        IOracleAggregator.PriceData memory priceData = oracleAggregator.getPriceData(feedId);
        require(priceData.status == IOracleAggregator.PriceStatus.ACTIVE, "Price not active");
        
        return price;
    }

    /**
     * @dev Estimate liquidation reward for queuing
     */
    function _estimateLiquidationReward(uint256 positionId, uint256 healthFactor) internal view returns (uint256) {
        // Get current price for estimation
        uint256 marketId = perpEngine.getPosition(positionId).marketId;
        uint256 currentPrice = oracleAggregator.getPrice(bytes32(marketId));
        
        (, uint256 estimatedPenalty, ) = _calculateLiquidation(positionId, currentPrice, healthFactor);
        
        // Base reward is penalty plus incentive
        uint256 baseReward = estimatedPenalty;
        uint256 incentive = (baseReward * _getIncentiveMultiplier()) / HEALTH_FACTOR_SCALE;
        
        return baseReward + incentive;
    }

    /**
     * @dev Validate flash loan parameters
     */
    function _validateFlashLoan(uint256 loanAmount) internal view {
        // Check if contract has sufficient allowance/balance for flash loan repayment
        uint256 contractBalance = quoteToken.balanceOf(address(this));
        require(contractBalance >= loanAmount, "Insufficient contract balance");
        
        // Additional flash loan validation can be added here
    }

    /**
     * @dev Get current incentive multiplier
     */
    function _getIncentiveMultiplier() internal view returns (uint256) {
        // Dynamic incentive based on queue length and market conditions
        uint256 queueLength = liquidationQueue.getLength();
        
        if (queueLength > 100) {
            return 0.3e18; // 30% incentive for high queue
        } else if (queueLength > 50) {
            return 0.2e18; // 20% incentive for moderate queue
        } else {
            return 0.1e18; // 10% incentive for normal queue
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @inheritdoc ILiquidationEngine
     */
    function updateLiquidatorConfig(LiquidatorConfig calldata newConfig) external override onlyPerpEngine {
        require(newConfig.penaltyRatio <= MAX_LIQUIDATION_PENALTY, "Penalty too high");
        require(newConfig.minReward <= newConfig.maxReward, "Invalid reward range");
        require(newConfig.gracePeriod <= 3600, "Grace period too long"); // Max 1 hour
        
        emit LiquidatorConfigUpdated(
            liquidatorConfig.minReward,
            newConfig.minReward,
            liquidatorConfig.penaltyRatio,
            newConfig.penaltyRatio,
            liquidatorConfig.gracePeriod,
            newConfig.gracePeriod
        );
        
        liquidatorConfig = newConfig;
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function setIncentiveMultiplier(uint256 newMultiplier) external onlyPerpEngine {
        require(newMultiplier <= 0.5e18, "Incentive too high"); // Max 50%
        // Implementation depends on incentive structure
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function emergencyCancelLiquidation(uint256 positionId) external override onlyPerpEngine {
        require(liquidationQueue.isQueued(positionId), "Not in queue");
        
        // Remove from queue
        liquidationQueue.remove(positionId);
        
        // Emit event for tracking
        emit LiquidationSkipped(positionId, msg.sender, 4); // Emergency cancel
    }

    /**
     * @dev Emergency function to recover bad debt
     */
    function recoverBadDebt(uint256 amount) external onlyPerpEngine {
        require(amount <= totalBadDebt, "Exceeds bad debt");
        
        totalBadDebt -= amount;
        quoteToken.safeTransfer(address(perpEngine), amount);
    }

    /**
     * @dev Pause liquidations in emergency
     */
    function pause() external onlyPerpEngine {
        _pause();
    }

    /**
     * @dev Unpause liquidations
     */
    function unpause() external onlyPerpEngine {
        _unpause();
    }
}