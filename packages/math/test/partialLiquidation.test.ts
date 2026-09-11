import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    WAD,
    simulatePartialLiquidation,
    isConservativeSafePolicyB,
    findMinimumSafePolicyBSize,
    findMinimumSafePolicyBSizeExhaustive,
    findMinimumSafePartialSize,
    evaluateBasePosition,
    CollateralPolicy,
    SizingMode,
    type PartialLiquidationParams
} from "../dist/index.js";

describe("Partial Liquidation Feasibility Suite (Prompt 07C-A-R2 Vectors A - P + Parity Suite)", () => {

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
            currentPrice8d: 2010_00000000n, // PnL_closed = +20 WAD
            isLong: true,
            fundingPaymentWad: 1000n * WAD, // Funding payment = 1000, M0 = 100 => M1 = 0, U = 900 WAD
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        // nominalClosedNetPnl = +20 - 900 = -880 WAD (net deficit)
        // M1 = 0, effectiveClosedNetDeficit = 880 WAD => totalClosedObligations = 880 + penalty > M1 => external bad debt required!
        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, false);
        assert.equal(res.nominalClosedNetPnlWad, -880n * WAD);
        assert.equal(res.externalBadDebtRequired, true);
        assert.equal(res.fallbackReason, "External bad debt required / closed obligations breach collateral");
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

    test("Vector N: True 6d native minimum size boundary test via small-domain exhaustive search", () => {
        const params6dBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 6,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const minResult = findMinimumSafePolicyBSizeExhaustive(params6dBase, WAD / 10n);
        assert.equal(minResult.willFullyLiquidate, false);
        assert.equal(minResult.mode, SizingMode.PARTIAL_GRID_RESEARCH);
        const xStar = minResult.recommendedDeltaSWad;

        const simAtXStar = simulatePartialLiquidation({ ...params6dBase, deltaSWad: xStar, policy: CollateralPolicy.POLICY_B });
        assert.equal(simAtXStar.isSafe, true);

        const simBelow = simulatePartialLiquidation({ ...params6dBase, deltaSWad: xStar - (WAD / 10n), policy: CollateralPolicy.POLICY_B });
        assert.equal(simBelow.isSafe, false);
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

    // ============ NEW R2 VECTORS ============

    test("LIQ-PART-A-PENSHORT1: Policy A positive PnL penalty shortfall accounting", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD, // M0 = 100, M_rel = 50 for 50% close
            deltaSWad: 5n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2010_00000000n, // PnL = +100, closed PnL = +50
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_A,
            liqFeeRatioBps: 250n, // Penalty on 5*2010 = 10050 => 251.25 WAD
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        // closedAvailable = M_rel(50) + closedPnL(50) = 100 WAD.
        // effectivePenalty = 251.25 WAD > 100 WAD => shortfall = 151.25 WAD.
        // mRetained = 50 WAD < 151.25 WAD => mPost = 0 WAD.
        // Unfunded penalty = 151.25 - 50 = 101.25 WAD => residualBadDebtWad = 101.25 WAD!
        const res = simulatePartialLiquidation(params);
        assert.equal(res.traderPayoutWad, 0n);
        assert.equal(res.mPostWad, 0n);
        assert.equal(res.externalBadDebtRequired, true);
        assert.equal(res.residualBadDebtWad, 101250000000000000000n); // Exact 101.25 WAD
        assert.equal(res.isSafe, false);
    });

    test("LIQ-PART-PROFIT-NATIVE-FLOOR1: Freeze Codex P1 0d native profit floor quantization counterexample", () => {
        const profitParams: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 40n * WAD,
            deltaSWad: 175n * (WAD / 100n), // 1.75 WAD
            entryPrice8d: 100_00000000n,
            currentPrice8d: 101_00000000n, // Long price profit = 1.75 * (101 - 100) = 1.75 WAD
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 0n,
            maintenanceMarginBps: 500n,
            minMarginRatioBps: 500n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(profitParams);
        assert.equal(res.nominalClosedProfitWad, 1750000000000000000n); // 1.75 WAD
        assert.equal(res.closedProfitNative, 1n); // Floor quantized to 1 native token
        assert.equal(res.effectiveClosedProfitWad, 1n * WAD); // 1 WAD physically realizable stored profit
        assert.equal(res.nominalClosedNetPnlWad, 1750000000000000000n);
        assert.equal(res.closedNetProfitNative, 1n);
        assert.equal(res.effectiveClosedNetProfitWad, 1n * WAD);
    });

    test("LIQ-PART-NET-FUNDING-NATIVE1: Freeze Codex P1 R6 0d signed net PnL funding counterexample", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 3n * WAD,
            m0Wad: 1n * WAD,
            deltaSWad: 2n * WAD,
            entryPrice8d: 60_00000000n,
            currentPrice8d: 62_00000000n, // Long price PnL_closed = 2 * (62 - 60) = +4 WAD
            isLong: true,
            fundingPaymentWad: 11n * (WAD / 10n), // Funding debt requested = 1.1 WAD
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 0n,
            maintenanceMarginBps: 500n,
            minMarginRatioBps: 500n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n * WAD
        };

        // 1. Funding settlement: m0 = 1 WAD, debt = 1.1 WAD => 1 native token margin forfeited => m1 = 0, U = 0.1 WAD
        // 2. Closed PnL = +4 WAD
        // 3. Authoritative signed net: nominalClosedNetPnl = +4 - 0.1 = +3.9 WAD
        // 4. Native FLOOR conversion: FLOOR(3.9) = 3 native tokens => effectiveClosedNetProfitWad = 3 WAD
        // 5. mPost = m1(0) + 3 WAD = 3 WAD
        // 6. Remaining size = 1 WAD @ 62 price => notional = 62 WAD => minMargin @ 5% = 3.1 WAD
        // 7. mPost (3 WAD) < minMargin (3.1 WAD) => isSafe == false!
        const res = simulatePartialLiquidation(params);

        assert.equal(res.baseState.m1Wad, 0n);
        assert.equal(res.baseState.unpaidFundingWad, 100000000000000000n); // 0.1 WAD
        assert.equal(res.pnlClosedWad, 4n * WAD);
        assert.equal(res.nominalClosedNetPnlWad, 3900000000000000000n); // 3.9 WAD
        assert.equal(res.closedNetProfitNative, 3n); // 3 native tokens
        assert.equal(res.effectiveClosedNetProfitWad, 3n * WAD);
        assert.equal(res.mPostWad, 3n * WAD);
        assert.equal(res.minMarginRequiredWad, 3100000000000000000n); // 3.1 WAD
        assert.equal(res.isSafe, false);
        assert.equal(res.fallbackReason, "Surviving margin below minMarginRatio requirement");
    });

    test("LIQ-PART-NET-DEFICIT-NATIVE1: 0d negative closed PnL + unpaid funding signed deficit CEIL quantization", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD,
            deltaSWad: 5n * WAD,
            entryPrice8d: 100_00000000n,
            currentPrice8d: 99_50000000n, // Loss = -2.5 WAD
            isLong: true,
            fundingPaymentWad: 100n * WAD + 200000000000000000n, // M1 = 0, U = 0.2 WAD
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 0n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n * WAD
        };

        // pnlClosed = -2.5 WAD, U = 0.2 WAD
        // nominalClosedNetPnl = -2.5 - 0.2 = -2.7 WAD
        // CEIL(2.7) = 3 native tokens => effectiveClosedNetDeficitWad = 3 WAD
        const res = simulatePartialLiquidation(params);

        assert.equal(res.nominalClosedNetPnlWad, -2700000000000000000n);
        assert.equal(res.closedNetDeficitNative, 3n);
        assert.equal(res.effectiveClosedNetDeficitWad, 3n * WAD);
    });

    test("LIQ-PART-RESEARCH-TAIL1: Freeze Codex P2 R8 tail-sampling of unaligned maxPartial on coarse research grids", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n) // minPositionSize = 0.1 WAD => maxPartial = 9.9 WAD
        };

        // Run research solver with coarse stepWad = 1 WAD (grid points = 1, 2, ..., 9 WAD)
        // 9.9 WAD is sampled as tail point and is safe!
        const rec = findMinimumSafePolicyBSizeExhaustive(paramsBase, 1n * WAD);

        assert.equal(rec.willFullyLiquidate, false);
        assert.equal(rec.mode, SizingMode.PARTIAL_GRID_RESEARCH);
        assert.equal(rec.recommendedDeltaSWad, 99n * (WAD / 10n)); // 9.9 WAD sampled via tail!
        assert.equal(rec.sampledMaxPartial, true);
        assert.equal(rec.searchExhaustive, false);
    });

    test("LIQ-PART-RESEARCH-INCONCLUSIVE1: Coarse grid miss returns RESEARCH_INCONCLUSIVE without triggering FULL_FALLBACK", () => {
        // Construct position where 9.5 WAD is safe, but grid step = 2 WAD samples {2, 4, 6, 8} which are all unsafe for 1.20 target
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 2n * WAD // maxPartial = 8 WAD
        };

        const rec = findMinimumSafePolicyBSizeExhaustive(paramsBase, 2n * WAD);

        assert.equal(rec.recommendedDeltaSWad, 0n);
        assert.equal(rec.mode, SizingMode.RESEARCH_INCONCLUSIVE);
        assert.equal(rec.willFullyLiquidate, false);
        assert.equal(rec.searchExhaustive, false);
        assert.equal(rec.fallbackReason, "No safe size found on sampled research grid; unsampled sizes may exist");
    });

    test("LIQ-PART-TARGET-HF-FLOOR1: Freeze Codex P2 R7 targetHfWad < WAD invalid target RangeError counterexample", () => {
        const codexParams: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 8n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 600000000000000000n, // Invalid target 0.60 < 1.0 (WAD)
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        assert.throws(
            () => simulatePartialLiquidation(codexParams),
            /RangeError: targetHfWad must be >= WAD/
        );

        assert.throws(
            () => isConservativeSafePolicyB(codexParams),
            /RangeError: targetHfWad must be >= WAD/
        );

        assert.throws(
            () => findMinimumSafePolicyBSizeExhaustive(codexParams, WAD / 10n),
            /RangeError: targetHfWad must be >= WAD/
        );

        assert.throws(
            () => findMinimumSafePolicyBSize(codexParams),
            /RangeError: targetHfWad must be >= WAD/
        );
    });

    test("LIQ-PART-TARGET-HF-BOUNDARY1: Boundary tests verifying targetHfWad validation across entry points", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 95n * (WAD / 10n),
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        // 1. targetHfWad = WAD - 1 -> REJECT
        const paramsBelow = { ...paramsBase, targetHfWad: WAD - 1n };
        assert.throws(() => simulatePartialLiquidation(paramsBelow), /RangeError: targetHfWad must be >= WAD/);
        assert.throws(() => isConservativeSafePolicyB(paramsBelow), /RangeError: targetHfWad must be >= WAD/);
        assert.throws(() => findMinimumSafePolicyBSizeExhaustive(paramsBelow, WAD / 10n), /RangeError: targetHfWad must be >= WAD/);

        // 2. targetHfWad = WAD -> ACCEPTED
        const paramsWad = { ...paramsBase, targetHfWad: WAD };
        assert.ok(simulatePartialLiquidation(paramsWad).isSafe);
        assert.ok(isConservativeSafePolicyB(paramsWad));
        assert.equal(findMinimumSafePolicyBSizeExhaustive(paramsWad, WAD / 10n).mode, SizingMode.PARTIAL_GRID_RESEARCH);

        // 3. targetHfWad = WAD + 1 -> ACCEPTED
        const paramsAbove = { ...paramsBase, targetHfWad: WAD + 1n };
        assert.ok(simulatePartialLiquidation(paramsAbove).isSafe);
        assert.ok(isConservativeSafePolicyB(paramsAbove));

        // 4. targetHfWad = 1.20e18 -> ACCEPTED
        const params120 = { ...paramsBase, targetHfWad: 1200000000000000000n };
        assert.ok(simulatePartialLiquidation(params120).isSafe);
        assert.ok(isConservativeSafePolicyB(params120));
    });

    test("LIQ-PART-RESEARCH-STEP1: Exhaustive research solver validates stepWad > 0", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        assert.throws(
            () => findMinimumSafePolicyBSizeExhaustive(paramsBase, 0n),
            /Invalid search stepWad: must be > 0/
        );

        assert.throws(
            () => findMinimumSafePolicyBSizeExhaustive(paramsBase, -1n),
            /Invalid search stepWad: must be > 0/
        );
    });

    test("LIQ-PART-NET-PARITY1: Property test verifying signed net physical margin quantum alignment across 0d, 6d, 18d, 24d", () => {
        const decimalsList = [0, 6, 18, 24];

        for (const quoteDecimals of decimalsList) {
            const paramsBase = {
                s0Wad: 10n * WAD,
                m0Wad: 2000n * WAD,
                entryPrice8d: 2000_00000000n,
                currentPrice8d: 1850_00000000n,
                isLong: true,
                fundingPaymentWad: 0n,
                targetHfWad: 1200000000000000000n,
                liqFeeRatioBps: 250n,
                maintenanceMarginBps: 500n,
                quoteDecimals,
                minPositionSizeWad: 1n * (WAD / 10n)
            };

            for (let step = 1n; step <= 9n; step++) {
                const x = step * WAD;
                const sim = simulatePartialLiquidation({ ...paramsBase, deltaSWad: x, policy: CollateralPolicy.POLICY_B });

                if (quoteDecimals < 18) {
                    const quantumWad = 10n ** BigInt(18 - quoteDecimals);
                    assert.equal(
                        sim.mPostWad % quantumWad,
                        0n,
                        `mPostWad quantum misalignment at quoteDecimals=${quoteDecimals}, x=${x}`
                    );
                }
            }
        }
    });

    test("LIQ-PART-HEALTHY-REC1: Healthy position returns no liquidation recommendation", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 2000_00000000n, // HF0 = 20.0 (Healthy)
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const rec = findMinimumSafePolicyBSizeExhaustive(paramsBase);
        assert.equal(rec.recommendedDeltaSWad, 0n);
        assert.equal(rec.mode, SizingMode.NONE);
        assert.equal(rec.willFullyLiquidate, false);
        assert.equal(rec.fallbackReason, "Position not liquidatable");
    });

    test("LIQ-PART-FULL-ROUTE1: Full liquidation fallback routing without simulating S0 as partial", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 100n * WAD, // Very low margin => unsolvent
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1700_00000000n, // Insolvent
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        // For stepWad > 1 (e.g. 1 WAD), coarse grid miss returns RESEARCH_INCONCLUSIVE
        const recGrid = findMinimumSafePolicyBSizeExhaustive(paramsBase, 1n * WAD);
        assert.equal(recGrid.recommendedDeltaSWad, 0n);
        assert.equal(recGrid.mode, SizingMode.RESEARCH_INCONCLUSIVE);
        assert.equal(recGrid.willFullyLiquidate, false);

        // For stepWad = 1n (true integer exhaustive scan on small domain), scan completes with FULL_FALLBACK
        const smallParamsBase = { ...paramsBase, s0Wad: 100n, m0Wad: 1n, minPositionSizeWad: 10n };
        const recExhaustive = findMinimumSafePolicyBSizeExhaustive(smallParamsBase, 1n);
        assert.equal(recExhaustive.recommendedDeltaSWad, 100n);
        assert.equal(recExhaustive.mode, SizingMode.FULL_FALLBACK);
        assert.equal(recExhaustive.willFullyLiquidate, true);

        // simulatePartialLiquidation(deltaS = S0) must reject full size
        const fullSim = simulatePartialLiquidation({ ...paramsBase, deltaSWad: 10n * WAD, policy: CollateralPolicy.POLICY_B });
        assert.equal(fullSim.isSafe, false);
        assert.equal(fullSim.fallbackReason, "Full liquidation required — outside partial model");
    });

    test("LIQ-PART-SAMPLE-GRID1: Sampled grid domain SafeB(x) behavior test", () => {
        const smallState = {
            s0Wad: 1000n * (10n ** 14n), // 0.1 WAD
            m0Wad: 20n * WAD,            // 20 WAD margin (HF0 = 0.5405)
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n // 1 wei
        };

        let foundSafe = false;

        for (let step = 1n; step <= 990n; step++) {
            const x = step * (10n ** 14n);
            const res = simulatePartialLiquidation({ ...smallState, deltaSWad: x });
            if (res.isSafe) {
                foundSafe = true;
                break;
            }
        }
        assert.ok(foundSafe);
    });

    test("LIQ-PART-NONMONO-0D1: Freeze Codex 0d native penalty non-monotonicity counterexample across Exact and Conservative predicates", () => {
        const consParams: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 180n * WAD,
            deltaSWad: 74n * (WAD / 10n),
            entryPrice8d: 100_00000000n,
            currentPrice8d: 85_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            minMarginRatioBps: 500n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n
        };

        const x1 = 7_400000000000000000n;
        const c1 = isConservativeSafePolicyB({ ...consParams, deltaSWad: x1 });

        const x2 = x1 + 1n; // 1 wei above integer boundary triggers CEIL penalty jump
        const c2 = isConservativeSafePolicyB({ ...consParams, deltaSWad: x2 });

        const x3 = 7_413000000000000000n; // Slightly higher size reduces required MM, restoring safety
        const c3 = isConservativeSafePolicyB({ ...consParams, deltaSWad: x3 });

        // ConservativeSafeB non-monotonicity: true -> false -> true
        assert.equal(c1, true);
        assert.equal(c2, false);
        assert.equal(c3, true);
    });

    test("LIQ-PART-LOSS-NATIVE-CEIL1: Freeze Codex P1 0d native closed-loss quantization counterexample", () => {
        const codexLossParams = {
            s0Wad: 33n * WAD,
            m0Wad: 6653n * WAD,
            entryPrice8d: 517_00000000n,
            currentPrice8d: 334_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n, // 1.20
            policy: CollateralPolicy.POLICY_B,
            liqFeeRatioBps: 253n,
            maintenanceMarginBps: 745n,
            minMarginRatioBps: 745n,
            quoteDecimals: 0,
            minPositionSizeWad: 1n * WAD
        };

        const deltaS = 17_400000000000000000n; // 17.4 WAD
        const res = simulatePartialLiquidation({ ...codexLossParams, deltaSWad: deltaS });

        // Nominal closed loss = 17.4 * (517 - 334) = 3184.2 WAD
        assert.equal(res.nominalClosedLossWad, 3184200000000000000000n);
        // Canonical native CEIL charge = 3185 whole tokens
        assert.equal(res.closedLossNative, 3185n);
        assert.equal(res.effectiveClosedLossWad, 3185n * WAD);

        // Under raw-WAD loss model: HF would be ~1.20049 (passing)
        // Under canonical native-loss model: HF is ~1.19843 < 1.20 => isSafe == false!
        assert.equal(res.isSafe, false);
        assert.equal(res.fallbackReason, "Post HF below target");
    });

    test("LIQ-PART-CONS-IMPLIES-EXACT1: Property test verifying ConservativeSafeB => ExactSafeB across all decimal domains", () => {
        const decimalsList = [0, 6, 18, 24];

        for (const quoteDecimals of decimalsList) {
            const paramsBase = {
                s0Wad: 10n * WAD,
                m0Wad: 2000n * WAD,
                entryPrice8d: 2000_00000000n,
                currentPrice8d: 1850_00000000n,
                isLong: true,
                fundingPaymentWad: 0n,
                targetHfWad: 1200000000000000000n,
                liqFeeRatioBps: 250n,
                maintenanceMarginBps: 500n,
                quoteDecimals,
                minPositionSizeWad: 1n * (WAD / 10n)
            };

            for (let step = 1n; step <= 99n; step++) {
                const x = step * (WAD / 10n);
                const fullParams: PartialLiquidationParams = { ...paramsBase, deltaSWad: x, policy: CollateralPolicy.POLICY_B };

                const isConsSafe = isConservativeSafePolicyB(fullParams);
                const exactRes = simulatePartialLiquidation(fullParams);

                if (isConsSafe) {
                    // Core Implication Proof Assertion: ConservativeSafeB => ExactSafeB MUST hold 100%!
                    assert.equal(exactRes.isSafe, true, `Implication breached at quoteDecimals=${quoteDecimals}, x=${x}`);
                }
            }
        }
    });

    test("LIQ-PART-OVERLIQ-EXHAUSTIVE1: Measured over-liquidation on small exhaustive research domain", () => {
        const decimalsList = [0, 6, 18, 24];

        for (const quoteDecimals of decimalsList) {
            const paramsBase = {
                s0Wad: 10n * WAD,
                m0Wad: 2000n * WAD,
                entryPrice8d: 2000_00000000n,
                currentPrice8d: 1850_00000000n,
                isLong: true,
                fundingPaymentWad: 0n,
                targetHfWad: 1200000000000000000n,
                liqFeeRatioBps: 250n,
                maintenanceMarginBps: 500n,
                quoteDecimals,
                minPositionSizeWad: 1n * (WAD / 10n)
            };

            const recExhaustive = findMinimumSafePolicyBSizeExhaustive(paramsBase, WAD / 10n);
            assert.equal(recExhaustive.mode, SizingMode.PARTIAL_GRID_RESEARCH);
            const xCandidate = recExhaustive.recommendedDeltaSWad;

            // Exhaustive linear scan for xExact over step units
            let xExact = paramsBase.s0Wad;
            const maxPartial = paramsBase.s0Wad - paramsBase.minPositionSizeWad;
            for (let x = WAD / 10n; x <= maxPartial; x += WAD / 10n) {
                const sim = simulatePartialLiquidation({ ...paramsBase, deltaSWad: x, policy: CollateralPolicy.POLICY_B });
                if (sim.isSafe) {
                    xExact = x;
                    break;
                }
            }

            assert.equal(xCandidate, xExact);
        }
    });

    test("LIQ-PART-SMALL-DOMAIN-MIN1: Small domain exhaustive minimum safe size test", () => {
        const paramsBase = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1850_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * (WAD / 10n)
        };

        const minResult = findMinimumSafePolicyBSizeExhaustive(paramsBase, WAD / 10n);
        assert.equal(minResult.willFullyLiquidate, false);
        const xStar = minResult.recommendedDeltaSWad;

        const simAtXStar = simulatePartialLiquidation({ ...paramsBase, deltaSWad: xStar, policy: CollateralPolicy.POLICY_B });
        assert.equal(simAtXStar.isSafe, true);

        const simBelow = simulatePartialLiquidation({ ...paramsBase, deltaSWad: xStar - (WAD / 10n), policy: CollateralPolicy.POLICY_B });
        assert.equal(simBelow.isSafe, false);
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
            m0Wad: 200n * WAD, // Liquidatable position (E0 = 50 WAD)
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

});
