// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title AddressArrayUtils
 * @notice Utilities for manipulating arrays of addresses
 * @dev Optimized for gas efficiency and memory usage
 */
library AddressArrayUtils {
    // ============ ERRORS ============
    
    error AddressNotFound();
    error DuplicateAddress();
    error EmptyArray();
    error IndexOutOfBounds();

    // ============ ADDITION ============

    /**
     * @notice Add an address to array if not already present
     * @param array Array of addresses
     * @param element Address to add
     * @return newArray New array with element added
     */
    function addUnique(address[] memory array, address element)
        internal
        pure
        returns (address[] memory newArray)
    {
        if (contains(array, element)) {
            revert DuplicateAddress();
        }
        
        newArray = new address[](array.length + 1);
        for (uint256 i = 0; i < array.length; i++) {
            newArray[i] = array[i];
        }
        newArray[array.length] = element;
    }

    /**
     * @notice Add multiple addresses, skipping duplicates
     * @param array Array of addresses
     * @param elements Addresses to add
     * @return newArray New array with elements added
     */
    function addAllUnique(address[] memory array, address[] memory elements)
        internal
        pure
        returns (address[] memory newArray)
    {
        // Count unique elements
        uint256 uniqueCount = 0;
        for (uint256 i = 0; i < elements.length; i++) {
            if (!contains(array, elements[i]) && !contains(elements, elements[i], i + 1)) {
                uniqueCount++;
            }
        }
        
        newArray = new address[](array.length + uniqueCount);
        
        // Copy original array
        for (uint256 i = 0; i < array.length; i++) {
            newArray[i] = array[i];
        }
        
        // Add unique elements
        uint256 currentIndex = array.length;
        for (uint256 i = 0; i < elements.length; i++) {
            address element = elements[i];
            if (!contains(array, element) && !contains(elements, element, i + 1)) {
                newArray[currentIndex] = element;
                currentIndex++;
            }
        }
    }

    // ============ REMOVAL ============

    /**
     * @notice Remove an element from array (swap with last element)
     * @param array Array of addresses
     * @param element Address to remove
     * @return newArray New array with element removed
     */
    function remove(address[] memory array, address element)
        internal
        pure
        returns (address[] memory newArray)
    {
        uint256 index = indexOf(array, element);
        if (index == type(uint256).max) {
            revert AddressNotFound();
        }
        
        return removeAtIndex(array, index);
    }

    /**
     * @notice Remove element at specific index (swap with last element)
     * @param array Array of addresses
     * @param index Index to remove
     * @return newArray New array with element removed
     */
    function removeAtIndex(address[] memory array, uint256 index)
        internal
        pure
        returns (address[] memory newArray)
    {
        if (index >= array.length) {
            revert IndexOutOfBounds();
        }
        
        if (array.length == 0) {
            revert EmptyArray();
        }
        
        newArray = new address[](array.length - 1);
        
        for (uint256 i = 0; i < array.length; i++) {
            if (i < index) {
                newArray[i] = array[i];
            } else if (i > index) {
                newArray[i - 1] = array[i];
            }
            // Skip the element at index
        }
    }

    /**
     * @notice Remove multiple elements from array
     * @param array Array of addresses
     * @param elements Elements to remove
     * @return newArray New array with elements removed
     */
    function removeAll(address[] memory array, address[] memory elements)
        internal
        pure
        returns (address[] memory newArray)
    {
        // Create a mapping of elements to remove
        bool[] memory toRemove = new bool[](array.length);
        uint256 removeCount = 0;
        
        for (uint256 i = 0; i < array.length; i++) {
            if (contains(elements, array[i])) {
                toRemove[i] = true;
                removeCount++;
            }
        }
        
        if (removeCount == 0) {
            // No changes needed
            newArray = array;
        } else {
            newArray = new address[](array.length - removeCount);
            uint256 newIndex = 0;
            
            for (uint256 i = 0; i < array.length; i++) {
                if (!toRemove[i]) {
                    newArray[newIndex] = array[i];
                    newIndex++;
                }
            }
        }
    }

    // ============ SEARCH ============

    /**
     * @notice Check if array contains address
     * @param array Array of addresses
     * @param element Address to find
     * @return found True if address is in array
     */
    function contains(address[] memory array, address element)
        internal
        pure
        returns (bool found)
    {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == element) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Check if array contains address starting from specific index
     * @param array Array of addresses
     * @param element Address to find
     * @param startIndex Index to start searching from
     * @return found True if address is in array
     */
    function contains(address[] memory array, address element, uint256 startIndex)
        internal
        pure
        returns (bool found)
    {
        for (uint256 i = startIndex; i < array.length; i++) {
            if (array[i] == element) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Find index of address in array
     * @param array Array of addresses
     * @param element Address to find
     * @return index Index of address, or type(uint256).max if not found
     */
    function indexOf(address[] memory array, address element)
        internal
        pure
        returns (uint256 index)
    {
        for (uint256 i = 0; i < array.length; i++) {
            if (array[i] == element) {
                return i;
            }
        }
        return type(uint256).max;
    }

    // ============ SET OPERATIONS ============

    /**
     * @notice Get intersection of two arrays
     * @param array1 First array
     * @param array2 Second array
     * @return intersection Array of common elements
     */
    function intersection(address[] memory array1, address[] memory array2)
        internal
        pure
        returns (address[] memory intersection)
    {
        // Count common elements
        uint256 count = 0;
        for (uint256 i = 0; i < array1.length; i++) {
            if (contains(array2, array1[i])) {
                count++;
            }
        }
        
        intersection = new address[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < array1.length; i++) {
            if (contains(array2, array1[i])) {
                intersection[index] = array1[i];
                index++;
            }
        }
    }

    /**
     * @notice Get union of two arrays (unique elements from both)
     * @param array1 First array
     * @param array2 Second array
     * @return union Array of all unique elements
     */
    function union(address[] memory array1, address[] memory array2)
        internal
        pure
        returns (address[] memory union)
    {
        // Start with first array
        address[] memory temp = new address[](array1.length + array2.length);
        uint256 count = 0;
        
        // Add all from first array
        for (uint256 i = 0; i < array1.length; i++) {
            temp[count] = array1[i];
            count++;
        }
        
        // Add unique from second array
        for (uint256 i = 0; i < array2.length; i++) {
            if (!contains(array1, array2[i])) {
                temp[count] = array2[i];
                count++;
            }
        }
        
        // Trim to actual size
        union = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            union[i] = temp[i];
        }
    }

    /**
     * @notice Get difference (array1 - array2)
     * @param array1 First array
     * @param array2 Second array
     * @return difference Elements in array1 but not in array2
     */
    function difference(address[] memory array1, address[] memory array2)
        internal
        pure
        returns (address[] memory difference)
    {
        // Count elements in array1 not in array2
        uint256 count = 0;
        for (uint256 i = 0; i < array1.length; i++) {
            if (!contains(array2, array1[i])) {
                count++;
            }
        }
        
        difference = new address[](count);
        uint256 index = 0;
        
        for (uint256 i = 0; i < array1.length; i++) {
            if (!contains(array2, array1[i])) {
                difference[index] = array1[i];
                index++;
            }
        }
    }

    // ============ UTILITIES ============

    /**
     * @notice Remove duplicates from array
     * @param array Array with possible duplicates
     * @return deduplicated Array without duplicates
     */
    function deduplicate(address[] memory array)
        internal
        pure
        returns (address[] memory deduplicated)
    {
        if (array.length <= 1) {
            return array;
        }
        
        // Count unique elements
        uint256 uniqueCount = 0;
        for (uint256 i = 0; i < array.length; i++) {
            bool isDuplicate = false;
            for (uint256 j = 0; j < i; j++) {
                if (array[i] == array[j]) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                uniqueCount++;
            }
        }
        
        deduplicated = new address[](uniqueCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < array.length; i++) {
            bool isDuplicate = false;
            for (uint256 j = 0; j < i; j++) {
                if (array[i] == array[j]) {
                    isDuplicate = true;
                    break;
                }
            }
            if (!isDuplicate) {
                deduplicated[index] = array[i];
                index++;
            }
        }
    }

    /**
     * @notice Check if two arrays are equal
     * @param array1 First array
     * @param array2 Second array
     * @return equal True if arrays have same elements in same order
     */
    function equals(address[] memory array1, address[] memory array2)
        internal
        pure
        returns (bool equal)
    {
        if (array1.length != array2.length) {
            return false;
        }
        
        for (uint256 i = 0; i < array1.length; i++) {
            if (array1[i] != array2[i]) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * @notice Reverse array in place
     * @param array Array to reverse
     */
    function reverse(address[] memory array) internal pure {
        uint256 length = array.length;
        for (uint256 i = 0; i < length / 2; i++) {
            address temp = array[i];
            array[i] = array[length - 1 - i];
            array[length - 1 - i] = temp;
        }
    }

    /**
     * @notice Get array slice
     * @param array Original array
     * @param start Start index
     * @param end End index (exclusive)
     * @return slice Array slice
     */
    function slice(
        address[] memory array,
        uint256 start,
        uint256 end
    ) internal pure returns (address[] memory slice) {
        require(start <= end, "AddressArrayUtils: invalid range");
        require(end <= array.length, "AddressArrayUtils: index out of bounds");
        
        slice = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            slice[i - start] = array[i];
        }
    }

    /**
     * @notice Concatenate two arrays
     * @param array1 First array
     * @param array2 Second array
     * @return concatenated Concatenated array
     */
    function concat(address[] memory array1, address[] memory array2)
        internal
        pure
        returns (address[] memory concatenated)
    {
        concatenated = new address[](array1.length + array2.length);
        
        for (uint256 i = 0; i < array1.length; i++) {
            concatenated[i] = array1[i];
        }
        
        for (uint256 i = 0; i < array2.length; i++) {
            concatenated[array1.length + i] = array2[i];
        }
    }

    // ============ BATCH OPERATIONS ============

    /**
     * @notice Apply function to each element
     * @param array Array of addresses
     * @param callback Function to apply
     */
    function forEach(
        address[] memory array,
        function(address) internal callback
    ) internal {
        for (uint256 i = 0; i < array.length; i++) {
            callback(array[i]);
        }
    }

    /**
     * @notice Filter array based on predicate
     * @param array Array to filter
     * @param predicate Filter function
     * @return filtered Filtered array
     */
    function filter(
        address[] memory array,
        function(address) internal view returns (bool) predicate
    ) internal view returns (address[] memory filtered) {
        // First pass: count matches
        uint256 count = 0;
        for (uint256 i = 0; i < array.length; i++) {
            if (predicate(array[i])) {
                count++;
            }
        }
        
        // Second pass: collect matches
        filtered = new address[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < array.length; i++) {
            if (predicate(array[i])) {
                filtered[index] = array[i];
                index++;
            }
        }
    }

    /**
     * @notice Map array to new values
     * @param array Array to map
     * @param mapper Mapping function
     * @return mapped Mapped array
     */
    function map(
        address[] memory array,
        function(address) internal pure returns (address) mapper
    ) internal pure returns (address[] memory mapped) {
        mapped = new address[](array.length);
        for (uint256 i = 0; i < array.length; i++) {
            mapped[i] = mapper(array[i]);
        }
    }
}