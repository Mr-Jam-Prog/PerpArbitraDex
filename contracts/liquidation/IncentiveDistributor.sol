// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

/**
 * @title IncentiveDistributor
 * @notice Distributes liquidation rewards and penalties
 * @dev Ensures proper incentive alignment between liquidators, protocol, and insurance fund
 */
contract IncentiveDistributor is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ STRUCTS ============
    struct DistributionConfig {
        uint256 liquidatorShare; // 1e18 = 100%
        uint256 protocolShare;   // 1e18 = 100%
        uint256 insuranceShare;  // 1e18 = 100%
        uint256 stakingShare;    // 1e18 = 100%
        uint256 totalShares;     // Sum of all shares (should be 1e18)
    }

    struct RewardStats {
        uint256 totalDistributed;
        uint256 toLiquidators;
        uint256 toProtocol;
        uint256 toInsurance;
        uint256 toStaking;
        uint256 lastDistributionTime;
    }

    // ============ IMMUTABLES ============
    IERC20 public immutable quoteToken;
    IPerpEngine public immutable perpEngine;
    IConfigRegistry public immutable configRegistry;
    
    // ============ STATE VARIABLES ============
    address public liquidationEngine;
    DistributionConfig public distributionConfig;
    RewardStats public rewardStats;
    
    address public protocolTreasury;
    address public insuranceFund;
    address public stakingContract;
    
    mapping(address => uint256) public liquidatorCumulativeRewards;
    mapping(uint256 => bool) public distributedPositions;

    // ============ CONSTANTS ============
    uint256 public constant SHARE_SCALE = 1e18;
    uint256 public constant MAX_SHARE = 0.8e18; // 80% maximum to any party

    // ============ EVENTS ============
    event DistributionConfigUpdated(
        uint256 liquidatorShare,
        uint256 protocolShare,
        uint256 insuranceShare,
        uint256 stakingShare
    );
    
    event RewardsDistributed(
        uint256 indexed positionId,
        uint256 totalPenalty,
        uint256 liquidatorAmount,
        uint256 protocolAmount,
        uint256 insuranceAmount,
        uint256 stakingAmount
    );
    
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event InsuranceFundUpdated(address oldFund, address newFund);
    event StakingContractUpdated(address oldStaking, address newStaking);

    // ============ MODIFIERS ============
    modifier onlyAuthorized() {
        require(msg.sender == address(perpEngine) || msg.sender == liquidationEngine, "Only authorized");
        _;
    }
    
    modifier onlyValidDistribution(uint256 totalAmount) {
        require(totalAmount > 0, "Invalid distribution amount");
        require(distributionConfig.totalShares == SHARE_SCALE, "Invalid share configuration");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        address _quoteToken,
        address _perpEngine,
        address _configRegistry,
        address _protocolTreasury,
        address _insuranceFund,
        address _stakingContract
    ) {
        require(_quoteToken != address(0), "Invalid quote token");
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(_configRegistry != address(0), "Invalid ConfigRegistry");
        
        quoteToken = IERC20(_quoteToken);
        perpEngine = IPerpEngine(_perpEngine);
        configRegistry = IConfigRegistry(_configRegistry);
        protocolTreasury = _protocolTreasury;
        insuranceFund = _insuranceFund;
        stakingContract = _stakingContract;
        
        // Default distribution: 60% liquidator, 20% protocol, 15% insurance, 5% staking
        distributionConfig = DistributionConfig({
            liquidatorShare: 0.6e18,
            protocolShare: 0.2e18,
            insuranceShare: 0.15e18,
            stakingShare: 0.05e18,
            totalShares: 1e18
        });
        
        rewardStats = RewardStats({
            totalDistributed: 0,
            toLiquidators: 0,
            toProtocol: 0,
            toInsurance: 0,
            toStaking: 0,
            lastDistributionTime: 0
        });
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Distribute liquidation penalty
     * @param positionId Liquidated position
     * @param totalPenalty Total penalty amount
     */
    function distributeLiquidationPenalty(uint256 positionId, uint256 totalPenalty)
        external
        nonReentrant
        onlyAuthorized
        onlyValidDistribution(totalPenalty)
    {
        require(!distributedPositions[positionId], "Already distributed");
        require(totalPenalty > 0, "No penalty to distribute");
        
        // Calculate distribution amounts
        (uint256 toLiquidator, uint256 toProtocol, uint256 toInsurance, uint256 toStaking) = 
            _calculateDistribution(totalPenalty);
        
        // Execute distributions
        _distributeToLiquidator(positionId, toLiquidator);
        _distributeToProtocol(toProtocol);
        _distributeToInsuranceFund(toInsurance);
        _distributeToStaking(toStaking);
        
        // Update stats
        _updateStats(totalPenalty, toLiquidator, toProtocol, toInsurance, toStaking);
        
        // Mark as distributed
        distributedPositions[positionId] = true;
        
        emit RewardsDistributed(
            positionId,
            totalPenalty,
            toLiquidator,
            toProtocol,
            toInsurance,
            toStaking
        );
    }

    /**
     * @notice Distribute protocol fees
     * @param feeAmount Fee amount to distribute
     */
    function distributeProtocolFees(uint256 feeAmount) external nonReentrant onlyAuthorized {
        require(feeAmount > 0, "No fees to distribute");
        
        // Protocol fees follow same distribution as penalties
        (uint256 toLiquidator, uint256 toProtocol, uint256 toInsurance, uint256 toStaking) = 
            _calculateDistribution(feeAmount);
        
        // Execute distributions
        _distributeToLiquidator(0, toLiquidator); // positionId 0 for fees
        _distributeToProtocol(toProtocol);
        _distributeToInsuranceFund(toInsurance);
        _distributeToStaking(toStaking);
        
        // Update stats
        rewardStats.totalDistributed += feeAmount;
        rewardStats.toLiquidators += toLiquidator;
        rewardStats.toProtocol += toProtocol;
        rewardStats.toInsurance += toInsurance;
        rewardStats.toStaking += toStaking;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Calculate distribution amounts
     * @param totalAmount Total amount to distribute
     * @return toLiquidator Amount to liquidator
     * @return toProtocol Amount to protocol
     * @return toInsurance Amount to insurance fund
     * @return toStaking Amount to staking contract
     */
    function calculateDistribution(uint256 totalAmount)
        public
        view
        returns (
            uint256 toLiquidator,
            uint256 toProtocol,
            uint256 toInsurance,
            uint256 toStaking
        )
    {
        return _calculateDistribution(totalAmount);
    }

    /**
     * @notice Get pending rewards for a liquidator
     * @param liquidator Liquidator address
     * @return pendingRewards Pending reward amount
     */
    function getPendingRewards(address liquidator) external view returns (uint256 pendingRewards) {
        // In current implementation, rewards are distributed immediately
        // This function can be extended for vesting schedules
        return 0;
    }

    /**
     * @notice Get distribution statistics
     * @return stats Current reward statistics
     */
    function getRewardStats() external view returns (RewardStats memory) {
        return rewardStats;
    }

    /**
     * @notice Check if position rewards were distributed
     * @param positionId Position ID
     * @return distributed True if distributed
     */
    function isDistributed(uint256 positionId) external view returns (bool) {
        return distributedPositions[positionId];
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Calculate distribution amounts
     */
    function _calculateDistribution(uint256 totalAmount)
        internal
        view
        returns (
            uint256 toLiquidator,
            uint256 toProtocol,
            uint256 toInsurance,
            uint256 toStaking
        )
    {
        toLiquidator = (totalAmount * distributionConfig.liquidatorShare) / SHARE_SCALE;
        toProtocol = (totalAmount * distributionConfig.protocolShare) / SHARE_SCALE;
        toInsurance = (totalAmount * distributionConfig.insuranceShare) / SHARE_SCALE;
        toStaking = (totalAmount * distributionConfig.stakingShare) / SHARE_SCALE;
        
        // Handle rounding errors by giving remainder to protocol
        uint256 distributed = toLiquidator + toProtocol + toInsurance + toStaking;
        if (distributed < totalAmount) {
            toProtocol += totalAmount - distributed;
        }
    }

    /**
     * @dev Distribute to liquidator
     */
    function _distributeToLiquidator(uint256 positionId, uint256 amount) internal {
        if (amount == 0) return;
        
        // In this implementation, liquidator rewards are handled by LiquidationEngine
        // This function is a placeholder for future extensions (e.g., reward vesting)
        // For now, the amount stays in the distributor contract
        
        // Track cumulative rewards (for statistics)
        // Note: This doesn't track individual liquidators since reward goes through LiquidationEngine
    }

    /**
     * @dev Distribute to protocol treasury
     */
    function _distributeToProtocol(uint256 amount) internal {
        if (amount == 0 || protocolTreasury == address(0)) return;
        
        quoteToken.safeTransfer(protocolTreasury, amount);
    }

    /**
     * @dev Distribute to insurance fund
     */
    function _distributeToInsuranceFund(uint256 amount) internal {
        if (amount == 0 || insuranceFund == address(0)) return;
        
        quoteToken.safeTransfer(insuranceFund, amount);
    }

    /**
     * @dev Distribute to staking contract
     */
    function _distributeToStaking(uint256 amount) internal {
        if (amount == 0 || stakingContract == address(0)) return;
        
        quoteToken.safeTransfer(stakingContract, amount);
    }

    /**
     * @dev Update reward statistics
     */
    function _updateStats(
        uint256 totalPenalty,
        uint256 toLiquidator,
        uint256 toProtocol,
        uint256 toInsurance,
        uint256 toStaking
    ) internal {
        rewardStats.totalDistributed += totalPenalty;
        rewardStats.toLiquidators += toLiquidator;
        rewardStats.toProtocol += toProtocol;
        rewardStats.toInsurance += toInsurance;
        rewardStats.toStaking += toStaking;
        rewardStats.lastDistributionTime = block.timestamp;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update distribution configuration
     * @param newConfig New distribution configuration
     */
    function updateDistributionConfig(DistributionConfig calldata newConfig) external onlyOwner {
        require(newConfig.liquidatorShare <= MAX_SHARE, "Liquidator share too high");
        require(newConfig.protocolShare <= MAX_SHARE, "Protocol share too high");
        require(newConfig.insuranceShare <= MAX_SHARE, "Insurance share too high");
        require(newConfig.stakingShare <= MAX_SHARE, "Staking share too high");
        
        uint256 total = newConfig.liquidatorShare + newConfig.protocolShare + 
                       newConfig.insuranceShare + newConfig.stakingShare;
        require(total == SHARE_SCALE, "Total must equal 100%");
        
        distributionConfig = newConfig;
        
        emit DistributionConfigUpdated(
            newConfig.liquidatorShare,
            newConfig.protocolShare,
            newConfig.insuranceShare,
            newConfig.stakingShare
        );
    }

    /**
     * @notice Update protocol treasury address
     * @param newTreasury New treasury address
     */
    function updateProtocolTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid treasury");
        
        emit TreasuryUpdated(protocolTreasury, newTreasury);
        protocolTreasury = newTreasury;
    }

    /**
     * @notice Update insurance fund address
     * @param newInsuranceFund New insurance fund address
     */
    function updateInsuranceFund(address newInsuranceFund) external onlyOwner {
        require(newInsuranceFund != address(0), "Invalid insurance fund");
        
        emit InsuranceFundUpdated(insuranceFund, newInsuranceFund);
        insuranceFund = newInsuranceFund;
    }

    /**
     * @notice Update staking contract address
     * @param newStakingContract New staking contract address
     */
    function updateStakingContract(address newStakingContract) external onlyOwner {
        require(newStakingContract != address(0), "Invalid staking contract");
        
        emit StakingContractUpdated(stakingContract, newStakingContract);
        stakingContract = newStakingContract;
    }

    function setLiquidationEngine(address _liquidationEngine) external onlyOwner {
        require(_liquidationEngine != address(0), "Invalid address");
        liquidationEngine = _liquidationEngine;
    }

    /**
     * @notice Emergency recover tokens
     * @param token Token to recover
     * @param amount Amount to recover
     */
    function emergencyRecover(address token, uint256 amount) external onlyOwner {
        require(token != address(quoteToken), "Cannot recover quote token");
        
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Sweep excess quote tokens to treasury
     * @dev Only callable when no pending distributions
     */
    function sweepExcessTokens() external onlyOwner {
        uint256 contractBalance = quoteToken.balanceOf(address(this));
        uint256 reservedAmount = _calculateReservedAmount();
        
        require(contractBalance > reservedAmount, "No excess tokens");
        
        uint256 excess = contractBalance - reservedAmount;
        quoteToken.safeTransfer(protocolTreasury, excess);
    }

    // ============ PRIVATE FUNCTIONS ============

    /**
     * @dev Calculate reserved amount for pending distributions
     */
    function _calculateReservedAmount() private view returns (uint256) {
        // In current implementation, all distributions are immediate
        // This function can be extended for vesting schedules
        return 0;
    }
}