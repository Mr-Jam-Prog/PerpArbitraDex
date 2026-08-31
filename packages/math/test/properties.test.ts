import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    WAD,
    calculateUnrealizedPnlWad,
    calculateFundingPaymentWad
} from '../dist/index.js';

describe('Economic Property & Invariant Tests', () => {

    test('Property 1: Long / Short PnL Symmetry Ex-Fees', () => {
        const sizes = [1n * WAD, 100n * WAD, WAD / 2n];
        const entryPrices = [1000n * WAD, 2500n * WAD, 1n * WAD];
        const currentPrices = [1200n * WAD, 2000n * WAD, 2n * WAD];

        for (let i = 0; i < sizes.length; i++) {
            const size = sizes[i];
            const entry = entryPrices[i];
            const current = currentPrices[i];

            const pnlLong = calculateUnrealizedPnlWad(size, entry, current, true);
            const pnlShort = calculateUnrealizedPnlWad(size, entry, current, false);

            assert.equal(pnlLong + pnlShort, 0n, `PnL sum should be 0 for size=${size}, entry=${entry}, current=${current}`);
        }
    });

    test('Property 2: Time-Step Independence of Funding Accrual', () => {
        const size = 10n * WAD;
        const indexStart = 0n;
        const indexMid1 = 15n * WAD;
        const indexMid2 = 35n * WAD;
        const indexEnd = 50n * WAD;

        // Step 1: Single step accumulation
        const singleStepFunding = calculateFundingPaymentWad(size, indexStart, indexEnd, true);

        // Step 2: Multi-step accumulation (sum of intervals)
        const step1 = calculateFundingPaymentWad(size, indexStart, indexMid1, true);
        const step2 = calculateFundingPaymentWad(size, indexMid1, indexMid2, true);
        const step3 = calculateFundingPaymentWad(size, indexMid2, indexEnd, true);

        const multiStepFunding = step1 + step2 + step3;

        assert.equal(singleStepFunding, multiStepFunding, 'Multi-step funding sum must equal single-step total');
    });

    test('Property 3: Value Conservation Invariant across Counterparties', () => {
        const size = 5n * WAD;
        const entry = 1500n * WAD;
        const current = 1800n * WAD;

        const pnlLong = calculateUnrealizedPnlWad(size, entry, current, true); // +1500
        const pnlShort = calculateUnrealizedPnlWad(size, entry, current, false); // -1500

        assert.equal(pnlLong, 1500n * WAD);
        assert.equal(pnlShort, -1500n * WAD);
        assert.equal(pnlLong + pnlShort, 0n, 'Net PnL between long and short must equal zero');
    });
});
