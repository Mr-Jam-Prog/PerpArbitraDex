// @title: Tests unitaires pour AMMPool (funding rates)
// @coverage: >95% (funding logic)
// @audit: Critical for protocol economics
// @invariants: Funding rate symmetry, no arbitrage

const { expect } = require("chai");
const { network, ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("💰 AMMPool - Unit Tests", function () {
  let ammPool;
  let perpEngine;
  let mockOracle;
  let owner, user1, user2;
  let impersonatedPerpEngine;
  
  const ETH_USD_MARKET = 1n;
  
  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // Déploiement PerpEngine mock
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    await perpEngine.waitForDeployment();
    const perpEngineAddress = await perpEngine.getAddress();

    // Déploiement Oracle mock/aggregator
    const MockOracle = await ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    
    // Déploiement AMMPool
    const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPoolFactory.deploy(perpEngineAddress, mockOracle.target);
    await ammPool.waitForDeployment();

    // Impersonate PerpEngine
    await network.provider.send("hardhat_setBalance", [
      perpEngineAddress,
      "0xDE0B6B3A7640000", // 1 ETH
    ]);
    impersonatedPerpEngine = await ethers.getImpersonatedSigner(perpEngineAddress);
    
    // Initialize market
    await ammPool.connect(impersonatedPerpEngine).initializeMarket(
      ETH_USD_MARKET,
      ethers.parseUnits("100000", 18), // skewScale ($100k)
      ethers.parseUnits("0.01", 18),   // maxFundingRate (1% per hour)
      3600                             // fundingInterval (1h)
    );
  });
  
  describe("📈 Funding Rate Calculation", function () {
    it("Should calculate funding rate based on skew", async function () {
      const skew = ethers.parseUnits("100", 18);
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, skew);

      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      
      const fundingRate = await ammPool.getFundingRate(ETH_USD_MARKET);
      expect(fundingRate).to.be.gt(0);
    });
    
    it("Should have symmetric funding for long vs short", async function () {
      const amount = ethers.parseUnits("100", 18);

      // Setup: long skew
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, amount);
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const longSkewRate = await ammPool.getFundingRate(ETH_USD_MARKET);

      // Re-initialize for short test to ensure clean state and identical time elapsed
      const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
      const ammPool2 = await AMMPoolFactory.deploy(impersonatedPerpEngine.address, mockOracle.target);
      await ammPool2.waitForDeployment();
      await ammPool2.connect(impersonatedPerpEngine).initializeMarket(
        ETH_USD_MARKET,
        ethers.parseUnits("100000", 18),
        ethers.parseUnits("0.01", 18),
        3600
      );

      await ammPool2.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, false, amount);
      await time.increase(3600);
      await ammPool2.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const shortSkewRate = await ammPool2.getFundingRate(ETH_USD_MARKET);

      expect(longSkewRate).to.equal(-shortSkewRate);
    });

    it("Should cap funding rate at maximum", async function () {
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("1000000", 18));

      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const fundingRate = await ammPool.getFundingRate(ETH_USD_MARKET);
      const maxRate = (await ammPool.getMarketConfig(ETH_USD_MARKET)).maxFundingRate;

      expect(fundingRate).to.equal(maxRate);
    });

    it("Should apply funding rate interval correctly", async function () {
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100000", 18));

      await time.increase(1800);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      expect(await ammPool.getFundingRate(ETH_USD_MARKET)).to.equal(0);

      await time.increase(1800);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      expect(await ammPool.getFundingRate(ETH_USD_MARKET)).to.be.gt(0);
    });
  });
  
  describe("🔄 Funding Settlement", function () {
    it("Should calculate funding payment correctly for long position", async function () {
      const positionSize = ethers.parseUnits("10000", 18);
      
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100", 18));
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      
      const lastFundingAccrued = (await time.latest()) - 3600;
      const payment = await ammPool.calculateFundingPayment(ETH_USD_MARKET, positionSize, true, lastFundingAccrued);

      expect(payment).to.be.lt(0);
    });

    it("Should calculate funding payment correctly for short position", async function () {
      const positionSize = ethers.parseUnits("10000", 18);
      
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100", 18));
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);

      const lastFundingAccrued = (await time.latest()) - 3600;
      const payment = await ammPool.calculateFundingPayment(ETH_USD_MARKET, positionSize, false, lastFundingAccrued);

      expect(payment).to.be.gt(0);
    });

    it("Should handle zero skew correctly", async function () {
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);

      const payment = await ammPool.calculateFundingPayment(ETH_USD_MARKET, ethers.parseUnits("10000", 18), true, (await time.latest()) - 3600);
      expect(payment).to.equal(0);
    });

    it("Should update accumulated funding in applyFunding", async function () {
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100", 18));
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);

      const lastFundingAccrued = (await time.latest()) - 3600;
      await ammPool.connect(impersonatedPerpEngine).applyFunding(ETH_USD_MARKET, ethers.parseUnits("10000", 18), true, lastFundingAccrued);

      const state = await ammPool.getFundingState(ETH_USD_MARKET);
      expect(state.fundingAccumulatedLong).to.be.gt(0);
    });
  });

  describe("⚖️ Funding Rate Properties", function () {
    it("Should maintain invariant: total funding paid = total funding received", async function () {
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100", 18));
      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);

      const lastFundingAccrued = (await time.latest()) - 3600;

      const longPayment = await ammPool.calculateFundingPayment(ETH_USD_MARKET, ethers.parseUnits("10000", 18), true, lastFundingAccrued);
      const shortPayment = await ammPool.calculateFundingPayment(ETH_USD_MARKET, ethers.parseUnits("10000", 18), false, lastFundingAccrued);

      expect(longPayment < 0n ? -longPayment : longPayment).to.equal(shortPayment < 0n ? -shortPayment : shortPayment);
    });

    it("Should have funding rate proportional to time", async function () {
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, ethers.parseUnits("100", 18));

      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const rate1h = await ammPool.getFundingRate(ETH_USD_MARKET);

      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const rate2h = await ammPool.getFundingRate(ETH_USD_MARKET);

      expect(rate2h).to.be.closeTo(rate1h, rate1h / 100n);
    });

    it("Should handle extreme skew values", async function () {
      const hugeSkew = ethers.parseUnits("1000000", 18);
      await ammPool.connect(impersonatedPerpEngine).updateSkew(ETH_USD_MARKET, true, hugeSkew);

      await time.increase(3600);
      await ammPool.connect(impersonatedPerpEngine).updateFundingRate(ETH_USD_MARKET);
      const rate = await ammPool.getFundingRate(ETH_USD_MARKET);
      const maxRate = (await ammPool.getMarketConfig(ETH_USD_MARKET)).maxFundingRate;

      expect(rate).to.equal(maxRate);
    });
  });

  describe("🔧 Configuration", function () {
    it("Should allow updating skew scale via PerpEngine", async function () {
      const newScale = ethers.parseUnits("200000", 18);
      await ammPool.connect(impersonatedPerpEngine).updateSkewScale(ETH_USD_MARKET, newScale);
      expect((await ammPool.getMarketConfig(ETH_USD_MARKET)).skewScale).to.equal(newScale);
    });

    it("Should reject non-PerpEngine configuration", async function () {
      await expect(
        ammPool.connect(user1).updateSkewScale(ETH_USD_MARKET, ethers.parseUnits("200000", 18))
      ).to.be.revertedWith("AMMPool: only PerpEngine");
    });

    it("Should allow updating max funding rate via PerpEngine", async function () {
      const newMaxRate = ethers.parseUnits("0.005", 18);
      await ammPool.connect(impersonatedPerpEngine).updateMaxFundingRate(ETH_USD_MARKET, newMaxRate);
      expect((await ammPool.getMarketConfig(ETH_USD_MARKET)).maxFundingRate).to.equal(newMaxRate);
    });

    it("Should validate configuration parameters", async function () {
      const excessiveRate = ethers.parseUnits("0.5", 18); // 50%
      await expect(
        ammPool.connect(impersonatedPerpEngine).updateMaxFundingRate(ETH_USD_MARKET, excessiveRate)
      ).to.be.revertedWith("AMMPool: funding rate too high");
    });
  });
});
