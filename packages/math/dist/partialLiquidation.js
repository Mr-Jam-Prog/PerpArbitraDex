/**
 * Partial Liquidation Math & Feasibility Prototype (Prompt 07C-A)
 * Formally defined according to docs/ECONOMIC_SPEC.md & PROMPT 07C-A gate requirements.
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
    const { s0Wad, m0Wad, deltaSWad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, targetHfWad, policy, liqFeeRatioBps, maintenanceMarginBps, quoteDecimals, minPositionSizeWad } = params;
    const baseState = evaluateBasePosition(s0Wad, m0Wad, entryPrice8d, currentPrice8d, isLong, fundingPaymentWad, maintenanceMarginBps, quoteDecimals);
    const remainingSizeWad = s0Wad - deltaSWad;
    const currentPriceWad = currentPrice8d * ORACLE_NORM_FACTOR;
    // Sanity checks for domain
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
            mPostWad: 0n,
            pnlRemainingWad: 0n,
            equityPostWad: 0n,
            mmRemainingWad: 0n,
            hfPostWad: 0n,
            traderPayoutWad: 0n,
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
    // 3. PnL allocation
    const pnlTotalWad = baseState.pnl0Wad;
    const pnlClosedWad = mulDivFloor(pnlTotalWad, deltaSWad, s0Wad);
    const pnlRemainingWad = pnlTotalWad - pnlClosedWad;
    const mmRemainingWad = calculateMaintenanceMarginWad(remainingSizeWad, currentPriceWad, maintenanceMarginBps);
    let mPostWad = 0n;
    let traderPayoutWad = 0n;
    let equityPostWad = 0n;
    const m1Wad = baseState.m1Wad;
    const uWad = baseState.unpaidFundingWad;
    if (policy === CollateralPolicy.POLICY_A) {
        // Proportional margin release
        const mRelWad = mulDivFloor(m1Wad, deltaSWad, s0Wad);
        const mRetainedWad = m1Wad - mRelWad;
        const netClosedWad = pnlClosedWad - uWad;
        if (netClosedWad >= 0n) {
            const payout = mRelWad + netClosedWad - effectivePenaltyWad;
            mPostWad = mRetainedWad;
            traderPayoutWad = payout > 0n ? payout : 0n;
        }
        else {
            const deficitWad = abs(netClosedWad);
            const totalChargeWad = deficitWad + effectivePenaltyWad;
            if (mRelWad >= totalChargeWad) {
                traderPayoutWad = mRelWad - totalChargeWad;
                mPostWad = mRetainedWad;
            }
            else {
                traderPayoutWad = 0n;
                const extraWad = totalChargeWad - mRelWad;
                mPostWad = mRetainedWad >= extraWad ? mRetainedWad - extraWad : 0n;
            }
        }
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    else if (policy === CollateralPolicy.POLICY_B) {
        // Retain collateral on surviving position
        traderPayoutWad = 0n;
        const lossClosedWad = pnlClosedWad < 0n ? abs(pnlClosedWad) : 0n;
        const totalDebitsWad = lossClosedWad + uWad + effectivePenaltyWad;
        if (pnlClosedWad > 0n) {
            mPostWad = (m1Wad + pnlClosedWad) >= (uWad + effectivePenaltyWad) ? (m1Wad + pnlClosedWad - uWad - effectivePenaltyWad) : 0n;
        }
        else {
            mPostWad = m1Wad >= totalDebitsWad ? m1Wad - totalDebitsWad : 0n;
        }
        equityPostWad = mPostWad + pnlRemainingWad;
    }
    else if (policy === CollateralPolicy.POLICY_C_C) {
        // Hybrid with return safe surplus
        const targetEquityReqWad = mulDivCeil(mmRemainingWad, targetHfWad, WAD);
        const lossClosedWad = pnlClosedWad < 0n ? abs(pnlClosedWad) : 0n;
        let maxMPostWad = 0n;
        if (pnlClosedWad > 0n) {
            maxMPostWad = (m1Wad + pnlClosedWad) >= (uWad + effectivePenaltyWad) ? (m1Wad + pnlClosedWad - uWad - effectivePenaltyWad) : 0n;
        }
        else {
            maxMPostWad = m1Wad >= (lossClosedWad + uWad + effectivePenaltyWad) ? m1Wad - (lossClosedWad + uWad + effectivePenaltyWad) : 0n;
        }
        const availEquityWad = maxMPostWad + pnlRemainingWad;
        if (availEquityWad <= targetEquityReqWad) {
            mPostWad = maxMPostWad;
            traderPayoutWad = 0n;
            equityPostWad = availEquityWad;
        }
        else {
            const surplusWad = availEquityWad - targetEquityReqWad;
            traderPayoutWad = surplusWad;
            mPostWad = maxMPostWad >= surplusWad ? maxMPostWad - surplusWad : 0n;
            equityPostWad = targetEquityReqWad;
        }
    }
    const hfPostWad = calculateHealthFactorWad(equityPostWad, mmRemainingWad);
    // Fallback conditions evaluation
    let isSafe = true;
    let fallbackReason = undefined;
    const lossClosedWad = pnlClosedWad < 0n ? abs(pnlClosedWad) : 0n;
    if (uWad > 0n && m1Wad + (pnlClosedWad > 0n ? pnlClosedWad : 0n) < lossClosedWad + uWad) {
        isSafe = false;
        fallbackReason = "Residual unpaid funding uncured";
    }
    else if (equityPostWad <= 0n) {
        isSafe = false;
        fallbackReason = "Post equity non-positive / insolvent";
    }
    else if (hfPostWad < targetHfWad) {
        isSafe = false;
        fallbackReason = "Post HF below target";
    }
    else if (remainingSizeWad < minPositionSizeWad && remainingSizeWad > 0n) {
        isSafe = false;
        fallbackReason = "Surviving size below minPositionSize";
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
        mPostWad,
        pnlRemainingWad,
        equityPostWad,
        mmRemainingWad,
        hfPostWad,
        traderPayoutWad,
        isSafe,
        fallbackReason
    };
}
