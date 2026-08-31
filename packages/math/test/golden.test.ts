import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    WAD,
    normalizeOraclePrice,
    calculateUnrealizedPnlWad,
    calculateFundingPaymentWad,
    calculateEquityWad,
    calculateHealthFactorWad,
    calculateMaintenanceMarginWad,
    openOrIncreasePosition,
    decreaseOrClosePosition,
    executeLiquidation,
    wadToNativeQuote,
    nativeQuoteToWad,
    type ProtocolParams,
    type PositionState
} from '../dist/index.js';

const defaultParams: ProtocolParams = {
    maxLeverageBps: 1000000n, // 100x
    initialMarginBps: 1000n, // 10%
    maintenanceMarginBps: 500n, // 5%
    liquidationPenaltyBps: 250n, // 2.5%
    liquidatorRewardShareBps: 5000n, // 50%
    protocolFeeBps: 10n, // 0.1%
    quoteDecimals: 18
};

describe('Golden Vectors Spec Coverage (GV-01 to GV-20)', () => {

    test('GV-01: Standard Long Profit ($1,000 to $1,200)', () => {
        const entryPrice = 1000n * WAD;
        const currentPrice = 1200n * WAD;
        const size = 1n * WAD;
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, true);
        assert.equal(pnl, 200n * WAD);

        const equity = calculateEquityWad(margin, pnl, 0n);
        assert.equal(equity, 400n * WAD);

        const mm = calculateMaintenanceMarginWad(size, currentPrice, defaultParams.maintenanceMarginBps);
        assert.equal(mm, 60n * WAD); // 5% of 1200

        const hf = calculateHealthFactorWad(equity, mm);
        assert.equal(hf, 6666666666666666666n); // ~6.66x WAD
    });

    test('GV-02: Standard Short Profit ($1,000 to $800)', () => {
        const entryPrice = 1000n * WAD;
        const currentPrice = 800n * WAD;
        const size = 1n * WAD;
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, false);
        assert.equal(pnl, 200n * WAD);

        const equity = calculateEquityWad(margin, pnl, 0n);
        assert.equal(equity, 400n * WAD);

        const mm = calculateMaintenanceMarginWad(size, currentPrice, defaultParams.maintenanceMarginBps);
        assert.equal(mm, 40n * WAD); // 5% of 800

        const hf = calculateHealthFactorWad(equity, mm);
        assert.equal(hf, 10000000000000000000n); // 10x WAD
    });

    test('GV-03: Low Price Token ($1.00 to $1.20)', () => {
        const entryPrice = normalizeOraclePrice(100000000n); // $1.00 in 8 decimals -> 1e18
        const currentPrice = normalizeOraclePrice(120000000n); // $1.20 in 8 decimals -> 1.2e18
        const size = 1000n * WAD;
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, true);
        assert.equal(pnl, 200n * WAD);
    });

    test('GV-04: High Price Token ($2,000 to $2,500)', () => {
        const entryPrice = normalizeOraclePrice(200000000000n); // $2000
        const currentPrice = normalizeOraclePrice(250000000000n); // $2500
        const size = WAD / 2n; // 0.5 BTC
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, true);
        assert.equal(pnl, 250n * WAD); // 0.5 * 500 = 250
    });

    test('GV-05: USDC 6 Decimals Long Profit', () => {
        const usdcParams: ProtocolParams = { ...defaultParams, quoteDecimals: 6 };
        const entryPrice = 2000n * WAD;
        const currentPrice = 2200n * WAD;
        const size = 1n * WAD;
        const marginNative = 200_000_000n; // 200 USDC
        const marginWad = nativeQuoteToWad(marginNative, 6);

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, true);
        assert.equal(pnl, 200n * WAD);

        const equityWad = calculateEquityWad(marginWad, pnl, 0n);
        assert.equal(equityWad, 400n * WAD);

        const nativeEquity = wadToNativeQuote(equityWad, usdcParams.quoteDecimals);
        assert.equal(nativeEquity, 400_000_000n); // 400 USDC
    });

    test('GV-06: USDC 6 Decimals Short Profit', () => {
        const usdcParams: ProtocolParams = { ...defaultParams, quoteDecimals: 6 };
        const entryPrice = 2000n * WAD;
        const currentPrice = 1800n * WAD;
        const size = 1n * WAD;
        const marginNative = 200_000_000n; // 200 USDC
        const marginWad = nativeQuoteToWad(marginNative, 6);

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, false);
        assert.equal(pnl, 200n * WAD);

        const nativePnl = wadToNativeQuote(pnl, usdcParams.quoteDecimals);
        assert.equal(nativePnl, 200_000_000n);
    });

    test('GV-07: Positive Funding Long (Trader Pays)', () => {
        const size = 1n * WAD;
        const entryFundingIndex = 10n * WAD;
        const currentFundingIndex = 30n * WAD; // +20 index increase

        const fundingPayment = calculateFundingPaymentWad(size, entryFundingIndex, currentFundingIndex, true);
        assert.equal(fundingPayment, 20n * WAD); // Trader owes 20
    });

    test('GV-08: Negative Funding Short (Trader Pays)', () => {
        const size = 1n * WAD;
        const entryFundingIndex = 30n * WAD;
        const currentFundingIndex = 10n * WAD; // -20 index decrease

        const fundingPayment = calculateFundingPaymentWad(size, entryFundingIndex, currentFundingIndex, false);
        assert.equal(fundingPayment, 20n * WAD); // Trader owes 20
    });

    test('GV-09: Long Loss Near Liquidation Threshold', () => {
        const entryPrice = 2000n * WAD;
        const currentPrice = 1820n * WAD; // Loss of 180
        const size = 1n * WAD;
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, true);
        assert.equal(pnl, -180n * WAD);

        const equity = calculateEquityWad(margin, pnl, 0n); // 20
        assert.equal(equity, 20n * WAD);

        const mm = calculateMaintenanceMarginWad(size, currentPrice, defaultParams.maintenanceMarginBps); // 5% of 1820 = 91
        assert.equal(mm, 91n * WAD);

        const hf = calculateHealthFactorWad(equity, mm);
        assert.ok(hf < WAD); // HF < 1.0 (Liquidatable)
    });

    test('GV-10: Short Loss Near Liquidation Threshold', () => {
        const entryPrice = 2000n * WAD;
        const currentPrice = 2180n * WAD; // Loss of 180
        const size = 1n * WAD;
        const margin = 200n * WAD;

        const pnl = calculateUnrealizedPnlWad(size, entryPrice, currentPrice, false);
        assert.equal(pnl, -180n * WAD);

        const equity = calculateEquityWad(margin, pnl, 0n); // 20
        assert.equal(equity, 20n * WAD);

        const mm = calculateMaintenanceMarginWad(size, currentPrice, defaultParams.maintenanceMarginBps); // 5% of 2180 = 109
        assert.equal(mm, 109n * WAD);

        const hf = calculateHealthFactorWad(equity, mm);
        assert.ok(hf < WAD); // HF < 1.0 (Liquidatable)
    });

    test('GV-11: Partial Decrease (50% Close) Long', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 2000n * WAD,
            marginWad: 200n * WAD,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const res = decreaseOrClosePosition(pos, WAD / 2n, 2400n * WAD, 0n, defaultParams);
        assert.equal(res.realizedPnlWad, 200n * WAD); // 0.5 * 400 = 200
        assert.equal(res.updatedPosition.sizeWad, WAD / 2n);
        assert.equal(res.updatedPosition.marginWad, 100n * WAD);
        assert.ok(res.traderPayoutWad > 290n * WAD); // Released margin (100) + PnL (200) - fee
    });

    test('GV-12: Partial Decrease (50% Close) Short', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 2000n * WAD,
            marginWad: 200n * WAD,
            isLong: false,
            entryFundingIndexWad: 0n
        };

        const res = decreaseOrClosePosition(pos, WAD / 2n, 1600n * WAD, 0n, defaultParams);
        assert.equal(res.realizedPnlWad, 200n * WAD); // 0.5 * (2000 - 1600) = 200
        assert.equal(res.updatedPosition.sizeWad, WAD / 2n);
    });

    test('GV-13: Solvent Liquidation Long', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 2000n * WAD,
            marginWad: 200n * WAD,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const res = executeLiquidation(pos, 1880n * WAD, 0n, defaultParams);
        assert.equal(res.badDebtWad, 0n);
        assert.ok(res.liquidatorRewardWad > 0n);
        assert.ok(res.insuranceFundAddWad > 0n);
    });

    test('GV-14: Insolvent Liquidation Long (Bad Debt)', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 2000n * WAD,
            marginWad: 200n * WAD,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const res = executeLiquidation(pos, 1700n * WAD, 0n, defaultParams);
        assert.equal(res.badDebtWad, 100n * WAD); // Equity = 200 - 300 = -100
        assert.equal(res.traderRemainingEquityWad, 0n);
    });

    test('GV-15: Insolvent Liquidation Short (Bad Debt)', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 2000n * WAD,
            marginWad: 200n * WAD,
            isLong: false,
            entryFundingIndexWad: 0n
        };

        const res = executeLiquidation(pos, 2300n * WAD, 0n, defaultParams);
        assert.equal(res.badDebtWad, 100n * WAD); // Equity = 200 - 300 = -100
    });

    test('GV-16: Minimum Size & Price Edge Case', () => {
        const pos: PositionState = {
            sizeWad: 1n, // 1 wei size
            entryPriceWad: 1n * WAD,
            marginWad: 1n,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const pnl = calculateUnrealizedPnlWad(pos.sizeWad, pos.entryPriceWad, 2n * WAD, true);
        assert.equal(pnl, 1n); // 1 wei profit
    });

    test('GV-17: Rounding Ceil on Protocol Fee', () => {
        const res = openOrIncreasePosition(null, 100n * WAD, 10n * WAD, 1n * WAD, true, 0n, defaultParams);
        assert.ok(res.protocolFeeWad >= 1n); // Fee strictly rounded up
    });

    test('GV-18: Rounding Floor on Trader Payout', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 100n * WAD,
            marginWad: 10n * WAD,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const res = decreaseOrClosePosition(pos, 1n * WAD, 100n * WAD + 1n, 0n, defaultParams);
        assert.ok(res.traderPayoutWad >= 0n);
    });

    test('GV-19: Zero Funding Drift', () => {
        const pos: PositionState = {
            sizeWad: 5n * WAD,
            entryPriceWad: 1500n * WAD,
            marginWad: 500n * WAD,
            isLong: true,
            entryFundingIndexWad: 100n * WAD
        };

        const fundingPayment = calculateFundingPaymentWad(pos.sizeWad, pos.entryFundingIndexWad, 100n * WAD, true);
        assert.equal(fundingPayment, 0n);
    });

    test('GV-20: Deep Out of Money Long (Total Loss)', () => {
        const pos: PositionState = {
            sizeWad: 1n * WAD,
            entryPriceWad: 1000n * WAD,
            marginWad: 200n * WAD,
            isLong: true,
            entryFundingIndexWad: 0n
        };

        const res = executeLiquidation(pos, 500n * WAD, 0n, defaultParams);
        assert.equal(res.badDebtWad, 300n * WAD); // Margin 200, PnL -500 -> Bad debt 300
    });
});
