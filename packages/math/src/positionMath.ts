/**
 * Exact TypeScript mirror of PositionMath.sol
 * DO NOT MODIFY LOGIC - Must match Solidity exactly
 * Version: 1.0.0
 * Solidity: contracts/libraries/PositionMath.sol
 */

// ============ CONSTANTS (MATH ONLY, NO POLICY) ============
// (Lines 37-47 in Solidity)
const PRICE_DECIMALS = 8;
const PRICE_NORMALIZATION = 10n ** 10n; // 10**10 to convert 8 → 18 decimals
const DECIMALS = 10n ** 18n;
const MAX_HEALTH_FACTOR = 100n * DECIMALS; // 100x

// ============ UTILITY FUNCTIONS ============

function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
    return (a * b) / c;
}

function abs(x: bigint): bigint {
    return x >= 0n ? x : -x;
}

// ============ STRUCTS (GAS OPTIMIZED) ============
// (Lines 50-81 in Solidity)

export interface PositionParams {
    size: bigint;               // Notional value (18 decimals)
    collateral: bigint;         // Collateral amount (18 decimals)
    entryPrice: bigint;         // Entry price (8 decimals)
    isLong: boolean;
    fundingAccrued: bigint;     // Funding accrued (18 decimals, signed)
}

export interface PositionRiskParams {
    maintenanceMarginBps: bigint;      // Basis points (e.g., 2000 = 20%)
    liquidationThresholdBps: bigint;   // Basis points (e.g., 8000 = 80%)
}

export interface LiquidationResult {
    isLiquidatable: boolean;
    liquidationPrice: bigint; // 8 decimals (0 if not liquidatable)
}

// ============ PRICE VALIDATION & NORMALIZATION ============
// (Lines 84-107 in Solidity)

/**
 * @dev Validate price has correct decimals and normalize for internal calculations
 * Mirror of: function validateAndNormalizePrice(uint256 price)
 * @param price Price in external format (must be PRICE_DECIMALS)
 * @return normalizedPrice Price normalized to 18 decimals for calculations
 */
export function validateAndNormalizePrice(price: bigint): bigint {
    // In production, we would check decimals, but for gas efficiency we assume
    // the caller has already normalized to PRICE_DECIMALS
    return price * PRICE_NORMALIZATION; // 8 → 18 decimals
}

/**
 * @dev Denormalize price from internal format back to external format
 * Mirror of: function denormalizePrice(uint256 normalizedPrice)
 * @param normalizedPrice Price in 18 decimals
 * @return price Price in PRICE_DECIMALS (8 decimals)
 */
export function denormalizePrice(normalizedPrice: bigint): bigint {
    return normalizedPrice / PRICE_NORMALIZATION;
}

// ============ CORE PNL CALCULATIONS ============
// (Lines 110-148 in Solidity)

function _validatePnLInputs(
    entryPrice: bigint,
    currentPrice: bigint,
    size: bigint
): void {
    if (entryPrice === 0n) throw new Error("ZeroEntryPrice");
    if (size === 0n) throw new Error("ZeroSize");
    if (currentPrice === 0n) throw new Error("PriceTooSmall");
}

function _calculatePnLLong(
    entryNormalized: bigint,
    currentNormalized: bigint,
    size: bigint
): { pnl: bigint, absolutePnL: bigint, isProfit: boolean } {
    if (currentNormalized > entryNormalized) {
        const priceDiff = currentNormalized - entryNormalized;
        const profit = mulDiv(priceDiff, size, DECIMALS);
        return {
            pnl: profit,
            absolutePnL: profit,
            isProfit: true
        };
    } else {
        const priceDiff = entryNormalized - currentNormalized;
        const loss = mulDiv(priceDiff, size, DECIMALS);
        return {
            pnl: -loss,
            absolutePnL: loss,
            isProfit: false
        };
    }
}

function _calculatePnLShort(
    entryNormalized: bigint,
    currentNormalized: bigint,
    size: bigint
): { pnl: bigint, absolutePnL: bigint, isProfit: boolean } {
    if (currentNormalized < entryNormalized) {
        const priceDiff = entryNormalized - currentNormalized;
        const profit = mulDiv(priceDiff, size, DECIMALS);
        return {
            pnl: profit,
            absolutePnL: profit,
            isProfit: true
        };
    } else {
        const priceDiff = currentNormalized - entryNormalized;
        const loss = mulDiv(priceDiff, size, DECIMALS);
        return {
            pnl: -loss,
            absolutePnL: loss,
            isProfit: false
        };
    }
}

/**
 * @dev Calculate PnL for a position (size = notional)
 * Mirror of: function calculatePnLWithProfitFlag(uint256 entryPrice, uint256 currentPrice, uint256 size, bool isLong)
 * Mathematical invariant: PnL(long) = -PnL(short) for same parameters
 * @param entryPrice Entry price (8 decimals)
 * @param currentPrice Current price (8 decimals)
 * @param size Notional value (18 decimals)
 * @param isLong True for long, false for short
 * @return pnl PnL (18 decimals, signed)
 * @return absolutePnL Absolute PnL value (18 decimals)
 * @return isProfit True if profit, false if loss
 */
export function calculatePnLWithProfitFlag(
    entryPrice: bigint,
    currentPrice: bigint,
    size: bigint,
    isLong: boolean
): [bigint, bigint, boolean] {
    // Validate inputs (Lines 129-130)
    _validatePnLInputs(entryPrice, currentPrice, size);
    
    // Normalize prices for calculation (Lines 133-134)
    const entryNormalized = validateAndNormalizePrice(entryPrice);
    const currentNormalized = validateAndNormalizePrice(currentPrice);
    
    let result: { pnl: bigint, absolutePnL: bigint, isProfit: boolean };
    
    if (isLong) {
        result = _calculatePnLLong(entryNormalized, currentNormalized, size);
    } else {
        result = _calculatePnLShort(entryNormalized, currentNormalized, size);
    }
    
    return [result.pnl, result.absolutePnL, result.isProfit];
}

/**
 * @dev Calculate PnL (optimized version)
 * Mirror of: function calculatePnL(uint256 entryPrice, uint256 currentPrice, uint256 size, bool isLong)
 * Gas-optimized for L2 execution
 */
export function calculatePnL(
    entryPrice: bigint,
    currentPrice: bigint,
    size: bigint,
    isLong: boolean
): bigint {
    // Validate inputs
    _validatePnLInputs(entryPrice, currentPrice, size);
    
    // Normalize prices
    const entryNormalized = validateAndNormalizePrice(entryPrice);
    const currentNormalized = validateAndNormalizePrice(currentPrice);
    
    if (isLong) {
        return _calculatePnLLongOptimized(entryNormalized, currentNormalized, size);
    } else {
        return _calculatePnLShortOptimized(entryNormalized, currentNormalized, size);
    }
}

function _calculatePnLLongOptimized(
    entryNormalized: bigint,
    currentNormalized: bigint,
    size: bigint
): bigint {
    try {
        return currentNormalized > entryNormalized
            ? mulDiv(currentNormalized - entryNormalized, size, DECIMALS)
            : -mulDiv(entryNormalized - currentNormalized, size, DECIMALS);
    } catch {
        return 0n;
    }
}

function _calculatePnLShortOptimized(
    entryNormalized: bigint,
    currentNormalized: bigint,
    size: bigint
): bigint {
    try {
        return currentNormalized < entryNormalized
            ? mulDiv(entryNormalized - currentNormalized, size, DECIMALS)
            : -mulDiv(currentNormalized - entryNormalized, size, DECIMALS);
    } catch {
        return 0n;
    }
}

// ============ HEALTH FACTOR CALCULATIONS ============
// (Lines 151-198 in Solidity)

function _validateHealthFactorInputs(
    params: PositionParams,
    currentPrice: bigint,
    riskParams: PositionRiskParams
): void {
    if (params.entryPrice === 0n) throw new Error("ZeroEntryPrice");
    if (params.size === 0n) throw new Error("ZeroSize");
    if (currentPrice === 0n) throw new Error("PriceTooSmall");
    
    if (
        riskParams.maintenanceMarginBps === 0n ||
        riskParams.maintenanceMarginBps > 10000n ||
        riskParams.liquidationThresholdBps === 0n ||
        riskParams.liquidationThresholdBps > 10000n ||
        riskParams.maintenanceMarginBps >= riskParams.liquidationThresholdBps
    ) {
        throw new Error(`InvalidMaintenanceMargin: ${riskParams.maintenanceMarginBps}`);
    }
}

function _calculateTotalValue(
    collateral: bigint,
    pnl: bigint,
    fundingAccrued: bigint,
    size: bigint
): bigint {
    // Clamp funding to economic bounds to prevent attacks
    let fundingClamped = fundingAccrued;
    
    if (fundingAccrued > size) {
        fundingClamped = size;
    } else if (fundingAccrued < -size) {
        fundingClamped = -size;
    }
    
    return collateral + pnl - fundingClamped;
}

/**
 * @dev Calculate health factor with economic bounds enforcement
 * Mirror of: function calculateHealthFactor(PositionParams memory params, uint256 currentPrice, PositionRiskParams memory riskParams)
 * Health Factor = (collateral + pnl - fundingClamped) / maintenanceMargin
 * @param params Position parameters
 * @param currentPrice Current price (8 decimals)
 * @param riskParams Risk parameters
 * @return healthFactor Health factor (18 decimals, 1e18 = 100% healthy)
 */
export function calculateHealthFactor(
    params: PositionParams,
    currentPrice: bigint,
    riskParams: PositionRiskParams
): bigint {
    // Validate inputs
    _validateHealthFactorInputs(params, currentPrice, riskParams);
    
    // Calculate PnL
    const pnl = calculatePnL(
        params.entryPrice,
        currentPrice,
        params.size,
        params.isLong
    );
    
    // Calculate total value with funding clamped to economic bounds
    const totalValue = _calculateTotalValue(
        params.collateral,
        pnl,
        params.fundingAccrued,
        params.size
    );
    
    // If total value is negative, health factor is 0
    if (totalValue <= 0n) {
        return 0n;
    }
    
    // Calculate maintenance margin in quote units
    const notionalValue = mulDiv(params.size, validateAndNormalizePrice(currentPrice), DECIMALS);
    const maintenanceMargin = mulDiv(notionalValue, riskParams.maintenanceMarginBps, 10000n);
    
    // Prevent division by zero (should never happen with validation)
    if (maintenanceMargin === 0n) {
        return MAX_HEALTH_FACTOR;
    }
    
    // Calculate health factor with upper bound
    let healthFactor = mulDiv(totalValue, DECIMALS, maintenanceMargin);
    
    // Apply maximum health factor to prevent UI issues
    if (healthFactor > MAX_HEALTH_FACTOR) {
        healthFactor = MAX_HEALTH_FACTOR;
    }
    
    return healthFactor;
}

// ============ LIQUIDATION CALCULATIONS ============
// (Lines 201-255 in Solidity)

function _validateLiquidationInputs(
    params: PositionParams,
    riskParams: PositionRiskParams
): void {
    if (params.entryPrice === 0n) throw new Error("ZeroEntryPrice");
    if (params.size === 0n) throw new Error("ZeroSize");
    
    if (
        riskParams.maintenanceMarginBps === 0n ||
        riskParams.maintenanceMarginBps > 10000n ||
        riskParams.liquidationThresholdBps === 0n ||
        riskParams.liquidationThresholdBps > 10000n ||
        riskParams.maintenanceMarginBps >= riskParams.liquidationThresholdBps
    ) {
        throw new Error(`InvalidMaintenanceMargin: ${riskParams.maintenanceMarginBps}`);
    }
}

/**
 * @dev Calculate liquidation price safely with explicit result
 * Mirror of: function calculateLiquidationPriceSafe(PositionParams memory params, PositionRiskParams memory riskParams)
 * Uses mathematical derivation: collateral + pnl(price) - funding = maintenanceMargin
 * @param params Position parameters
 * @param riskParams Risk parameters
 * @return result Contains liquidation price and liquidatable flag
 */
export function calculateLiquidationPriceSafe(
    params: PositionParams,
    riskParams: PositionRiskParams
): LiquidationResult {
    // Validate inputs
    _validateLiquidationInputs(params, riskParams);
    
    // Calculate maintenance margin ratio
    const mmRatio = mulDiv(DECIMALS, riskParams.maintenanceMarginBps, 10000n);
    const entryNormalized = validateAndNormalizePrice(params.entryPrice);
    
    if (params.isLong) {
        const numerator = int256(mulDiv(params.size, entryNormalized, DECIMALS)) - int256(params.collateral) + int256(params.fundingAccrued);
        if (numerator <= 0n) return { isLiquidatable: false, liquidationPrice: 0n };
        
        const denominator = mulDiv(params.size, DECIMALS - mmRatio, DECIMALS);
        if (denominator === 0n) return { isLiquidatable: false, liquidationPrice: 0n };
        
        const liqPriceNormalized = mulDiv(uint256(numerator), DECIMALS, denominator);
        return {
            isLiquidatable: true,
            liquidationPrice: denormalizePrice(liqPriceNormalized)
        };
    } else {
        const numerator = int256(mulDiv(params.size, entryNormalized, DECIMALS)) + int256(params.collateral) - int256(params.fundingAccrued);
        if (numerator <= 0n) return { isLiquidatable: false, liquidationPrice: 0n };
        
        const denominator = mulDiv(params.size, DECIMALS + mmRatio, DECIMALS);
        const liqPriceNormalized = mulDiv(uint256(numerator), DECIMALS, denominator);
        
        return {
            isLiquidatable: true,
            liquidationPrice: denormalizePrice(liqPriceNormalized)
        };
    }
}

// Helpers for int256/uint256 casting simulation in TS
function int256(x: bigint): bigint { return x; }
function uint256(x: bigint): bigint { return x < 0n ? 0n : x; }

// ============ EXPORT CONSTANTS ============
export const Constants = {
    PRICE_DECIMALS,
    PRICE_NORMALIZATION: Number(PRICE_NORMALIZATION),
    DECIMALS: Number(DECIMALS),
    MAX_HEALTH_FACTOR: Number(MAX_HEALTH_FACTOR),
} as const;