const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("🧮 PositionMath - Unit Tests", function () {
  let positionMath;
  const PRECISION = 10n**18n;
  const PRICE_PRECISION = 10n**8n;

  before(async function () {
    const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
    positionMath = await PositionMathWrapper.deploy();
    await positionMath.waitForDeployment();
  });

  describe("📈 PnL Calculations", function () {
    it("Should calculate PnL for long position with profit (in quote units)", async function () {
      const size = 100n * PRECISION; // 100 ETH
      const entryPrice = 2000n * PRICE_PRECISION; // $2000
      const currentPrice = 2200n * PRICE_PRECISION; // $2200
      const isLong = true;

      // 100 ETH * ($2200 - $2000) = $20,000
      const expectedPnL = 20000n * PRECISION;
      const pnl = await positionMath.calculatePnL(entryPrice, currentPrice, size, isLong);
      expect(pnl).to.equal(expectedPnL);
    });

    it("Should calculate PnL for short position with profit (in quote units)", async function () {
      const size = 100n * PRECISION;
      const entryPrice = 2000n * PRICE_PRECISION;
      const currentPrice = 1800n * PRICE_PRECISION;
      const isLong = false;

      // 100 ETH * ($2000 - $1800) = $20,000
      const expectedPnL = 20000n * PRECISION;
      const pnl = await positionMath.calculatePnL(entryPrice, currentPrice, size, isLong);
      expect(pnl).to.equal(expectedPnL);
    });
  });

  describe("⚖️ Margin & Health Factor", function () {
    it("Should calculate health factor correctly", async function () {
      const size = 100n * PRECISION; // 100 ETH
      const entryPrice = 2000n * PRICE_PRECISION;
      const currentPrice = 2000n * PRICE_PRECISION;
      // Notional = size * price? No, PositionMath treats size as notional in units.
      // maintenanceMargin = size * bps / 10000.

      const collateral = 10n * PRECISION;

      const params = {
        size: size,
        collateral: collateral,
        entryPrice: entryPrice,
        isLong: true,
        fundingAccrued: 0n
      };

      const riskParams = {
        maintenanceMarginBps: 500n, // 5%
        liquidationThresholdBps: 10000n
      };

      // Notional = 100 ETH * 2000 USD/ETH = 200,000 USD
      // maintenanceMargin = 200,000 * 0.05 = 10,000.
      // HF = 10 / 10,000 = 0.001.

      // Wait, let's adjust collateral to make HF = 2.0
      // size = 100 ETH, Price = 2000 -> Notional = 200,000 USD
      // MM (5%) = 10,000 USD
      // To get HF = 2.0, we need Collateral = 20,000 USD
      params.collateral = 20000n * PRECISION;

      // Wait, my previous run returned 100.
      // Let's check size in the test.
      // const size = 100n * PRECISION;

      const hf = await positionMath.calculateHealthFactor(params, currentPrice, riskParams);
      expect(hf).to.equal(2n * PRECISION);
    });

    it("Should cap health factor at 100", async function () {
        const size = 1n * PRECISION;
        const collateral = 3000n * PRECISION;
        const params = {
            size: size,
            collateral: collateral,
            entryPrice: 2000n * PRICE_PRECISION,
            isLong: true,
            fundingAccrued: 0n
        };
        const riskParams = {
            maintenanceMarginBps: 100n, // 1%
            liquidationThresholdBps: 10000n
        };
        const hf = await positionMath.calculateHealthFactor(params, 2000n * PRICE_PRECISION, riskParams);
        expect(hf).to.equal(100n * PRECISION);
    });
  });
});
