// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title SafeDecimalMath
 * @dev Safe math operations with PRBMath for critical calculations
 */
library SafeDecimalMath {
    /// @dev Precision unit (18 decimals)
    uint256 public constant DECIMALS = 10**18;
    
    /// @dev Error definitions
    error DivisionByZero();
    error MultiplicationOverflow(uint256 a, uint256 b);
    error DivisionOverflow(uint256 numerator, uint256 denominator);
    
    /**
     * @dev Multiply with DECIMALS precision using mulDiv to prevent overflow
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        if (denominator == 0) revert DivisionByZero();
        return Math.mulDiv(x, y, denominator);
    }
    
    /**
     * @dev Multiply with DECIMALS precision
     */
    function multiplyDecimal(uint256 x, uint256 y) internal pure returns (uint256) {
        if (x == 0 || y == 0) return 0;
        return mulDiv(x, y, DECIMALS);
    }
    
    /**
     * @dev Divide with DECIMALS precision
     */
    function divideDecimal(uint256 x, uint256 y) internal pure returns (uint256) {
        if (y == 0) revert DivisionByZero();
        return mulDiv(x, DECIMALS, y);
    }
    
    /**
     * @dev Square root using Babylonian method
     */
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        
        return y;
    }
    
    /**
     * @dev Absolute value for int256
     */
    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }
    
    /**
     * @dev Minimum of two values
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    /**
     * @dev Maximum of two values
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }
    
    /**
     * @dev Clamp value between min and max
     */
    function clamp(uint256 value, uint256 minValue, uint256 maxValue) internal pure returns (uint256) {
        if (value < minValue) return minValue;
        if (value > maxValue) return maxValue;
        return value;
    }
    
    /**
     * @dev Calculate weighted average
     */
    function weightedAverage(
        uint256 value1,
        uint256 weight1,
        uint256 value2,
        uint256 weight2
    ) internal pure returns (uint256) {
        uint256 totalWeight = weight1 + weight2;
        if (totalWeight == 0) return 0;
        
        uint256 numerator = value1 * weight1 + value2 * weight2;
        return numerator / totalWeight;
    }
}
