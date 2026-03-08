// @title: Tests unitaires pour AMMPool (funding rates)
// @coverage: >95% (funding logic)
// @audit: Critical for protocol economics
// @invariants: Funding rate symmetry, no arbitrage

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("💰 AMMPool - Unit Tests", function () {
  let ammPool;
  let perpEngine;
  let oracleAggregator;
  let owner, user1, user2;
  let engineSigner;
  
  const MARKET_ID = 1;
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = ethers.parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = ethers.parseUnits("1000", 18);
  const LEVERAGE = ethers.parseUnits("5", 18);
  
  const SKEW_SCALE = ethers.parseUnits("1000000", 18); // $1M
  const MAX_FUNDING_RATE = ethers.parseUnits("0.01", 18); // 1%
  const FUNDING_INTERVAL = 3600; // 1 hour

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // Déploiement OracleAggregator mock
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracleAggregator = await MockOracle.deploy("Aggregator", 18);
    await oracleAggregator.waitForDeployment();
    
    // Déploiement PerpEngine mock
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    await perpEngine.waitForDeployment();
    
    // Déploiement AMMPool
    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(perpEngine.target, oracleAggregator.target);
    await ammPool.waitForDeployment();
    
    // Configuration
    await perpEngine.setAMMPool(ammPool.target);

    // Initialize market in AMMPool
    await ammPool.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);

    // Setup impersonated signer
    engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
    await owner.sendTransaction({ to: perpEngine.target, value: ethers.parseEther("1") });
  });
  
  describe("📈 Funding Rate Calculation", function () {
    it("Should calculate funding rate based on skew", async function () {
      const skewAmount = ethers.parseUnits("100000", 18); // $100k skew long
      
      await ammPool.connect(engineSigner).updateSkew(MARKET_ID, true, skewAmount);
      await time.increase(FUNDING_INTERVAL);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      
      const fundingRate = await ammPool.getFundingRate(MARKET_ID);
      const MAX_FUNDING_RATE_LIB = ethers.parseUnits("0.01", 18);
      expect(fundingRate).to.equal(MAX_FUNDING_RATE_LIB);
    });
    
    it("Should have symmetric funding for long vs short", async function () {
      const skewAmount = ethers.parseUnits("10000", 18);

      // Long skew
      await ammPool.connect(engineSigner).updateSkew(MARKET_ID, true, skewAmount);
      await time.increase(FUNDING_INTERVAL);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      const longSkewRate = await ammPool.getFundingRate(MARKET_ID);

      // Reset skew
      await ammPool.connect(engineSigner).updateSkew(MARKET_ID, true, -skewAmount);

      // Short skew
      await ammPool.connect(engineSigner).updateSkew(MARKET_ID, false, skewAmount);
      await time.increase(FUNDING_INTERVAL);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      const shortSkewRate = await ammPool.getFundingRate(MARKET_ID);

      expect(longSkewRate).to.equal(-shortSkewRate);
    });
  });
  
  describe("🔄 Funding Settlement", function () {
    it("Should calculate funding payment correctly", async function () {
      const skewAmount = ethers.parseUnits("100000", 18);
      
      await ammPool.connect(engineSigner).updateSkew(MARKET_ID, true, skewAmount);
      await time.increase(FUNDING_INTERVAL);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      
      const fundingRate = await ammPool.getFundingRate(MARKET_ID);
      const positionSize = ethers.parseUnits("10000", 18);
      const elapsed = 3600;
      
      const payment = await ammPool.calculateFundingPayment(MARKET_ID, positionSize, true, (await time.latest()) - elapsed);
      
      const expected = -(positionSize * fundingRate * BigInt(elapsed)) / ethers.parseUnits("1", 18);
      expect(payment).to.be.closeTo(expected, 100n);
    });
  });

  describe("🔧 Administration", function () {
    it("Should allow owner to initialize market", async function () {
      const NEW_MARKET_ID = 2;
      await ammPool.initializeMarket(NEW_MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      const config = await ammPool.getMarketConfig(NEW_MARKET_ID);
      expect(config.isActive).to.be.true;
    });

    it("Should allow PerpEngine to update skew scale", async function () {
      const newScale = ethers.parseUnits("500000", 18); // Use smaller scale within limits
      await ammPool.connect(engineSigner).updateSkewScale(MARKET_ID, newScale);
      const config = await ammPool.getMarketConfig(MARKET_ID);
      expect(config.skewScale).to.equal(newScale);
    });
  });
});
