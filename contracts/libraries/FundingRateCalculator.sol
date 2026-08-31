// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {SafeDecimalMath} from "./SafeDecimalMath.sol";

/**
 * @title FundingRateCalculator
 * @notice Dynamic funding rate calculation and cumulative index tracking based on market skew according to ECONOMIC_SPEC.md
 * @dev Time-weighted, bounded, and dependent only on AMM state
 */
library FundingRateCalculator {
    using SafeDecimalMath for uint256;

    // ============ CONSTANTS ============
    
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant MAX_FUNDING_RATE = PRECISION / 100; // 1% max funding rate per interval
    uint256 internal constant MIN_FUNDING_RATE = 0;
    uint256 internal constant FUNDING_VELOCITY_MAX = PRECISION / 1000; // 0.1% per second max velocity
    uint256 internal constant SKEW_SCALE_DEFAULT = 100_000 * PRECISION; // $100k default skew scale

    // ============ STRUCTS ============
    
    struct FundingState {
        int256 currentFundingRate;
        uint256 lastFundingTime;
        int256 cumulativeFundingIndex;
        uint256 skewScale;
        uint256 maxFundingRate;
    }

    // ============ CORE CALCULATIONS ============

    /**
     * @notice Calculate funding rate based on skew
     * @param longOpenInterest Long open interest (WAD 1e18)
     * @param shortOpenInterest Short open interest (WAD 1e18)
     * @param skewScale Normalization factor for skew (WAD 1e18)
     * @param timeElapsed Seconds since last funding update
     * @return fundingRate Calculated funding rate per interval (WAD 1e18, signed, positive = longs pay shorts)
     */
    function calculateFundingRate(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 skewScale,
        uint256 timeElapsed
    ) internal pure returns (int256 fundingRate) {
        // Net skew = long - short
        int256 netSkew = int256(longOpenInterest) - int256(shortOpenInterest);
        
        // Normalized skew = netSkew / skewScale
        int256 normalizedSkew;
        if (skewScale > 0) {
            normalizedSkew = int256(
                uint256(abs(netSkew)).mulDiv(PRECISION, skewScale)
            );
            if (netSkew < 0) {
                normalizedSkew = -normalizedSkew;
            }
        }
        
        // Funding rate = normalizedSkew * fundingVelocity * timeElapsed
        fundingRate = (normalizedSkew * int256(FUNDING_VELOCITY_MAX) * int256(timeElapsed)) / int256(PRECISION);
        
        // Apply bounds
        fundingRate = clampFundingRate(fundingRate);
    }

    /**
     * @notice Calculate funding payment for a position according to ECONOMIC_SPEC.md
     * @dev Exact units and formula:
     *   deltaIndex = currentFundingIndex - entryFundingIndex                     (WAD 1e18, signed)
     *   rawPayment = positionSize * abs(deltaIndex) / 1e18                       (Quote WAD 1e18)
     *   if deltaIndex > 0 (longs pay shorts):
     *     isLong  => fundingPayment = +rawPayment (trader owes, reduces equity)
     *     isShort => fundingPayment = -rawPayment (trader receives, increases equity)
     *   if deltaIndex < 0 (shorts pay longs):
     *     isLong  => fundingPayment = -rawPayment (trader receives, increases equity)
     *     isShort => fundingPayment = +rawPayment (trader owes, reduces equity)
     * @param positionSize Size of position in base asset units (WAD 1e18)
     * @param entryFundingIndex Cumulative funding index at position entry/settlement (WAD 1e18)
     * @param currentFundingIndex Current cumulative funding index of market (WAD 1e18)
     * @param isLong True for long position, false for short position
     * @return fundingPayment Funding payment in Quote WAD (1e18, positive = trader owes, negative = trader receives)
     */
    function calculateFundingPayment(
        uint256 positionSize,
        int256 entryFundingIndex,
        int256 currentFundingIndex,
        bool isLong
    ) internal pure returns (int256 fundingPayment) {
        int256 deltaFunding = currentFundingIndex - entryFundingIndex;
        if (deltaFunding == 0 || positionSize == 0) return 0;
        
        int256 rawPayment = int256(positionSize.mulDiv(uint256(abs(deltaFunding)), PRECISION));
        
        if (deltaFunding > 0) {
            // Index increased: longs pay shorts
            fundingPayment = isLong ? rawPayment : -rawPayment;
        } else {
            // Index decreased: shorts pay longs
            fundingPayment = isLong ? -rawPayment : rawPayment;
        }
    }

    /**
     * @notice Update funding state with new rate
     * @param state Current funding state
     * @param newFundingRate New funding rate
     * @param currentTime Current timestamp
     * @return updatedState Updated funding state
     */
    function updateFundingState(
        FundingState memory state,
        int256 newFundingRate,
        uint256 currentTime
    ) internal pure returns (FundingState memory updatedState) {
        uint256 timeElapsed = currentTime - state.lastFundingTime;
        
        // Accumulate rate into cumulative index
        if (timeElapsed > 0) {
            state.cumulativeFundingIndex += newFundingRate;
        }
        
        state.currentFundingRate = newFundingRate;
        state.lastFundingTime = currentTime;
        
        return state;
    }

    /**
     * @notice Calculate time-weighted average funding rate
     * @param fundingRates Array of historical funding rates
     * @param timestamps Array of timestamps
     * @param startTime Start time for TWAP
     * @param endTime End time for TWAP
     * @return twapFundingRate Time-weighted average funding rate
     */
    function calculateTWAPFundingRate(
        int256[] memory fundingRates,
        uint256[] memory timestamps,
        uint256 startTime,
        uint256 endTime
    ) internal pure returns (int256 twapFundingRate) {
        require(fundingRates.length == timestamps.length, "FundingRateCalculator: array length mismatch");
        require(startTime < endTime, "FundingRateCalculator: invalid time range");
        
        int256 weightedSum = 0;
        uint256 totalDuration = 0;
        
        for (uint256 i = 0; i < fundingRates.length - 1; i++) {
            uint256 segmentStart = max(timestamps[i], startTime);
            uint256 segmentEnd = min(timestamps[i + 1], endTime);
            
            if (segmentStart < segmentEnd) {
                uint256 segmentDuration = segmentEnd - segmentStart;
                weightedSum += fundingRates[i] * int256(segmentDuration);
                totalDuration += segmentDuration;
            }
        }
        
        if (totalDuration > 0) {
            twapFundingRate = weightedSum / int256(totalDuration);
        }
    }

    // ============ VALIDATION & BOUNDING ============

    /**
     * @notice Clamp funding rate to allowed bounds
     * @param fundingRate Raw funding rate
     * @return clampedRate Clamped funding rate
     */
    function clampFundingRate(int256 fundingRate)
        internal
        pure
        returns (int256 clampedRate)
    {
        if (fundingRate > int256(MAX_FUNDING_RATE)) {
            clampedRate = int256(MAX_FUNDING_RATE);
        } else if (fundingRate < -int256(MAX_FUNDING_RATE)) {
            clampedRate = -int256(MAX_FUNDING_RATE);
        } else {
            clampedRate = fundingRate;
        }
    }

    /**
     * @notice Validate funding rate parameters
     * @param skewScale Skew scale parameter
     * @param maxFundingRate Maximum funding rate
     * @return valid True if parameters are valid
     */
    function validateParameters(uint256 skewScale, uint256 maxFundingRate)
        internal
        pure
        returns (bool valid)
    {
        valid = true;
        valid = valid && skewScale > 0;
        valid = valid && maxFundingRate <= MAX_FUNDING_RATE;
        valid = valid && maxFundingRate > 0;
    }

    // ============ SKEW CALCULATIONS ============

    /**
     * @notice Calculate premium/discount based on skew
     * @param longOpenInterest Long open interest
     * @param shortOpenInterest Short open interest
     * @param skewScale Normalization factor
     * @return premium Premium rate (positive when longs > shorts)
     */
    function calculatePremium(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 skewScale
    ) internal pure returns (int256 premium) {
        int256 netSkew = int256(longOpenInterest) - int256(shortOpenInterest);
        premium = (netSkew * int256(PRECISION)) / int256(skewScale);
    }

    /**
     * @notice Calculate mark price from index price and funding
     * @param indexPrice Current index price
     * @param fundingRate Current funding rate
     * @param timeToNextFunding Seconds until next funding accrual
     * @return markPrice Mark price for trading
     */
    function calculateMarkPrice(
        uint256 indexPrice,
        int256 fundingRate,
        uint256 timeToNextFunding
    ) internal pure returns (uint256 markPrice) {
        // Mark price = indexPrice * (1 + fundingRate * timeToNextFunding)
        int256 adjustment = (fundingRate * int256(timeToNextFunding)) / int256(PRECISION);
        int256 markPriceInt = (int256(indexPrice) * (int256(PRECISION) + adjustment)) / int256(PRECISION);
        
        require(markPriceInt >= 0, "FundingRateCalculator: negative mark price");
        markPrice = uint256(markPriceInt);
    }

    // ============ UTILITY FUNCTIONS ============

    function abs(int256 x) private pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function max(uint256 a, uint256 b) private pure returns (uint256) {
        return a > b ? a : b;
    }

    function min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    // ============ BATCH CALCULATIONS ============

    /**
     * @notice Batch calculate funding payments according to ECONOMIC_SPEC.md
     * @param positionSizes Array of position sizes (WAD 1e18)
     * @param entryFundingIndex Entry cumulative funding index (WAD 1e18)
     * @param currentFundingIndex Current cumulative funding index (WAD 1e18)
     * @param isLongs Array of position directions
     * @return fundingPayments Array of funding payments (Quote WAD 1e18)
     */
    function batchCalculateFundingPayments(
        uint256[] memory positionSizes,
        int256 entryFundingIndex,
        int256 currentFundingIndex,
        bool[] memory isLongs
    ) internal pure returns (int256[] memory fundingPayments) {
        uint256 length = positionSizes.length;
        require(isLongs.length == length, "FundingRateCalculator: array length mismatch");
        
        fundingPayments = new int256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            fundingPayments[i] = calculateFundingPayment(
                positionSizes[i],
                entryFundingIndex,
                currentFundingIndex,
                isLongs[i]
            );
        }
    }

    /**
     * @notice Batch calculate mark prices
     * @param indexPrices Array of index prices
     * @param fundingRate Current funding rate
     * @param timeToNextFunding Seconds until next funding accrual
     * @return markPrices Array of mark prices
     */
    function batchCalculateMarkPrices(
        uint256[] memory indexPrices,
        int256 fundingRate,
        uint256 timeToNextFunding
    ) internal pure returns (uint256[] memory markPrices) {
        uint256 length = indexPrices.length;
        markPrices = new uint256[](length);
        
        for (uint256 i = 0; i < length; i++) {
            markPrices[i] = calculateMarkPrice(
                indexPrices[i],
                fundingRate,
                timeToNextFunding
            );
        }
    }
}