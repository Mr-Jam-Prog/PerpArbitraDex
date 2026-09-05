/**
 * Reference Executable Math Model for Perpetual DEX Protocol
 * Formally defined according to docs/ECONOMIC_SPEC.md
 */
export const WAD = 10n ** 18n;
export const ORACLE_PRICE_DECIMALS = 8n;
export const ORACLE_NORM_FACTOR = 10n ** 10n; // Convert 8 decimals -> 18 decimals WAD
// ============ UTILITY MATH FUNCTIONS ============
/**
 * Floor division: floor(a * b / c)
 */
export function mulDivFloor(a, b, c) {
    return (a * b) / c;
}
/**
 * Ceil division: ceil(a * b / c)
 */
export function mulDivCeil(a, b, c) {
    const prod = a * b;
    if (prod === 0n)
        return 0n;
    return (prod + c - 1n) / c;
}
/**
 * Absolute value for BigInt
 */
export function abs(a) {
    return a >= 0n ? a : -a;
}
/**
 * Converts external oracle price (8 decimals) to internal WAD price (18 decimals)
 */
export function normalizeOraclePrice(rawPrice8Decimals) {
    return rawPrice8Decimals * ORACLE_NORM_FACTOR;
}
/**
 * Converts 18-decimal quote WAD amount to native ERC20 quote token units (floor rounding)
 */
export function wadToNativeQuote(wadAmount, quoteDecimals) {
    if (quoteDecimals === 18)
        return wadAmount;
    const scale = 10n ** BigInt(18 - quoteDecimals);
    return wadAmount / scale;
}
/**
 * Converts 18-decimal quote WAD amount to native ERC20 quote token units (ceil rounding)
 */
export function wadToNativeQuoteCeil(wadAmount, quoteDecimals) {
    if (quoteDecimals === 18)
        return wadAmount;
    if (wadAmount === 0n)
        return 0n;
    const scale = 10n ** BigInt(18 - quoteDecimals);
    return (wadAmount + scale - 1n) / scale;
}
/**
 * Converts native ERC20 quote token units to 18-decimal quote WAD amount
 */
export function nativeQuoteToWad(nativeAmount, quoteDecimals) {
    if (quoteDecimals === 18)
        return nativeAmount;
    const scale = 10n ** BigInt(18 - quoteDecimals);
    return nativeAmount * scale;
}
// ============ CORE CALCULATIONS ============
/**
 * Calculate Notional Value in Quote WAD
 * notionalQuoteWad = sizeWad * priceWad / 1e18
 */
export function calculateNotionalQuoteWad(sizeWad, priceWad) {
    return mulDivFloor(sizeWad, priceWad, WAD);
}
/**
 * Calculate Mark Price given Index Price and Skew
 * MarkPrice = IndexPrice * (1 + Skew / SkewScale)
 */
export function calculateMarkPriceWad(indexPriceWad, skewWad, skewScaleWad) {
    if (skewScaleWad === 0n)
        return indexPriceWad;
    const premiumFactor = mulDivFloor(skewWad, WAD, skewScaleWad); // signed WAD
    const markPriceFactor = WAD + premiumFactor;
    if (markPriceFactor <= 0n)
        return 1n; // Floor to 1 wei to prevent zero/negative price
    return mulDivFloor(indexPriceWad, markPriceFactor, WAD);
}
/**
 * Calculate PnL in Quote WAD
 * Long:  PnL = sizeWad * (currentPriceWad - entryPriceWad) / 1e18
 * Short: PnL = sizeWad * (entryPriceWad - currentPriceWad) / 1e18
 */
export function calculateUnrealizedPnlWad(sizeWad, entryPriceWad, currentPriceWad, isLong) {
    if (sizeWad === 0n)
        return 0n;
    if (isLong) {
        if (currentPriceWad >= entryPriceWad) {
            return mulDivFloor(sizeWad, currentPriceWad - entryPriceWad, WAD);
        }
        else {
            return -mulDivFloor(sizeWad, entryPriceWad - currentPriceWad, WAD);
        }
    }
    else {
        if (entryPriceWad >= currentPriceWad) {
            return mulDivFloor(sizeWad, entryPriceWad - currentPriceWad, WAD);
        }
        else {
            return -mulDivFloor(sizeWad, currentPriceWad - entryPriceWad, WAD);
        }
    }
}
/**
 * Calculate Cumulative Funding Payment in Quote WAD
 * FundingPayment = sizeWad * (cumFundingCurr - cumFundingEntry) / 1e18 * (isLong ? +1 : -1)
 * Positive value = Trader owes / pays funding
 * Negative value = Trader receives funding
 */
export function calculateFundingPaymentWad(sizeWad, entryFundingIndexWad, currentFundingIndexWad, isLong) {
    const deltaFunding = currentFundingIndexWad - entryFundingIndexWad;
    const rawPayment = mulDivFloor(sizeWad, abs(deltaFunding), WAD);
    if (deltaFunding === 0n)
        return 0n;
    if (deltaFunding > 0n) {
        // Positive index increase: longs pay shorts
        return isLong ? rawPayment : -rawPayment;
    }
    else {
        // Negative index decrease: shorts pay longs
        return isLong ? -rawPayment : rawPayment;
    }
}
/**
 * Calculate Equity in Quote WAD
 * equityWad = marginWad + unrealizedPnlWad - fundingPaymentWad
 */
export function calculateEquityWad(marginWad, unrealizedPnlWad, fundingPaymentWad) {
    return marginWad + unrealizedPnlWad - fundingPaymentWad;
}
/**
 * Calculate Maintenance Margin Requirement in Quote WAD (Ceil rounding to preserve solvency)
 */
export function calculateMaintenanceMarginWad(sizeWad, currentPriceWad, maintenanceMarginBps) {
    const notionalWad = calculateNotionalQuoteWad(sizeWad, currentPriceWad);
    return mulDivCeil(notionalWad, maintenanceMarginBps, 10000n);
}
/**
 * Calculate Health Factor in WAD (1e18 = 1.0 = Liquidation Threshold)
 * HealthFactor = floor(equityWad * 1e18 / maintenanceMarginWad)
 * Returns 0 if equity <= 0
 */
export function calculateHealthFactorWad(equityWad, maintenanceMarginWad) {
    if (equityWad <= 0n)
        return 0n;
    if (maintenanceMarginWad === 0n)
        return 100n * WAD; // Max HF
    return mulDivFloor(equityWad, WAD, maintenanceMarginWad);
}
/**
 * Calculate Liquidation Price in WAD
 */
export function calculateLiquidationPriceWad(position, currentFundingIndexWad, maintenanceMarginBps) {
    const fundingPayment = calculateFundingPaymentWad(position.sizeWad, position.entryFundingIndexWad, currentFundingIndexWad, position.isLong);
    const mmRatio = mulDivFloor(WAD, maintenanceMarginBps, 10000n);
    if (position.isLong) {
        // size * (P - Entry) / 1e18 + Margin - Funding = size * P * mmRatio / 1e18
        // P * size / 1e18 * (1 - mmRatio) = size * Entry / 1e18 - Margin + Funding
        const num = mulDivFloor(position.sizeWad, position.entryPriceWad, WAD) - position.marginWad + fundingPayment;
        const den = mulDivFloor(position.sizeWad, WAD - mmRatio, WAD);
        if (num <= 0n || den === 0n) {
            return { hasValidLiquidationPrice: false, liquidationPriceWad: 0n };
        }
        return {
            hasValidLiquidationPrice: true,
            liquidationPriceWad: mulDivFloor(num, WAD, den)
        };
    }
    else {
        // size * (Entry - P) / 1e18 + Margin - Funding = size * P * mmRatio / 1e18
        // size * Entry / 1e18 + Margin - Funding = P * size / 1e18 * (1 + mmRatio)
        const num = mulDivFloor(position.sizeWad, position.entryPriceWad, WAD) + position.marginWad - fundingPayment;
        const den = mulDivFloor(position.sizeWad, WAD + mmRatio, WAD);
        if (num <= 0n) {
            return { hasValidLiquidationPrice: false, liquidationPriceWad: 0n };
        }
        return {
            hasValidLiquidationPrice: true,
            liquidationPriceWad: mulDivFloor(num, WAD, den)
        };
    }
}
/**
 * Simulate Position Increase / Opening
 */
export function openOrIncreasePosition(position, addedSizeWad, addedMarginWad, execPriceWad, isLong, currentFundingIndexWad, params) {
    // Protocol fee = ceil(addedNotional * protocolFeeBps / 10000)
    const addedNotional = calculateNotionalQuoteWad(addedSizeWad, execPriceWad);
    const protocolFeeWad = mulDivCeil(addedNotional, params.protocolFeeBps, 10000n);
    const netMarginAdded = addedMarginWad > protocolFeeWad ? addedMarginWad - protocolFeeWad : 0n;
    if (!position || position.sizeWad === 0n) {
        return {
            updatedPosition: {
                sizeWad: addedSizeWad,
                entryPriceWad: execPriceWad,
                marginWad: netMarginAdded,
                isLong,
                entryFundingIndexWad: currentFundingIndexWad
            },
            protocolFeeWad,
            traderPayoutWad: 0n,
            realizedPnlWad: 0n
        };
    }
    // Volume-Weighted Average Price
    const oldNotional = mulDivFloor(position.sizeWad, position.entryPriceWad, WAD);
    const addedEntryVal = mulDivFloor(addedSizeWad, execPriceWad, WAD);
    const totalSize = position.sizeWad + addedSizeWad;
    const newEntryPrice = mulDivFloor(oldNotional + addedEntryVal, WAD, totalSize);
    return {
        updatedPosition: {
            sizeWad: totalSize,
            entryPriceWad: newEntryPrice,
            marginWad: position.marginWad + netMarginAdded,
            isLong: position.isLong,
            entryFundingIndexWad: currentFundingIndexWad
        },
        protocolFeeWad,
        traderPayoutWad: 0n,
        realizedPnlWad: 0n
    };
}
/**
 * Simulate Partial Decrease or Full Close of Position
 */
export function decreaseOrClosePosition(position, closedSizeWad, execPriceWad, currentFundingIndexWad, params) {
    const sizeToClose = closedSizeWad > position.sizeWad ? position.sizeWad : closedSizeWad;
    // Realized PnL for closed portion
    const realizedPnlWad = calculateUnrealizedPnlWad(sizeToClose, position.entryPriceWad, execPriceWad, position.isLong);
    // Funding payment for closed portion
    const fundingPaymentWad = calculateFundingPaymentWad(sizeToClose, position.entryFundingIndexWad, currentFundingIndexWad, position.isLong);
    // Margin portion released
    const releasedMarginWad = mulDivFloor(position.marginWad, sizeToClose, position.sizeWad);
    // Closing fee
    const closedNotional = calculateNotionalQuoteWad(sizeToClose, execPriceWad);
    const protocolFeeWad = mulDivCeil(closedNotional, params.protocolFeeBps, 10000n);
    // Trader net payout = Released Margin + Realized PnL - Funding Payment - Fee
    const rawPayout = releasedMarginWad + realizedPnlWad - fundingPaymentWad - protocolFeeWad;
    const traderPayoutWad = rawPayout > 0n ? rawPayout : 0n;
    const remainingSize = position.sizeWad - sizeToClose;
    const remainingMargin = position.marginWad - releasedMarginWad;
    return {
        updatedPosition: {
            sizeWad: remainingSize,
            entryPriceWad: remainingSize > 0n ? position.entryPriceWad : 0n,
            marginWad: remainingMargin > 0n ? remainingMargin : 0n,
            isLong: position.isLong,
            entryFundingIndexWad: remainingSize > 0n ? position.entryFundingIndexWad : 0n
        },
        protocolFeeWad,
        traderPayoutWad,
        realizedPnlWad
    };
}
/**
 * Execute Liquidation according to Solvency Rules (Prompt 07B Full Liquidation)
 */
export function executeLiquidation(position, currentPriceWad, currentFundingIndexWad, params) {
    const unrealizedPnl = calculateUnrealizedPnlWad(position.sizeWad, position.entryPriceWad, currentPriceWad, position.isLong);
    const fundingPayment = calculateFundingPaymentWad(position.sizeWad, position.entryFundingIndexWad, currentFundingIndexWad, position.isLong);
    const netPnl = unrealizedPnl - fundingPayment;
    const equity = position.marginWad + netPnl;
    const notional = calculateNotionalQuoteWad(position.sizeWad, currentPriceWad);
    // Penalty = ceil(notional * liquidationPenaltyBps / 10000)
    const penalty = mulDivCeil(notional, params.liquidationPenaltyBps, 10000n);
    const reward = mulDivFloor(penalty, params.liquidatorRewardShareBps, 10000n);
    if (equity > 0n) {
        if (equity >= penalty) {
            // Branch A
            const rem = equity - penalty;
            return {
                liquidatedSizeWad: position.sizeWad,
                liquidatorRewardWad: reward,
                insuranceFundAddWad: penalty - reward,
                badDebtWad: 0n,
                traderRemainingEquityWad: rem
            };
        }
        else {
            // Branch B (0 < Equity < Penalty)
            return {
                liquidatedSizeWad: position.sizeWad,
                liquidatorRewardWad: reward,
                insuranceFundAddWad: equity > reward ? equity - reward : 0n,
                badDebtWad: 0n,
                traderRemainingEquityWad: 0n
            };
        }
    }
    else {
        // Branch C / Exact Zero Equity (Equity <= 0)
        const badDebtWad = abs(equity);
        return {
            liquidatedSizeWad: position.sizeWad,
            liquidatorRewardWad: reward,
            insuranceFundAddWad: 0n,
            badDebtWad,
            traderRemainingEquityWad: 0n
        };
    }
}
