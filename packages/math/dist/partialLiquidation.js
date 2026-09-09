/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A-R4)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A-R4 requirements.
 */
import { WAD, ORACLE_NORM_FACTOR, mulDivFloor, mulDivCeil, abs, wadToNativeQuote, wadToNativeQuoteCeil, nativeQuoteToWad, calculateNotionalQuoteWad, calculateUnrealizedPnlWad, calculateMaintenanceMarginWad, calculateHealthFactorWad } from "./referenceModel.js";
export var CollateralPolicy;
(function (CollateralPolicy) {
    CollateralPolicy["POLICY_A"] = "POLICY_A";
    CollateralPolicy["POLICY_B"] = "POLICY_B";
    CollateralPolicy["POLICY_C_C"] = "POLICY_C_C"; // Hybrid attribution: retain required collateral for target HF, return safe surplus
})(CollateralPolicy || (CollateralPolicy = {}));
export var SizingMode;
(function (SizingMode) {
    SizingMode["NONE"] = "NONE";
    SizingMode["PARTIAL_CONSERVATIVE"] = "PARTIAL_CONSERVATIVE";
    SizingMode["FULL_FALLBACK"] = "FULL_FALLBACK";
})(SizingMode || (SizingMode = {}));
/**
 * Evaluates pre-liquidation base position state after funding settlement on S0.
 */
export function evaluateBasePosition(s0Wad, m0Wad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, maintenanceMarginBps, quoteDecimals) {
    let m1Wad = m0Wad;
    let unpaidFundingWad = 0n;
    if (fundingPaymentWad > 0n) {
        const debtNative = wadToNativeQuoteCeil(fundingPaymentWad, quoteDecimals);
        const chargedWad = nativeQuoteToWad(debtNative, quoteDecimals);
        if (m0Wad >= chargedWad) {
            m1Wad = m0Wad - chargedWad;
            unpaidFundingWad = 0n;
        }
        else {
            const marginNative = wadToNativeQuote(m0Wad, quoteDecimals);
            const marginForfeitedWad = nativeQuoteToWad(marginNative, quoteDecimals);
            m1Wad = m0Wad - marginForfeitedWad;
            unpaidFundingWad = fundingPaymentWad > marginForfeitedWad ? fundingPaymentWad - marginForfeitedWad : 0n;
        }
    }
    else if (fundingPaymentWad < 0n) {
        const creditNative = wadToNativeQuote(abs(fundingPaymentWad), quoteDecimals);
        const creditedWad = nativeQuoteToWad(creditNative, quoteDecimals);
        m1Wad = m0Wad + creditedWad;
        unpaidFundingWad = 0n;
    }
    const currentPriceWad = currentPrice8d * ORACLE_NORM_FACTOR;
    const entryPriceWad = entryPrice8d * ORACLE_NORM_FACTOR;
    const pnl0Wad = calculateUnrealizedPnlWad(s0Wad, entryPriceWad, currentPriceWad, isLong);
    const equity0Wad = m1Wad + pnl0Wad - unpaidFundingWad;
    const mm0Wad = calculateMaintenanceMarginWad(s0Wad, currentPriceWad, maintenanceMarginBps);
    const hf0Wad = calculateHealthFactorWad(equity0Wad, mm0Wad);
    return {
        m1Wad,
        unpaidFundingWad,
        pnl0Wad,
        equity0Wad,
        mm0Wad,
        hf0Wad,
        isLiquidatable: hf0Wad < WAD
    };
}
/**
 * Simulates partial liquidation for given size and policy.
 * Domain is strictly 0 < deltaSWad < s0Wad. Full liquidation (deltaSWad >= s0Wad) is rejected.
 */
export function simulatePartialLiquidation(params) {
    const { s0Wad, m0Wad, deltaSWad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, targetHfWad, policy, liqFeeRatioBps, maintenanceMarginBps, minMarginRatioBps = maintenanceMarginBps, quoteDecimals, minPositionSizeWad } = params;
    const baseState = evaluateBasePosition(s0Wad, m0Wad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, maintenanceMarginBps, quoteDecimals);
    const remainingSizeWad = s0Wad > deltaSWad ? s0Wad - deltaSWad : 0n;
    const currentPriceWad = currentPrice8d * ORACLE_NORM_FACTOR;
    const entryPriceWad = entryPrice8d * ORACLE_NORM_FACTOR;
    // Reject non-liquidatable position inputs
    if (!baseState.isLiquidatable) {
        return {
            baseState,
            deltaSWad,
            remainingSizeWad,
            policy,
            notionalClosedWad: 0n,
            nominalPenaltyWad: 0n,
            penaltyNative: 0n,
            effectivePenaltyWad: 0n,
            nominalRewardWad: 0n,
            rewardNative: 0n,
            effectiveRewardWad: 0n,
            pnlClosedWad: 0n,
            nominalClosedLossWad: 0n,
            closedLossNative: 0n,
            effectiveClosedLossWad: 0n,
            pnlRemainingWad: 0n,
            pnlRoundingResidualWad: 0n,
            unpaidFundingBeforeWad: baseState.unpaidFundingWad,
            unpaidFundingAfterWad: baseState.unpaidFundingWad,
            mPostWad: 0n,
            equityPostWad: 0n,
            mmRemainingWad: 0n,
            minMarginRequiredWad: 0n,
            hfPostWad: 0n,
            traderPayoutWad: 0n,
            residualBadDebtWad: 0n,
            externalBadDebtRequired: false,
            isSafe: false,
            fallbackReason: "Position not liquidatable"
        };
    }
    // Domain bounds check: partial simulation must strictly be 0 < deltaSWad < s0Wad
    if (deltaSWad <= 0n || deltaSWad >= s0Wad) {
        return {
            baseState,
            deltaSWad,
            remainingSizeWad,
            policy,
            notionalClosedWad: 0n,
            nominalPenaltyWad: 0n,
            penaltyNative: 0n,
            effectivePenaltyWad: 0n,
            nominalRewardWad: 0n,
            rewardNative: 0n,
            effectiveRewardWad: 0n,
            pnlClosedWad: 0n,
            nominalClosedLossWad: 0n,
            closedLossNative: 0n,
            effectiveClosedLossWad: 0n,
            pnlRemainingWad: 0n,
            pnlRoundingResidualWad: 0n,
            unpaidFundingBeforeWad: baseState.unpaidFundingWad,
            unpaidFundingAfterWad: baseState.unpaidFundingWad,
            mPostWad: 0n,
            equityPostWad: 0n,
            mmRemainingWad: 0n,
            minMarginRequiredWad: 0n,
            hfPostWad: 0n,
            traderPayoutWad: 0n,
            residualBadDebtWad: 0n,
            externalBadDebtRequired: false,
            isSafe: false,
            fallbackReason: deltaSWad >= s0Wad
                ? "Full liquidation required — outside partial model"
                : "Invalid deltaS domain"
        };
    }
    // 1. Closed notional and penalty
    const notionalClosedWad = calculateNotionalQuoteWad(deltaSWad, currentPriceWad);
    const nominalPenaltyWad = mulDivCeil(notionalClosedWad, liqFeeRatioBps, 10000n);
    const penaltyNative = wadToNativeQuoteCeil(nominalPenaltyWad, quoteDecimals);
    const effectivePenaltyWad = nativeQuoteToWad(penaltyNative, quoteDecimals);
    // 2. Liquidator reward (50% share)
    const nominalRewardWad = mulDivFloor(nominalPenaltyWad, 5000n, 10000n);
    const rewardNative = wadToNativeQuote(nominalRewardWad, quoteDecimals);
    const effectiveRewardWad = nativeQuoteToWad(rewardNative, quoteDecimals);
    // 3. Direct PnL & Canonical Native Closed Loss Quantization
    const pnlClosedWad = calculateUnrealizedPnlWad(deltaSWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRoundingResidualWad = baseState.pnl0Wad - (pnlClosedWad + pnlRemainingWad);
    let nominalClosedLossWad = 0n;
    let closedLossNative = 0n;
    let effectiveClosedLossWad = 0n;
    if (pnlClosedWad < 0n) {
        nominalClosedLossWad = abs(pnlClosedWad);
        closedLossNative = wadToNativeQuoteCeil(nominalClosedLossWad, quoteDecimals);
        effectiveClosedLossWad = nativeQuoteToWad(closedLossNative, quoteDecimals);
    }
    const mmRemainingWad = calculateMaintenanceMarginWad(remainingSizeWad, currentPriceWad, maintenanceMarginBps);
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const minMarginRequiredWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n);
    let mPostWad = 0n;
    let traderPayoutWad = 0n;
    let equityPostWad = 0n;
    const m1Wad = baseState.m1Wad;
    const uWad = baseState.unpaidFundingWad;
    // Unpaid funding cure calculation
    const realizedProfitClosedWad = pnlClosedWad > 0n ? pnlClosedWad : 0n;
    const availableToCureWad = m1Wad + realizedProfitClosedWad;
    const unpaidFundingAfterWad = uWad > availableToCureWad ? uWad - availableToCureWad : 0n;
    // Canonical Closed Obligations using effective native charges
    const totalClosedObligationsWad = effectiveClosedLossWad + uWad + effectivePenaltyWad;
    const availableRealizedResourcesWad = m1Wad + realizedProfitClosedWad;
    let residualBadDebtWad = 0n;
    let externalBadDebtRequired = false;
    if (totalClosedObligationsWad > availableRealizedResourcesWad) {
        residualBadDebtWad = totalClosedObligationsWad - availableRealizedResourcesWad;
        externalBadDebtRequired = true;
    }
    if (policy === CollateralPolicy.POLICY_A) {
        // Proportional margin release with native quote quantization (matching PerpEngine.sol)
        const rawRelWad = mulDivFloor(m1Wad, deltaSWad, s0Wad);
        const releaseNative = wadToNativeQuote(rawRelWad, quoteDecimals);
        const effectiveReleasedWad = nativeQuoteToWad(releaseNative, quoteDecimals);
        const mRetainedWad = m1Wad - effectiveReleasedWad;
        const netClosedWad = pnlClosedWad - uWad;
        const closedAvailableWad = effectiveReleasedWad + netClosedWad;
        if (closedAvailableWad >= effectivePenaltyWad) {
            const grossPayoutWad = closedAvailableWad - effectivePenaltyWad;
            mPostWad = mRetainedWad;
            const payoutNative = wadToNativeQuote(grossPayoutWad, quoteDecimals);
            traderPayoutWad = nativeQuoteToWad(payoutNative, quoteDecimals);
        }
        else {
            const penaltyShortfallWad = effectivePenaltyWad - closedAvailableWad;
            traderPayoutWad = 0n;
            if (mRetainedWad >= penaltyShortfallWad) {
                mPostWad = mRetainedWad - penaltyShortfallWad;
            }
            else {
                mPostWad = 0n;
                residualBadDebtWad = totalClosedObligationsWad > availableRealizedResourcesWad
                    ? totalClosedObligationsWad - availableRealizedResourcesWad
                    : 0n;
                externalBadDebtRequired = true;
            }
        }
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    else if (policy === CollateralPolicy.POLICY_B) {
        // Pure Retain Collateral / Pure Deleveraging
        traderPayoutWad = 0n;
        if (pnlClosedWad > 0n) {
            mPostWad = (m1Wad + pnlClosedWad) >= (uWad + effectivePenaltyWad)
                ? (m1Wad + pnlClosedWad - uWad - effectivePenaltyWad)
                : 0n;
        }
        else {
            mPostWad = m1Wad >= totalClosedObligationsWad ? m1Wad - totalClosedObligationsWad : 0n;
        }
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    else if (policy === CollateralPolicy.POLICY_C_C) {
        // Hybrid Policy C-C: Safe surplus payout depending ONLY on realizable stored margin
        const targetEquityReqWad = mulDivCeil(mmRemainingWad, targetHfWad, WAD);
        let maxMPostWad = 0n;
        if (pnlClosedWad > 0n) {
            maxMPostWad = (m1Wad + pnlClosedWad) >= (uWad + effectivePenaltyWad)
                ? (m1Wad + pnlClosedWad - uWad - effectivePenaltyWad)
                : 0n;
        }
        else {
            maxMPostWad = m1Wad >= totalClosedObligationsWad ? m1Wad - totalClosedObligationsWad : 0n;
        }
        // Stored margin required to achieve target HF (without relying on unrealized PnL payout)
        const requiredStoredMarginForHfWad = targetEquityReqWad > pnlRemainingWad ? targetEquityReqWad - pnlRemainingWad : 0n;
        const requiredStoredMarginWad = requiredStoredMarginForHfWad > minMarginRequiredWad ? requiredStoredMarginForHfWad : minMarginRequiredWad;
        const safeSurplusMarginWad = maxMPostWad > requiredStoredMarginWad ? maxMPostWad - requiredStoredMarginWad : 0n;
        const payoutNative = wadToNativeQuote(safeSurplusMarginWad, quoteDecimals);
        const effectivePayoutWad = nativeQuoteToWad(payoutNative, quoteDecimals);
        traderPayoutWad = effectivePayoutWad;
        mPostWad = maxMPostWad >= effectivePayoutWad ? maxMPostWad - effectivePayoutWad : 0n;
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    const hfPostWad = calculateHealthFactorWad(equityPostWad, mmRemainingWad);
    // Safety predicate
    let isSafe = true;
    let fallbackReason = undefined;
    if (unpaidFundingAfterWad > 0n) {
        isSafe = false;
        fallbackReason = "Residual unpaid funding uncured";
    }
    else if (externalBadDebtRequired || residualBadDebtWad > 0n) {
        isSafe = false;
        fallbackReason = "External bad debt required / closed obligations breach collateral";
    }
    else if (equityPostWad <= 0n) {
        isSafe = false;
        fallbackReason = "Post equity non-positive / insolvent";
    }
    else if (hfPostWad < targetHfWad) {
        isSafe = false;
        fallbackReason = "Post HF below target";
    }
    else if (remainingSizeWad > 0n && remainingSizeWad < minPositionSizeWad) {
        isSafe = false;
        fallbackReason = "Surviving size below minPositionSize";
    }
    else if (remainingSizeWad > 0n && mPostWad < minMarginRequiredWad) {
        isSafe = false;
        fallbackReason = "Surviving margin below minMarginRatio requirement";
    }
    return {
        baseState,
        deltaSWad,
        remainingSizeWad,
        policy,
        notionalClosedWad,
        nominalPenaltyWad,
        penaltyNative,
        effectivePenaltyWad,
        nominalRewardWad,
        rewardNative,
        effectiveRewardWad,
        pnlClosedWad,
        nominalClosedLossWad,
        closedLossNative,
        effectiveClosedLossWad,
        pnlRemainingWad,
        pnlRoundingResidualWad,
        unpaidFundingBeforeWad: baseState.unpaidFundingWad,
        unpaidFundingAfterWad,
        mPostWad,
        equityPostWad,
        mmRemainingWad,
        minMarginRequiredWad,
        hfPostWad,
        traderPayoutWad,
        residualBadDebtWad,
        externalBadDebtRequired,
        isSafe,
        fallbackReason
    };
}
/**
 * Conservative Upper-Bound Predicate for Policy B (`ConservativeSafeB`).
 * Evaluates whether deltaSWad satisfies Policy B under worst-case rounding bounds,
 * ensuring strict monotonicity over integer WAD units for all quote token decimals.
 */
export function isConservativeSafePolicyB(params) {
    const { s0Wad, m0Wad, deltaSWad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, targetHfWad, liqFeeRatioBps, maintenanceMarginBps, minMarginRatioBps = maintenanceMarginBps, quoteDecimals, minPositionSizeWad } = params;
    const remainingSizeWad = s0Wad > deltaSWad ? s0Wad - deltaSWad : 0n;
    if (deltaSWad <= 0n || deltaSWad >= s0Wad)
        return false;
    const baseState = evaluateBasePosition(s0Wad, m0Wad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, maintenanceMarginBps, quoteDecimals);
    if (!baseState.isLiquidatable)
        return false;
    const currentPriceWad = currentPrice8d * ORACLE_NORM_FACTOR;
    const entryPriceWad = entryPrice8d * ORACLE_NORM_FACTOR;
    // Exact effective native charges
    const notionalClosedWad = calculateNotionalQuoteWad(deltaSWad, currentPriceWad);
    const nominalPenaltyWad = mulDivCeil(notionalClosedWad, liqFeeRatioBps, 10000n);
    const penaltyNative = wadToNativeQuoteCeil(nominalPenaltyWad, quoteDecimals);
    const effectivePenaltyWad = nativeQuoteToWad(penaltyNative, quoteDecimals);
    const pnlClosedWad = calculateUnrealizedPnlWad(deltaSWad, entryPriceWad, currentPriceWad, isLong);
    let effectiveClosedLossWad = 0n;
    if (pnlClosedWad < 0n) {
        const nominalClosedLossWad = abs(pnlClosedWad);
        const closedLossNative = wadToNativeQuoteCeil(nominalClosedLossWad, quoteDecimals);
        effectiveClosedLossWad = nativeQuoteToWad(closedLossNative, quoteDecimals);
    }
    const uWad = baseState.unpaidFundingWad;
    const m1Wad = baseState.m1Wad;
    const realizedProfitClosedWad = pnlClosedWad > 0n ? pnlClosedWad : 0n;
    // Conservative Upper Bound on Closed Obligations (+1 wei for division domination)
    const totalObligationsUpperWad = effectiveClosedLossWad + uWad + effectivePenaltyWad + 1n;
    // Unpaid funding cure check
    if (uWad > (m1Wad + realizedProfitClosedWad))
        return false;
    // Realized obligations breach check
    if (totalObligationsUpperWad > (m1Wad + realizedProfitClosedWad))
        return false;
    // Conservative Surviving Stored Margin Lower Bound
    let mPostLowerWad = 0n;
    if (pnlClosedWad > 0n) {
        mPostLowerWad = (m1Wad + pnlClosedWad) >= (uWad + effectivePenaltyWad + 1n)
            ? (m1Wad + pnlClosedWad - uWad - effectivePenaltyWad - 1n)
            : 0n;
    }
    else {
        mPostLowerWad = m1Wad >= totalObligationsUpperWad ? m1Wad - totalObligationsUpperWad : 0n;
    }
    // Conservative Requirements Upper Bounds
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const mmRemainingUpperWad = mulDivCeil(remainingNotionalWad, maintenanceMarginBps, 10000n) + 1n;
    const minMarginRequiredUpperWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n) + 1n;
    if (mPostLowerWad < minMarginRequiredUpperWad)
        return false;
    if (remainingSizeWad < minPositionSizeWad)
        return false;
    // Conservative Surviving Equity Lower Bound
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const equityLowerWad = mPostLowerWad + pnlRemainingWad - 1n;
    if (equityLowerWad <= 0n)
        return false;
    // Conservative Health Factor Lower Bound
    const hfConsWad = calculateHealthFactorWad(equityLowerWad, mmRemainingUpperWad);
    return hfConsWad >= targetHfWad;
}
/**
 * Canonical minimum safe size solver for Policy B using exact O(log S0) BigInt binary search over ConservativeSafeB.
 */
export function findMinimumSafePolicyBSize(params) {
    const baseState = evaluateBasePosition(params.s0Wad, params.m0Wad, params.entryPrice8d, params.currentPrice8d, params.isLong, params.fundingPaymentWad, params.maintenanceMarginBps, params.quoteDecimals);
    // 1. Healthy position check -> NO liquidation recommendation
    if (!baseState.isLiquidatable) {
        return {
            recommendedDeltaSWad: 0n,
            mode: SizingMode.NONE,
            willFullyLiquidate: false,
            fallbackReason: "Position not liquidatable",
            evaluationCount: 0
        };
    }
    // 2. Frozen partial domain: lo = 1 wei, hi = S0 - minPositionSize
    const lo = 1n;
    const hi = params.minPositionSizeWad > 0n && params.s0Wad > params.minPositionSizeWad
        ? params.s0Wad - params.minPositionSizeWad
        : params.s0Wad - 1n;
    if (hi < lo) {
        return {
            recommendedDeltaSWad: params.s0Wad,
            mode: SizingMode.FULL_FALLBACK,
            willFullyLiquidate: true,
            fallbackReason: "Surviving size domain empty / full fallback required",
            evaluationCount: 0
        };
    }
    // 3. Exact O(log S0) BigInt binary search over ConservativeSafeB
    let bestX = null;
    let low = lo;
    let high = hi;
    let evalCount = 0;
    while (low <= high) {
        evalCount++;
        const mid = low + (high - low) / 2n;
        const fullParams = { ...params, deltaSWad: mid, policy: CollateralPolicy.POLICY_B };
        const isConsSafe = isConservativeSafePolicyB(fullParams);
        if (isConsSafe) {
            bestX = mid;
            high = mid - 1n; // Search lower for smaller safe x
        }
        else {
            low = mid + 1n; // Search higher
        }
    }
    if (bestX !== null) {
        const exactSim = simulatePartialLiquidation({ ...params, deltaSWad: bestX, policy: CollateralPolicy.POLICY_B });
        return {
            recommendedDeltaSWad: bestX,
            mode: SizingMode.PARTIAL_CONSERVATIVE,
            willFullyLiquidate: false,
            partialResult: exactSim,
            evaluationCount: evalCount
        };
    }
    // 4. Full liquidation fallback routing
    return {
        recommendedDeltaSWad: params.s0Wad,
        mode: SizingMode.FULL_FALLBACK,
        willFullyLiquidate: true,
        fallbackReason: "Full liquidation fallback required",
        evaluationCount: evalCount
    };
}
/**
 * Backward compatibility alias for findMinimumSafePolicyBSize.
 */
export function findMinimumSafePartialSize(params) {
    return findMinimumSafePolicyBSize(params);
}
