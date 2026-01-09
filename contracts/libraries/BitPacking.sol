// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title BitPacking
 * @notice Efficient bit packing and unpacking for storage optimization
 * @dev Provides functions for packing multiple values into single storage slots
 */
library BitPacking {
    // ============ BIT MASKS ============
    
    uint256 internal constant MASK_8BIT = 0xFF;
    uint256 internal constant MASK_16BIT = 0xFFFF;
    uint256 internal constant MASK_32BIT = 0xFFFFFFFF;
    uint256 internal constant MASK_64BIT = 0xFFFFFFFFFFFFFFFF;
    uint256 internal constant MASK_128BIT = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;
    
    // ============ POSITION PACKING SCHEMA ============
    // Position data packed into 256 bits (uint256):
    // Bits 0-63: size (64 bits)
    // Bits 64-127: margin (64 bits)
    // Bits 128-191: entryPrice (64 bits)
    // Bits 192-223: lastFundingAccrued (32 bits) - timestamp
    // Bits 224-247: leverage (24 bits) - up to 16.7 million x
    // Bit 248: isLong (1 bit)
    // Bits 249-255: flags (7 bits) - reserved for future use
    
    uint256 internal constant SIZE_OFFSET = 0;
    uint256 internal constant SIZE_BITS = 64;
    uint256 internal constant SIZE_MASK = MASK_64BIT;
    
    uint256 internal constant MARGIN_OFFSET = 64;
    uint256 internal constant MARGIN_BITS = 64;
    uint256 internal constant MARGIN_MASK = MASK_64BIT << MARGIN_OFFSET;
    
    uint256 internal constant ENTRY_PRICE_OFFSET = 128;
    uint256 internal constant ENTRY_PRICE_BITS = 64;
    uint256 internal constant ENTRY_PRICE_MASK = MASK_64BIT << ENTRY_PRICE_OFFSET;
    
    uint256 internal constant LAST_FUNDING_OFFSET = 192;
    uint256 internal constant LAST_FUNDING_BITS = 32;
    uint256 internal constant LAST_FUNDING_MASK = MASK_32BIT << LAST_FUNDING_OFFSET;
    
    uint256 internal constant LEVERAGE_OFFSET = 224;
    uint256 internal constant LEVERAGE_BITS = 24;
    uint256 internal constant LEVERAGE_MASK = (MASK_32BIT >> 8) << LEVERAGE_OFFSET;
    
    uint256 internal constant IS_LONG_OFFSET = 248;
    uint256 internal constant IS_LONG_MASK = 1 << IS_LONG_OFFSET;
    
    uint256 internal constant FLAGS_OFFSET = 249;
    uint256 internal constant FLAGS_BITS = 7;
    uint256 internal constant FLAGS_MASK = (MASK_8BIT >> 1) << FLAGS_OFFSET;

    // ============ POSITION PACKING ============

    /**
     * @notice Pack position data into a single uint256
     * @param size Position size (max 2^64-1)
     * @param margin Position margin (max 2^64-1)
     * @param entryPrice Entry price (max 2^64-1)
     * @param lastFundingAccrued Last funding timestamp (max 2^32-1)
     * @param leverage Leverage (max 2^24-1 = ~16.7 million)
     * @param isLong True for long position
     * @param flags Additional flags (7 bits)
     * @return packed Packed position data
     */
    function packPosition(
        uint256 size,
        uint256 margin,
        uint256 entryPrice,
        uint32 lastFundingAccrued,
        uint24 leverage,
        bool isLong,
        uint8 flags
    ) internal pure returns (uint256 packed) {
        // Validate input ranges
        require(size <= SIZE_MASK, "BitPacking: size overflow");
        require(margin <= SIZE_MASK, "BitPacking: margin overflow");
        require(entryPrice <= SIZE_MASK, "BitPacking: entryPrice overflow");
        require(leverage <= (1 << LEVERAGE_BITS) - 1, "BitPacking: leverage overflow");
        require(flags <= (1 << FLAGS_BITS) - 1, "BitPacking: flags overflow");
        
        packed = size;
        packed |= (margin << MARGIN_OFFSET);
        packed |= (entryPrice << ENTRY_PRICE_OFFSET);
        packed |= (uint256(lastFundingAccrued) << LAST_FUNDING_OFFSET);
        packed |= (uint256(leverage) << LEVERAGE_OFFSET);
        
        if (isLong) {
            packed |= IS_LONG_MASK;
        }
        
        packed |= (uint256(flags) << FLAGS_OFFSET);
    }

    /**
     * @notice Unpack position data from a packed uint256
     * @param packed Packed position data
     * @return size Position size
     * @return margin Position margin
     * @return entryPrice Entry price
     * @return lastFundingAccrued Last funding timestamp
     * @return leverage Leverage
     * @return isLong True for long position
     * @return flags Additional flags
     */
    function unpackPosition(uint256 packed)
        internal
        pure
        returns (
            uint256 size,
            uint256 margin,
            uint256 entryPrice,
            uint32 lastFundingAccrued,
            uint24 leverage,
            bool isLong,
            uint8 flags
        )
    {
        size = packed & SIZE_MASK;
        margin = (packed & MARGIN_MASK) >> MARGIN_OFFSET;
        entryPrice = (packed & ENTRY_PRICE_MASK) >> ENTRY_PRICE_OFFSET;
        lastFundingAccrued = uint32((packed & LAST_FUNDING_MASK) >> LAST_FUNDING_OFFSET);
        leverage = uint24((packed & LEVERAGE_MASK) >> LEVERAGE_OFFSET);
        isLong = (packed & IS_LONG_MASK) != 0;
        flags = uint8((packed & FLAGS_MASK) >> FLAGS_OFFSET);
    }

    // ============ GENERIC BIT OPERATIONS ============

    /**
     * @notice Extract bits from a packed value
     * @param packed Packed value
     * @param offset Bit offset (0 = LSB)
     * @param bits Number of bits to extract
     * @return extracted Extracted bits
     */
    function extractBits(
        uint256 packed,
        uint256 offset,
        uint256 bits
    ) internal pure returns (uint256 extracted) {
        require(bits <= 256, "BitPacking: too many bits");
        require(offset + bits <= 256, "BitPacking: offset overflow");
        
        uint256 mask = (1 << bits) - 1;
        extracted = (packed >> offset) & mask;
    }

    /**
     * @notice Set bits in a packed value
     * @param packed Original packed value
     * @param value Value to set
     * @param offset Bit offset
     * @param bits Number of bits to set
     * @return newPacked Updated packed value
     */
    function setBits(
        uint256 packed,
        uint256 value,
        uint256 offset,
        uint256 bits
    ) internal pure returns (uint256 newPacked) {
        require(bits <= 256, "BitPacking: too many bits");
        require(offset + bits <= 256, "BitPacking: offset overflow");
        require(value < (1 << bits), "BitPacking: value overflow");
        
        uint256 mask = (1 << bits) - 1;
        // Clear target bits
        newPacked = packed & ~(mask << offset);
        // Set new bits
        newPacked |= (value & mask) << offset;
    }

    /**
     * @notice Check if a specific bit is set
     * @param packed Packed value
     * @param bit Bit position (0 = LSB)
     * @return isSet True if bit is set
     */
    function isBitSet(uint256 packed, uint256 bit)
        internal
        pure
        returns (bool isSet)
    {
        require(bit < 256, "BitPacking: bit out of range");
        return (packed >> bit) & 1 == 1;
    }

    /**
     * @notice Set a specific bit
     * @param packed Original packed value
     * @param bit Bit position
     * @param value Bit value (true = 1, false = 0)
     * @return newPacked Updated packed value
     */
    function setBit(
        uint256 packed,
        uint256 bit,
        bool value
    ) internal pure returns (uint256 newPacked) {
        require(bit < 256, "BitPacking: bit out of range");
        
        if (value) {
            newPacked = packed | (1 << bit);
        } else {
            newPacked = packed & ~(1 << bit);
        }
    }

    // ============ BOOLEAN PACKING ============

    /**
     * @notice Pack up to 256 booleans into a single uint256
     * @param bools Array of booleans
     * @return packed Packed booleans
     */
    function packBools(bool[] memory bools)
        internal
        pure
        returns (uint256 packed)
    {
        require(bools.length <= 256, "BitPacking: too many booleans");
        
        for (uint256 i = 0; i < bools.length; i++) {
            if (bools[i]) {
                packed |= (1 << i);
            }
        }
    }

    /**
     * @notice Unpack booleans from a packed uint256
     * @param packed Packed booleans
     * @param count Number of booleans to unpack
     * @return bools Array of booleans
     */
    function unpackBools(uint256 packed, uint256 count)
        internal
        pure
        returns (bool[] memory bools)
    {
        require(count <= 256, "BitPacking: too many booleans");
        
        bools = new bool[](count);
        for (uint256 i = 0; i < count; i++) {
            bools[i] = (packed >> i) & 1 == 1;
        }
    }

    // ============ MULTI-VALUE PACKING ============

    /**
     * @notice Pack multiple uint64 values
     * @param values Array of uint64 values
     * @return packed Packed values
     */
    function packUint64Array(uint64[] memory values)
        internal
        pure
        returns (uint256 packed)
    {
        require(values.length <= 4, "BitPacking: too many uint64 values");
        
        for (uint256 i = 0; i < values.length; i++) {
            packed |= uint256(values[i]) << (i * 64);
        }
    }

    /**
     * @notice Unpack multiple uint64 values
     * @param packed Packed values
     * @param count Number of values to unpack
     * @return values Array of uint64 values
     */
    function unpackUint64Array(uint256 packed, uint256 count)
        internal
        pure
        returns (uint64[] memory values)
    {
        require(count <= 4, "BitPacking: too many uint64 values");
        
        values = new uint64[](count);
        for (uint256 i = 0; i < count; i++) {
            values[i] = uint64(packed >> (i * 64));
        }
    }

    /**
     * @notice Pack multiple uint32 values
     * @param values Array of uint32 values
     * @return packed Packed values
     */
    function packUint32Array(uint32[] memory values)
        internal
        pure
        returns (uint256 packed)
    {
        require(values.length <= 8, "BitPacking: too many uint32 values");
        
        for (uint256 i = 0; i < values.length; i++) {
            packed |= uint256(values[i]) << (i * 32);
        }
    }

    /**
     * @notice Unpack multiple uint32 values
     * @param packed Packed values
     * @param count Number of values to unpack
     * @return values Array of uint32 values
     */
    function unpackUint32Array(uint256 packed, uint256 count)
        internal
        pure
        returns (uint32[] memory values)
    {
        require(count <= 8, "BitPacking: too many uint32 values");
        
        values = new uint32[](count);
        for (uint256 i = 0; i < count; i++) {
            values[i] = uint32(packed >> (i * 32));
        }
    }

    // ============ COMPRESSION ============

    /**
     * @notice Simple run-length encoding for boolean arrays
     * @param bools Array of booleans
     * @return encoded Encoded array of (value, count) pairs
     */
    function runLengthEncode(bool[] memory bools)
        internal
        pure
        returns (uint256[] memory encoded)
    {
        if (bools.length == 0) {
            return new uint256[](0);
        }
        
        // First pass to count runs
        uint256 runCount = 1;
        bool current = bools[0];
        for (uint256 i = 1; i < bools.length; i++) {
            if (bools[i] != current) {
                runCount++;
                current = bools[i];
            }
        }
        
        // Second pass to encode
        encoded = new uint256[](runCount * 2);
        current = bools[0];
        uint256 runLength = 1;
        uint256 encodedIndex = 0;
        
        for (uint256 i = 1; i < bools.length; i++) {
            if (bools[i] == current) {
                runLength++;
            } else {
                encoded[encodedIndex] = current ? 1 : 0;
                encoded[encodedIndex + 1] = runLength;
                encodedIndex += 2;
                
                current = bools[i];
                runLength = 1;
            }
        }
        
        // Add last run
        encoded[encodedIndex] = current ? 1 : 0;
        encoded[encodedIndex + 1] = runLength;
    }

    // ============ VALIDATION ============

    /**
     * @notice Validate that packing and unpacking produces original values
     * @param size Original size
     * @param margin Original margin
     * @param entryPrice Original entry price
     * @param lastFundingAccrued Original last funding timestamp
     * @param leverage Original leverage
     * @param isLong Original position direction
     * @param flags Original flags
     * @return valid True if round-trip succeeds
     */
    function validatePositionPacking(
        uint256 size,
        uint256 margin,
        uint256 entryPrice,
        uint32 lastFundingAccrued,
        uint24 leverage,
        bool isLong,
        uint8 flags
    ) internal pure returns (bool valid) {
        uint256 packed = packPosition(
            size,
            margin,
            entryPrice,
            lastFundingAccrued,
            leverage,
            isLong,
            flags
        );
        
        (
            uint256 unpackedSize,
            uint256 unpackedMargin,
            uint256 unpackedEntryPrice,
            uint32 unpackedLastFunding,
            uint24 unpackedLeverage,
            bool unpackedIsLong,
            uint8 unpackedFlags
        ) = unpackPosition(packed);
        
        valid = true;
        valid = valid && unpackedSize == size;
        valid = valid && unpackedMargin == margin;
        valid = valid && unpackedEntryPrice == entryPrice;
        valid = valid && unpackedLastFunding == lastFundingAccrued;
        valid = valid && unpackedLeverage == leverage;
        valid = valid && unpackedIsLong == isLong;
        valid = valid && unpackedFlags == flags;
    }
}