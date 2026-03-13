// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";

import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {IOracleSecurity} from "./OracleSecurity.sol";
import {OracleSanityChecker} from "./OracleSanityChecker.sol";
import {ChainlinkOracle} from "./ChainlinkOracle.sol";
import {PythOracle} from "./PythOracle.sol";
import {TWAPOracle} from "./TWAPOracle.sol";

/**
 * @title OracleAggregator
 * @notice Single entry point for price feeds with multi-source aggregation and fallback
 * @dev Never reverts on getPrice, returns last valid price with staleness flag
 */
contract OracleAggregator is IOracleAggregator, Ownable, Pausable {
    // ============ CONSTANTS ============
    
    uint256 private constant PRECISION = 1e18;
    uint256 private constant PRICE_DECIMALS = 8; // All prices normalized to 8 decimals
    uint256 private constant MAX_CACHE_AGE = 5 minutes;
    uint256 private constant MIN_SOURCES = 2;
    uint256 private constant MAX_DEVIATION_BPS = 200; // 2%
    uint256 private constant MEDIAN_WINDOW = 3;

    // ============ STRUCTS ============
    
    struct AggregatedPrice {
        uint256 price;
        uint256 timestamp;
        uint256 confidence;
        PriceStatus status;
        uint256 minPrice;
        uint256 maxPrice;
    }

    struct PriceCache {
        uint256 price;
        uint256 timestamp;
        uint256 confidence;
        bool isValid;
    }

    // ============ STATE VARIABLES ============
    
    // Feed ID => OracleSource[]
    mapping(bytes32 => OracleSource[]) private _sources;
    
    // Feed ID => AggregatedPrice
    mapping(bytes32 => AggregatedPrice) private _aggregatedPrices;
    
    // Feed ID => PriceCache
    mapping(bytes32 => PriceCache) private _priceCache;
    
    // Feed ID => configuration
    mapping(bytes32 => FeedConfig) private _feedConfigs;

    // feedId => timestamp => prices
    mapping(bytes32 => mapping(uint256 => uint256[])) private _aggregatedPricesHistory;
    // feedId => timestamp => timestamps
    mapping(bytes32 => mapping(uint256 => uint256[])) private _aggregatedTimestampsHistory;
    // feedId => timestamp => confidences
    mapping(bytes32 => mapping(uint256 => uint256[])) private _aggregatedConfidencesHistory;
    
    // Security module
    address public oracleSecurity;
    
    // Sanity checker
    address public sanityChecker;
    
    // Emergency fallback price (feedId => price)
    mapping(bytes32 => uint256) private _emergencyPrices;
    
    // Feed IDs list
    bytes32[] private _allFeedIds;

    // ============ MODIFIERS ============
    
    modifier onlySecurityModule() {
        require(msg.sender == oracleSecurity, "OracleAggregator: only security module");
        _;
    }
    
    modifier feedExists(bytes32 feedId) {
        require(_sources[feedId].length > 0, "OracleAggregator: feed not found");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(address securityModule, address sanityChecker_) {
        require(securityModule != address(0), "OracleAggregator: zero address");
        require(sanityChecker_ != address(0), "OracleAggregator: zero address");
        
        oracleSecurity = securityModule;
        sanityChecker = sanityChecker_;
    }

    // ============ PRICE AGGREGATION ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function getPrice(bytes32 feedId) 
        external 
        view 
        override 
        returns (uint256 price) 
    {
        // Never revert - return last valid price with staleness flag
        AggregatedPrice storage aggPrice = _aggregatedPrices[feedId];
        uint256 maxStaleness = _feedConfigs[feedId].maxStaleness;
        if (maxStaleness == 0) maxStaleness = MAX_CACHE_AGE;
        
        if (aggPrice.status == PriceStatus.ACTIVE && 
            aggPrice.timestamp <= block.timestamp &&
            block.timestamp - aggPrice.timestamp <= maxStaleness) {
            return aggPrice.price;
        }
        
        // Return cached price if available and not too stale
        PriceCache storage cache = _priceCache[feedId];
        if (cache.isValid &&
            cache.timestamp <= block.timestamp &&
            block.timestamp - cache.timestamp <= maxStaleness * 2) {
            return cache.price;
        }
        
        // Emergency fallback price
        if (_emergencyPrices[feedId] > 0) {
            return _emergencyPrices[feedId];
        }
        
        // Last resort: return 0 (caller must handle)
        return 0;
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function getPriceData(bytes32 feedId)
        external
        view
        override
        returns (PriceData memory priceData)
    {
        AggregatedPrice storage aggPrice = _aggregatedPrices[feedId];
        
        priceData = PriceData({
            price: aggPrice.price,
            timestamp: aggPrice.timestamp,
            confidence: aggPrice.confidence,
            status: aggPrice.status,
            minPrice: aggPrice.minPrice,
            maxPrice: aggPrice.maxPrice
        });
    }

    /**
     * @notice Update price for a feed from all sources
     * @param feedId Feed identifier
     * @return success True if price was updated
     */
    function updatePrice(bytes32 feedId) 
        external 
        whenNotPaused
        feedExists(feedId)
        returns (bool success) 
    {
        OracleSource[] storage sources = _sources[feedId];
        require(sources.length >= MIN_SOURCES, "OracleAggregator: insufficient sources");
        
        // Collect prices from all active sources
        uint256[] memory prices = new uint256[](sources.length);
        uint256[] memory timestamps = new uint256[](sources.length);
        uint256[] memory confidences = new uint256[](sources.length);
        
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < sources.length; i++) {
            OracleSource storage source = sources[i];
            
            if (!source.isActive) {
                continue;
            }
            
            (bool sourceValid, uint256 price, uint256 timestamp, uint256 confidence) = 
                _fetchSourcePrice(source);
            
            if (sourceValid) {
                // Timestamp validation
                if (timestamp > block.timestamp || timestamp == 0) {
                    continue;
                }

                // Staleness check per source
                if (block.timestamp - timestamp > source.heartbeat) {
                    continue;
                }

                // Normalize to target decimals
                prices[validCount] = _normalizeDecimals(price, source.decimals, PRICE_DECIMALS);
                timestamps[validCount] = timestamp;
                confidences[validCount] = confidence;
                validCount++;
            }
            
            // Update source last update time
            source.lastUpdate = timestamp;
        }
        
        require(validCount >= MIN_SOURCES, "OracleAggregator: insufficient valid sources");
        
        // Aggregate prices
        AggregatedPrice memory aggPrice = _aggregatePrices(
            feedId,
            prices,
            timestamps,
            confidences,
            validCount
        );
        
        // Apply sanity checks
        bool sanityOk;
        try OracleSanityChecker(sanityChecker).validatePrice(
            feedId,
            aggPrice.price,
            aggPrice.minPrice,
            aggPrice.maxPrice
        ) returns (bool ok) {
            sanityOk = ok;
        } catch {
            sanityOk = false;
        }
        
        if (!sanityOk) {
            // Mark price as disputed
            aggPrice.status = PriceStatus.DISPUTED;
            
            // Check security module for emergency handling
            try IOracleSecurity(oracleSecurity).shouldFreeze(feedId) returns (bool freeze) {
                if (freeze) {
                    aggPrice.status = PriceStatus.FROZEN;
                }
            } catch {}
        }
        
        // Update aggregated price
        _aggregatedPrices[feedId] = aggPrice;

        // Store source data for audit using separate mappings to avoid struct nested array issues
        _aggregatedPricesHistory[feedId][aggPrice.timestamp] = prices;
        _aggregatedTimestampsHistory[feedId][aggPrice.timestamp] = timestamps;
        _aggregatedConfidencesHistory[feedId][aggPrice.timestamp] = confidences;
        
        // Update cache
        _priceCache[feedId] = PriceCache({
            price: aggPrice.price,
            timestamp: aggPrice.timestamp,
            confidence: aggPrice.confidence,
            isValid: aggPrice.status == PriceStatus.ACTIVE
        });
        
        emit PriceUpdated(
            feedId,
            aggPrice.price,
            aggPrice.timestamp,
            aggPrice.confidence
        );
        
        return true;
    }

    // ============ SOURCE MANAGEMENT ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function addOracleSource(bytes32 feedId, OracleSource calldata source)
        external
        override
        onlyOwner
    {
        require(source.oracleAddress != address(0), "OracleAggregator: zero address");
        require(source.heartbeat > 0, "OracleAggregator: zero heartbeat");
        require(source.decimals <= 18, "OracleAggregator: too many decimals");
        
        // Check for duplicates
        for (uint256 i = 0; i < _sources[feedId].length; i++) {
            require(
                _sources[feedId][i].oracleAddress != source.oracleAddress,
                "OracleAggregator: duplicate source"
            );
        }
        
        _sources[feedId].push(source);
        
        // Initialize feed config if first source
        if (_sources[feedId].length == 1) {
            _feedConfigs[feedId] = FeedConfig({
                minSources: MIN_SOURCES,
                maxDeviationBps: MAX_DEVIATION_BPS,
                maxStaleness: MAX_CACHE_AGE,
                requireTWAP: false,
                twapWindow: 0
            });
            _allFeedIds.push(feedId);
        }
        
        emit OracleAdded(feedId, source.oracleAddress, source.oracleType);
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function removeOracleSource(bytes32 feedId) external override onlyOwner {
        require(_sources[feedId].length > 0, "OracleAggregator: no sources");
        
        // Find and remove source
        _sources[feedId].pop();
        
        // If no sources left, remove feed
        if (_sources[feedId].length == 0) {
            _removeFeed(feedId);
        }
        
        emit OracleRemoved(feedId);
    }

    // ============ TWAP FUNCTIONS ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function getTWAP(bytes32 feedId, uint256 period)
        external
        view
        override
        feedExists(feedId)
        returns (uint256 twapPrice)
    {
        // Check if TWAP is required for this feed
        if (_feedConfigs[feedId].requireTWAP) {
            // Get TWAP from TWAP oracle
            // Implementation depends on TWAP oracle interface
            // For now, return current price if no TWAP available
            return _aggregatedPrices[feedId].price;
        }
        
        // Calculate simple TWAP from price history
        // Note: In production, this would use a proper TWAP oracle
        return _aggregatedPrices[feedId].price;
    }

    // ============ CONSENSUS FUNCTIONS ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function getConsensusPrice(bytes32 feedId)
        external
        view
        override
        feedExists(feedId)
        returns (uint256 consensusPrice, uint256 numSources)
    {
        OracleSource[] storage sources = _sources[feedId];
        uint256[] memory prices = new uint256[](sources.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < sources.length; i++) {
            if (!sources[i].isActive) continue;
            
            (bool valid, uint256 price, , ) = _fetchSourcePrice(sources[i]);
            if (valid) {
                // Normalize to target decimals
                prices[validCount] = _normalizeDecimals(price, sources[i].decimals, PRICE_DECIMALS);
                validCount++;
            }
        }
        
        if (validCount == 0) {
            return (0, 0);
        }
        
        // Calculate median of valid prices
        consensusPrice = _median(prices, validCount);
        numSources = validCount;
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function validatePriceDeviation(bytes32 feedId, uint256 maxDeviation)
        external
        view
        override
        returns (bool valid)
    {
        OracleSource[] storage sources = _sources[feedId];
        uint256[] memory prices = new uint256[](sources.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < sources.length; i++) {
            if (!sources[i].isActive) continue;
            
            (bool sourceValid, uint256 price, , ) = _fetchSourcePrice(sources[i]);
            if (sourceValid) {
                // Normalize to target decimals
                prices[validCount] = _normalizeDecimals(price, sources[i].decimals, PRICE_DECIMALS);
                validCount++;
            }
        }
        
        if (validCount < MIN_SOURCES) {
            return false;
        }
        
        // Check deviation between min and max prices
        (uint256 minPrice, uint256 maxPrice) = _minMax(prices, validCount);
        uint256 deviation = (maxPrice - minPrice) * 10000 / minPrice;
        
        return deviation <= maxDeviation;
    }

    // ============ EMERGENCY FUNCTIONS ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function emergencyPriceOverride(bytes32 feedId, uint256 price) 
        external 
        override 
        onlySecurityModule 
    {
        require(price > 0, "OracleAggregator: zero price");
        
        _emergencyPrices[feedId] = price;
        
        // Mark aggregated price as overridden
        _aggregatedPrices[feedId].status = PriceStatus.FROZEN;
        _aggregatedPrices[feedId].price = price;
        _aggregatedPrices[feedId].timestamp = block.timestamp;
        
        emit EmergencyPriceOverride(feedId, price, msg.sender);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Fetch price from a single oracle source
     */
    function _fetchSourcePrice(OracleSource memory source)
        internal
        view
        returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (source.oracleType == OracleType.CHAINLINK) {
            try ChainlinkOracle(source.oracleAddress).getPriceData() returns (bool v, uint256 p, uint256 t, uint256 c) {
                return (v, p, t, c);
            } catch { return (false, 0, 0, 0); }
        } else if (source.oracleType == OracleType.PYTH) {
            try PythOracle(source.oracleAddress).getPriceData() returns (bool v, uint256 p, uint256 t, uint256 c) {
                return (v, p, t, c);
            } catch { return (false, 0, 0, 0); }
        } else if (source.oracleType == OracleType.TWAP) {
            try TWAPOracle(source.oracleAddress).getPriceData() returns (bool v, uint256 p, uint256 t, uint256 c) {
                return (v, p, t, c);
            } catch { return (false, 0, 0, 0); }
        } else if (source.oracleType == OracleType.CUSTOM) {
            // Custom oracle interface
            return (false, 0, 0, 0);
        }
        
        return (false, 0, 0, 0);
    }

    /**
     * @dev Aggregate prices from multiple sources
     */
    function _aggregatePrices(
        bytes32 feedId,
        uint256[] memory prices,
        uint256[] memory timestamps,
        uint256[] memory confidences,
        uint256 validCount
    ) internal view returns (AggregatedPrice memory) {
        require(validCount >= MIN_SOURCES, "OracleAggregator: insufficient valid prices");
        
        // Calculate median price
        uint256 medianPrice = _median(prices, validCount);
        
        // Calculate timestamp (median of timestamps)
        uint256 medianTimestamp = _median(timestamps, validCount);
        
        // Calculate confidence (average of confidences)
        uint256 avgConfidence = 0;
        for (uint256 i = 0; i < validCount; i++) {
            avgConfidence += confidences[i];
        }
        avgConfidence /= validCount;
        
        // Calculate min/max prices
        (uint256 minPrice, uint256 maxPrice) = _minMax(prices, validCount);
        
        // Check deviation
        uint256 deviation = (maxPrice - minPrice) * 10000 / minPrice;
        bool deviationOk = deviation <= _feedConfigs[feedId].maxDeviationBps;
        
        // Check staleness
        bool stale = block.timestamp - medianTimestamp > _feedConfigs[feedId].maxStaleness;
        
        // Determine status
        PriceStatus status = PriceStatus.ACTIVE;
        if (!deviationOk) {
            status = PriceStatus.DISPUTED;
        } else if (stale) {
            status = PriceStatus.INACTIVE;
        }
        
        // Price is already normalized by caller
        uint256 normalizedPrice = medianPrice;
        
        return AggregatedPrice({
            price: normalizedPrice,
            timestamp: medianTimestamp,
            confidence: avgConfidence,
            status: status,
            minPrice: minPrice,
            maxPrice: maxPrice
        });
    }

    /**
     * @dev Calculate median of an array
     */
    function _median(uint256[] memory array, uint256 length) 
        internal 
        pure 
        returns (uint256) 
    {
        // Sort first `length` elements
        uint256[] memory sorted = _sort(array, length);
        
        if (length % 2 == 0) {
            // Even number of elements: average of two middle elements
            uint256 mid1 = sorted[length / 2 - 1];
            uint256 mid2 = sorted[length / 2];
            return (mid1 + mid2) / 2;
        } else {
            // Odd number of elements: middle element
            return sorted[length / 2];
        }
    }

    /**
     * @dev Sort array using insertion sort (simple, small arrays expected)
     */
    function _sort(uint256[] memory array, uint256 length) 
        internal 
        pure 
        returns (uint256[] memory) 
    {
        uint256[] memory sorted = new uint256[](length);
        
        // Copy array
        for (uint256 i = 0; i < length; i++) {
            sorted[i] = array[i];
        }
        
        // Insertion sort
        for (uint256 i = 1; i < length; i++) {
            uint256 key = sorted[i];
            uint256 j = i;
            
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
        }
        
        return sorted;
    }

    /**
     * @dev Find min and max in array
     */
    function _minMax(uint256[] memory array, uint256 length)
        internal
        pure
        returns (uint256 min, uint256 max)
    {
        require(length > 0, "OracleAggregator: empty array");
        
        min = array[0];
        max = array[0];
        
        for (uint256 i = 1; i < length; i++) {
            if (array[i] < min) {
                min = array[i];
            }
            if (array[i] > max) {
                max = array[i];
            }
        }
    }

    /**
     * @dev Normalize price to target decimals
     */
    function _normalizeDecimals(
        uint256 price,
        uint256 sourceDecimals,
        uint256 targetDecimals
    ) internal pure returns (uint256) {
        if (sourceDecimals > targetDecimals) {
            return price / (10 ** (sourceDecimals - targetDecimals));
        } else if (sourceDecimals < targetDecimals) {
            return price * (10 ** (targetDecimals - sourceDecimals));
        } else {
            return price;
        }
    }

    /**
     * @dev Remove feed from registry
     */
    function _removeFeed(bytes32 feedId) internal {
        // Remove from feed IDs list
        for (uint256 i = 0; i < _allFeedIds.length; i++) {
            if (_allFeedIds[i] == feedId) {
                _allFeedIds[i] = _allFeedIds[_allFeedIds.length - 1];
                _allFeedIds.pop();
                break;
            }
        }
        
        // Clear storage
        delete _aggregatedPrices[feedId];
        delete _priceCache[feedId];
        delete _feedConfigs[feedId];
        delete _emergencyPrices[feedId];
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc IOracleAggregator
     */
    function getOracleSources(bytes32 feedId)
        external
        view
        override
        returns (OracleSource[] memory sources)
    {
        sources = _sources[feedId];
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function isPriceStale(bytes32 feedId) 
        external 
        view 
        override 
        returns (bool stale) 
    {
        AggregatedPrice storage aggPrice = _aggregatedPrices[feedId];
        if (aggPrice.status != PriceStatus.ACTIVE) {
            return true;
        }
        if (aggPrice.timestamp > block.timestamp || aggPrice.timestamp == 0) {
            return true; // Invalid timestamps are treated as stale
        }
        uint256 maxStaleness = _feedConfigs[feedId].maxStaleness;
        if (maxStaleness == 0) maxStaleness = MAX_CACHE_AGE;
        stale = block.timestamp - aggPrice.timestamp > maxStaleness;
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function getLastUpdate(bytes32 feedId)
        external
        view
        override
        returns (uint256 timestamp)
    {
        return _aggregatedPrices[feedId].timestamp;
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function getConfidence(bytes32 feedId)
        external
        view
        override
        returns (uint256 confidence)
    {
        return _aggregatedPrices[feedId].confidence;
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function isPriceWithinBounds(
        bytes32 feedId,
        uint256 minPrice,
        uint256 maxPrice
    ) external view override returns (bool withinBounds) {
        uint256 price = _aggregatedPrices[feedId].price;
        withinBounds = price >= minPrice && price <= maxPrice;
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Set security module address
     */
    function setSecurityModule(address securityModule) external onlyOwner {
        require(securityModule != address(0), "OracleAggregator: zero address");
        oracleSecurity = securityModule;
    }

    /**
     * @notice Set sanity checker address
     */
    function setSanityChecker(address sanityChecker_) external onlyOwner {
        require(sanityChecker_ != address(0), "OracleAggregator: zero address");
        sanityChecker = sanityChecker_;
    }

    /**
     * @notice Configure feed parameters
     */
    function configureFeed(
        bytes32 feedId,
        uint256 minSources,
        uint256 maxDeviationBps,
        uint256 maxStaleness,
        bool requireTWAP,
        uint256 twapWindow
    ) external onlyOwner feedExists(feedId) {
        require(minSources >= 1, "OracleAggregator: min sources < 1");
        require(maxDeviationBps <= 1000, "OracleAggregator: deviation too high"); // 10% max
        require(maxStaleness <= 1 hours, "OracleAggregator: staleness too high");
        
        _feedConfigs[feedId] = FeedConfig({
            minSources: minSources,
            maxDeviationBps: maxDeviationBps,
            maxStaleness: maxStaleness,
            requireTWAP: requireTWAP,
            twapWindow: twapWindow
        });
    }

    /**
     * @notice Emergency pause all price updates
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

    // ============ UTILITY FUNCTIONS ============

    /**
     * @notice Get all feed IDs
     */
    function getAllFeedIds() external view returns (bytes32[] memory) {
        return _allFeedIds;
    }

    /**
     * @notice Get feed configuration
     */
    function getFeedConfig(bytes32 feedId) external view returns (FeedConfig memory) {
        return _feedConfigs[feedId];
    }

    /**
     * @notice Get aggregated price data
     */
    function getAggregatedPrice(bytes32 feedId) external view returns (AggregatedPrice memory) {
        return _aggregatedPrices[feedId];
    }

    /**
     * @notice Get cached price
     */
    function getCachedPrice(bytes32 feedId) external view returns (PriceCache memory) {
        return _priceCache[feedId];
    }

    /**
     * @notice Get emergency price
     */
    function getEmergencyPrice(bytes32 feedId) external view returns (uint256) {
        return _emergencyPrices[feedId];
    }

    /**
     * @notice Get aggregated source data for audit
     */
    function getAggregatedSourceData(bytes32 feedId, uint256 timestamp) 
        external 
        view 
        returns (uint256[] memory prices, uint256[] memory timestamps, uint256[] memory confidences) 
    {
        return (
            _aggregatedPricesHistory[feedId][timestamp],
            _aggregatedTimestampsHistory[feedId][timestamp],
            _aggregatedConfidencesHistory[feedId][timestamp]
        );
    }

    /**
     * @inheritdoc IOracleAggregator
     */
    function updatePrice(
        bytes32 feedId,
        uint256 price,
        uint256 timestamp,
        uint256 confidence
    ) external override whenNotPaused {
        // Only security module can push prices directly
        require(msg.sender == oracleSecurity, "OracleAggregator: only security module");
        require(timestamp <= block.timestamp, "OracleAggregator: future timestamp");
        require(timestamp > 0, "OracleAggregator: zero timestamp");
        
        FeedConfig storage config = _feedConfigs[feedId];
        if (config.maxStaleness > 0) {
            require(block.timestamp - timestamp <= config.maxStaleness, "OracleAggregator: stale price");
        }

        _aggregatedPrices[feedId] = AggregatedPrice({
            price: price,
            timestamp: timestamp,
            confidence: confidence,
            status: PriceStatus.ACTIVE,
            minPrice: price,
            maxPrice: price
        });
        
        emit PriceUpdated(feedId, price, timestamp, confidence);
    }
}

struct FeedConfig {
    uint256 minSources;
    uint256 maxDeviationBps;
    uint256 maxStaleness;
    bool requireTWAP;
    uint256 twapWindow;
}
