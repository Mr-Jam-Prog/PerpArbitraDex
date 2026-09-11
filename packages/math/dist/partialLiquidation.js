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
    SizingMode["PARTIAL_EXACT_RESEARCH"] = "PARTIAL_EXACT_RESEARCH";
    SizingMode["PARTIAL_GRID_RESEARCH"] = "PARTIAL_GRID_RESEARCH";
    SizingMode["RESEARCH_INCONCLUSIVE"] = "RESEARCH_INCONCLUSIVE";
    SizingMode["FULL_FALLBACK"] = "FULL_FALLBACK";
})(SizingMode || (SizingMode = {}));
/**
 * Validates that targetHfWad meets the minimum protocol liquidation threshold floor (WAD = 1e18).
 */
export function validateTargetHfWad(targetHfWad) {
    if (targetHfWad < WAD) {
        throw new RangeError("targetHfWad must be >= WAD");
    }
}
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
    validateTargetHfWad(targetHfWad);
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
            nominalClosedProfitWad: 0n,
            closedProfitNative: 0n,
            effectiveClosedProfitWad: 0n,
            nominalClosedNetPnlWad: 0n,
            closedNetProfitNative: 0n,
            effectiveClosedNetProfitWad: 0n,
            closedNetDeficitNative: 0n,
            effectiveClosedNetDeficitWad: 0n,
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
            nominalClosedProfitWad: 0n,
            closedProfitNative: 0n,
            effectiveClosedProfitWad: 0n,
            nominalClosedNetPnlWad: 0n,
            closedNetProfitNative: 0n,
            effectiveClosedNetProfitWad: 0n,
            closedNetDeficitNative: 0n,
            effectiveClosedNetDeficitWad: 0n,
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
    // 3. Direct PnL & Diagnostic Standalone Loss/Profit Quantization
    const pnlClosedWad = calculateUnrealizedPnlWad(deltaSWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRoundingResidualWad = baseState.pnl0Wad - (pnlClosedWad + pnlRemainingWad);
    let nominalClosedLossWad = 0n;
    let closedLossNative = 0n;
    let effectiveClosedLossWad = 0n;
    let nominalClosedProfitWad = 0n;
    let closedProfitNative = 0n;
    let effectiveClosedProfitWad = 0n;
    if (pnlClosedWad < 0n) {
        nominalClosedLossWad = abs(pnlClosedWad);
        closedLossNative = wadToNativeQuoteCeil(nominalClosedLossWad, quoteDecimals);
        effectiveClosedLossWad = nativeQuoteToWad(closedLossNative, quoteDecimals);
    }
    else if (pnlClosedWad > 0n) {
        nominalClosedProfitWad = pnlClosedWad;
        closedProfitNative = wadToNativeQuote(nominalClosedProfitWad, quoteDecimals);
        effectiveClosedProfitWad = nativeQuoteToWad(closedProfitNative, quoteDecimals);
    }
    // 4. Authoritative Canonical Signed Net Closed PnL Settlement (Prompt 07B Order)
    const m1Wad = baseState.m1Wad;
    const uWad = baseState.unpaidFundingWad;
    const nominalClosedNetPnlWad = pnlClosedWad - uWad;
    let closedNetProfitNative = 0n;
    let effectiveClosedNetProfitWad = 0n;
    let closedNetDeficitNative = 0n;
    let effectiveClosedNetDeficitWad = 0n;
    if (nominalClosedNetPnlWad >= 0n) {
        closedNetProfitNative = wadToNativeQuote(nominalClosedNetPnlWad, quoteDecimals);
        effectiveClosedNetProfitWad = nativeQuoteToWad(closedNetProfitNative, quoteDecimals);
    }
    else {
        closedNetDeficitNative = wadToNativeQuoteCeil(abs(nominalClosedNetPnlWad), quoteDecimals);
        effectiveClosedNetDeficitWad = nativeQuoteToWad(closedNetDeficitNative, quoteDecimals);
    }
    // Unpaid funding debt is fully folded into the signed net closed slice settlement
    const unpaidFundingAfterWad = 0n;
    const mmRemainingWad = calculateMaintenanceMarginWad(remainingSizeWad, currentPriceWad, maintenanceMarginBps);
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const minMarginRequiredWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n);
    let mPostWad = 0n;
    let traderPayoutWad = 0n;
    let equityPostWad = 0n;
    // Canonical Closed Obligations & Available Realized Resources using Signed Net
    let availableRealizedResourcesWad = 0n;
    let totalClosedObligationsWad = 0n;
    if (nominalClosedNetPnlWad >= 0n) {
        availableRealizedResourcesWad = m1Wad + effectiveClosedNetProfitWad;
        totalClosedObligationsWad = effectivePenaltyWad;
    }
    else {
        availableRealizedResourcesWad = m1Wad;
        totalClosedObligationsWad = effectiveClosedNetDeficitWad + effectivePenaltyWad;
    }
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
        const effectiveNetClosedWad = nominalClosedNetPnlWad >= 0n
            ? effectiveClosedNetProfitWad
            : -effectiveClosedNetDeficitWad;
        const closedAvailableWad = effectiveReleasedWad + effectiveNetClosedWad;
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
        // Pure Retain Collateral / Pure Deleveraging with signed net PnL settlement
        traderPayoutWad = 0n;
        mPostWad = availableRealizedResourcesWad >= totalClosedObligationsWad
            ? availableRealizedResourcesWad - totalClosedObligationsWad
            : 0n;
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    else if (policy === CollateralPolicy.POLICY_C_C) {
        // Hybrid Policy C-C: Safe surplus payout depending ONLY on realizable stored margin
        const targetEquityReqWad = mulDivCeil(mmRemainingWad, targetHfWad, WAD);
        const maxMPostWad = availableRealizedResourcesWad >= totalClosedObligationsWad
            ? availableRealizedResourcesWad - totalClosedObligationsWad
            : 0n;
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
    else if (hfPostWad < WAD || hfPostWad < targetHfWad) {
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
        nominalClosedProfitWad,
        closedProfitNative,
        effectiveClosedProfitWad,
        nominalClosedNetPnlWad,
        closedNetProfitNative,
        effectiveClosedNetProfitWad,
        closedNetDeficitNative,
        effectiveClosedNetDeficitWad,
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
 * Research-only Conservative Upper-Bound Predicate for Policy B (`ConservativeSafeB`).
 * Evaluates whether deltaSWad satisfies Policy B under worst-case rounding bounds.
 * Note: Non-monotonic due to discrete native quantization boundaries; NOT suitable for binary search.
 */
export function isConservativeSafePolicyB(params) {
    const { s0Wad, m0Wad, deltaSWad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, targetHfWad, liqFeeRatioBps, maintenanceMarginBps, minMarginRatioBps = maintenanceMarginBps, quoteDecimals, minPositionSizeWad } = params;
    validateTargetHfWad(targetHfWad);
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
    const uWad = baseState.unpaidFundingWad;
    const m1Wad = baseState.m1Wad;
    const nominalClosedNetPnlWad = pnlClosedWad - uWad;
    let availableResourcesUpperWad = 0n;
    let obligationsUpperWad = 0n;
    if (nominalClosedNetPnlWad >= 0n) {
        const profitNative = wadToNativeQuote(nominalClosedNetPnlWad, quoteDecimals);
        const effectiveNetProfitWad = nativeQuoteToWad(profitNative, quoteDecimals);
        availableResourcesUpperWad = m1Wad + effectiveNetProfitWad;
        obligationsUpperWad = effectivePenaltyWad + 1n;
    }
    else {
        const deficitNative = wadToNativeQuoteCeil(abs(nominalClosedNetPnlWad), quoteDecimals);
        const effectiveNetDeficitWad = nativeQuoteToWad(deficitNative, quoteDecimals);
        availableResourcesUpperWad = m1Wad;
        obligationsUpperWad = effectiveNetDeficitWad + effectivePenaltyWad + 1n;
    }
    if (obligationsUpperWad > availableResourcesUpperWad)
        return false;
    const mPostLowerWad = availableResourcesUpperWad >= obligationsUpperWad
        ? availableResourcesUpperWad - obligationsUpperWad
        : 0n;
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const mmRemainingUpperWad = mulDivCeil(remainingNotionalWad, maintenanceMarginBps, 10000n) + 1n;
    const minMarginRequiredUpperWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n) + 1n;
    if (mPostLowerWad < minMarginRequiredUpperWad)
        return false;
    if (remainingSizeWad < minPositionSizeWad)
        return false;
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const equityLowerWad = mPostLowerWad + pnlRemainingWad - 1n;
    if (equityLowerWad <= 0n)
        return false;
    const hfConsWad = calculateHealthFactorWad(equityLowerWad, mmRemainingUpperWad);
    return hfConsWad >= WAD && hfConsWad >= targetHfWad;
}
/**
 * Research-Only Resolution-Aware Grid Sizing Solver.
 * Evaluates Policy B safety over a declared stepWad research grid.
 *
 * Semantics:
 * - stepWad == 1: True integer-domain exhaustive search (searchExhaustive = true).
 *   Returns PARTIAL_EXACT_RESEARCH or FULL_FALLBACK.
 * - stepWad > 1: Resolution-limited grid sampling (searchExhaustive = false).
 *   Returns PARTIAL_GRID_RESEARCH if a safe grid point is found, or RESEARCH_INCONCLUSIVE
 *   if no safe point is found on the grid (never FULL_FALLBACK).
 *
 * NOTE: For research and test verification only; not suitable for production sizing.
 */
export function findSafePolicyBSizeResearch(params, stepWad = WAD) {
    if (stepWad <= 0n) {
        throw new Error("Invalid search stepWad: must be > 0");
    }
    validateTargetHfWad(params.targetHfWad);
    const baseState = evaluateBasePosition(params.s0Wad, params.m0Wad, params.entryPrice8d, params.currentPrice8d, params.isLong, params.fundingPaymentWad, params.maintenanceMarginBps, params.quoteDecimals);
    if (!baseState.isLiquidatable) {
        return {
            recommendedDeltaSWad: 0n,
            mode: SizingMode.NONE,
            willFullyLiquidate: false,
            fallbackReason: "Position not liquidatable",
            evaluationCount: 0,
            researchStepWad: stepWad,
            searchExhaustive: stepWad === 1n,
            sampledMaxPartial: false
        };
    }
    if (params.minPositionSizeWad >= params.s0Wad) {
        return {
            recommendedDeltaSWad: params.s0Wad,
            mode: SizingMode.FULL_FALLBACK,
            willFullyLiquidate: true,
            fallbackReason: "No valid partial domain: minPositionSizeWad >= s0Wad",
            evaluationCount: 0,
            researchStepWad: stepWad,
            searchExhaustive: true,
            sampledMaxPartial: false
        };
    }
    const maxPartial = params.minPositionSizeWad === 0n
        ? params.s0Wad - 1n
        : params.s0Wad - params.minPositionSizeWad;
    const isExhaustive = stepWad === 1n;
    let evalCount = 0;
    let sampledMaxPartial = false;
    // Grid sampling
    for (let x = stepWad; x <= maxPartial; x += stepWad) {
        evalCount++;
        if (x === maxPartial)
            sampledMaxPartial = true;
        const sim = simulatePartialLiquidation({ ...params, deltaSWad: x, policy: CollateralPolicy.POLICY_B });
        if (sim.isSafe) {
            return {
                recommendedDeltaSWad: x,
                mode: isExhaustive ? SizingMode.PARTIAL_EXACT_RESEARCH : SizingMode.PARTIAL_GRID_RESEARCH,
                willFullyLiquidate: false,
                partialResult: sim,
                evaluationCount: evalCount,
                researchStepWad: stepWad,
                searchExhaustive: isExhaustive,
                sampledMaxPartial
            };
        }
    }
    // Tail sampling: if stepWad > 1 and maxPartial was not grid-aligned, explicitly sample maxPartial
    if (stepWad > 1n && maxPartial % stepWad !== 0n) {
        evalCount++;
        sampledMaxPartial = true;
        const simTail = simulatePartialLiquidation({ ...params, deltaSWad: maxPartial, policy: CollateralPolicy.POLICY_B });
        if (simTail.isSafe) {
            return {
                recommendedDeltaSWad: maxPartial,
                mode: SizingMode.PARTIAL_GRID_RESEARCH,
                willFullyLiquidate: false,
                partialResult: simTail,
                evaluationCount: evalCount,
                researchStepWad: stepWad,
                searchExhaustive: false,
                sampledMaxPartial: true
            };
        }
    }
    // Grid miss conclusions
    if (isExhaustive) {
        // True integer-domain exhaustive scan completed with zero safe partial points
        return {
            recommendedDeltaSWad: params.s0Wad,
            mode: SizingMode.FULL_FALLBACK,
            willFullyLiquidate: true,
            fallbackReason: "Exhaustive integer scan completed — no safe partial size exists",
            evaluationCount: evalCount,
            researchStepWad: stepWad,
            searchExhaustive: true,
            sampledMaxPartial: true
        };
    }
    else {
        // Coarse grid search completed with zero safe points on sampled grid points
        return {
            recommendedDeltaSWad: 0n,
            mode: SizingMode.RESEARCH_INCONCLUSIVE,
            willFullyLiquidate: false,
            fallbackReason: "No safe size found on sampled research grid; unsampled sizes may exist",
            evaluationCount: evalCount,
            researchStepWad: stepWad,
            searchExhaustive: false,
            sampledMaxPartial
        };
    }
}
/**
 * Backward compatibility alias for findSafePolicyBSizeResearch.
 */
export function findMinimumSafePolicyBSizeExhaustive(params, stepWad = WAD) {
    return findSafePolicyBSizeResearch(params, stepWad);
}
/**
 * Quarantined/retired binary search solver. Returns FULL_FALLBACK by default to reflect
 * non-monotonicity of exact/conservative safety predicates.
 */
export function findMinimumSafePolicyBSize(params) {
    validateTargetHfWad(params.targetHfWad);
    const baseState = evaluateBasePosition(params.s0Wad, params.m0Wad, params.entryPrice8d, params.currentPrice8d, params.isLong, params.fundingPaymentWad, params.maintenanceMarginBps, params.quoteDecimals);
    if (!baseState.isLiquidatable) {
        return {
            recommendedDeltaSWad: 0n,
            mode: SizingMode.NONE,
            willFullyLiquidate: false,
            fallbackReason: "Position not liquidatable",
            evaluationCount: 0
        };
    }
    return {
        recommendedDeltaSWad: params.s0Wad,
        mode: SizingMode.FULL_FALLBACK,
        willFullyLiquidate: true,
        fallbackReason: "Binary search over non-monotonic predicate retired — full fallback",
        evaluationCount: 0
    };
}
/**
 * Backward compatibility alias for findMinimumSafePolicyBSize.
 */
export function findMinimumSafePartialSize(params) {
    return findMinimumSafePolicyBSize(params);
}
