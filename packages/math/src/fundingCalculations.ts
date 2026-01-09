/**
 * Exact TypeScript mirror of FundingRateCalculator.sol
 * DO NOT MODIFY LOGIC - Must match Solidity exactly
 * Version: 1.0.0
 * Solidity: contracts/libraries/FundingRateCalculator.sol
 * Lines correspondance noted in comments
 */

// ============ CONSTANTS (Lines 13-19 in Solidity) ============
const PRECISION = 10n ** 18n;
const MAX_FUNDING_RATE = PRECISION / 100n; // 1% max funding rate per interval
const MIN_FUNDING_RATE = 0n;
const FUNDING_VELOCITY_MAX = PRECISION / 1000n; // 0.1% per second max velocity
const SKEW_SCALE_DEFAULT = 100000n * PRECISION; // $100k default skew scale

// ============ STRUCTS (Lines 22-30 in Solidity) ============
interface FundingState {
    currentFundingRate: bigint;
    lastFundingTime: bigint;
    fundingAccumulatedLong: bigint;
    fundingAccumulatedShort: bigint;
    skewScale: bigint;
    maxFundingRate: bigint;
}

// ============ CORE CALCULATIONS ============

/**
 * @notice Calculate funding rate based on skew (Lines 38-72 in Solidity)
 * @param longOpenInterest Long open interest
 * @param shortOpenInterest Short open interest
 * @param skewScale Normalization factor for skew
 * @param timeElapsed Seconds since last funding update
 * @return fundingRate Calculated funding rate (positive = longs pay shorts)
 */
export function calculateFundingRate(
    longOpenInterest: bigint,
    shortOpenInterest: bigint,
    skewScale: bigint,
    timeElapsed: bigint
): bigint {
    // Net skew = long - short (Line 46)
    const netSkew = longOpenInterest - shortOpenInterest;
    
    // Normalized skew = netSkew / skewScale (Lines 49-57)
    let normalizedSkew: bigint;
    if (skewScale > 0n) {
        const absNetSkew = abs(netSkew);
        const normalized = mulDiv(absNetSkew, PRECISION, skewScale);
        normalizedSkew = normalized;
        if (netSkew < 0n) {
            normalizedSkew = -normalizedSkew;
        }
    } else {
        normalizedSkew = 0n;
    }
    
    // Funding rate = normalizedSkew * fundingVelocity * timeElapsed (Line 60)
    // Clamp to max funding rate
    let fundingRate = (normalizedSkew * FUNDING_VELOCITY_MAX * timeElapsed) / PRECISION;
    
    // Apply bounds (Line 63)
    fundingRate = clampFundingRate(fundingRate);
    
    return fundingRate;
}

/**
 * @notice Calculate funding payment for a position (Lines 75-91 in Solidity)
 * @param positionSize Size of position
 * @param fundingRate Current funding rate
 * @param timeElapsed Seconds since last funding accrual
 * @param isLong True for long position
 * @return fundingPayment Funding payment (positive = receive, negative = pay)
 */
export function calculateFundingPayment(
    positionSize: bigint,
    fundingRate: bigint,
    timeElapsed: bigint,
    isLong: boolean
): bigint {
    // Funding payment = size * fundingRate * timeElapsed / PRECISION (Line 83)
    // Longs pay when fundingRate > 0, receive when fundingRate < 0
    // Shorts receive when fundingRate > 0, pay when fundingRate < 0
    
    const rawPayment = (positionSize * fundingRate * timeElapsed) / PRECISION;
    
    let fundingPayment: bigint;
    if (isLong) {
        // Longs pay positive funding rates (Line 88)
        fundingPayment = -rawPayment;
    } else {
        // Shorts receive positive funding rates (Line 90)
        fundingPayment = rawPayment;
    }
    
    return fundingPayment;
}

/**
 * @notice Update funding state with new rate (Lines 94-118 in Solidity)
 * @param state Current funding state
 * @param newFundingRate New funding rate
 * @param currentTime Current timestamp
 * @return updatedState Updated funding state
 */
export function updateFundingState(
    state: FundingState,
    newFundingRate: bigint,
    currentTime: bigint
): FundingState {
    const timeElapsed = currentTime - state.lastFundingTime;
    
    // Update accumulated funding (Line 101)
    if (timeElapsed > 0n) {
        // Positive funding rate: longs pay to shorts
        // Negative funding rate: shorts pay to longs
        const fundingAccumulated = mulDiv(abs(newFundingRate), timeElapsed, PRECISION);
        
        if (newFundingRate > 0n) {
            state.fundingAccumulatedLong += fundingAccumulated;
        } else if (newFundingRate < 0n) {
            state.fundingAccumulatedShort += fundingAccumulated;
        }
    }
    
    state.currentFundingRate = newFundingRate;
    state.lastFundingTime = currentTime;
    
    return state;
}

/**
 * @notice Calculate time-weighted average funding rate (Lines 121-150 in Solidity)
 * @param fundingRates Array of historical funding rates
 * @param timestamps Array of timestamps
 * @param startTime Start time for TWAP
 * @param endTime End time for TWAP
 * @return twapFundingRate Time-weighted average funding rate
 */
export function calculateTWAPFundingRate(
    fundingRates: bigint[],
    timestamps: bigint[],
    startTime: bigint,
    endTime: bigint
): bigint {
    if (fundingRates.length !== timestamps.length) {
        throw new Error("FundingRateCalculator: array length mismatch");
    }
    if (startTime >= endTime) {
        throw new Error("FundingRateCalculator: invalid time range");
    }
    
    let weightedSum = 0n;
    let totalDuration = 0n;
    
    for (let i = 0; i < fundingRates.length - 1; i++) {
        const segmentStart = max(timestamps[i], startTime);
        const segmentEnd = min(timestamps[i + 1], endTime);
        
        if (segmentStart < segmentEnd) {
            const segmentDuration = segmentEnd - segmentStart;
            weightedSum += fundingRates[i] * segmentDuration;
            totalDuration += segmentDuration;
        }
    }
    
    let twapFundingRate: bigint;
    if (totalDuration > 0n) {
        twapFundingRate = weightedSum / totalDuration;
    } else {
        twapFundingRate = 0n;
    }
    
    return twapFundingRate;
}

// ============ VALIDATION & BOUNDING ============

/**
 * @notice Clamp funding rate to allowed bounds (Lines 154-164 in Solidity)
 * @param fundingRate Raw funding rate
 * @return clampedRate Clamped funding rate
 */
export function clampFundingRate(fundingRate: bigint): bigint {
    let clampedRate: bigint;
    if (fundingRate > MAX_FUNDING_RATE) {
        clampedRate = MAX_FUNDING_RATE;
    } else if (fundingRate < -MAX_FUNDING_RATE) {
        clampedRate = -MAX_FUNDING_RATE;
    } else {
        clampedRate = fundingRate;
    }
    return clampedRate;
}

/**
 * @notice Validate funding rate parameters (Lines 167-178 in Solidity)
 * @param skewScale Skew scale parameter
 * @param maxFundingRate Maximum funding rate
 * @return valid True if parameters are valid
 */
export function validateParameters(skewScale: bigint, maxFundingRate: bigint): boolean {
    let valid = true;
    valid = valid && skewScale > 0n;
    valid = valid && maxFundingRate <= MAX_FUNDING_RATE;
    valid = valid && maxFundingRate > 0n;
    return valid;
}

// ============ SKEW CALCULATIONS ============

/**
 * @notice Calculate premium/discount based on skew (Lines 182-189 in Solidity)
 * @param longOpenInterest Long open interest
 * @param shortOpenInterest Short open interest
 * @param skewScale Normalization factor
 * @return premium Premium rate (positive when longs > shorts)
 */
export function calculatePremium(
    longOpenInterest: bigint,
    shortOpenInterest: bigint,
    skewScale: bigint
): bigint {
    const netSkew = longOpenInterest - shortOpenInterest;
    const premium = (netSkew * PRECISION) / skewScale;
    return premium;
}

/**
 * @notice Calculate mark price from index price and funding (Lines 192-204 in Solidity)
 * @param indexPrice Current index price
 * @param fundingRate Current funding rate
 * @param timeToNextFunding Seconds until next funding accrual
 * @return markPrice Mark price for trading
 */
export function calculateMarkPrice(
    indexPrice: bigint,
    fundingRate: bigint,
    timeToNextFunding: bigint
): bigint {
    // Mark price = indexPrice * (1 + fundingRate * timeToNextFunding) (Line 196)
    const adjustment = (fundingRate * timeToNextFunding) / PRECISION;
    const markPriceInt = (indexPrice * (PRECISION + adjustment)) / PRECISION;
    
    if (markPriceInt < 0n) {
        throw new Error("FundingRateCalculator: negative mark price");
    }
    
    return markPriceInt;
}

// ============ UTILITY FUNCTIONS (Lines 207-219 in Solidity) ============

function abs(x: bigint): bigint {
    return x >= 0n ? x : -x;
}

function max(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

function min(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
    return (a * b) / c;
}

// ============ BATCH CALCULATIONS ============

/**
 * @notice Batch calculate funding payments (Lines 222-240 in Solidity)
 * @param positionSizes Array of position sizes
 * @param fundingRate Current funding rate
 * @param timeElapsed Seconds since last funding accrual
 * @param isLongs Array of position directions
 * @return fundingPayments Array of funding payments
 */
export function batchCalculateFundingPayments(
    positionSizes: bigint[],
    fundingRate: bigint,
    timeElapsed: bigint,
    isLongs: boolean[]
): bigint[] {
    const length = positionSizes.length;
    if (isLongs.length !== length) {
        throw new Error("FundingRateCalculator: array length mismatch");
    }
    
    const fundingPayments = new Array<bigint>(length);
    
    for (let i = 0; i < length; i++) {
        fundingPayments[i] = calculateFundingPayment(
            positionSizes[i],
            fundingRate,
            timeElapsed,
            isLongs[i]
        );
    }
    
    return fundingPayments;
}

/**
 * @notice Batch calculate mark prices (Lines 243-259 in Solidity)
 * @param indexPrices Array of index prices
 * @param fundingRate Current funding rate
 * @param timeToNextFunding Seconds until next funding accrual
 * @return markPrices Array of mark prices
 */
export function batchCalculateMarkPrices(
    indexPrices: bigint[],
    fundingRate: bigint,
    timeToNextFunding: bigint
): bigint[] {
    const length = indexPrices.length;
    const markPrices = new Array<bigint>(length);
    
    for (let i = 0; i < length; i++) {
        markPrices[i] = calculateMarkPrice(
            indexPrices[i],
            fundingRate,
            timeToNextFunding
        );
    }
    
    return markPrices;
}

// ============ EXPORT CONSTANTS ============
export const FundingConstants = {
    PRECISION: Number(PRECISION),
    MAX_FUNDING_RATE: Number(MAX_FUNDING_RATE),
    MIN_FUNDING_RATE: Number(MIN_FUNDING_RATE),
    FUNDING_VELOCITY_MAX: Number(FUNDING_VELOCITY_MAX),
    SKEW_SCALE_DEFAULT: Number(SKEW_SCALE_DEFAULT),
} as const;