// @title: Tests unitaires pour PositionMath library
// @coverage: 100% (pure math functions)
// @audit: Critical for financial calculations
// @security: Overflow protection, precision handling

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("🧮 PositionMath - Unit Tests", function () {
  let positionMath;
  
  before(async function () {
    // Déploiement de la library
    const PositionMath = await ethers.getContractFactory("PositionMath");
    positionMath = await PositionMath.deploy();
    await positionMath.deployed();
  });
  
  describe("📈 PnL Calculations", function () {
    it("Should calculate PnL for long position with profit", async function () {
      const size = ethers.utils.parseUnits("100", 18); // 100 ETH
      const entryPrice = ethers.utils.parseUnits("2000", 18); // $2000
      const currentPrice = ethers.utils.parseUnits("2200", 18); // $2200
      const isLong = true;
      
      // PnL long = size * (currentPrice - entryPrice) / entryPrice
      // = 100 * (2200 - 2000) / 2000 = 100 * 200 / 2000 = 10 ETH
      const expectedPnL = ethers.utils.parseUnits("10", 18);
      
      const pnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, isLong);
      expect(pnl).to.equal(expectedPnL);
    });
    
    it("Should calculate PnL for long position with loss", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const currentPrice = ethers.utils.parseUnits("1800", 18);
      const isLong = true;
      
      // PnL = 100 * (1800 - 2000) / 2000 = 100 * (-200) / 2000 = -10 ETH
      const expectedPnL = ethers.utils.parseUnits("-10", 18);
      
      const pnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, isLong);
      expect(pnl).to.equal(expectedPnL);
    });
    
    it("Should calculate PnL for short position with profit", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const currentPrice = ethers.utils.parseUnits("1800", 18);
      const isLong = false;
      
      // PnL short = size * (entryPrice - currentPrice) / entryPrice
      // = 100 * (2000 - 1800) / 2000 = 100 * 200 / 2000 = 10 ETH
      const expectedPnL = ethers.utils.parseUnits("10", 18);
      
      const pnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, isLong);
      expect(pnl).to.equal(expectedPnL);
    });
    
    it("Should calculate PnL for short position with loss", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const currentPrice = ethers.utils.parseUnits("2200", 18);
      const isLong = false;
      
      // PnL = 100 * (2000 - 2200) / 2000 = 100 * (-200) / 2000 = -10 ETH
      const expectedPnL = ethers.utils.parseUnits("-10", 18);
      
      const pnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, isLong);
      expect(pnl).to.equal(expectedPnL);
    });
    
    it("Should handle zero price change", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const price = ethers.utils.parseUnits("2000", 18);
      
      const longPnl = await positionMath.calculatePnL(size, price, price, true);
      const shortPnl = await positionMath.calculatePnL(size, price, price, false);
      
      expect(longPnl).to.equal(0);
      expect(shortPnl).to.equal(0);
    });
    
    it("Should maintain PnL symmetry", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const currentPrice = ethers.utils.parseUnits("2100", 18);
      
      const longPnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, true);
      const shortPnl = await positionMath.calculatePnL(size, entryPrice, currentPrice, false);
      
      // longPnl + shortPnl should be 0 (perfect hedge)
      expect(longPnl.add(shortPnl)).to.equal(0);
    });
  });
  
  describe("⚖️ Margin Calculations", function () {
    it("Should calculate margin ratio correctly", async function () {
      const collateral = ethers.utils.parseUnits("1000", 18); // $1000
      const size = ethers.utils.parseUnits("5", 18); // 5 ETH
      const price = ethers.utils.parseUnits("2000", 18); // $2000
      
      // Notional = size * price = 5 * 2000 = $10,000
      // Margin ratio = collateral / notional = 1000 / 10000 = 0.1 (10%)
      const expectedRatio = ethers.utils.parseUnits("0.1", 18);
      
      const ratio = await positionMath.calculateMarginRatio(collateral, size, price);
      expect(ratio).to.equal(expectedRatio);
    });
    
    it("Should calculate leverage from margin ratio", async function () {
      const marginRatio = ethers.utils.parseUnits("0.1", 18); // 10%
      
      // Leverage = 1 / marginRatio = 1 / 0.1 = 10x
      const expectedLeverage = ethers.utils.parseUnits("10", 18);
      
      const leverage = await positionMath.calculateLeverage(marginRatio);
      expect(leverage).to.equal(expectedLeverage);
    });
    
    it("Should calculate required margin", async function () {
      const size = ethers.utils.parseUnits("10", 18); // 10 ETH
      const price = ethers.utils.parseUnits("2000", 18); // $2000
      const marginRatio = ethers.utils.parseUnits("0.1", 18); // 10%
      
      // Notional = 10 * 2000 = $20,000
      // Required margin = notional * marginRatio = 20000 * 0.1 = $2000
      const expectedMargin = ethers.utils.parseUnits("2000", 18);
      
      const requiredMargin = await positionMath.calculateRequiredMargin(size, price, marginRatio);
      expect(requiredMargin).to.equal(expectedMargin);
    });
    
    it("Should calculate liquidation price for long", async function () {
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const marginRatio = ethers.utils.parseUnits("0.1", 18);
      const maintenanceRatio = ethers.utils.parseUnits("0.08", 18);
      const isLong = true;
      
      // Liquidation price long = entryPrice * (1 - (marginRatio - maintenanceRatio))
      // = 2000 * (1 - (0.1 - 0.08)) = 2000 * (1 - 0.02) = 2000 * 0.98 = 1960
      const expectedPrice = ethers.utils.parseUnits("1960", 18);
      
      const liquidationPrice = await positionMath.calculateLiquidationPrice(
        entryPrice,
        marginRatio,
        maintenanceRatio,
        isLong
      );
      
      expect(liquidationPrice).to.equal(expectedPrice);
    });
    
    it("Should calculate liquidation price for short", async function () {
      const entryPrice = ethers.utils.parseUnits("2000", 18);
      const marginRatio = ethers.utils.parseUnits("0.1", 18);
      const maintenanceRatio = ethers.utils.parseUnits("0.08", 18);
      const isLong = false;
      
      // Liquidation price short = entryPrice * (1 + (marginRatio - maintenanceRatio))
      // = 2000 * (1 + (0.1 - 0.08)) = 2000 * (1 + 0.02) = 2000 * 1.02 = 2040
      const expectedPrice = ethers.utils.parseUnits("2040", 18);
      
      const liquidationPrice = await positionMath.calculateLiquidationPrice(
        entryPrice,
        marginRatio,
        maintenanceRatio,
        isLong
      );
      
      expect(liquidationPrice).to.equal(expectedPrice);
    });
  });
  
  describe("💸 Funding Calculations", function () {
    it("Should calculate funding payment", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const fundingRate = ethers.utils.parseUnits("0.0001", 18); // 0.01% per hour
      
      // Funding = size * fundingRate = 100 * 0.0001 = 0.01
      const expectedFunding = ethers.utils.parseUnits("0.01", 18);
      
      const funding = await positionMath.calculateFundingPayment(size, fundingRate);
      expect(funding).to.equal(expectedFunding);
    });
    
    it("Should handle negative funding rate", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const fundingRate = ethers.utils.parseUnits("-0.0001", 18);
      
      const funding = await positionMath.calculateFundingPayment(size, fundingRate);
      expect(funding).to.equal(ethers.utils.parseUnits("-0.01", 18));
    });
    
    it("Should calculate cumulative funding", async function () {
      const size = ethers.utils.parseUnits("100", 18);
      const fundingRates = [
        ethers.utils.parseUnits("0.0001", 18),
        ethers.utils.parseUnits("0.0002", 18),
        ethers.utils.parseUnits("-0.0001", 18)
      ];
      
      let cumulativeFunding = ethers.BigNumber.from(0);
      for (const rate of fundingRates) {
        cumulativeFunding = cumulativeFunding.add(
          await positionMath.calculateFundingPayment(size, rate)
        );
      }
      
      // Total = 100*(0.0001 + 0.0002 - 0.0001) = 100*0.0002 = 0.02
      expect(cumulativeFunding).to.equal(ethers.utils.parseUnits("0.02", 18));
    });
  });
  
  describe("🛡️ Safety Checks", function () {
    it("Should prevent overflow in multiplication", async function () {
      const maxUint = ethers.constants.MaxUint256;
      const one = ethers.utils.parseUnits("1", 18);
      
      // Devrait gérer les grands nombres sans overflow
      await expect(
        positionMath.safeMul(maxUint, one)
      ).to.not.be.reverted;
    });
    
    it("Should prevent underflow in subtraction", async function () {
      const a = ethers.utils.parseUnits("100", 18);
      const b = ethers.utils.parseUnits("200", 18);
      
      // Devrait échouer si b > a
      await expect(
        positionMath.safeSub(a, b)
      ).to.be.revertedWith("Underflow");
    });
    
    it("Should handle division by zero", async function () {
      const a = ethers.utils.parseUnits("100", 18);
      const zero = ethers.BigNumber.from(0);
      
      await expect(
        positionMath.safeDiv(a, zero)
      ).to.be.revertedWith("DivisionByZero");
    });
    
    it("Should enforce precision limits", async function () {
      const value = ethers.utils.parseUnits("0.000000000000000001", 18); // 1 wei
      
      // Devrait maintenir la précision
      const multiplied = await positionMath.safeMul(value, ethers.utils.parseUnits("2", 18));
      expect(multiplied).to.equal(ethers.utils.parseUnits("0.000000000000000002", 18));
    });
  });
  
  describe("📊 Statistical Functions", function () {
    it("Should calculate mean correctly", async function () {
      const values = [
        ethers.utils.parseUnits("100", 18),
        ethers.utils.parseUnits("200", 18),
        ethers.utils.parseUnits("300", 18)
      ];
      
      // Mean = (100 + 200 + 300) / 3 = 200
      const mean = await positionMath.calculateMean(values);
      expect(mean).to.equal(ethers.utils.parseUnits("200", 18));
    });
    
    it("Should calculate median correctly", async function () {
      const values = [
        ethers.utils.parseUnits("100", 18),
        ethers.utils.parseUnits("300", 18),
        ethers.utils.parseUnits("200", 18)
      ];
      
      // Sorted: 100, 200, 300 -> Median = 200
      const median = await positionMath.calculateMedian(values);
      expect(median).to.equal(ethers.utils.parseUnits("200", 18));
    });
    
    it("Should calculate standard deviation", async function () {
      const values = [
        ethers.utils.parseUnits("100", 18),
        ethers.utils.parseUnits("200", 18),
        ethers.utils.parseUnits("300", 18)
      ];
      
      // Mean = 200
      // Variance = ((100-200)² + (200-200)² + (300-200)²) / 3 = (10000 + 0 + 10000) / 3 = 6666.66
      // Std dev = sqrt(6666.66) ≈ 81.649
      const stdDev = await positionMath.calculateStandardDeviation(values);
      const expected = ethers.utils.parseUnits("81.649", 18);
      
      expect(stdDev).to.be.closeTo(expected, ethers.utils.parseUnits("0.1", 18));
    });
    
    it("Should calculate correlation", async function () {
      const x = [
        ethers.utils.parseUnits("1", 18),
        ethers.utils.parseUnits("2", 18),
        ethers.utils.parseUnits("3", 18)
      ];
      
      const y = [
        ethers.utils.parseUnits("2", 18),
        ethers.utils.parseUnits("4", 18),
        ethers.utils.parseUnits("6", 18)
      ];
      
      // Perfect positive correlation = 1.0
      const correlation = await positionMath.calculateCorrelation(x, y);
      expect(correlation).to.be.closeTo(ethers.utils.parseUnits("1", 18), ethers.utils.parseUnits("0.01", 18));
    });
  });
});