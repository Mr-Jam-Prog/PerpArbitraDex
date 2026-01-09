// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title L2GasOptimized
 * @notice Gas optimization helpers specific to L2 rollups
 * @dev Optimized for Arbitrum, Base, Optimism with different gas characteristics
 */
library L2GasOptimized {
    // ============ CONSTANTS ============
    
    // L2-specific gas parameters (adjust per network)
    uint256 internal constant L2_TX_DATA_ZERO_BYTE = 4; // Gas per zero byte in calldata
    uint256 internal constant L2_TX_DATA_NON_ZERO_BYTE = 16; // Gas per non-zero byte
    uint256 internal constant L2_CALL_STIPEND = 2300; // Gas stipend for calls
    uint256 internal constant L2_SLOAD_GAS = 2100; // Adjusted for L2
    uint256 internal constant L2_SSTORE_GAS = 20000; // Adjusted for L2
    
    // ============ CALDATA OPTIMIZATION ============

    /**
     * @notice Pack multiple addresses into minimal calldata
     * @param addresses Array of addresses
     * @return packed Packed addresses (tightly packed)
     */
    function packAddresses(address[] memory addresses)
        internal
        pure
        returns (bytes memory packed)
    {
        assembly {
            let length := mload(addresses)
            packed := mload(0x40)
            mstore(packed, length)
            
            let offset := add(packed, 32)
            for { let i := 0 } lt(i, length) { i := add(i, 1) } {
                mstore(offset, mload(add(add(addresses, 32), mul(i, 32))))
                offset := add(offset, 20) // Addresses are 20 bytes
            }
            
            // Update free memory pointer
            mstore(0x40, offset)
        }
    }

    /**
     * @notice Unpack addresses from tightly packed calldata
     * @param packed Packed addresses
     * @return addresses Array of addresses
     */
    function unpackAddresses(bytes memory packed)
        internal
        pure
        returns (address[] memory addresses)
    {
        assembly {
            let length := mload(packed)
            addresses := mload(0x40)
            mstore(addresses, length)
            
            let offset := add(packed, 32)
            let dest := add(addresses, 32)
            for { let i := 0 } lt(i, length) { i := add(i, 1) } {
                mstore(dest, mload(offset))
                dest := add(dest, 32)
                offset := add(offset, 20)
            }
            
            // Update free memory pointer
            mstore(0x40, dest)
        }
    }

    /**
     * @notice Efficient batch call with minimal calldata overhead
     * @param targets Array of target addresses
     * @param data Array of call data
     * @param values Array of ETH values
     * @return results Array of call results
     */
    function batchCall(
        address[] memory targets,
        bytes[] memory data,
        uint256[] memory values
    ) internal returns (bytes[] memory results) {
        uint256 length = targets.length;
        require(
            data.length == length && values.length == length,
            "L2GasOptimized: array length mismatch"
        );
        
        results = new bytes[](length);
        
        for (uint256 i = 0; i < length; i++) {
            (bool success, bytes memory result) = targets[i].call{
                value: values[i],
                gas: gasleft() > L2_CALL_STIPEND ? gasleft() - L2_CALL_STIPEND : gasleft()
            }(data[i]);
            
            require(success, "L2GasOptimized: call failed");
            results[i] = result;
        }
    }

    // ============ STORAGE OPTIMIZATION ============

    /**
     * @notice Store multiple values in a single storage slot (bit packing)
     * @param slot Storage slot
     * @param values Array of values to pack
     * @param bitsPerValue Bits allocated per value
     */
    function storePacked(
        uint256 slot,
        uint256[] memory values,
        uint256 bitsPerValue
    ) internal {
        uint256 packed;
        uint256 mask = (1 << bitsPerValue) - 1;
        
        for (uint256 i = 0; i < values.length; i++) {
            require(values[i] <= mask, "L2GasOptimized: value overflow");
            packed |= (values[i] << (i * bitsPerValue));
        }
        
        assembly {
            sstore(slot, packed)
        }
    }

    /**
     * @notice Load packed values from storage
     * @param slot Storage slot
     * @param count Number of values to load
     * @param bitsPerValue Bits per value
     * @return values Array of unpacked values
     */
    function loadPacked(
        uint256 slot,
        uint256 count,
        uint256 bitsPerValue
    ) internal view returns (uint256[] memory values) {
        values = new uint256[](count);
        uint256 mask = (1 << bitsPerValue) - 1;
        uint256 packed;
        
        assembly {
            packed := sload(slot)
        }
        
        for (uint256 i = 0; i < count; i++) {
            values[i] = (packed >> (i * bitsPerValue)) & mask;
        }
    }

    // ============ LOOP OPTIMIZATION ============

    /**
     * @notice Unchecked loop for gas optimization (use with caution)
     * @param array Array to iterate over
     * @param callback Function to call for each element
     */
    function uncheckedForEach(
        uint256[] memory array,
        function(uint256) internal callback
    ) internal {
        uint256 length = array.length;
        
        for (uint256 i = 0; i < length; ) {
            callback(array[i]);
            unchecked {
                i++;
            }
        }
    }

    /**
     * @notice Batch process with gas limit protection
     * @param array Array to process
     * @param callback Processing function
     * @param gasPerItem Estimated gas per item
     * @return processed Number of items processed
     */
    function batchProcessWithGasLimit(
        uint256[] memory array,
        function(uint256) internal callback,
        uint256 gasPerItem
    ) internal returns (uint256 processed) {
        uint256 startGas = gasleft();
        uint256 length = array.length;
        
        for (uint256 i = 0; i < length; i++) {
            // Check if we have enough gas for next item + buffer
            if (gasleft() < gasPerItem * 2) {
                break;
            }
            
            callback(array[i]);
            processed++;
        }
    }

    // ============ MEMORY OPTIMIZATION ============

    /**
     * @notice Allocate memory in chunks to reduce allocations
     * @param size Total size needed
     * @param chunkSize Chunk size for allocation
     * @return ptr Pointer to allocated memory
     */
    function allocateChunked(uint256 size, uint256 chunkSize)
        internal
        pure
        returns (uint256 ptr)
    {
        assembly {
            ptr := mload(0x40)
            let end := add(ptr, size)
            let chunkEnd := add(ptr, chunkSize)
            
            // Allocate in chunks
            for { } lt(ptr, end) { } {
                mstore(0x40, chunkEnd)
                ptr := chunkEnd
                chunkEnd := add(chunkEnd, chunkSize)
            }
            
            // Final allocation
            mstore(0x40, end)
        }
    }

    /**
     * @notice Copy memory with minimal gas usage
     * @param src Source pointer
     * @param dest Destination pointer
     * @param length Length in bytes
     */
    function memcpy(
        uint256 src,
        uint256 dest,
        uint256 length
    ) internal pure {
        assembly {
            // Copy word-length chunks
            for {
                let end := add(src, length)
            } lt(src, end) {
                src := add(src, 32)
                dest := add(dest, 32)
            } {
                mstore(dest, mload(src))
            }
            
            // Handle remaining bytes
            let mask := sub(exp(256, sub(32, mod(length, 32))), 1)
            mstore(dest, or(and(mload(dest), not(mask)), and(mload(src), mask)))
        }
    }

    // ============ GAS ESTIMATION ============

    /**
     * @notice Estimate gas cost for a transaction
     * @param dataLength Length of calldata in bytes
     * @param storageReads Number of storage reads
     * @param storageWrites Number of storage writes
     * @return estimatedGas Estimated gas cost
     */
    function estimateGasCost(
        uint256 dataLength,
        uint256 storageReads,
        uint256 storageWrites
    ) internal pure returns (uint256 estimatedGas) {
        // Base transaction cost
        estimatedGas = 21000;
        
        // Calldata cost
        estimatedGas += dataLength * L2_TX_DATA_NON_ZERO_BYTE;
        
        // Storage operations
        estimatedGas += storageReads * L2_SLOAD_GAS;
        estimatedGas += storageWrites * L2_SSTORE_GAS;
        
        // Execution buffer (20%)
        estimatedGas += estimatedGas / 5;
    }

    /**
     * @notice Check if gas is sufficient for operation
     * @param requiredGas Gas required for operation
     * @param safetyMargin Safety margin percentage (1e18 = 100%)
     * @return sufficient True if gas is sufficient
     */
    function isGasSufficient(uint256 requiredGas, uint256 safetyMargin)
        internal
        view
        returns (bool sufficient)
    {
        uint256 available = gasleft();
        uint256 threshold = requiredGas + (requiredGas * safetyMargin) / 1e18;
        sufficient = available > threshold;
    }

    // ============ COMPRESSION ============

    /**
     * @notice Simple delta encoding for sequential numbers
     * @param numbers Array of sequential numbers
     * @return encoded Encoded as [first, delta1, delta2, ...]
     */
    function deltaEncode(uint256[] memory numbers)
        internal
        pure
        returns (uint256[] memory encoded)
    {
        if (numbers.length == 0) {
            return new uint256[](0);
        }
        
        encoded = new uint256[](numbers.length);
        encoded[0] = numbers[0];
        
        for (uint256 i = 1; i < numbers.length; i++) {
            encoded[i] = numbers[i] - numbers[i - 1];
        }
    }

    /**
     * @notice Decode delta-encoded numbers
     * @param encoded Delta-encoded array
     * @return numbers Decoded numbers
     */
    function deltaDecode(uint256[] memory encoded)
        internal
        pure
        returns (uint256[] memory numbers)
    {
        if (encoded.length == 0) {
            return new uint256[](0);
        }
        
        numbers = new uint256[](encoded.length);
        numbers[0] = encoded[0];
        
        for (uint256 i = 1; i < encoded.length; i++) {
            numbers[i] = numbers[i - 1] + encoded[i];
        }
    }

    // ============ FALLBACK FOR L1 ============

    /**
     * @notice Check if running on L1 or L2
     * @return isL2 True if likely running on L2
     */
    function isLikelyL2() internal view returns (bool isL2) {
        // Heuristic: L2s typically have different gas prices and block properties
        uint256 gasPrice = tx.gasprice;
        uint256 blockNumber = block.number;
        
        // Arbitrum: gas price is in gwei per L2 gas, not wei
        // Optimism: similar
        // Base: similar
        
        // If gas price is unusually low or high for L1, assume L2
        isL2 = (gasPrice < 1e9 || gasPrice > 1e12); // Outside typical L1 range
    }

    /**
     * @notice Get appropriate gas stipend for current network
     * @return stipend Recommended gas stipend
     */
    function getNetworkStipend() internal view returns (uint256 stipend) {
        if (isLikelyL2()) {
            return L2_CALL_STIPEND;
        } else {
            return 2300; // Standard L1 stipend
        }
    }
}