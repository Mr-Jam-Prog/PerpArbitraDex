// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";

/**
 * @title LiquidationQueue
 * @notice MEV-resistant liquidation queue with randomization
 * @dev Implements FIFO with jitter to prevent front-running
 */
contract LiquidationQueue {
    using EnumerableSet for EnumerableSet.UintSet;

    // ============ STRUCTS ============
    struct QueueItem {
        ILiquidationEngine.LiquidationCandidate candidate;
        uint256 queueTime;
        uint256 randomSeed;
    }

    // ============ STATE VARIABLES ============
    EnumerableSet.UintSet private positionQueue;
    mapping(uint256 => QueueItem) private queueItems;
    
    uint256 public queueHead;
    uint256 public queueTail;
    uint256 public queueSize;
    uint256 public maxQueueSize = 1000;
    
    // Randomization parameters
    uint256 public minGracePeriod = 300; // 5 minutes
    uint256 public maxGracePeriod = 900; // 15 minutes
    uint256 public jitterRange = 60; // ±1 minute
    
    // ============ EVENTS ============
    event PositionEnqueued(
        uint256 indexed positionId,
        uint256 queueTime,
        uint256 estimatedReward
    );
    
    event PositionDequeued(
        uint256 indexed positionId,
        address indexed dequeuedBy,
        uint256 queueDuration
    );
    
    event QueueParametersUpdated(
        uint256 minGracePeriod,
        uint256 maxGracePeriod,
        uint256 jitterRange,
        uint256 maxQueueSize
    );

    // ============ MODIFIERS ============
    modifier onlyLiquidationEngine() {
        require(msg.sender == address(liquidationEngine), "Only LiquidationEngine");
        _;
    }
    
    // ============ IMMUTABLES ============
    address public immutable liquidationEngine;

    // ============ CONSTRUCTOR ============
    constructor(address _liquidationEngine) {
        require(_liquidationEngine != address(0), "Invalid LiquidationEngine");
        liquidationEngine = _liquidationEngine;
    }

    // ============ EXTERNAL FUNCTIONS ============

    /**
     * @notice Enqueue position for liquidation
     * @param candidate Liquidation candidate
     */
    function enqueue(ILiquidationEngine.LiquidationCandidate memory candidate) 
        external 
        onlyLiquidationEngine 
    {
        require(candidate.positionId > 0, "Invalid position");
        require(!isQueued(candidate.positionId), "Already queued");
        require(queueSize < maxQueueSize, "Queue full");
        
        // Generate random seed for this position
        uint256 randomSeed = _generateRandomSeed(candidate.positionId);
        
        // Calculate grace period with jitter
        uint256 gracePeriod = _calculateGracePeriod(randomSeed);
        uint256 queueTime = block.timestamp + gracePeriod;
        
        // Add to queue
        queueItems[candidate.positionId] = QueueItem({
            candidate: candidate,
            queueTime: queueTime,
            randomSeed: randomSeed
        });
        
        positionQueue.add(candidate.positionId);
        queueSize++;
        queueTail = candidate.positionId;
        
        emit PositionEnqueued(candidate.positionId, queueTime, candidate.estimatedReward);
    }

    /**
     * @notice Remove position from queue
     * @param positionId Position to remove
     */
    function remove(uint256 positionId) external onlyLiquidationEngine {
        require(isQueued(positionId), "Not in queue");
        
        _remove(positionId);
        emit PositionDequeued(positionId, msg.sender, block.timestamp - queueItems[positionId].queueTime);
    }

    /**
     * @notice Get next position from queue
     * @return hasNext Whether there is a next position
     * @return nextPositionId Next position ID
     */
    function getNext() external view returns (bool hasNext, uint256 nextPositionId) {
        if (positionQueue.length() == 0) {
            return (false, 0);
        }
        
        // Get all queued positions
        uint256[] memory allPositions = positionQueue.values();
        
        // Filter by grace period and sort by health factor
        ILiquidationEngine.LiquidationCandidate[] memory candidates = new ILiquidationEngine.LiquidationCandidate[](allPositions.length);
        uint256 validCount = 0;
        
        for (uint256 i = 0; i < allPositions.length; i++) {
            QueueItem storage item = queueItems[allPositions[i]];
            if (block.timestamp >= item.queueTime) {
                candidates[validCount] = item.candidate;
                validCount++;
            }
        }
        
        if (validCount == 0) {
            return (false, 0);
        }
        
        // Sort by health factor (most unhealthy first)
        _sortCandidates(candidates, validCount);
        
        return (true, candidates[0].positionId);
    }

    /**
     * @notice Get queue slice
     * @param cursor Start cursor
     * @param limit Maximum to return
     * @return candidates Array of candidates
     * @return newCursor New cursor position
     */
    function getQueue(uint256 cursor, uint256 limit) 
        external 
        view 
        returns (ILiquidationEngine.LiquidationCandidate[] memory candidates, uint256 newCursor) 
    {
        uint256[] memory allPositions = positionQueue.values();
        uint256 length = allPositions.length;
        
        if (cursor >= length) {
            return (new ILiquidationEngine.LiquidationCandidate[](0), cursor);
        }
        
        uint256 end = cursor + limit;
        if (end > length) {
            end = length;
        }
        
        candidates = new ILiquidationEngine.LiquidationCandidate[](end - cursor);
        
        for (uint256 i = cursor; i < end; i++) {
            candidates[i - cursor] = queueItems[allPositions[i]].candidate;
        }
        
        newCursor = end;
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if position is queued
     * @param positionId Position ID
     * @return queued True if queued
     */
    function isQueued(uint256 positionId) public view returns (bool) {
        return positionQueue.contains(positionId);
    }

    /**
     * @notice Get queue length
     * @return length Queue length
     */
    function getLength() external view returns (uint256) {
        return positionQueue.length();
    }

    /**
     * @notice Get queue time for position
     * @param positionId Position ID
     * @return queueTime Time when position becomes liquidatable
     */
    function getQueueTime(uint256 positionId) external view returns (uint256) {
        require(isQueued(positionId), "Not in queue");
        return queueItems[positionId].queueTime;
    }

    /**
     * @notice Get average queue time
     * @return avgTime Average queue time in seconds
     */
    function getAverageQueueTime() external view returns (uint256 avgTime) {
        uint256[] memory positions = positionQueue.values();
        if (positions.length == 0) return 0;
        
        uint256 totalTime = 0;
        uint256 count = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            QueueItem storage item = queueItems[positions[i]];
            if (item.queueTime > block.timestamp) {
                totalTime += item.queueTime - block.timestamp;
                count++;
            }
        }
        
        return count > 0 ? totalTime / count : 0;
    }

    /**
     * @notice Get queue statistics
     * @return totalPositions Total positions in queue
     * @return readyPositions Positions past grace period
     * @return avgHealthFactor Average health factor
     */
    function getQueueStats() external view returns (
        uint256 totalPositions,
        uint256 readyPositions,
        uint256 avgHealthFactor
    ) {
        uint256[] memory positions = positionQueue.values();
        totalPositions = positions.length;
        
        uint256 totalHealth = 0;
        readyPositions = 0;
        
        for (uint256 i = 0; i < positions.length; i++) {
            QueueItem storage item = queueItems[positions[i]];
            
            if (block.timestamp >= item.queueTime) {
                readyPositions++;
            }
            
            totalHealth += item.candidate.healthFactor;
        }
        
        avgHealthFactor = totalPositions > 0 ? totalHealth / totalPositions : 0;
        
        return (totalPositions, readyPositions, avgHealthFactor);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Remove position from queue
     */
    function _remove(uint256 positionId) internal {
        positionQueue.remove(positionId);
        delete queueItems[positionId];
        queueSize--;
        
        if (positionId == queueHead) {
            // Update head if needed
            if (positionQueue.length() > 0) {
                uint256[] memory positions = positionQueue.values();
                queueHead = positions[0];
            } else {
                queueHead = 0;
            }
        }
    }

    /**
     * @dev Generate random seed for position
     */
    function _generateRandomSeed(uint256 positionId) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1),
            positionId,
            block.timestamp,
            msg.sender
        )));
    }

    /**
     * @dev Calculate grace period with jitter
     */
    function _calculateGracePeriod(uint256 randomSeed) internal view returns (uint256) {
        // Base grace period
        uint256 basePeriod = (minGracePeriod + maxGracePeriod) / 2;
        
        // Add jitter (± jitterRange)
        uint256 jitterMod = 2 * jitterRange + 1;
        uint256 gracePeriod = basePeriod + (randomSeed % jitterMod) - jitterRange;
        
        // Ensure within bounds
        if (gracePeriod < minGracePeriod) gracePeriod = minGracePeriod;
        if (gracePeriod > maxGracePeriod) gracePeriod = maxGracePeriod;
        
        return gracePeriod;
    }

    /**
     * @dev Sort candidates by health factor
     */
    function _sortCandidates(
        ILiquidationEngine.LiquidationCandidate[] memory candidates,
        uint256 length
    ) internal pure {
        // Simple bubble sort for small arrays
        for (uint256 i = 0; i < length - 1; i++) {
            for (uint256 j = 0; j < length - i - 1; j++) {
                if (candidates[j].healthFactor > candidates[j + 1].healthFactor) {
                    // Swap
                    ILiquidationEngine.LiquidationCandidate memory temp = candidates[j];
                    candidates[j] = candidates[j + 1];
                    candidates[j + 1] = temp;
                }
            }
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Update queue parameters
     * @param _minGracePeriod New minimum grace period
     * @param _maxGracePeriod New maximum grace period
     * @param _jitterRange New jitter range
     * @param _maxQueueSize New maximum queue size
     */
    function updateQueueParameters(
        uint256 _minGracePeriod,
        uint256 _maxGracePeriod,
        uint256 _jitterRange,
        uint256 _maxQueueSize
    ) external onlyLiquidationEngine {
        require(_minGracePeriod > 0, "Invalid min grace period");
        require(_maxGracePeriod >= _minGracePeriod, "Invalid grace period range");
        require(_jitterRange <= _minGracePeriod / 2, "Jitter too large");
        require(_maxQueueSize > 0, "Invalid max queue size");
        
        minGracePeriod = _minGracePeriod;
        maxGracePeriod = _maxGracePeriod;
        jitterRange = _jitterRange;
        maxQueueSize = _maxQueueSize;
        
        emit QueueParametersUpdated(_minGracePeriod, _maxGracePeriod, _jitterRange, _maxQueueSize);
    }

    /**
     * @notice Emergency clear queue
     * @dev Only in case of emergency
     */
    function emergencyClearQueue() external onlyLiquidationEngine {
        uint256[] memory positions = positionQueue.values();
        
        for (uint256 i = 0; i < positions.length; i++) {
            _remove(positions[i]);
        }
        
        queueSize = 0;
        queueHead = 0;
        queueTail = 0;
    }

    /**
     * @notice Remove expired positions from queue
     * @param maxRemove Maximum positions to remove
     * @return removed Count of positions removed
     */
    function removeExpired(uint256 maxRemove) external onlyLiquidationEngine returns (uint256 removed) {
        uint256[] memory positions = positionQueue.values();
        
        for (uint256 i = 0; i < positions.length && removed < maxRemove; i++) {
            QueueItem storage item = queueItems[positions[i]];
            
            // Remove if grace period passed plus 24 hours
            if (block.timestamp > item.queueTime + 24 hours) {
                _remove(positions[i]);
                removed++;
            }
        }
        
        return removed;
    }
}