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
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";

/**
 * @title LiquidationEngine
 * @notice Core liquidation engine for PerpArbitraDEX
 * @dev Handles underwater position liquidations with MEV resistance and economic safety
 */
contract LiquidationEngine is ILiquidationEngine, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;

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
        (bool isActive, , ) = perpEngine.getPositionStatus(positionId);
        require(isActive, "Invalid position");
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
        (bool isActive, bool isLiquidatable, ) = perpEngine.getPositionStatus(positionId);
        require(isActive, "Position inactive");
        require(isLiquidatable, "Not liquidatable");
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
        public
        override
        nonReentrant
        whenNotPaused
        onlyValidPosition(positionId)
        returns (LiquidationResult memory result)
    {
        return _executeLiquidationInternal(positionId, minReward);
    }

    /**
     * @notice Helper for batch liquidations to avoid reentrancy guard collisions
     * @dev Restricted to address(this) to ensure it's only called via batch entry points that have the guard
     */
    function executeLiquidationInternal(uint256 positionId, uint256 minReward)
        external
        whenNotPaused
        onlyValidPosition(positionId)
        returns (LiquidationResult memory result)
    {
        require(msg.sender == address(this), "Internal only");
        return _executeLiquidationInternal(positionId, minReward);
    }

    /**
     * @dev Internal implementation of liquidation logic
     */
    function _executeLiquidationInternal(uint256 positionId, uint256 minReward)
        internal
        returns (LiquidationResult memory result)
    {
        // Check position is in queue and grace period passed
        require(liquidationQueue.isQueued(positionId), "Not in queue");
        require(
            block.timestamp >= liquidationQueue.getQueueTime(positionId),
            "Grace period not passed"
        );

        // Get current status and health
        (bool isActive, bool isLiquidatable, uint256 healthFactor) = perpEngine.getPositionStatus(positionId);
        require(isActive, "Position inactive");
        require(isLiquidatable, "Position healthy");

        uint256 marketId = perpEngine.getPositionInternal(positionId).marketId;
        uint256 currentPrice = _getValidatedPrice(marketId);
        
        // Calculate liquidation details
        (uint256 reward, uint256 penalty, uint256 newHealthFactor) = _calculateLiquidation(
            positionId,
            currentPrice,
            healthFactor
        );
        
        require(reward >= minReward, "Reward below minimum");
        require(reward <= liquidatorConfig.maxReward, "Reward exceeds maximum");
        
        // Execute liquidation via PerpEngine
        uint256 positionSizeBefore = perpEngine.getPositionInternal(positionId).size;
        uint256 remainingSize = _executePerpLiquidation(positionId, currentPrice, penalty);
        
        // Update state
        isPositionLiquidated[positionId] = remainingSize == 0;
        lastLiquidationTime[positionId] = block.timestamp;
        totalLiquidations++;
        totalLiquidationVolume += (positionSizeBefore - remainingSize);
        
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
            try this.executeLiquidationInternal(positionIds[i], minRewards[i]) returns (LiquidationResult memory result) {
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
    function liquidateBatch(uint256[] calldata positionIds)
        external
        override
        nonReentrant
        whenNotPaused
    {
        uint256 length = positionIds.length;
        require(length <= liquidatorConfig.batchSize, "Exceeds batch size");

        for (uint256 i = 0; i < length; i++) {
            uint256 positionId = positionIds[i];
            if (!isPositionLiquidated[positionId]) {
                try this.executeLiquidationInternal(positionId, liquidatorConfig.minReward) {
                    // Success
                } catch {
                    emit LiquidationSkipped(positionId, msg.sender, 3);
                }
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
    function processQueue(uint256 maxProcess) external override returns (uint256 numProcessed) {
        return processLiquidations(maxProcess);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function processLiquidations(uint256 maxCount)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256 numProcessed)
    {
        require(maxCount > 0, "Invalid max count");
        uint256 limit = maxCount > liquidatorConfig.batchSize ? liquidatorConfig.batchSize : maxCount;

        for (uint256 i = 0; i < limit; i++) {
            (bool hasNext, uint256 nextPositionId) = liquidationQueue.getNext();
            if (!hasNext) break;
            
            try this.executeLiquidationInternal(nextPositionId, liquidatorConfig.minReward) {
                numProcessed++;
            } catch {
                // Skip non-liquidatable or failing positions to prevent queue blockage
                emit LiquidationSkipped(nextPositionId, msg.sender, 3);
                continue;
            }
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
        // Calculate penalty based on liquidated notional value
        // Note: price is normalized to 18 decimals internally
        uint256 liquidatedNotional = liquidatedSize.mulDiv(liquidationPrice * 10**10, HEALTH_FACTOR_SCALE);
        uint256 penalty = liquidatedNotional.mulDiv(liquidatorConfig.penaltyRatio, HEALTH_FACTOR_SCALE);
        
        // Calculate reward (penalty + incentive)
        uint256 baseReward = penalty;
        uint256 incentive = baseReward.mulDiv(_getIncentiveMultiplier(), HEALTH_FACTOR_SCALE);
        
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
        uint256 liquidationRatio;
        if (healthFactor >= HEALTH_FACTOR_SCALE) {
            liquidationRatio = 0;
        } else {
            liquidationRatio = (HEALTH_FACTOR_SCALE - healthFactor).mulDiv(HEALTH_FACTOR_SCALE, HEALTH_FACTOR_SCALE - targetHealthFactor);
        }
        
        // Cap at 100%
        liquidationRatio = liquidationRatio > HEALTH_FACTOR_SCALE ? HEALTH_FACTOR_SCALE : liquidationRatio;
        
        uint256 liquidatedSize = position.size.mulDiv(liquidationRatio, HEALTH_FACTOR_SCALE);
        
        // Calculate reward and penalty
        reward = estimateReward(positionId, liquidatedSize, currentPrice);
        // Penalty should be what we expect to receive from PerpEngine (liquidationReward * 2)
        // or just match what PerpEngine calculates.
        uint256 liquidatedNotional = liquidatedSize.mulDiv(currentPrice * 10**10, HEALTH_FACTOR_SCALE);
        penalty = liquidatedNotional.mulDiv(liquidatorConfig.penaltyRatio, HEALTH_FACTOR_SCALE);
        
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
                positionId: positionId,
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
        // Get feedId from PerpEngine
        bytes32 feedId = perpEngine.getMarketOracleFeed(marketId);
        
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
        uint256 marketId = perpEngine.getPositionInternal(positionId).marketId;
        bytes32 feedId = perpEngine.getMarketOracleFeed(marketId);
        uint256 currentPrice = oracleAggregator.getPrice(feedId);
        
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
            newConfig.minReward,
            newConfig.maxReward,
            newConfig.penaltyRatio,
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
