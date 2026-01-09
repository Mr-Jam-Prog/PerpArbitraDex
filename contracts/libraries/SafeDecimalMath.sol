// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
        
        // Use assembly for gas optimization when safe
        assembly {
            // Compute remainder using mulmod
            let remainder := mulmod(x, y, denominator)
            
            // 512-bit multiply [prod1 prod0] = x * y
            let prod0 := mul(x, y)
            let prod1 := sub(sub(0, prod0), lt(prod0, 0))
            
            // Handle non-overflow cases, 256 by 256 division
            if iszero(prod1) {
                if iszero(remainder) {
                    result := div(prod0, denominator)
                } else {
                    result := add(div(prod0, denominator), gt(remainder, prod0))
                }
                return result
            }
            
            // Make sure the result is less than 2**256
            if or(gt(denominator, prod1), iszero(prod1)) {
                // Divide [prod1 prod0] by the factors of two
                let twos := and(sub(0, denominator), denominator)
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
                prod0 := or(prod0, mul(prod1, twos))
                
                // Invert denominator mod 2**256
                let inv := xor(mul(3, denominator), 2)
                inv := mul(inv, sub(2, mul(denominator, inv)))
                inv := mul(inv, sub(2, mul(denominator, inv)))
                inv := mul(inv, sub(2, mul(denominator, inv)))
                inv := mul(inv, sub(2, mul(denominator, inv)))
                inv := mul(inv, sub(2, mul(denominator, inv)))
                inv := mul(inv, sub(2, mul(denominator, inv)))
                
                // Because the division is now exact we can divide by multiplying
                result := mul(prod0, inv)
                return result
            }
        }
        
        // Fallback for very large numbers (should never happen in practice)
        uint256 prod0 = x * y;
        uint256 prod1;
        assembly {
            let mm := mulmod(x, y, not(0))
            prod1 := sub(sub(mm, prod0), lt(mm, prod0))
        }
        
        require(denominator > prod1, "Math: mulDiv overflow");
        
        uint256 remainder;
        assembly {
            remainder := mulmod(x, y, denominator)
        }
        
        prod1 = prod1 - (remainder > prod0 ? 1 : 0);
        prod0 = prod0 - remainder;
        
        uint256 twos = denominator & (~denominator + 1);
        assembly {
            denominator := div(denominator, twos)
            prod0 := div(prod0, twos)
            twos := add(div(sub(0, twos), twos), 1)
        }
        
        prod0 |= prod1 * twos;
        
        uint256 inverse = (3 * denominator) ^ 2;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        inverse *= 2 - denominator * inverse;
        
        result = prod0 * inverse;
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