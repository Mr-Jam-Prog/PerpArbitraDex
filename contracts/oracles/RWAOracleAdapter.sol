// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IRWAOracleAdapter} from "../interfaces/IRWAOracleAdapter.sol";

/**
 * @title RWAOracleAdapter
 * @notice Adapter for real-world asset oracles with slow update cadence
 * @dev Manual updates with NAV verification and volatility clamping
 */
contract RWAOracleAdapter is IRWAOracleAdapter, Ownable, Pausable {
    // ============ CONSTANTS ============
    
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant MAX_UPDATE_INTERVAL = 7 days; // Weekly updates max
    uint256 private constant MIN_UPDATE_INTERVAL = 1 hours; // Hourly updates min
    uint256 private constant MAX_VOLATILITY_BPS = 1000; // 10% max daily volatility
    uint256 private constant MAX_PRICE_CHANGE_BPS = 5000; // 50% max change between updates
    
    // ============ STRUCTS ============
    
    struct RWAPrice {
        uint256 price; // NAV per share/token (8 decimals)
        uint256 timestamp;
        uint256 navTimestamp; // When NAV was calculated off-chain
        bytes32 proofHash; // Hash of off-chain proof
        string metadata; // JSON metadata URI
    }
    
    struct RWAConfig {
        uint256 minUpdateInterval;
        uint256 maxUpdateInterval;
        uint256 maxVolatilityBps;
        bool requireProof;
        bool isActive;
    }
    
    // ============ STATE VARIABLES ============
    
    // Asset ID => price history
    mapping(bytes32 => RWAPrice[]) private _priceHistory;
    
    // Asset ID => configuration
    mapping(bytes32 => RWAConfig) private _assetConfigs;
    
    // Authorized updaters
    mapping(address => bool) private _authorizedUpdaters;
    
    // Last update per asset
    mapping(bytes32 => uint256) private _lastUpdate;
    
    // Emergency prices
    mapping(bytes32 => uint256) private _emergencyPrices;
    mapping(bytes32 => bool) private _emergencyActive;
    
    // ============ EVENTS ============
    
    event PriceUpdated(
        bytes32 indexed assetId,
        uint256 price,
        uint256 timestamp,
        uint256 navTimestamp,
        bytes32 proofHash,
        string metadata
    );
    event AssetConfigured(
        bytes32 indexed assetId,
        uint256 minUpdateInterval,
        uint256 maxUpdateInterval,
        uint256 maxVolatilityBps,
        bool requireProof
    );
    event UpdaterAuthorized(address indexed updater, bool authorized);
    event EmergencyPriceSet(bytes32 indexed assetId, uint256 price, address setBy);
    event EmergencyPriceCleared(bytes32 indexed assetId, address clearedBy);
    
    // ============ MODIFIERS ============
    
    modifier onlyUpdater() {
        require(_authorizedUpdaters[msg.sender] || msg.sender == owner(),
            "RWAOracleAdapter: unauthorized");
        _;
    }
    
    modifier assetExists(bytes32 assetId) {
        require(_assetConfigs[assetId].isActive, "RWAOracleAdapter: asset not found");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor() {
        // Owner is automatically an authorized updater
        _authorizedUpdaters[msg.sender] = true;
    }
    
    // ============ PRICE MANAGEMENT ============
    
    /**
     * @inheritdoc IRWAOracleAdapter
     */
    function getPriceData(bytes32 assetId)
        external
        view
        override
        assetExists(assetId)
        returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (_emergencyActive[assetId]) {
            return (true, _emergencyPrices[assetId], block.timestamp, 10000);
        }
        
        RWAPrice[] storage history = _priceHistory[assetId];
        if (history.length == 0) {
            return (false, 0, 0, 0);
        }
        
        RWAPrice storage latest = history[history.length - 1];
        
        // Check if price is stale
        RWAConfig storage config = _assetConfigs[assetId];
        bool stale = block.timestamp - latest.timestamp > config.maxUpdateInterval;
        
        if (stale) {
            return (false, 0, 0, 0);
        }
        
        // Calculate confidence based on time since update
        uint256 timeSinceUpdate = block.timestamp - latest.timestamp;
        uint256 maxInterval = config.maxUpdateInterval;
        
        // Confidence decreases linearly with time
        if (timeSinceUpdate >= maxInterval) {
            confidence = 0;
        } else {
            confidence = 10000 - (timeSinceUpdate * 10000 / maxInterval);
        }
        
        return (true, latest.price, latest.timestamp, confidence);
    }
    
    /**
     * @notice Update price for an RWA
     * @param assetId Asset identifier
     * @param price NAV price (8 decimals)
     * @param navTimestamp When NAV was calculated off-chain
     * @param proofHash Hash of off-chain proof
     * @param metadata JSON metadata URI
     * @return success True if price was updated
     */
    function updatePrice(
        bytes32 assetId,
        uint256 price,
        uint256 navTimestamp,
        bytes32 proofHash,
        string calldata metadata
    ) external onlyUpdater assetExists(assetId) returns (bool success) {
        require(price > 0, "RWAOracleAdapter: zero price");
        require(navTimestamp <= block.timestamp, "RWAOracleAdapter: future NAV timestamp");
        
        RWAConfig storage config = _assetConfigs[assetId];
        
        // Check update interval
        require(block.timestamp - _lastUpdate[assetId] >= config.minUpdateInterval,
            "RWAOracleAdapter: too frequent update");
        
        // Check proof requirement
        if (config.requireProof) {
            require(proofHash != bytes32(0), "RWAOracleAdapter: proof required");
        }
        
        // Get previous price for volatility check
        RWAPrice[] storage history = _priceHistory[assetId];
        if (history.length > 0) {
            RWAPrice storage previous = history[history.length - 1];
            
            // Calculate price change
            uint256 changeBps;
            if (price >= previous.price) {
                changeBps = (price - previous.price) * 10000 / previous.price;
            } else {
                changeBps = (previous.price - price) * 10000 / previous.price;
            }
            
            // Check against max volatility
            require(changeBps <= config.maxVolatilityBps,
                "RWAOracleAdapter: volatility too high");
            
            // Additional sanity: check against absolute max change
            require(changeBps <= MAX_PRICE_CHANGE_BPS,
                "RWAOracleAdapter: price change too large");
        }
        
        // Create new price entry
        RWAPrice memory newPrice = RWAPrice({
            price: price,
            timestamp: block.timestamp,
            navTimestamp: navTimestamp,
            proofHash: proofHash,
            metadata: metadata
        });
        
        history.push(newPrice);
        _lastUpdate[assetId] = block.timestamp;
        
        emit PriceUpdated(assetId, price, block.timestamp, navTimestamp, proofHash, metadata);
        
        return true;
    }
    
    // ============ ASSET MANAGEMENT ============
    
    /**
     * @notice Configure a new RWA asset
     */
    function configureAsset(
        bytes32 assetId,
        uint256 minUpdateInterval,
        uint256 maxUpdateInterval,
        uint256 maxVolatilityBps,
        bool requireProof
    ) external onlyOwner {
        require(minUpdateInterval >= MIN_UPDATE_INTERVAL, 
            "RWAOracleAdapter: min interval too low");
        require(maxUpdateInterval <= MAX_UPDATE_INTERVAL,
            "RWAOracleAdapter: max interval too high");
        require(minUpdateInterval < maxUpdateInterval,
            "RWAOracleAdapter: invalid interval range");
        require(maxVolatilityBps <= MAX_VOLATILITY_BPS,
            "RWAOracleAdapter: volatility too high");
        require(!_assetConfigs[assetId].isActive,
            "RWAOracleAdapter: asset already configured");
        
        _assetConfigs[assetId] = RWAConfig({
            minUpdateInterval: minUpdateInterval,
            maxUpdateInterval: maxUpdateInterval,
            maxVolatilityBps: maxVolatilityBps,
            requireProof: requireProof,
            isActive: true
        });
        
        emit AssetConfigured(assetId, minUpdateInterval, maxUpdateInterval, 
            maxVolatilityBps, requireProof);
    }
    
    /**
     * @notice Deactivate an asset
     */
    function deactivateAsset(bytes32 assetId) external onlyOwner assetExists(assetId) {
        _assetConfigs[assetId].isActive = false;
    }
    
    // ============ UPDATER MANAGEMENT ============
    
    /**
     * @notice Authorize an address to update prices
     */
    function authorizeUpdater(address updater, bool authorized) external onlyOwner {
        _authorizedUpdaters[updater] = authorized;
        
        emit UpdaterAuthorized(updater, authorized);
    }
    
    /**
     * @notice Check if address is authorized updater
     */
    function isAuthorizedUpdater(address updater) external view returns (bool) {
        return _authorizedUpdaters[updater];
    }
    
    // ============ EMERGENCY FUNCTIONS ============
    
    /**
     * @notice Set emergency price for an asset
     */
    function setEmergencyPrice(bytes32 assetId, uint256 price) external onlyOwner {
        require(price > 0, "RWAOracleAdapter: zero price");
        
        _emergencyPrices[assetId] = price;
        _emergencyActive[assetId] = true;
        
        emit EmergencyPriceSet(assetId, price, msg.sender);
    }
    
    /**
     * @notice Clear emergency price
     */
    function clearEmergencyPrice(bytes32 assetId) external onlyOwner {
        _emergencyActive[assetId] = false;
        
        emit EmergencyPriceCleared(assetId, msg.sender);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get latest price for an asset
     */
    function getLatestPrice(bytes32 assetId) 
        external 
        view 
        returns (RWAPrice memory price, bool valid) 
    {
        RWAPrice[] storage history = _priceHistory[assetId];
        if (history.length == 0) {
            return (RWAPrice(0, 0, 0, bytes32(0), ""), false);
        }
        
        price = history[history.length - 1];
        valid = true;
    }
    
    /**
     * @notice Get price history for an asset
     */
    function getPriceHistory(bytes32 assetId, uint256 limit) 
        external 
        view 
        returns (RWAPrice[] memory history) 
    {
        RWAPrice[] storage fullHistory = _priceHistory[assetId];
        uint256 historyLength = fullHistory.length;
        
        if (limit == 0 || limit > historyLength) {
            limit = historyLength;
        }
        
        history = new RWAPrice[](limit);
        
        for (uint256 i = 0; i < limit; i++) {
            history[i] = fullHistory[historyLength - 1 - i];
        }
    }
    
    /**
     * @notice Get asset configuration
     */
    function getAssetConfig(bytes32 assetId) external view returns (RWAConfig memory) {
        return _assetConfigs[assetId];
    }
    
    /**
     * @notice Check if price is stale
     */
    function isPriceStale(bytes32 assetId) external view returns (bool) {
        RWAPrice[] storage history = _priceHistory[assetId];
        if (history.length == 0) {
            return true;
        }
        
        RWAPrice storage latest = history[history.length - 1];
        RWAConfig storage config = _assetConfigs[assetId];
        
        return block.timestamp - latest.timestamp > config.maxUpdateInterval;
    }
    
    /**
     * @notice Get time since last update
     */
    function getTimeSinceLastUpdate(bytes32 assetId) external view returns (uint256) {
        if (_lastUpdate[assetId] == 0) {
            return type(uint256).max;
        }
        
        return block.timestamp - _lastUpdate[assetId];
    }
    
    /**
     * @notice Calculate volatility between two prices
     */
    function calculateVolatility(
        uint256 price1,
        uint256 price2
    ) external pure returns (uint256 volatilityBps) {
        require(price1 > 0 && price2 > 0, "RWAOracleAdapter: zero price");
        
        if (price1 >= price2) {
            volatilityBps = (price1 - price2) * 10000 / price2;
        } else {
            volatilityBps = (price2 - price1) * 10000 / price1;
        }
    }
    
    /**
     * @notice Get emergency price status
     */
    function getEmergencyStatus(bytes32 assetId) external view returns (bool active, uint256 price) {
        return (_emergencyActive[assetId], _emergencyPrices[assetId]);
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Emergency pause all updates
     */
    function emergencyPause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Emergency unpause
     */
    function emergencyUnpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @notice Withdraw any accidentally sent ETH
     */
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "RWAOracleAdapter: no balance");
        
        payable(owner()).transfer(balance);
    }

    function getPrice(bytes32 assetId) external view override returns (uint256) {
        (, uint256 price, , ) = this.getPriceData(assetId);
        return price;
    }

    function updatePrice(bytes32 assetId, uint256 price, uint256 timestamp) external override onlyUpdater assetExists(assetId) returns (bool success) {
        return this.updatePrice(assetId, price, timestamp, bytes32(0), "");
    }
}