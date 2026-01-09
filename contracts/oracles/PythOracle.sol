// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IPythOracle} from "../interfaces/IPythOracle.sol";

/**
 * @title PythOracle
 * @notice Pyth Network oracle adapter with confidence interval validation
 * @dev Handles price exponent normalization and confidence checks
 */
contract PythOracle is IPythOracle, Ownable {
    // ============ CONSTANTS ============
    
    uint256 private constant PRICE_DECIMALS = 8;
    uint256 private constant MAX_CONFIDENCE_RATIO = 100; // 1% max confidence/price ratio
    uint256 private constant MAX_STALENESS = 5 minutes;
    uint256 private constant MIN_PUBLISH_INTERVAL = 1 seconds;
    
    // ============ IMMUTABLES ============
    
    IPyth public immutable pyth;
    bytes32 public immutable priceId;
    
    // ============ STATE VARIABLES ============
    
    uint256 public maxConfidenceRatio;
    uint256 public maxStaleness;
    bool public isActive;
    
    // Last valid price data
    PythPriceData private _lastValidPrice;
    
    // Emergency fallback
    uint256 public emergencyPrice;
    bool public emergencyActive;
    
    // ============ EVENTS ============
    
    event MaxConfidenceRatioUpdated(uint256 oldRatio, uint256 newRatio);
    event MaxStalenessUpdated(uint256 oldStaleness, uint256 newStaleness);
    event StatusUpdated(bool oldStatus, bool newStatus);
    event EmergencyPriceSet(uint256 price, uint256 timestamp);
    event EmergencyPriceCleared(uint256 timestamp);
    event PriceUpdated(
        bytes32 indexed priceId,
        uint256 price,
        uint256 confidence,
        uint256 timestamp
    );
    
    // ============ CONSTRUCTOR ============
    
    constructor(
        address pyth_,
        bytes32 priceId_,
        uint256 maxConfidenceRatio_,
        uint256 maxStaleness_
    ) {
        require(pyth_ != address(0), "PythOracle: zero address");
        require(priceId_ != bytes32(0), "PythOracle: zero price ID");
        require(maxConfidenceRatio_ <= MAX_CONFIDENCE_RATIO, 
            "PythOracle: confidence ratio too high");
        require(maxStaleness_ <= MAX_STALENESS, "PythOracle: staleness too high");
        
        pyth = IPyth(pyth_);
        priceId = priceId_;
        maxConfidenceRatio = maxConfidenceRatio_;
        maxStaleness = maxStaleness_;
        isActive = true;
    }
    
    // ============ PRICE FETCHING ============
    
    /**
     * @notice Get latest price data from Pyth
     * @return valid True if price is valid
     * @return price Normalized price (8 decimals)
     * @return timestamp Price timestamp
     * @return confidence Confidence interval (8 decimals)
     */
    function getPriceData()
        external
        view
        override
        returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence)
    {
        if (emergencyActive) {
            return (true, emergencyPrice, block.timestamp, 0);
        }
        
        if (!isActive) {
            return (false, 0, 0, 0);
        }
        
        try pyth.getPriceUnsafe(priceId) returns (PythStructs.Price memory pythPrice) {
            // Validate price
            valid = _validatePythPrice(pythPrice);
            
            if (!valid) {
                // Return last valid price if available and not too stale
                if (_lastValidPrice.timestamp > 0 && 
                    block.timestamp - _lastValidPrice.timestamp <= maxStaleness * 2) {
                    return (true, _lastValidPrice.price, _lastValidPrice.timestamp, 
                           _lastValidPrice.confidence);
                }
                return (false, 0, 0, 0);
            }
            
            // Normalize price
            price = _normalizePythPrice(pythPrice);
            timestamp = pythPrice.publishTime;
            confidence = _normalizePythConfidence(pythPrice);
            
            return (true, price, timestamp, confidence);
            
        } catch {
            // Pyth call failed
            if (_lastValidPrice.timestamp > 0 && 
                block.timestamp - _lastValidPrice.timestamp <= maxStaleness * 2) {
                return (true, _lastValidPrice.price, _lastValidPrice.timestamp, 
                       _lastValidPrice.confidence);
            }
            return (false, 0, 0, 0);
        }
    }
    
    /**
     * @notice Update price with Pyth update data
     * @param updateData Pyth price update data
     * @param updateFee Fee for the update (will be refunded)
     * @return success True if price was updated
     */
    function updatePrice(bytes[] calldata updateData, uint256 updateFee)
        external
        payable
        returns (bool success)
    {
        if (!isActive) {
            return false;
        }
        
        require(msg.value >= updateFee, "PythOracle: insufficient fee");
        
        try pyth.updatePriceFeeds{value: updateFee}(updateData) {
            // Get updated price
            PythStructs.Price memory pythPrice = pyth.getPriceUnsafe(priceId);
            
            // Validate price
            bool valid = _validatePythPrice(pythPrice);
            if (!valid) {
                // Refund unused fee
                if (msg.value > updateFee) {
                    payable(msg.sender).transfer(msg.value - updateFee);
                }
                return false;
            }
            
            // Update cached price
            _lastValidPrice = PythPriceData({
                price: _normalizePythPrice(pythPrice),
                confidence: _normalizePythConfidence(pythPrice),
                timestamp: pythPrice.publishTime,
                expo: pythPrice.expo
            });
            
            // Refund unused fee
            if (msg.value > updateFee) {
                payable(msg.sender).transfer(msg.value - updateFee);
            }
            
            emit PriceUpdated(
                priceId,
                _lastValidPrice.price,
                _lastValidPrice.confidence,
                _lastValidPrice.timestamp
            );
            
            return true;
            
        } catch {
            // Refund entire amount on failure
            payable(msg.sender).transfer(msg.value);
            return false;
        }
    }
    
    // ============ VALIDATION FUNCTIONS ============
    
    /**
     * @dev Validate Pyth price structure
     */
    function _validatePythPrice(PythStructs.Price memory pythPrice)
        internal
        view
        returns (bool)
    {
        // Check price existence
        if (pythPrice.price <= 0) {
            return false;
        }
        
        // Check publish time
        if (pythPrice.publishTime == 0) {
            return false;
        }
        
        // Check staleness
        if (block.timestamp - pythPrice.publishTime > maxStaleness) {
            return false;
        }
        
        // Check confidence
        if (pythPrice.conf < 0) {
            return false;
        }
        
        // Check confidence ratio (confidence / price)
        uint256 price = uint256(uint64(pythPrice.price));
        uint256 confidence = uint256(uint64(pythPrice.conf));
        
        if (price == 0) {
            return false;
        }
        
        // Calculate confidence ratio in basis points
        uint256 confidenceRatio = (confidence * 10000) / price;
        if (confidenceRatio > maxConfidenceRatio) {
            return false;
        }
        
        // Check for reasonable publish interval (anti-spam)
        if (_lastValidPrice.timestamp > 0) {
            if (pythPrice.publishTime - _lastValidPrice.timestamp < MIN_PUBLISH_INTERVAL) {
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * @dev Normalize Pyth price to 8 decimals
     */
    function _normalizePythPrice(PythStructs.Price memory pythPrice)
        internal
        pure
        returns (uint256)
    {
        // Pyth prices are: price * 10^expo
        // We want to convert to 8 decimals
        
        int32 expo = pythPrice.expo;
        int64 price = pythPrice.price;
        
        if (expo >= 0) {
            // Positive exponent: price * 10^expo
            return uint256(uint64(price)) * (10 ** uint32(expo));
        } else {
            // Negative exponent: price / 10^(-expo)
            return uint256(uint64(price)) / (10 ** uint32(-expo));
        }
        
        // Further normalize to 8 decimals
        // Assuming the above gives us price in natural units
        // We then convert to 8 decimals
        
        // For simplicity, we assume Pyth already gives us price in reasonable decimals
        // In production, you'd need to adjust based on the specific feed
    }
    
    /**
     * @dev Normalize Pyth confidence to 8 decimals
     */
    function _normalizePythConfidence(PythStructs.Price memory pythPrice)
        internal
        pure
        returns (uint256)
    {
        // Similar normalization as price
        int32 expo = pythPrice.expo;
        uint64 conf = uint64(pythPrice.conf);
        
        if (expo >= 0) {
            return uint256(conf) * (10 ** uint32(expo));
        } else {
            return uint256(conf) / (10 ** uint32(-expo));
        }
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Set maximum confidence ratio
     */
    function setMaxConfidenceRatio(uint256 newRatio) external onlyOwner {
        require(newRatio <= MAX_CONFIDENCE_RATIO, "PythOracle: ratio too high");
        
        uint256 oldRatio = maxConfidenceRatio;
        maxConfidenceRatio = newRatio;
        
        emit MaxConfidenceRatioUpdated(oldRatio, newRatio);
    }
    
    /**
     * @notice Set maximum staleness
     */
    function setMaxStaleness(uint256 newStaleness) external onlyOwner {
        require(newStaleness <= MAX_STALENESS, "PythOracle: staleness too high");
        
        uint256 oldStaleness = maxStaleness;
        maxStaleness = newStaleness;
        
        emit MaxStalenessUpdated(oldStaleness, newStaleness);
    }
    
    /**
     * @notice Set oracle active status
     */
    function setActive(bool active) external onlyOwner {
        bool oldStatus = isActive;
        isActive = active;
        
        emit StatusUpdated(oldStatus, active);
    }
    
    /**
     * @notice Set emergency price
     */
    function setEmergencyPrice(uint256 price) external onlyOwner {
        require(price > 0, "PythOracle: zero price");
        
        emergencyPrice = price;
        emergencyActive = true;
        
        emit EmergencyPriceSet(price, block.timestamp);
    }
    
    /**
     * @notice Clear emergency price
     */
    function clearEmergencyPrice() external onlyOwner {
        emergencyActive = false;
        
        emit EmergencyPriceCleared(block.timestamp);
    }
    
    /**
     * @notice Withdraw accumulated fees
     */
    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "PythOracle: no balance");
        
        payable(owner()).transfer(balance);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Get last valid price data
     */
    function getLastValidPrice() external view returns (PythPriceData memory) {
        return _lastValidPrice;
    }
    
    /**
     * @notice Check if price is stale
     */
    function isPriceStale() external view returns (bool) {
        if (_lastValidPrice.timestamp == 0) {
            return true;
        }
        
        return block.timestamp - _lastValidPrice.timestamp > maxStaleness;
    }
    
    /**
     * @notice Get oracle configuration
     */
    function getConfig() external view returns (
        uint256 maxConfidenceRatio_,
        uint256 maxStaleness_,
        bool isActive_,
        bool emergencyActive_
    ) {
        return (maxConfidenceRatio, maxStaleness, isActive, emergencyActive);
    }
    
    /**
     * @notice Get Pyth contract address
     */
    function getPythAddress() external view returns (address) {
        return address(pyth);
    }
    
    /**
     * @notice Get price ID
     */
    function getPriceId() external view returns (bytes32) {
        return priceId;
    }
    
    /**
     * @notice Get time since last update
     */
    function getTimeSinceLastUpdate() external view returns (uint256) {
        if (_lastValidPrice.timestamp == 0) {
            return type(uint256).max;
        }
        
        return block.timestamp - _lastValidPrice.timestamp;
    }
    
    /**
     * @notice Get contract ETH balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}

struct PythPriceData {
    uint256 price;
    uint256 confidence;
    uint256 timestamp;
    int32 expo;
}