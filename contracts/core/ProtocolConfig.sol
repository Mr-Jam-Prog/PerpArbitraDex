// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";
import {ITimelockController} from "../interfaces/ITimelockController.sol";

import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";

/**
 * @title ProtocolConfig
 * @notice Single source of truth for all economic parameters
 * @dev Centralized configuration with timelock and governance controls
 */
contract ProtocolConfig is IConfigRegistry, Ownable, Pausable {
    using SafeDecimalMath for uint256;

    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant MAX_FEE_RATIO = PRECISION / 10; // 10% maximum
    uint256 private constant MAX_LEVERAGE = 100 * PRECISION; // 100x
    uint256 private constant MIN_MARGIN_RATIO = PRECISION / 200; // 0.5%

    // ============ STATE VARIABLES ============
    
    // Market ID => MarketConfig
    mapping(uint256 => MarketConfig) private _marketConfigs;
    
    // ProtocolConfig
    ProtocolConfig private _protocolConfig;
    
    // RiskConfig
    RiskConfig private _riskConfig;
    
    // Configuration guardian (emergency role)
    address private _configGuardian;
    
    // Timelock controller
    address public timelockController;
    
    // Scheduled updates
    mapping(bytes32 => ScheduledUpdate) private _scheduledUpdates;
    
    // Configuration version
    uint256 private _configVersion;

    // ============ STRUCTS ============
    
    struct ScheduledUpdate {
        bytes32 configHash;
        uint256 eta;
        bool executed;
        bool cancelled;
        address proposedBy;
    }

    // ============ MODIFIERS ============
    
    modifier onlyTimelock() {
        require(msg.sender == timelockController, "ProtocolConfig: only timelock");
        _;
    }
    
    modifier onlyGuardian() {
        require(msg.sender == _configGuardian, "ProtocolConfig: only guardian");
        _;
    }
    
    modifier marketExists(uint256 marketId) {
        require(_marketConfigs[marketId].isActive || _marketConfigs[marketId].createdAt > 0,
            "ProtocolConfig: market not found");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(
        address initialGuardian,
        address initialTimelock
    ) {
        require(initialGuardian != address(0), "ProtocolConfig: zero guardian");
        require(initialTimelock != address(0), "ProtocolConfig: zero timelock");
        
        _configGuardian = initialGuardian;
        timelockController = initialTimelock;
        
        // Initialize with safe defaults
        _protocolConfig = ProtocolConfig({
            protocolFeeRatio: PRECISION / 1000, // 0.1%
            insuranceFundRatio: PRECISION / 100, // 1%
            referralRewardRatio: PRECISION / 500, // 0.2%
            minLiquidationReward: 100 * PRECISION, // $100 minimum
            maxLiquidationReward: 10000 * PRECISION, // $10,000 maximum
            liquidationGracePeriod: 1 hours,
            oracleHeartbeat: 2 minutes,
            maxPriceDeviation: PRECISION / 100, // 1%
            insuranceFund: address(0), // Set after deployment
            feeCollector: address(0), // Set after deployment
            emergencyAdmin: initialGuardian
        });
        
        _riskConfig = RiskConfig({
            volatilityThreshold: PRECISION / 10, // 10%
            circuitBreakerThreshold: PRECISION / 5, // 20%
            maxDrawdown: PRECISION / 2, // 50%
            recoveryPeriod: 1 hours,
            positionConcentration: PRECISION / 20, // 5%
            marginCallThreshold: PRECISION * 125 / 100 // 125%
        });
        
        _configVersion = 1;
    }

    // ============ MARKET CONFIGURATION ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function updateMarketConfig(uint256 marketId, MarketConfig calldata newConfig)
        external
        override
        onlyTimelock
        marketExists(marketId)
    {
        MarketConfig storage config = _marketConfigs[marketId];
        
        // Validate parameters
        _validateMarketConfig(newConfig);
        
        // Save old config for event
        MarketConfig memory oldConfig = config;
        
        // Update config
        config.initialMarginRatio = newConfig.initialMarginRatio;
        config.maintenanceMarginRatio = newConfig.maintenanceMarginRatio;
        config.liquidationFeeRatio = newConfig.liquidationFeeRatio;
        config.maxLeverage = newConfig.maxLeverage;
        config.maxPositionSize = newConfig.maxPositionSize;
        config.maxOpenInterest = newConfig.maxOpenInterest;
        config.minPositionSize = newConfig.minPositionSize;
        config.fundingInterval = newConfig.fundingInterval;
        config.maxFundingRate = newConfig.maxFundingRate;
        config.priceImpactK = newConfig.priceImpactK;
        config.isActive = newConfig.isActive;
        config.updatedAt = block.timestamp;
        
        emit MarketConfigUpdated(marketId, oldConfig, newConfig);
        _configVersion++;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getMarketConfig(uint256 marketId)
        external
        view
        override
        marketExists(marketId)
        returns (MarketConfig memory config)
    {
        return _marketConfigs[marketId];
    }

    // ============ PROTOCOL CONFIGURATION ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function updateProtocolConfig(ProtocolConfig calldata newConfig)
        external
        override
        onlyTimelock
    {
        // Validate parameters
        _validateProtocolConfig(newConfig);
        
        // Save old config for event
        ProtocolConfig memory oldConfig = _protocolConfig;
        
        // Update config
        _protocolConfig = newConfig;
        
        emit ProtocolConfigUpdated(oldConfig, newConfig);
        _configVersion++;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getProtocolConfig()
        external
        view
        override
        returns (ProtocolConfig memory config)
    {
        return _protocolConfig;
    }

    // ============ RISK CONFIGURATION ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function updateRiskConfig(RiskConfig calldata newConfig)
        external
        override
        onlyTimelock
    {
        // Validate parameters
        _validateRiskConfig(newConfig);
        
        // Save old config for event
        RiskConfig memory oldConfig = _riskConfig;
        
        // Update config
        _riskConfig = newConfig;
        
        emit RiskConfigUpdated(oldConfig, newConfig);
        _configVersion++;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getRiskConfig()
        external
        view
        override
        returns (RiskConfig memory config)
    {
        return _riskConfig;
    }

    // ============ GUARDIAN FUNCTIONS ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function updateConfigGuardian(address newGuardian) external override onlyGuardian {
        require(newGuardian != address(0), "ProtocolConfig: zero address");
        
        address oldGuardian = _configGuardian;
        _configGuardian = newGuardian;
        
        emit ConfigGuardianUpdated(oldGuardian, newGuardian);
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getConfigGuardian() external view override returns (address guardian) {
        return _configGuardian;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function emergencyDisableMarket(uint256 marketId) external override onlyGuardian {
        MarketConfig storage config = _marketConfigs[marketId];
        require(config.isActive, "ProtocolConfig: already inactive");
        
        config.isActive = false;
        config.updatedAt = block.timestamp;
        
        emit MarketStatusChanged(marketId, false);
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function emergencyEnableMarket(uint256 marketId) external override onlyGuardian {
        MarketConfig storage config = _marketConfigs[marketId];
        require(!config.isActive, "ProtocolConfig: already active");
        
        config.isActive = true;
        config.updatedAt = block.timestamp;
        
        emit MarketStatusChanged(marketId, true);
    }

    // ============ VALIDATION FUNCTIONS ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function isMarketActive(uint256 marketId) 
        external 
        view 
        override 
        marketExists(marketId) 
        returns (bool active) 
    {
        return _marketConfigs[marketId].isActive;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function validateMarketParameters(
        uint256 marketId,
        uint256 size,
        uint256 leverage
    ) external view override returns (bool valid) {
        MarketConfig storage config = _marketConfigs[marketId];
        
        if (!config.isActive) return false;
        if (size < config.minPositionSize) return false;
        if (size > config.maxPositionSize) return false;
        if (leverage > config.maxLeverage) return false;
        
        // Check margin requirements
        uint256 requiredInitialMargin = size.mulDiv(config.initialMarginRatio, PRECISION);
        uint256 providedMargin = size.mulDiv(PRECISION, leverage);
        
        if (providedMargin < requiredInitialMargin) return false;
        
        return true;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getMaxPositionSize(uint256 marketId)
        external
        view
        override
        marketExists(marketId)
        returns (uint256 maxSize)
    {
        return _marketConfigs[marketId].maxPositionSize;
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function getMinMargin(uint256 marketId, uint256 size)
        external
        view
        override
        marketExists(marketId)
        returns (uint256 minMargin)
    {
        MarketConfig storage config = _marketConfigs[marketId];
        minMargin = size.mulDiv(config.initialMarginRatio, PRECISION);
    }

    // ============ TIMELOCK FUNCTIONS ============

    /**
     * @inheritdoc IConfigRegistry
     */
    function scheduleConfigUpdate(bytes32 configHash, uint256 eta) external override onlyTimelock {
        require(eta > block.timestamp, "ProtocolConfig: eta must be in future");
        require(_scheduledUpdates[configHash].eta == 0, "ProtocolConfig: already scheduled");
        
        _scheduledUpdates[configHash] = ScheduledUpdate({
            configHash: configHash,
            eta: eta,
            executed: false,
            cancelled: false,
            proposedBy: msg.sender
        });
        
        emit ConfigUpdateScheduled(configHash, eta);
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function executeConfigUpdate(bytes32 configHash) external override onlyTimelock {
        ScheduledUpdate storage update = _scheduledUpdates[configHash];
        require(update.eta > 0, "ProtocolConfig: not scheduled");
        require(!update.executed, "ProtocolConfig: already executed");
        require(!update.cancelled, "ProtocolConfig: cancelled");
        require(block.timestamp >= update.eta, "ProtocolConfig: eta not reached");
        
        update.executed = true;
        
        emit ConfigUpdateExecuted(configHash);
    }

    /**
     * @inheritdoc IConfigRegistry
     */
    function cancelConfigUpdate(bytes32 configHash) external override onlyTimelock {
        ScheduledUpdate storage update = _scheduledUpdates[configHash];
        require(update.eta > 0, "ProtocolConfig: not scheduled");
        require(!update.executed, "ProtocolConfig: already executed");
        require(!update.cancelled, "ProtocolConfig: already cancelled");
        
        update.cancelled = true;
        
        emit ConfigUpdateCancelled(configHash);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Validate market configuration parameters
     */
    function _validateMarketConfig(MarketConfig calldata config) internal pure {
        require(config.initialMarginRatio > 0, "ProtocolConfig: zero initial margin");
        require(config.maintenanceMarginRatio > 0, "ProtocolConfig: zero maintenance margin");
        require(config.initialMarginRatio > config.maintenanceMarginRatio,
            "ProtocolConfig: initial must be > maintenance");
        require(config.maxLeverage <= MAX_LEVERAGE, "ProtocolConfig: leverage too high");
        require(config.liquidationFeeRatio <= MAX_FEE_RATIO, "ProtocolConfig: fee too high");
        require(config.maxFundingRate <= MAX_FEE_RATIO, "ProtocolConfig: funding rate too high");
        require(config.fundingInterval >= 1 hours && config.fundingInterval <= 24 hours,
            "ProtocolConfig: invalid funding interval");
    }

    /**
     * @dev Validate protocol configuration parameters
     */
    function _validateProtocolConfig(ProtocolConfig calldata config) internal pure {
        require(config.protocolFeeRatio <= MAX_FEE_RATIO, "ProtocolConfig: fee too high");
        require(config.insuranceFundRatio <= MAX_FEE_RATIO, "ProtocolConfig: insurance too high");
        require(config.referralRewardRatio <= MAX_FEE_RATIO, "ProtocolConfig: reward too high");
        require(config.minLiquidationReward <= config.maxLiquidationReward,
            "ProtocolConfig: min > max");
        require(config.oracleHeartbeat <= 1 hours, "ProtocolConfig: heartbeat too long");
        require(config.maxPriceDeviation <= PRECISION / 20, "ProtocolConfig: deviation too high");
        require(config.insuranceFund != address(0), "ProtocolConfig: zero insurance fund");
        require(config.feeCollector != address(0), "ProtocolConfig: zero fee collector");
    }

    /**
     * @dev Validate risk configuration parameters
     */
    function _validateRiskConfig(RiskConfig calldata config) internal pure {
        require(config.volatilityThreshold <= PRECISION, "ProtocolConfig: volatility too high");
        require(config.circuitBreakerThreshold <= PRECISION, "ProtocolConfig: breaker too high");
        require(config.maxDrawdown <= PRECISION, "ProtocolConfig: drawdown too high");
        require(config.recoveryPeriod <= 24 hours, "ProtocolConfig: recovery too long");
        require(config.positionConcentration <= PRECISION / 10, "ProtocolConfig: concentration too high");
        require(config.marginCallThreshold >= PRECISION, "ProtocolConfig: call threshold too low");
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Initialize a new market configuration
     */
    function initializeMarket(
        uint256 marketId,
        MarketConfig calldata config
    ) external onlyOwner {
        require(_marketConfigs[marketId].createdAt == 0, "ProtocolConfig: market exists");
        
        _validateMarketConfig(config);
        
        _marketConfigs[marketId] = config;
        _marketConfigs[marketId].createdAt = block.timestamp;
        _marketConfigs[marketId].updatedAt = block.timestamp;
        
        emit MarketInitialized(marketId, _marketConfigs[marketId]);
    }

    /**
     * @notice Set timelock controller address
     */
    function setTimelockController(address newTimelock) external onlyOwner {
        require(newTimelock != address(0), "ProtocolConfig: zero address");
        timelockController = newTimelock;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get configuration version
     */
    function getConfigVersion() external view returns (uint256) {
        return _configVersion;
    }

    /**
     * @notice Get scheduled update details
     */
    function getScheduledUpdate(bytes32 configHash) 
        external 
        view 
        returns (ScheduledUpdate memory) 
    {
        return _scheduledUpdates[configHash];
    }

    /**
     * @notice Check if update is pending
     */
    function isUpdatePending(bytes32 configHash) external view returns (bool) {
        ScheduledUpdate storage update = _scheduledUpdates[configHash];
        return update.eta > 0 && !update.executed && !update.cancelled;
    }
}