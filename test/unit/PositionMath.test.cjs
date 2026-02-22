if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, parseEther } = ethers;

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
    it("Should calculate PnL for long position with profit", async function () {
      const size = 100n * PRECISION; // 100 ETH
      const entryPrice = 2000n * PRICE_PRECISION; // $2000
      const currentPrice = 2200n * PRICE_PRECISION; // $2200
      const isLong = true;

      const expectedPnL = 10n * PRECISION;
      const pnl = await positionMath.calculatePnL(entryPrice, currentPrice, size, isLong);
      expect(pnl).to.equal(expectedPnL);
    });

    it("Should calculate PnL for short position with profit", async function () {
      const size = 100n * PRECISION;
      const entryPrice = 2000n * PRICE_PRECISION;
      const currentPrice = 1800n * PRICE_PRECISION;
      const isLong = false;

      const expectedPnL = 10n * PRECISION;
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

      // maintenanceMargin = 100 * 0.05 = 5.
      // HF = 10 / 5 = 2.0.
      const hf = await positionMath.calculateHealthFactor(params, currentPrice, riskParams);
      expect(hf).to.equal(2n * PRECISION);
    });

    it("Should cap health factor at 100", async function () {
        const size = 1n * PRECISION;
        const collateral = 1000n * PRECISION;
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
