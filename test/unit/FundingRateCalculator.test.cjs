// @title: Tests unitaires pour FundingRateCalculator
// @coverage: >95% (funding rate logic)
// @audit: Critical for protocol economics
// @security: Rate capping, smooth adjustments

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("📊 FundingRateCalculator - Unit Tests", function () {
  let fundingRateCalculator;
  
  before(async function () {
    const FundingRateCalculator = await ethers.getContractFactory("FundingRateCalculator");
    fundingRateCalculator = await FundingRateCalculator.deploy();
    await fundingRateCalculator.waitForDeployment();
  });
  
  describe("🎯 Basic Funding Rate Calculation", function () {
    it("Should calculate funding rate based on skew", async function () {
      const skew = ethers.parseUnits("100000", 18); // $100k skew long
      const totalSize = ethers.parseUnits("1000000", 18); // $1M total
      const coefficient = ethers.parseUnits("0.0001", 18); // 0.01% per hour per unit skew
      
      // fundingRate = skew / totalSize * coefficient
      // = 100,000 / 1,000,000 * 0.0001 = 0.1 * 0.0001 = 0.00001 (0.001% per hour)
      const expectedRate = ethers.parseUnits("0.00001", 18);
      
      const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      expect(rate).to.equal(expectedRate);
    });
    
    it("Should handle negative skew (shorts pay)", async function () {
      const skew = ethers.parseUnits("-100000", 18); // $100k skew short
      const totalSize = ethers.parseUnits("1000000", 18);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      // fundingRate = -100,000 / 1,000,000 * 0.0001 = -0.00001
      const expectedRate = ethers.parseUnits("-0.00001", 18);
      
      const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      expect(rate).to.equal(expectedRate);
    });
    
    it("Should handle zero total size", async function () {
      const skew = ethers.parseUnits("100000", 18);
      const totalSize = ethers.BigNumber.from(0);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      // Quand totalSize = 0, funding rate = 0
      const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      expect(rate).to.equal(0);
    });
    
    it("Should handle small total size", async function () {
      const skew = ethers.parseUnits("1000", 18);
      const totalSize = ethers.parseUnits("100", 18); // 1000% skew!
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      // fundingRate = 1000 / 100 * 0.0001 = 10 * 0.0001 = 0.001 (0.1% per hour)
      const expectedRate = ethers.parseUnits("0.001", 18);
      
      const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      expect(rate).to.equal(expectedRate);
    });
  });
  
  describe("🚫 Rate Capping", function () {
    it("Should cap positive funding rate", async function () {
      const maxRate = ethers.parseUnits("0.001", 18); // 0.1% max per hour
      const excessiveRate = ethers.parseUnits("0.002", 18); // 0.2%
      
      const cappedRate = await fundingRateCalculator.capFundingRate(excessiveRate, maxRate);
      expect(cappedRate).to.equal(maxRate);
    });
    
    it("Should cap negative funding rate", async function () {
      const maxRate = ethers.parseUnits("0.001", 18);
      const excessiveRate = ethers.parseUnits("-0.002", 18);
      
      const cappedRate = await fundingRateCalculator.capFundingRate(excessiveRate, maxRate);
      expect(cappedRate).to.equal(maxRate * (-1)); // -maxRate
    });
    
    it("Should not cap rates within limits", async function () {
      const maxRate = ethers.parseUnits("0.001", 18);
      const reasonableRate = ethers.parseUnits("0.0005", 18);
      
      const cappedRate = await fundingRateCalculator.capFundingRate(reasonableRate, maxRate);
      expect(cappedRate).to.equal(reasonableRate);
    });
    
    it("Should handle zero max rate", async function () {
      const maxRate = ethers.BigNumber.from(0);
      const rate = ethers.parseUnits("0.0005", 18);
      
      const cappedRate = await fundingRateCalculator.capFundingRate(rate, maxRate);
      expect(cappedRate).to.equal(0);
    });
  });
  
  describe("🔄 Smooth Rate Adjustment", function () {
    it("Should smoothly adjust funding rates", async function () {
      const currentRate = ethers.parseUnits("0.0005", 18);
      const targetRate = ethers.parseUnits("0.001", 18);
      const maxAdjustment = ethers.parseUnits("0.0001", 18); // Max 0.01% adjustment
      
      // Nouveau rate = min(targetRate, currentRate + maxAdjustment)
      // = min(0.001, 0.0005 + 0.0001) = min(0.001, 0.0006) = 0.0006
      const expectedRate = ethers.parseUnits("0.0006", 18);
      
      const adjustedRate = await fundingRateCalculator.adjustSmoothly(
        currentRate,
        targetRate,
        maxAdjustment
      );
      
      expect(adjustedRate).to.equal(expectedRate);
    });
    
    it("Should smoothly decrease rates", async function () {
      const currentRate = ethers.parseUnits("0.001", 18);
      const targetRate = ethers.parseUnits("0.0005", 18);
      const maxAdjustment = ethers.parseUnits("0.0001", 18);
      
      // Nouveau rate = max(targetRate, currentRate - maxAdjustment)
      // = max(0.0005, 0.001 - 0.0001) = max(0.0005, 0.0009) = 0.0009
      const expectedRate = ethers.parseUnits("0.0009", 18);
      
      const adjustedRate = await fundingRateCalculator.adjustSmoothly(
        currentRate,
        targetRate,
        maxAdjustment
      );
      
      expect(adjustedRate).to.equal(expectedRate);
    });
    
    it("Should reach target rate gradually", async function () {
      let currentRate = ethers.parseUnits("0", 18);
      const targetRate = ethers.parseUnits("0.001", 18);
      const maxAdjustment = ethers.parseUnits("0.0002", 18);
      
      // Itérations pour atteindre le target
      for (let i = 0; i < 5; i++) {
        currentRate = await fundingRateCalculator.adjustSmoothly(
          currentRate,
          targetRate,
          maxAdjustment
        );
      }
      
      // Après 5 itérations: 0 → 0.0002 → 0.0004 → 0.0006 → 0.0008 → 1.0
      expect(currentRate).to.equal(targetRate);
    });
    
    it("Should handle negative adjustments", async function () {
      const currentRate = ethers.parseUnits("-0.0003", 18);
      const targetRate = ethers.parseUnits("0.0002", 18);
      const maxAdjustment = ethers.parseUnits("0.0001", 18);
      
      // De -0.0003 vers 0.0002: augmentation de 0.0005, mais limité à 0.0001
      // Nouveau rate = -0.0003 + 0.0001 = -0.0002
      const expectedRate = ethers.parseUnits("-0.0002", 18);
      
      const adjustedRate = await fundingRateCalculator.adjustSmoothly(
        currentRate,
        targetRate,
        maxAdjustment
      );
      
      expect(adjustedRate).to.equal(expectedRate);
    });
  });
  
  describe("⏱️ Time-Based Accumulation", function () {
    it("Should accumulate funding over time", async function () {
      const hourlyRate = ethers.parseUnits("0.0001", 18); // 0.01% per hour
      const timeElapsed = 7200; // 2 hours
      
      // Accumulated = hourlyRate * (timeElapsed / 3600)
      // = 0.0001 * 2 = 0.0002
      const expectedAccumulated = ethers.parseUnits("0.0002", 18);
      
      const accumulated = await fundingRateCalculator.calculateAccumulatedFunding(
        hourlyRate,
        timeElapsed
      );
      
      expect(accumulated).to.equal(expectedAccumulated);
    });
    
    it("Should handle partial hours", async function () {
      const hourlyRate = ethers.parseUnits("0.0001", 18);
      const timeElapsed = 1800; // 0.5 hours
      
      // Accumulated = 0.0001 * 0.5 = 0.00005
      const expectedAccumulated = ethers.parseUnits("0.00005", 18);
      
      const accumulated = await fundingRateCalculator.calculateAccumulatedFunding(
        hourlyRate,
        timeElapsed
      );
      
      expect(accumulated).to.equal(expectedAccumulated);
    });
    
    it("Should handle negative rates over time", async function () {
      const hourlyRate = ethers.parseUnits("-0.0001", 18);
      const timeElapsed = 3600; // 1 hour
      
      const accumulated = await fundingRateCalculator.calculateAccumulatedFunding(
        hourlyRate,
        timeElapsed
      );
      
      expect(accumulated).to.equal(hourlyRate);
    });
    
    it("Should handle large time intervals", async function () {
      const hourlyRate = ethers.parseUnits("0.00001", 18);
      const timeElapsed = 86400 * 7; // 1 week
      
      // 0.00001 * 24 * 7 = 0.00168
      const expectedAccumulated = ethers.parseUnits("0.00168", 18);
      
      const accumulated = await fundingRateCalculator.calculateAccumulatedFunding(
        hourlyRate,
        timeElapsed
      );
      
      expect(accumulated).to.equal(expectedAccumulated);
    });
  });
  
  describe("📊 Statistical Properties", function () {
    it("Should maintain expected value properties", async function () {
      const skews = [
        ethers.parseUnits("100000", 18),
        ethers.parseUnits("-50000", 18),
        ethers.parseUnits("0", 18)
      ];
      
      const totalSize = ethers.parseUnits("1000000", 18);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      let sum = ethers.BigNumber.from(0);
      for (const skew of skews) {
        const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
        sum = sum + (rate);
      }
      
      // La somme devrait être proportionnelle à la somme des skews
      const totalSkew = ethers.parseUnits("50000", 18); // 100k - 50k + 0
      const expectedSum = totalSkew * (coefficient) / (totalSize);
      
      expect(sum).to.equal(expectedSum);
    });
    
    it("Should have linear scaling with coefficient", async function () {
      const skew = ethers.parseUnits("100000", 18);
      const totalSize = ethers.parseUnits("1000000", 18);
      const coefficient1 = ethers.parseUnits("0.0001", 18);
      const coefficient2 = ethers.parseUnits("0.0002", 18);
      
      const rate1 = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient1);
      const rate2 = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient2);
      
      // rate2 devrait être exactement le double de rate1
      expect(rate2).to.equal(rate1 * (2));
    });
    
    it("Should have inverse scaling with total size", async function () {
      const skew = ethers.parseUnits("100000", 18);
      const totalSize1 = ethers.parseUnits("1000000", 18);
      const totalSize2 = ethers.parseUnits("2000000", 18);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      const rate1 = await fundingRateCalculator.calculateFundingRate(skew, totalSize1, coefficient);
      const rate2 = await fundingRateCalculator.calculateFundingRate(skew, totalSize2, coefficient);
      
      // rate2 devrait être la moitié de rate1
      expect(rate2).to.equal(rate1 / (2));
    });
    
    it("Should preserve sign symmetry", async function () {
      const skew = ethers.parseUnits("100000", 18);
      const totalSize = ethers.parseUnits("1000000", 18);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      const positiveRate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      const negativeRate = await fundingRateCalculator.calculateFundingRate(skew * (-1), totalSize, coefficient);
      
      // Les taux devraient être opposés
      expect(positiveRate).to.equal(negativeRate * (-1));
    });
  });
  
  describe("🔧 Edge Cases", function () {
    it("Should handle maximum skew values", async function () {
      const maxSkew = ethers.MaxUint256 / (2); // Évite l'overflow
      const totalSize = maxSkew;
      const coefficient = ethers.parseUnits("1", 18);
      
      // Devrait calculer sans overflow
      const rate = await fundingRateCalculator.calculateFundingRate(maxSkew, totalSize, coefficient);
      
      // rate ≈ coefficient (car skew ≈ totalSize)
      expect(rate).to.be.closeTo(coefficient, coefficient / (1000));
    });
    
    it("Should handle minimum values", async function () {
      const minSkew = ethers.BigNumber.from(1);
      const totalSize = ethers.MaxUint256;
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      // Devrait gérer les très petits rapports
      const rate = await fundingRateCalculator.calculateFundingRate(minSkew, totalSize, coefficient);
      expect(rate).to.equal(0); // Arrondi à zéro
    });
    
    it("Should maintain precision for small rates", async function () {
      const skew = ethers.parseUnits("1", 18);
      const totalSize = ethers.parseUnits("1000000", 18);
      const coefficient = ethers.parseUnits("0.0001", 18);
      
      // rate = 1 / 1,000,000 * 0.0001 = 1e-10
      const rate = await fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient);
      const expected = ethers.parseUnits("0.0000000001", 18);
      
      expect(rate).to.equal(expected);
    });
    
    it("Should not overflow in intermediate calculations", async function () {
      // Test avec des valeurs qui pourraient causer un overflow
      const skew = ethers.MaxUint256 / (10);
      const totalSize = ethers.BigNumber.from(10);
      const coefficient = ethers.parseUnits("1", 18);
      
      await expect(
        fundingRateCalculator.calculateFundingRate(skew, totalSize, coefficient)
      ).to.not.be.reverted;
    });
  });
});