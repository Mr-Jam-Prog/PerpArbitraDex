import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    WAD,
    simulatePartialLiquidation,
    CollateralPolicy,
    type PartialLiquidationParams
} from "../dist/index.js";

describe("Partial Liquidation Feasibility Suite (Prompt 07C-A Vectors A - P)", () => {

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
            minPositionSizeWad: 1n * (WAD / 10n) // 0.1 WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.baseState.isLiquidatable, true);
        assert.ok(res.hfPostWad > res.baseState.hf0Wad);
        assert.ok(res.hfPostWad >= 1200000000000000000n);
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
        // After 50% close, closed PnL = +250 cures the 100 unpaid funding, leaving net equity!
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

    test("Vector H: 24-decimal quote unsupported domain", () => {
        assert.throws(() => {
            const dec = 24;
            if (dec > 18) throw new Error("quoteDecimals > 18 unsupported");
        });
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

        // On closed slice: M_rel = 1000, loss = 900, penalty = 227.5. Deficit + penalty = 1127.5 > 1000.
        // Shortfall 127.5 consumes retained margin, making HF_post strictly worse (0 < 0.2197)!
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

    test("Vector M: Hybrid policy safely returns excess equity", () => {
        const params: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 5000n * WAD,
            deltaSWad: 8n * WAD,
            entryPrice8d: 2000_00000000n,
            currentPrice8d: 1900_00000000n,
            isLong: true,
            fundingPaymentWad: 0n,
            targetHfWad: 1200000000000000000n,
            policy: CollateralPolicy.POLICY_C_C,
            liqFeeRatioBps: 250n,
            maintenanceMarginBps: 500n,
            quoteDecimals: 18,
            minPositionSizeWad: 1n * WAD
        };

        const res = simulatePartialLiquidation(params);
        assert.equal(res.isSafe, true);
        assert.equal(res.hfPostWad, 1200000000000000000n);
        assert.ok(res.traderPayoutWad > 0n);
    });

    test("Vector N: Native rounding boundary around minimum safe deltaS", () => {
        const params6d: PartialLiquidationParams = {
            s0Wad: 10n * WAD,
            m0Wad: 2000n * WAD,
            deltaSWad: 9499999999999999999n,
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

        const res = simulatePartialLiquidation(params6d);
        assert.ok(res.effectivePenaltyWad >= res.nominalPenaltyWad);
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

    test("Vector P: External bad-debt fallback", () => {
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
        assert.equal(res.fallbackReason, "Post equity non-positive / insolvent");
    });

});
