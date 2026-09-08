/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A-R1)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A-R1 requirements.
 */
import { WAD, ORACLE_NORM_FACTOR, mulDivFloor, mulDivCeil, abs, wadToNativeQuote, wadToNativeQuoteCeil, nativeQuoteToWad, calculateNotionalQuoteWad, calculateUnrealizedPnlWad, calculateMaintenanceMarginWad, calculateHealthFactorWad } from "./referenceModel.js";
export var CollateralPolicy;
(function (CollateralPolicy) {
    CollateralPolicy["POLICY_A"] = "POLICY_A";
    CollateralPolicy["POLICY_B"] = "POLICY_B";
    CollateralPolicy["POLICY_C_C"] = "POLICY_C_C"; // Hybrid attribution: retain required collateral for target HF, return safe surplus
})(CollateralPolicy || (CollateralPolicy = {}));
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
 */
export function simulatePartialLiquidation(params) {
    const { s0Wad, m0Wad, deltaSWad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, targetHfWad, policy, liqFeeRatioBps, maintenanceMarginBps, minMarginRatioBps = maintenanceMarginBps, quoteDecimals, minPositionSizeWad } = params;
    const baseState = evaluateBasePosition(s0Wad, m0Wad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, maintenanceMarginBps, quoteDecimals);
    const remainingSizeWad = s0Wad - deltaSWad;
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
    // Domain bounds check
    if (deltaSWad <= 0n || deltaSWad > s0Wad) {
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
            fallbackReason: "Invalid deltaS domain"
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
    // 3. Direct PnL calculations (canonical rule)
    const pnlClosedWad = calculateUnrealizedPnlWad(deltaSWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRemainingWad = calculateUnrealizedPnlWad(remainingSizeWad, entryPriceWad, currentPriceWad, isLong);
    const pnlRoundingResidualWad = baseState.pnl0Wad - (pnlClosedWad + pnlRemainingWad);
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
    // Closed-slice obligation vs realized resources
    const lossClosedWad = pnlClosedWad < 0n ? abs(pnlClosedWad) : 0n;
    const totalClosedObligationsWad = lossClosedWad + uWad + effectivePenaltyWad;
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
        if (netClosedWad >= 0n) {
            const payoutWad = effectiveReleasedWad + netClosedWad - effectivePenaltyWad;
            mPostWad = mRetainedWad;
            const payoutNative = wadToNativeQuote(payoutWad > 0n ? payoutWad : 0n, quoteDecimals);
            traderPayoutWad = nativeQuoteToWad(payoutNative, quoteDecimals);
        }
        else {
            const deficitWad = abs(netClosedWad);
            const totalChargeWad = deficitWad + effectivePenaltyWad;
            if (effectiveReleasedWad >= totalChargeWad) {
                const payoutWad = effectiveReleasedWad - totalChargeWad;
                mPostWad = mRetainedWad;
                const payoutNative = wadToNativeQuote(payoutWad, quoteDecimals);
                traderPayoutWad = nativeQuoteToWad(payoutNative, quoteDecimals);
            }
            else {
                traderPayoutWad = 0n;
                const extraWad = totalChargeWad - effectiveReleasedWad;
                mPostWad = mRetainedWad >= extraWad ? mRetainedWad - extraWad : 0n;
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
 * Finds the minimum safe partial liquidation size using continuous analytical seed + tight discrete verification.
 */
export function findMinimumSafePartialSize(params) {
    const baseState = evaluateBasePosition(params.s0Wad, params.m0Wad, params.entryPrice8d, params.currentPrice8d, params.isLong, params.fundingPaymentWad, params.maintenanceMarginBps, params.quoteDecimals);
    if (!baseState.isLiquidatable) {
        const fullRes = simulatePartialLiquidation({ ...params, deltaSWad: params.s0Wad });
        return {
            recommendedDeltaSWad: params.s0Wad,
            willFullyLiquidate: true,
            result: fullRes,
            fallbackReason: "Position not liquidatable"
        };
    }
    // Continuous analytical seed bound under Policy B:
    // x* = (HF_target * MMR * P * S - E) / (P * (HF_target * MMR - liqFeeRatio))
    const currentPriceWad = params.currentPrice8d * ORACLE_NORM_FACTOR;
    const mmrWad = mulDivFloor(WAD, params.maintenanceMarginBps, 10000n);
    const liqFeeWad = mulDivFloor(WAD, params.liqFeeRatioBps, 10000n);
    const targetMmRatioWad = mulDivFloor(params.targetHfWad, mmrWad, WAD);
    const targetMmQuoteWad = mulDivFloor(baseState.mm0Wad, params.targetHfWad, WAD);
    const numWad = targetMmQuoteWad - baseState.equity0Wad;
    const denRateWad = targetMmRatioWad - liqFeeWad; // MMR * HF_target - liqFeeRatio
    const denWad = mulDivFloor(currentPriceWad, denRateWad, WAD);
    let seedDeltaSWad = params.s0Wad;
    if (numWad > 0n && denWad > 0n) {
        seedDeltaSWad = mulDivCeil(numWad, WAD, denWad);
    }
    const quantum = 10n ** 14n; // Base size step quantum (0.0001 WAD base size)
    let stepDeltaS = seedDeltaSWad > 0n ? seedDeltaSWad : quantum;
    if (stepDeltaS > params.s0Wad)
        stepDeltaS = params.s0Wad;
    let res = simulatePartialLiquidation({ ...params, deltaSWad: stepDeltaS });
    // Step up if seed was slightly under due to rounding
    while (!res.isSafe && stepDeltaS < params.s0Wad) {
        stepDeltaS += quantum;
        if (stepDeltaS >= params.s0Wad) {
            stepDeltaS = params.s0Wad;
            res = simulatePartialLiquidation({ ...params, deltaSWad: stepDeltaS });
            break;
        }
        res = simulatePartialLiquidation({ ...params, deltaSWad: stepDeltaS });
    }
    // Step down to find tightest minimal x* such that x* is safe and x* - quantum is unsafe
    if (res.isSafe && stepDeltaS < params.s0Wad) {
        while (stepDeltaS > quantum) {
            const prevDeltaS = stepDeltaS - quantum;
            const prevRes = simulatePartialLiquidation({ ...params, deltaSWad: prevDeltaS });
            if (prevRes.isSafe) {
                stepDeltaS = prevDeltaS;
                res = prevRes;
            }
            else {
                break;
            }
        }
        return {
            recommendedDeltaSWad: stepDeltaS,
            willFullyLiquidate: false,
            result: res
        };
    }
    // Fallback to FULL liquidation
    const fullRes = simulatePartialLiquidation({ ...params, deltaSWad: params.s0Wad });
    return {
        recommendedDeltaSWad: params.s0Wad,
        willFullyLiquidate: true,
        result: fullRes,
        fallbackReason: res.fallbackReason || "Full liquidation fallback required"
    };
}
