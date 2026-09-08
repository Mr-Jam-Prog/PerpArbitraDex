import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    WAD,
    simulatePartialLiquidation,
    findMinimumSafePartialSize,
    evaluateBasePosition,
    CollateralPolicy,
    type PartialLiquidationParams
} from "../dist/index.js";

describe("Partial Liquidation Feasibility Suite (Prompt 07C-A-R1 Vectors A - P + Parity Suite)", () => {

    test("Vector A: Long price-loss liquidation", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n), // 9.5 WAD closed (95%)
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n, // PnL = -1500
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n, // 1.20
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n) // 0.1 WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, true);
        assert.ok(res.hfPostWad > res.baseState.hf0Wad);
        assert.ok(res.hfPostWad >= 1200000000000000000n);
        assert.equal(res.unpaidFundingAfterWad, 0n);
        assert.equal(res.externalBadDebtRequired, false);
        assert.ok(res.isSafe);
    });

    test("Vector B: Short price-loss liquidation", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2100n * WAD, // E0 = 600 > P_full (537.5)
            deltaSWad: 95n * (WAD / 10n), // 9.5 WAD closed (95%)
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2150_00000000n, // PnL = -1500
            isLong: false,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, true);
        assert.ok(res.hfPostWad > res.baseState.hf0Wad);
        assert.ok(res.hfPostWad >= 1200000000000000000n);
        assert.equal(res.unpaidFundingAfterWad, 0n);
        assert.equal(res.externalBadDebtRequired, false);
        assert.ok(res.isSafe);
    });

    test("Vector C: Positive trading PnL but funding-driven liquidation", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 1000n * WAD,
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2050_00000000n, // PnL = +500
            isLong: true,
            fundingPaymentWad: 1100n * WAD, // Funding payment > M0
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, true);
        assert.equal(res.baseState.m1Wad, 0n);
        assert.equal(res.baseState.unpaidFundingWad, 100n * WAD);
        assert.ok(res.pnlClosedWad > 0n);
        // Closed PnL = +250 cures U = 100 => unpaidFundingAfterWad = 0
        assert.equal(res.unpaidFundingAfterWad, 0n);
        assert.ok(res.equityPostWad > 0n);
    });

    test("Vector D: Residual unpaid funding failure fallback", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD,
            deltaSWad: 2n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2010_00000000n, // PnL = +100
            isLong: true,
            fundingPaymentWad: 1000n * WAD, // Funding payment = 1000, M0 = 100 => U = 900
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, false);
        assert.ok(res.unpaidFundingAfterWad > 0n);
        assert.equal(res.fallbackReason, "Residual unpaid funding uncured");
    });

    test("Vector E: Penalty makes naïve size insufficient", () => {
        const paramsNaive: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 8n * WAD, // Naïve size yields HF_post = 0.7027 < 1.20
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const resNaive = simulatePartialLiquidation(paramsNaive);
        assert.equal(resNaive.isSafe, false);
        assert.equal(resNaive.fallbackReason, "Post HF below target");

        const paramsAdjusted = { ...paramsNaive, deltaSWad: 95n * (WAD / 10n) }; // 9.5 WAD
        const resAdjusted = simulatePartialLiquidation(paramsAdjusted);
        assert.equal(resAdjusted.isSafe, true);
        assert.ok(resAdjusted.hfPostWad >= 1200000000000000000n);
    });

    test("Vector F: 6-decimal quote boundary", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n),
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 6,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.ok(res.penaltyNative > 0n);
        assert.ok(res.effectivePenaltyWad >= res.nominalPenaltyWad);
        assert.equal(res.isSafe, true);
    });

    test("Vector G: 0-decimal quote boundary", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n),
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.ok(res.effectivePenaltyWad >= res.nominalPenaltyWad);
        assert.equal(res.isSafe, true);
    });

    test("Vector H: Real 24-decimal quote token support", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n),
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 24,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.ok(res.penaltyNative > 0n);
        assert.ok(res.effectivePenaltyWad >= res.nominalPenaltyWad);
        assert.equal(res.isSafe, true);
    });

    test("Vector I: Near-full required repair", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 1400n * WAD, // E0 = 500 > P_full (477.5)
            deltaSWad: 97n * (WAD / 10n), // 9.7 WAD (97% close required to restore HF to >= 1.20)
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1910_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 100000000000000000n // 0.1 WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, true);
        assert.ok(res.hfPostWad >= 1200000000000000000n);
    });

    test("Vector J: Proportional collateral withdrawal leaves ideal HF unchanged", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_A,
            liqFeeRatioBps: 0n, // Zero penalty to test ideal case
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        // In ideal continuous zero-penalty case, Policy A HF_post equals HF_pre exactly!
        assert.equal(res.hfPostWad, res.baseState.hf0Wad);
    });

    test("Vector K: Penalty makes Policy A HF worse when shortfall consumes retained margin", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD, // M0 = 2000, hf0 = 0.2197
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1820_00000000n, // PnL = -1800, closed loss = 900
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_A,
            liqFeeRatioBps: 250n, // 2.5% penalty = 227.5
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.ok(res.hfPostWad < res.baseState.hf0Wad);
    });

    test("Vector L: Retain-collateral policy improves HF", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n),
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.ok(res.hfPostWad > res.baseState.hf0Wad);
    });

    test("Vector M: Policy C-C safe surplus on genuinely liquidatable position", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD, // E0 = 500 > P_full (462.5), HF0 = 0.5405 < 1.0 (Liquidatable)
            deltaSWad: 98n * (WAD / 10n), // 9.8 WAD (98% close)
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n, // PnL0 = -1500
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_C_C,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const resB = simulatePartialLiquidation({ ...params, policy: CollateralPolicy.POLICY_B });
        assert.equal(resB.baseState.isLiquidatable, true);
        assert.ok(resB.hfPostWad > 1200000000000000000n);

        const resC = simulatePartialLiquidation(params);
        assert.equal(resC.baseState.isLiquidatable, true);
        assert.equal(resC.isSafe, true);
        assert.ok(resC.traderPayoutWad > 0n);
        assert.ok(resC.hfPostWad >= 1200000000000000000n);
    });

    test("Vector N: True 6d native minimum size boundary test", () => {
        const params6dBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 6,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const minResult = findMinimumSafePartialSize(params6dBase);
        assert.equal(minResult.willFullyLiquidate, false);
        const xStar = minResult.recommendedDeltaSWad;

        const resStar = simulatePartialLiquidation({ ...params6dBase, deltaSWad: xStar });
        assert.equal(resStar.isSafe, true);

        const baseQuantum = 10n ** 14n; // 0.0001 WAD base size quantum
        const resBelow = simulatePartialLiquidation({ ...params6dBase, deltaSWad: xStar - baseQuantum });
        assert.equal(resBelow.isSafe, false);
    });

    test("Vector O: Dust fallback due to surviving size below minPositionSize", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n), // 9.5 WAD closed, surviving = 0.5 WAD
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD // minPositionSize = 1 WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, false);
        assert.equal(res.fallbackReason, "Surviving size below minPositionSize");
    });

    test("Vector P: Explicit external bad-debt fallback", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD, // Low margin
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1700_00000000n, // Huge loss (-3000)
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, false);
        assert.ok(res.residualBadDebtWad > 0n);
        assert.equal(res.externalBadDebtRequired, true);
        assert.equal(res.fallbackReason, "External bad debt required / closed obligations breach collateral");
    });

    // ============ EXTRA PARITY & DESTRUCTION VECTORS ============

    test("Extra 1: Discrete rounding Policy A micro-improvement counterexample", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 1000n * WAD + 1n, // 1 wei extra
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1820_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_A,
            liqFeeRatioBps: 0n, // zero penalty to isolate rounding
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        // Floor rounding on M_rel leaves 1 wei dust on M_retained => hfPost > hf0 by discrete dust!
        assert.ok(res.hfPostWad >= res.baseState.hf0Wad);
    });

    test("Extra 2: Policy A native margin release parity", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 3n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_A,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 6,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.mPostWad % 10n**12n, 0n);
    });

    test("Extra 3: Direct PnL calculation vs proportional full PnL allocation residual", () => {
        const s0Wad = 1000000000000000003n; // 1.000000000000000003 WAD
        const deltaSWad = 333333333333333333n; // ~1/3 WAD
        const entryPrice8d = 2000_00000001n;
        const currentPrice8d = 1850_00000000n;

        const params: PartialLiquidationParams = {
            s0Wad,
            m0Wad: 200n * WAD, // Liquidatable position
            deltaSWad,
            entryPrice8d,
            currentPrice8d,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, true);
        assert.ok(res.pnlClosedWad !== 0n);
        assert.ok(res.pnlRemainingWad !== 0n);
        assert.ok(res.pnlRoundingResidualWad !== 0n);
    });

    test("Extra 4: Joint closed-slice obligation test (positive PnL + funding + penalty)", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD, // Low margin m1 = 100
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2020_00000000n, // Closed PnL = +100
            isLong: true,
            fundingPaymentWad: 150n * WAD, // Funding debt = 150 => M1 = 0, U = 50
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n, // Penalty on 5*2020 = 10100 => 252.5
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        // Available realized resources = m1(0) + PnL_closed(100) = 100.
        // Closed obligations = U(50) + Penalty(252.5) = 302.5 > 100.
        // Resources cover U (100 >= 50), but breach U + Penalty (100 < 302.5)!
        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, false);
        assert.equal(res.externalBadDebtRequired, true);
        assert.ok(res.residualBadDebtWad > 0n);
    });

    test("Extra 5: Healthy position rejection", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2000_00000000n, // HF0 = 20.0 (Healthy)
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, false);
        assert.equal(res.isSafe, false);
        assert.equal(res.fallbackReason, "Position not liquidatable");
    });

    test("LIQ-PART-REF-MIN1: Minimum safe size minimality test", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const minResult = findMinimumSafePartialSize(paramsBase);
        assert.equal(minResult.willFullyLiquidate, false);
        const xStar = minResult.recommendedDeltaSWad;

        const resStar = simulatePartialLiquidation({ ...paramsBase, deltaSWad: xStar });
        assert.equal(resStar.isSafe, true);

        const quantum = 10n ** 14n;
        const resBelow = simulatePartialLiquidation({ ...paramsBase, deltaSWad: xStar - quantum });
        assert.equal(resBelow.isSafe, false);
    });

});
