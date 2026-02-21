// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IMarketRegistry} from "../interfaces/IMarketRegistry.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

/**
 * @title MarketRegistry
 * @notice Registry for all supported markets with configuration
 * @dev Central registry for market parameters and oracle mappings
 */
contract MarketRegistry is IMarketRegistry, Ownable, Pausable {
    // ============ STATE VARIABLES ============
    
    // Market ID => Market configuration
    mapping(uint256 => IMarketRegistry.Market) private _markets;
    
    // Market ID => version history
    mapping(uint256 => IMarketRegistry.MarketUpdate[]) private _marketHistory;
    
    // Symbol => Market ID
    mapping(string => uint256) private _symbolToMarketId;
    
    // Array of all market IDs
    uint256[] private _allMarketIds;
    
    // Next market ID
    uint256 private _nextMarketId = 1;
    
    // Configuration registry
    address public configRegistry;

    // ============ EVENTS ============
    
    event MarketAdded(
        uint256 indexed marketId,
        string symbol,
        bytes32 oracleFeedId,
        address baseToken,
        address quoteToken,
        uint256 maxLeverage,
        uint256 maxPositionSize
    );
    
    event MarketUpdated(
        uint256 indexed marketId,
        uint256 version,
        address updatedBy
    );
    
    event MarketStatusChanged(
        uint256 indexed marketId,
        bool newStatus,
        address changedBy
    );
    
    event OracleFeedUpdated(
        uint256 indexed marketId,
        bytes32 oldFeedId,
        bytes32 newFeedId
    );

    // ============ MODIFIERS ============
    
    modifier onlyGovernance() {
        require(msg.sender == owner() || msg.sender == configRegistry, 
            "MarketRegistry: only governance");
        _;
    }
    
    modifier marketExists(uint256 marketId) {
        require(marketId > 0 && marketId < _nextMarketId, "MarketRegistry: invalid market ID");
        require(_markets[marketId].createdAt > 0, "MarketRegistry: market not found");
        _;
    }
    
    modifier marketActive(uint256 marketId) {
        require(_markets[marketId].isActive, "MarketRegistry: market inactive");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(address configRegistry_) {
        require(configRegistry_ != address(0), "MarketRegistry: zero address");
        configRegistry = configRegistry_;
    }

    // ============ MARKET MANAGEMENT ============

    /**
     * @inheritdoc IMarketRegistry
     */
    function addMarket(
        string calldata symbol,
        bytes32 oracleFeedId,
        address baseToken,
        address quoteToken,
        uint256 maxLeverage,
        uint256 minMarginRatio,
        uint256 liquidationFeeRatio,
        uint256 protocolFeeRatio,
        uint256 maxPositionSize,
        uint256 maxOpenInterest
    ) external override onlyGovernance whenNotPaused returns (uint256 marketId) {
        require(bytes(symbol).length > 0, "MarketRegistry: empty symbol");
        require(oracleFeedId != bytes32(0), "MarketRegistry: invalid oracle feed");
        require(baseToken != address(0), "MarketRegistry: zero base token");
        require(quoteToken != address(0), "MarketRegistry: zero quote token");
        require(baseToken != quoteToken, "MarketRegistry: same tokens");
        require(_symbolToMarketId[symbol] == 0, "MarketRegistry: symbol exists");
        require(maxLeverage > 0, "MarketRegistry: zero leverage");
        require(maxPositionSize > 0, "MarketRegistry: zero max position");
        
        marketId = _nextMarketId++;
        
        IMarketRegistry.Market memory market = IMarketRegistry.Market({
            isActive: true,
            symbol: symbol,
            oracleFeedId: oracleFeedId,
            baseToken: baseToken,
            quoteToken: quoteToken,
            maxLeverage: maxLeverage,
            minMarginRatio: minMarginRatio,
            liquidationFeeRatio: liquidationFeeRatio,
            protocolFeeRatio: protocolFeeRatio,
            maxPositionSize: maxPositionSize,
            maxOpenInterest: maxOpenInterest,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            version: 1
        });
        
        _markets[marketId] = market;
        _symbolToMarketId[symbol] = marketId;
        _allMarketIds.push(marketId);
        
        // Initialize history
        _marketHistory[marketId].push(IMarketRegistry.MarketUpdate({
            marketId: marketId,
            oldConfig: IMarketRegistry.Market({
                isActive: false,
                symbol: "",
                oracleFeedId: bytes32(0),
                baseToken: address(0),
                quoteToken: address(0),
                maxLeverage: 0,
                minMarginRatio: 0,
                liquidationFeeRatio: 0,
                protocolFeeRatio: 0,
                maxPositionSize: 0,
                maxOpenInterest: 0,
                createdAt: 0,
                updatedAt: 0,
                version: 0
            }),
            newConfig: market,
            timestamp: block.timestamp,
            updatedBy: msg.sender
        }));
        
        emit MarketAdded(
            marketId,
            symbol,
            oracleFeedId,
            baseToken,
            quoteToken,
            maxLeverage,
            maxPositionSize
        );
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function updateMarket(
        uint256 marketId,
        uint256 maxLeverage,
        uint256 minMarginRatio,
        uint256 liquidationFeeRatio,
        uint256 protocolFeeRatio,
        uint256 maxPositionSize,
        uint256 maxOpenInterest
    ) external override onlyGovernance marketExists(marketId) {
        IMarketRegistry.Market storage market = _markets[marketId];
        
        // Save old configuration
        IMarketRegistry.Market memory oldConfig = market;
        
        // Update parameters
        market.maxLeverage = maxLeverage;
        market.minMarginRatio = minMarginRatio;
        market.liquidationFeeRatio = liquidationFeeRatio;
        market.protocolFeeRatio = protocolFeeRatio;
        market.maxPositionSize = maxPositionSize;
        market.maxOpenInterest = maxOpenInterest;
        market.updatedAt = block.timestamp;
        market.version++;
        
        // Save to history
        _marketHistory[marketId].push(IMarketRegistry.MarketUpdate({
            marketId: marketId,
            oldConfig: oldConfig,
            newConfig: market,
            timestamp: block.timestamp,
            updatedBy: msg.sender
        }));
        
        emit MarketUpdated(marketId, market.version, msg.sender);
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function setMarketStatus(uint256 marketId, bool isActive) 
        external 
        override 
        onlyGovernance 
        marketExists(marketId) 
    {
        IMarketRegistry.Market storage market = _markets[marketId];
        require(market.isActive != isActive, "MarketRegistry: same status");
        
        // Can't disable market with open positions (checked by PerpEngine)
        if (!isActive) {
            // Additional checks would be done by PerpEngine
        }
        
        market.isActive = isActive;
        market.updatedAt = block.timestamp;
        
        emit MarketStatusChanged(marketId, isActive, msg.sender);
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function updateOracleFeed(uint256 marketId, bytes32 newFeedId) 
        external 
        override 
        onlyGovernance 
        marketExists(marketId) 
    {
        require(newFeedId != bytes32(0), "MarketRegistry: invalid feed");
        
        IMarketRegistry.Market storage market = _markets[marketId];
        bytes32 oldFeedId = market.oracleFeedId;
        
        require(oldFeedId != newFeedId, "MarketRegistry: same feed");
        
        // Verify oracle feed exists and is valid
        // This would check with OracleAggregator in production
        
        market.oracleFeedId = newFeedId;
        market.updatedAt = block.timestamp;
        
        emit OracleFeedUpdated(marketId, oldFeedId, newFeedId);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc IMarketRegistry
     */
    function getMarket(uint256 marketId) 
        external 
        view 
        override 
        marketExists(marketId) 
        returns (IMarketRegistry.Market memory)
    {
        return _markets[marketId];
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function getMarketBySymbol(string calldata symbol) 
        external 
        view 
        override 
        returns (uint256 marketId, IMarketRegistry.Market memory market)
    {
        marketId = _symbolToMarketId[symbol];
        require(marketId > 0, "MarketRegistry: symbol not found");
        market = _markets[marketId];
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function getMarketStatus(uint256 marketId) 
        external 
        view 
        override 
        marketExists(marketId) 
        returns (bool isActive, uint256 version) 
    {
        IMarketRegistry.Market storage market = _markets[marketId];
        return (market.isActive, market.version);
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function validateMarket(uint256 marketId, uint256 positionSize) 
        external 
        view 
        override 
        returns (bool valid, string memory reason) 
    {
        if (marketId == 0 || marketId >= _nextMarketId) {
            return (false, "MarketRegistry: invalid market ID");
        }
        
        IMarketRegistry.Market storage market = _markets[marketId];
        
        if (!market.isActive) {
            return (false, "MarketRegistry: market inactive");
        }
        
        if (positionSize > market.maxPositionSize) {
            return (false, "MarketRegistry: exceeds max position size");
        }
        
        // Additional validations would be done by RiskManager
        
        return (true, "");
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function getAllMarkets() external view override returns (uint256[] memory) {
        return _allMarketIds;
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function getActiveMarkets() external view override returns (uint256[] memory) {
        uint256 activeCount = 0;
        
        // Count active markets
        for (uint256 i = 0; i < _allMarketIds.length; i++) {
            if (_markets[_allMarketIds[i]].isActive) {
                activeCount++;
            }
        }
        
        // Create array
        uint256[] memory activeMarkets = new uint256[](activeCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < _allMarketIds.length; i++) {
            uint256 marketId = _allMarketIds[i];
            if (_markets[marketId].isActive) {
                activeMarkets[index] = marketId;
                index++;
            }
        }
        
        return activeMarkets;
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function getMarketHistory(uint256 marketId, uint256 limit) 
        external 
        view 
        override 
        marketExists(marketId) 
        returns (IMarketRegistry.MarketUpdate[] memory history)
    {
        IMarketRegistry.MarketUpdate[] storage fullHistory = _marketHistory[marketId];
        uint256 historyLength = fullHistory.length;
        
        if (limit == 0 || limit > historyLength) {
            limit = historyLength;
        }
        
        history = new IMarketRegistry.MarketUpdate[](limit);
        
        for (uint256 i = 0; i < limit; i++) {
            history[i] = fullHistory[historyLength - 1 - i];
        }
    }

    /**
     * @inheritdoc IMarketRegistry
     */
    function isMarketActive(uint256 marketId) 
        external 
        view 
        override 
        marketExists(marketId) 
        returns (bool) 
    {
        return _markets[marketId].isActive;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Set configuration registry address
     */
    function setConfigRegistry(address newConfigRegistry) external onlyOwner {
        require(newConfigRegistry != address(0), "MarketRegistry: zero address");
        configRegistry = newConfigRegistry;
    }

    /**
     * @notice Emergency pause all markets
     */
    function emergencyPause() external onlyOwner {
        _pause();
        
        // Mark all markets as inactive
        for (uint256 i = 0; i < _allMarketIds.length; i++) {
            uint256 marketId = _allMarketIds[i];
            if (_markets[marketId].isActive) {
                _markets[marketId].isActive = false;
                emit MarketStatusChanged(marketId, false, msg.sender);
            }
        }
    }

    /**
     * @notice Emergency resume markets
     */
    function emergencyResume() external onlyOwner {
        _unpause();
        
        // Reactivate markets
        for (uint256 i = 0; i < _allMarketIds.length; i++) {
            uint256 marketId = _allMarketIds[i];
            if (!_markets[marketId].isActive) {
                _markets[marketId].isActive = true;
                emit MarketStatusChanged(marketId, true, msg.sender);
            }
        }
    }

    // ============ UTILITY FUNCTIONS ============

    /**
     * @notice Get total number of markets
     */
    function getMarketCount() external view returns (uint256 total, uint256 active) {
        total = _allMarketIds.length;
        
        for (uint256 i = 0; i < total; i++) {
            if (_markets[_allMarketIds[i]].isActive) {
                active++;
            }
        }
    }

    /**
     * @notice Check if symbol exists
     */
    function symbolExists(string calldata symbol) external view returns (bool) {
        return _symbolToMarketId[symbol] > 0;
    }

    /**
     * @notice Get market ID by symbol
     */
    function getMarketIdBySymbol(string calldata symbol) external view returns (uint256) {
        return _symbolToMarketId[symbol];
    }
}
