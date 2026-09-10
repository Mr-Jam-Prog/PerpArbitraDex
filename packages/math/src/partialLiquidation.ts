/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A-R4)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A-R4 requirements.
 */

import {
    WAD,
    ORACLE_NORM_FACTOR,
    mulDivFloor,
    mulDivCeil,
    abs,
    wadToNativeQuote,
    wadToNativeQuoteCeil,
    nativeQuoteToWad,
    calculateNotionalQuoteWad,
    calculateUnrealizedPnlWad,
    calculateMaintenanceMarginWad,
    calculateHealthFactorWad
} from "./referenceModel.js";

export enum CollateralPolicy {
    POLICY_A = "POLICY_A", // Voluntary-decrease style proportional margin withdrawal
    POLICY_B = "POLICY_B", // Pure retain collateral / pure deleveraging
    POLICY_C_C = "POLICY_C_C" // Hybrid attribution: retain required collateral for target HF, return safe surplus
}

export enum SizingMode {
    NONE = "NONE",
    PARTIAL_CONSERVATIVE = "PARTIAL_CONSERVATIVE",
    FULL_FALLBACK = "FULL_FALLBACK"
}

export interface PartialLiquidationParams {
    s0Wad: bigint;
    m0Wad: bigint;
    deltaSWad: bigint;
    entryPrice8d: bigint;
    currentPrice8d: bigint;
    isLong: boolean;
    fundingPaymentWad: bigint; // positive = trader owes funding
    targetHfWad: bigint;
    policy: CollateralPolicy;
    liqFeeRatioBps: bigint; // e.g. 250n = 2.5%
    maintenanceMarginBps: bigint; // e.g. 500n = 5.0%
    minMarginRatioBps?: bigint; // e.g. 500n = 5.0% (defaults to maintenanceMarginBps if omitted)
    quoteDecimals: number;
    minPositionSizeWad: bigint;
}

export interface BasePositionStateResult {
    m1Wad: bigint;
    unpaidFundingWad: bigint;
    pnl0Wad: bigint;
    equity0Wad: bigint;
    mm0Wad: bigint;
    hf0Wad: bigint;
    isLiquidatable: boolean;
}

export interface PartialLiquidationResult {
    baseState: BasePositionStateResult;
    deltaSWad: bigint;
    remainingSizeWad: bigint;
    policy: CollateralPolicy;
    notionalClosedWad: bigint;
    nominalPenaltyWad: bigint;
    penaltyNative: bigint;
    effectivePenaltyWad: bigint;
    nominalRewardWad: bigint;
    rewardNative: bigint;
    effectiveRewardWad: bigint;
    pnlClosedWad: bigint;
    nominalClosedLossWad: bigint;
    closedLossNative: bigint;
    effectiveClosedLossWad: bigint;
    nominalClosedProfitWad: bigint;
    closedProfitNative: bigint;
    effectiveClosedProfitWad: bigint;
    pnlRemainingWad: bigint;
    pnlRoundingResidualWad: bigint;
    unpaidFundingBeforeWad: bigint;
    unpaidFundingAfterWad: bigint;
    mPostWad: bigint;
    equityPostWad: bigint;
    mmRemainingWad: bigint;
    minMarginRequiredWad: bigint;
    hfPostWad: bigint;
    traderPayoutWad: bigint;
    residualBadDebtWad: bigint;
    externalBadDebtRequired: boolean;
    isSafe: boolean;
    fallbackReason?: string;
}

export interface PartialSizingRecommendation {
    recommendedDeltaSWad: bigint;
    mode: SizingMode;
    willFullyLiquidate: boolean;
    partialResult?: PartialLiquidationResult;
    fallbackReason?: string;
    evaluationCount?: number;
}

/**
 * Evaluates pre-liquidation base position state after funding settlement on S0.
 */
export function evaluateBasePosition(
    s0Wad: bigint,
    m0Wad: bigint,
    entryPrice8d: bigint,
    currentPrice8d: bigint,
    isLong: boolean,
    fundingPaymentWad: bigint,
    maintenanceMarginBps: bigint,
    quoteDecimals: number
): BasePositionStateResult {
    let m1Wad = m0Wad;
    let unpaidFundingWad = 0n;

    if (fundingPaymentWad > 0n) {
        const debtNative = wadToNativeQuoteCeil(fundingPaymentWad, quoteDecimals);
        const chargedWad = nativeQuoteToWad(debtNative, quoteDecimals);
        if (m0Wad >= chargedWad) {
            m1Wad = m0Wad - chargedWad;
            unpaidFundingWad = 0n;
        } else {
            const marginNative = wadToNativeQuote(m0Wad, quoteDecimals);
            const marginForfeitedWad = nativeQuoteToWad(marginNative, quoteDecimals);
            m1Wad = m0Wad - marginForfeitedWad;
            unpaidFundingWad = fundingPaymentWad > marginForfeitedWad ? fundingPaymentWad - marginForfeitedWad : 0n;
        }
    } else if (fundingPaymentWad < 0n) {
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
export function simulatePartialLiquidation(
    params: PartialLiquidationParams
): PartialLiquidationResult {
    const {
        s0Wad,
        m0Wad,
        deltaSWad,
        entryPrice8d,
        currentPrice8d,
        isLong,
        fundingPaymentWad,
        targetHfWad,
        policy,
        liqFeeRatioBps,
        maintenanceMarginBps,
        minMarginRatioBps = maintenanceMarginBps,
        quoteDecimals,
        minPositionSizeWad
    } = params;

    const baseState = evaluateBasePosition(
        s0Wad,
        m0Wad,
        entryPrice8d,
        currentPrice8d,
        isLong,
        fundingPaymentWad,
        maintenanceMarginBps,
        quoteDecimals
    );

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

    // 3. Direct PnL & Native Quantization of Closed Loss (CEIL) / Profit (FLOOR)
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
    } else if (pnlClosedWad > 0n) {
        nominalClosedProfitWad = pnlClosedWad;
        closedProfitNative = wadToNativeQuote(nominalClosedProfitWad, quoteDecimals);
        effectiveClosedProfitWad = nativeQuoteToWad(closedProfitNative, quoteDecimals);
    }

    const mmRemainingWad = calculateMaintenanceMarginWad(remainingSizeWad, currentPriceWad, maintenanceMarginBps);
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const minMarginRequiredWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n);

    let mPostWad = 0n;
    let traderPayoutWad = 0n;
    let equityPostWad = 0n;

    const m1Wad = baseState.m1Wad;
    const uWad = baseState.unpaidFundingWad;

    // Unpaid funding cure calculation using effective native quantized profit
    const availableToCureWad = m1Wad + effectiveClosedProfitWad;
    const unpaidFundingAfterWad = uWad > availableToCureWad ? uWad - availableToCureWad : 0n;

    // Canonical Closed Obligations using effective native charges and resources
    const totalClosedObligationsWad = effectiveClosedLossWad + uWad + effectivePenaltyWad;
    const availableRealizedResourcesWad = m1Wad + effectiveClosedProfitWad;

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

        const netClosedWad = (pnlClosedWad > 0n ? effectiveClosedProfitWad : -effectiveClosedLossWad) - uWad;
        const closedAvailableWad = effectiveReleasedWad + netClosedWad;

        if (closedAvailableWad >= effectivePenaltyWad) {
            const grossPayoutWad = closedAvailableWad - effectivePenaltyWad;
            mPostWad = mRetainedWad;
            const payoutNative = wadToNativeQuote(grossPayoutWad, quoteDecimals);
            traderPayoutWad = nativeQuoteToWad(payoutNative, quoteDecimals);
        } else {
            const penaltyShortfallWad = effectivePenaltyWad - closedAvailableWad;
            traderPayoutWad = 0n;
            if (mRetainedWad >= penaltyShortfallWad) {
                mPostWad = mRetainedWad - penaltyShortfallWad;
            } else {
                mPostWad = 0n;
                residualBadDebtWad = totalClosedObligationsWad > availableRealizedResourcesWad
                    ? totalClosedObligationsWad - availableRealizedResourcesWad
                    : 0n;
                externalBadDebtRequired = true;
            }
        }
        equityPostWad = mPostWad + pnlRemainingWad;

    } else if (policy === CollateralPolicy.POLICY_B) {
        // Pure Retain Collateral / Pure Deleveraging with native quantized profit
        traderPayoutWad = 0n;
        mPostWad = availableRealizedResourcesWad >= totalClosedObligationsWad
            ? availableRealizedResourcesWad - totalClosedObligationsWad
            : 0n;
        equityPostWad = mPostWad + pnlRemainingWad;

    } else if (policy === CollateralPolicy.POLICY_C_C) {
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
    let fallbackReason: string | undefined = undefined;

    if (unpaidFundingAfterWad > 0n) {
        isSafe = false;
        fallbackReason = "Residual unpaid funding uncured";
    } else if (externalBadDebtRequired || residualBadDebtWad > 0n) {
        isSafe = false;
        fallbackReason = "External bad debt required / closed obligations breach collateral";
    } else if (equityPostWad <= 0n) {
        isSafe = false;
        fallbackReason = "Post equity non-positive / insolvent";
    } else if (hfPostWad < targetHfWad) {
        isSafe = false;
        fallbackReason = "Post HF below target";
    } else if (remainingSizeWad > 0n && remainingSizeWad < minPositionSizeWad) {
        isSafe = false;
        fallbackReason = "Surviving size below minPositionSize";
    } else if (remainingSizeWad > 0n && mPostWad < minMarginRequiredWad) {
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
export function isConservativeSafePolicyB(
    params: PartialLiquidationParams
): boolean {
    const {
        s0Wad,
        m0Wad,
        deltaSWad,
        entryPrice8d,
        currentPrice8d,
        isLong,
        fundingPaymentWad,
        targetHfWad,
        liqFeeRatioBps,
        maintenanceMarginBps,
        minMarginRatioBps = maintenanceMarginBps,
        quoteDecimals,
        minPositionSizeWad
    } = params;

    const remainingSizeWad = s0Wad > deltaSWad ? s0Wad - deltaSWad : 0n;
    if (deltaSWad <= 0n || deltaSWad >= s0Wad) return false;

    const baseState = evaluateBasePosition(
        s0Wad,
        m0Wad,
        entryPrice8d,
        currentPrice8d,
        isLong,
        fundingPaymentWad,
        maintenanceMarginBps,
        quoteDecimals
    );

    if (!baseState.isLiquidatable) return false;

    const currentPriceWad = currentPrice8d * ORACLE_NORM_FACTOR;
    const entryPriceWad = entryPrice8d * ORACLE_NORM_FACTOR;

    // Exact effective native charges
    const notionalClosedWad = calculateNotionalQuoteWad(deltaSWad, currentPriceWad);
    const nominalPenaltyWad = mulDivCeil(notionalClosedWad, liqFeeRatioBps, 10000n);
    const penaltyNative = wadToNativeQuoteCeil(nominalPenaltyWad, quoteDecimals);
    const effectivePenaltyWad = nativeQuoteToWad(penaltyNative, quoteDecimals);

    const pnlClosedWad = calculateUnrealizedPnlWad(deltaSWad, entryPriceWad, currentPriceWad, isLong);
    let effectiveClosedLossWad = 0n;
    let effectiveClosedProfitWad = 0n;
    if (pnlClosedWad < 0n) {
        const nominalClosedLossWad = abs(pnlClosedWad);
        const closedLossNative = wadToNativeQuoteCeil(nominalClosedLossWad, quoteDecimals);
        effectiveClosedLossWad = nativeQuoteToWad(closedLossNative, quoteDecimals);
    } else if (pnlClosedWad > 0n) {
        const nominalClosedProfitWad = pnlClosedWad;
        const closedProfitNative = wadToNativeQuote(nominalClosedProfitWad, quoteDecimals);
        effectiveClosedProfitWad = nativeQuoteToWad(closedProfitNative, quoteDecimals);
    }

    const uWad = baseState.unpaidFundingWad;
    const m1Wad = baseState.m1Wad;

    // Conservative Upper Bound on Closed Obligations (+1 wei for division domination)
    const totalObligationsUpperWad = effectiveClosedLossWad + uWad + effectivePenaltyWad + 1n;

    // Unpaid funding cure check
    if (uWad > (m1Wad + effectiveClosedProfitWad)) return false;

    // Realized obligations breach check
    if (totalObligationsUpperWad > (m1Wad + effectiveClosedProfitWad)) return false;

    // Conservative Surviving Stored Margin Lower Bound
    let mPostLowerWad = 0n;
    if (pnlClosedWad > 0n) {
        mPostLowerWad = (m1Wad + effectiveClosedProfitWad) >= totalObligationsUpperWad
            ? (m1Wad + effectiveClosedProfitWad - totalObligationsUpperWad)
            : 0n;
    } else {
        mPostLowerWad = m1Wad >= totalObligationsUpperWad ? m1Wad - totalObligationsUpperWad : 0n;
    }

    // Conservative Requirements Upper Bounds
    const remainingNotionalWad = calculateNotionalQuoteWad(remainingSizeWad, currentPriceWad);
    const mmRemainingUpperWad = mulDivCeil(remainingNotionalWad, maintenanceMarginBps, 10000n) + 1n;
    const minMarginRequiredUpperWad = mulDivCeil(remainingNotionalWad, minMarginRatioBps, 10000n) + 1n;

    if (mPostLowerWad < minMarginRequiredUpperWad) return false;
    if (remainingSizeWad < minPositionSizeWad) return false;

    // Conservative Surviving Equity Lower Bound
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const equityLowerWad = mPostLowerWad + pnlRemainingWad - 1n;

    if (equityLowerWad <= 0n) return false;

    // Conservative Health Factor Lower Bound
    const hfConsWad = calculateHealthFactorWad(equityLowerWad, mmRemainingUpperWad);
    return hfConsWad >= targetHfWad;
}

/**
 * Exhaustive Minimum Safe Size Solver over small integer domains (TEST / RESEARCH ONLY).
 * Iterates sequentially through all integer step units to find the exact minimum safe size
 * without relying on binary search over non-monotonic predicates.
 */
export function findMinimumSafePolicyBSizeExhaustive(
    params: Omit<PartialLiquidationParams, "deltaSWad" | "policy">,
    stepWad: bigint = WAD
): PartialSizingRecommendation {
    const baseState = evaluateBasePosition(
        params.s0Wad,
        params.m0Wad,
        params.entryPrice8d,
        params.currentPrice8d,
        params.isLong,
        params.fundingPaymentWad,
        params.maintenanceMarginBps,
        params.quoteDecimals
    );

    if (!baseState.isLiquidatable) {
        return {
            recommendedDeltaSWad: 0n,
            mode: SizingMode.NONE,
            willFullyLiquidate: false,
            fallbackReason: "Position not liquidatable",
            evaluationCount: 0
        };
    }

    const maxPartial = params.minPositionSizeWad > 0n && params.s0Wad > params.minPositionSizeWad
        ? params.s0Wad - params.minPositionSizeWad
        : params.s0Wad - 1n;

    let evalCount = 0;
    for (let x = stepWad; x <= maxPartial; x += stepWad) {
        evalCount++;
        const sim = simulatePartialLiquidation({ ...params, deltaSWad: x, policy: CollateralPolicy.POLICY_B });
        if (sim.isSafe) {
            return {
                recommendedDeltaSWad: x,
                mode: SizingMode.PARTIAL_CONSERVATIVE,
                willFullyLiquidate: false,
                partialResult: sim,
                evaluationCount: evalCount
            };
        }
    }

    return {
        recommendedDeltaSWad: params.s0Wad,
        mode: SizingMode.FULL_FALLBACK,
        willFullyLiquidate: true,
        fallbackReason: "Full liquidation fallback required — no safe size found in domain",
        evaluationCount: evalCount
    };
}

/**
 * Quarantined/retired binary search solver. Returns FULL_FALLBACK by default to reflect
 * non-monotonicity of exact/conservative safety predicates.
 */
export function findMinimumSafePolicyBSize(
    params: Omit<PartialLiquidationParams, "deltaSWad" | "policy">
): PartialSizingRecommendation {
    const baseState = evaluateBasePosition(
        params.s0Wad,
        params.m0Wad,
        params.entryPrice8d,
        params.currentPrice8d,
        params.isLong,
        params.fundingPaymentWad,
        params.maintenanceMarginBps,
        params.quoteDecimals
    );

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
export function findMinimumSafePartialSize(
    params: Omit<PartialLiquidationParams, "deltaSWad">
): PartialSizingRecommendation {
    return findMinimumSafePolicyBSize(params);
}
