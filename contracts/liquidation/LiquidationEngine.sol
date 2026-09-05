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
    mapping(uint256 => bytes32) public marketFeedIds;
    
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
     * @dev Internal core execution for liquidations without nonReentrant modifier
     */
    function _executeLiquidationCore(
        uint256 positionId,
        uint256 minReward,
        address liquidator
    ) internal returns (LiquidationResult memory result) {
        IPerpEngine.PositionView memory position = perpEngine.getPosition(positionId);
        uint256 currentPrice = _getValidatedPrice(position.marketId);

        if (liquidationQueue.isQueued(positionId)) {
            require(
                block.timestamp >= liquidationQueue.getQueueTime(positionId) + liquidatorConfig.gracePeriod,
                "Grace period not passed"
            );
        }

        uint256 positionSizeBefore = position.size;

        // Strict liquidatability check before calling PerpEngine
        require(perpEngine.isPositionLiquidatable(positionId, currentPrice), "Position not liquidatable");

        // Calculate canonical penalty and reward before position state mutation
        (, uint256 penalty, , ) = _calculateLiquidation(positionId, currentPrice, 0);

        // Execute full liquidation via PerpEngine
        uint256 reward = perpEngine.liquidatePosition(
            IPerpEngine.LiquidateParams({
                positionId: positionId,
                trader: position.trader,
                marketId: position.marketId,
                sizeToLiquidate: positionSizeBefore,
                minReward: minReward,
                liquidator: liquidator
            })
        );

        // Update state
        isPositionLiquidated[positionId] = true;
        lastLiquidationTime[positionId] = block.timestamp;
        totalLiquidations++;
        totalLiquidationVolume += positionSizeBefore;

        // Reward was physically paid directly by LiquidityVault via PerpEngine

        // Prepare result
        result = LiquidationResult({
            positionId: positionId,
            liquidator: liquidator,
            liquidationPrice: currentPrice,
            penalty: penalty,
            reward: reward,
            remainingSize: 0,
            fullyLiquidated: true
        });

        // Remove from queue if queued
        if (liquidationQueue.isQueued(positionId)) {
            liquidationQueue.remove(positionId);
        }

        emit LiquidationExecuted(positionId, liquidator, reward, penalty, true);
    }

    /**
     * @notice Helper function for try/catch calls from processQueue and executeBatchLiquidation
     */
    function _executeFromQueue(uint256 positionId, uint256 minReward, address liquidator)
        external
        returns (LiquidationResult memory)
    {
        require(msg.sender == address(this), "Only self");
        return _executeLiquidationCore(positionId, minReward, liquidator);
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
        returns (LiquidationResult memory)
    {
        return _executeLiquidationCore(positionId, minReward, msg.sender);
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
            try this._executeFromQueue(positionIds[i], minRewards[i], msg.sender) returns (LiquidationResult memory result) {
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
        revert("Flash liquidation disabled");
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

            // Check liquidatability
            IPerpEngine.PositionView memory pos = perpEngine.getPosition(nextPositionId);
            if (!perpEngine.isPositionLiquidatable(nextPositionId, _getValidatedPrice(pos.marketId))) {
                liquidationQueue.remove(nextPositionId);
                continue;
            }
            
            try this._executeFromQueue(nextPositionId, 0, msg.sender) {
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
        
        (reward, penalty, newHealthFactor, ) = _calculateLiquidation(positionId, currentPrice, healthFactor);
    }

    /**
     * @inheritdoc ILiquidationEngine
     */
    function estimateReward(
        uint256 positionId,
        uint256 liquidatedSize,
        uint256 liquidationPrice
    ) public view override returns (uint256 reward) {
        IPerpEngine.PositionView memory position = perpEngine.getPosition(positionId);
        if (liquidationPrice == 0) {
            liquidationPrice = _getValidatedPrice(position.marketId);
        }
        if (liquidatedSize == 0) {
            liquidatedSize = position.size;
        }
        IPerpEngine.Market memory market = perpEngine.getMarket(position.marketId);
        uint256 liquidatedNotional = (liquidatedSize * liquidationPrice * 10**10) / HEALTH_FACTOR_SCALE;
        uint256 penalty = (liquidatedNotional * market.liquidationFeeRatio + HEALTH_FACTOR_SCALE - 1) / HEALTH_FACTOR_SCALE;
        reward = (penalty * 5000) / 10000;
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
     * @dev Calculate canonical full liquidation details (07B)
     */
    function _calculateLiquidation(
        uint256 positionId,
        uint256 currentPrice,
        uint256 /* healthFactor */
    ) internal view returns (uint256 reward, uint256 penalty, uint256 newHealthFactor, uint256 liquidatedSize) {
        IPerpEngine.PositionView memory position = perpEngine.getPosition(positionId);
        IPerpEngine.Market memory market = perpEngine.getMarket(position.marketId);

        liquidatedSize = position.size;
        uint256 liquidatedNotional = (liquidatedSize * currentPrice * 10**10) / HEALTH_FACTOR_SCALE;

        // Penalty CEIL rounding
        penalty = (liquidatedNotional * market.liquidationFeeRatio + HEALTH_FACTOR_SCALE - 1) / HEALTH_FACTOR_SCALE;

        // Reward FLOOR rounding (50% reward share)
        reward = (penalty * 5000) / 10000;
        newHealthFactor = HEALTH_FACTOR_SCALE; // Fully liquidated
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
    function setMarketFeedId(uint256 marketId, bytes32 feedId)
        external
        onlyPerpEngine
    {
        marketFeedIds[marketId] = feedId;
    }

    function _getValidatedPrice(uint256 marketId) internal view returns (uint256) {
        bytes32 feedId = marketFeedIds[marketId];
        if (feedId == bytes32(0)) {
            IPerpEngine.Market memory m = perpEngine.getMarket(marketId);
            feedId = m.oracleFeedId;
        }
        require(feedId != bytes32(0), "LiquidationEngine: feedId not configured");
        
        // Get price with validation
        uint256 price = oracleAggregator.getPrice(feedId);
        require(price > 0, "Invalid price");
        require(!oracleAggregator.isPriceStale(feedId), "Price stale");
        
        return price;
    }

    /**
     * @dev Estimate liquidation reward for queuing
     */
    function _estimateLiquidationReward(uint256 positionId, uint256 healthFactor) internal view returns (uint256) {
        uint256 marketId = perpEngine.getPosition(positionId).marketId;
        uint256 currentPrice = _getValidatedPrice(marketId);
        (uint256 reward, , , ) = _calculateLiquidation(positionId, currentPrice, healthFactor);
        return reward;
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
