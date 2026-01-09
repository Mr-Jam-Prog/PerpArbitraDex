/**
 * Exact TypeScript mirror of FundingRateCalculator.sol
 * DO NOT MODIFY LOGIC - Must match Solidity exactly
 * Version: 1.0.0
 * Solidity: contracts/libraries/FundingRateCalculator.sol
 * Lines correspondance noted in comments
 */
interface FundingState {
    currentFundingRate: bigint;
    lastFundingTime: bigint;
    fundingAccumulatedLong: bigint;
    fundingAccumulatedShort: bigint;
    skewScale: bigint;
    maxFundingRate: bigint;
}
/**
 * @notice Calculate funding rate based on skew (Lines 38-72 in Solidity)
 * @param longOpenInterest Long open interest
 * @param shortOpenInterest Short open interest
 * @param skewScale Normalization factor for skew
 * @param timeElapsed Seconds since last funding update
 * @return fundingRate Calculated funding rate (positive = longs pay shorts)
 */
export declare function calculateFundingRate(longOpenInterest: bigint, shortOpenInterest: bigint, skewScale: bigint, timeElapsed: bigint): bigint;
/**
 * @notice Calculate funding payment for a position (Lines 75-91 in Solidity)
 * @param positionSize Size of position
 * @param fundingRate Current funding rate
 * @param timeElapsed Seconds since last funding accrual
 * @param isLong True for long position
 * @return fundingPayment Funding payment (positive = receive, negative = pay)
 */
export declare function calculateFundingPayment(positionSize: bigint, fundingRate: bigint, timeElapsed: bigint, isLong: boolean): bigint;
/**
 * @notice Update funding state with new rate (Lines 94-118 in Solidity)
 * @param state Current funding state
 * @param newFundingRate New funding rate
 * @param currentTime Current timestamp
 * @return updatedState Updated funding state
 */
export declare function updateFundingState(state: FundingState, newFundingRate: bigint, currentTime: bigint): FundingState;
/**
 * @notice Calculate time-weighted average funding rate (Lines 121-150 in Solidity)
 * @param fundingRates Array of historical funding rates
 * @param timestamps Array of timestamps
 * @param startTime Start time for TWAP
 * @param endTime End time for TWAP
 * @return twapFundingRate Time-weighted average funding rate
 */
export declare function calculateTWAPFundingRate(fundingRates: bigint[], timestamps: bigint[], startTime: bigint, endTime: bigint): bigint;
/**
 * @notice Clamp funding rate to allowed bounds (Lines 154-164 in Solidity)
 * @param fundingRate Raw funding rate
 * @return clampedRate Clamped funding rate
 */
export declare function clampFundingRate(fundingRate: bigint): bigint;
/**
 * @notice Validate funding rate parameters (Lines 167-178 in Solidity)
 * @param skewScale Skew scale parameter
 * @param maxFundingRate Maximum funding rate
 * @return valid True if parameters are valid
 */
export declare function validateParameters(skewScale: bigint, maxFundingRate: bigint): boolean;
/**
 * @notice Calculate premium/discount based on skew (Lines 182-189 in Solidity)
 * @param longOpenInterest Long open interest
 * @param shortOpenInterest Short open interest
 * @param skewScale Normalization factor
 * @return premium Premium rate (positive when longs > shorts)
 */
export declare function calculatePremium(longOpenInterest: bigint, shortOpenInterest: bigint, skewScale: bigint): bigint;
/**
 * @notice Calculate mark price from index price and funding (Lines 192-204 in Solidity)
 * @param indexPrice Current index price
 * @param fundingRate Current funding rate
 * @param timeToNextFunding Seconds until next funding accrual
 * @return markPrice Mark price for trading
 */
export declare function calculateMarkPrice(indexPrice: bigint, fundingRate: bigint, timeToNextFunding: bigint): bigint;
/**
 * @notice Batch calculate funding payments (Lines 222-240 in Solidity)
 * @param positionSizes Array of position sizes
 * @param fundingRate Current funding rate
 * @param timeElapsed Seconds since last funding accrual
 * @param isLongs Array of position directions
 * @return fundingPayments Array of funding payments
 */
export declare function batchCalculateFundingPayments(positionSizes: bigint[], fundingRate: bigint, timeElapsed: bigint, isLongs: boolean[]): bigint[];
/**
 * @notice Batch calculate mark prices (Lines 243-259 in Solidity)
 * @param indexPrices Array of index prices
 * @param fundingRate Current funding rate
 * @param timeToNextFunding Seconds until next funding accrual
 * @return markPrices Array of mark prices
 */
export declare function batchCalculateMarkPrices(indexPrices: bigint[], fundingRate: bigint, timeToNextFunding: bigint): bigint[];
export declare const FundingConstants: {
    readonly PRECISION: number;
    readonly MAX_FUNDING_RATE: number;
    readonly MIN_FUNDING_RATE: number;
    readonly FUNDING_VELOCITY_MAX: number;
    readonly SKEW_SCALE_DEFAULT: number;
};
export {};
