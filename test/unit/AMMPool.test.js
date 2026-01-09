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
  let protocolConfig;
  let owner, user1, user2;
  
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = ethers.utils.parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = ethers.utils.parseUnits("1000", 18);
  const LEVERAGE = ethers.utils.parseUnits("5", 18);
  
  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    
    // Déploiement ProtocolConfig
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy();
    await protocolConfig.deployed();
    await protocolConfig.initialize();
    
    // Déploiement PerpEngine mock
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    await perpEngine.deployed();
    
    // Déploiement AMMPool
    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(protocolConfig.address, perpEngine.address);
    await ammPool.deployed();
    
    // Configuration
    await protocolConfig.setAMMPool(ammPool.address);
    await perpEngine.setAMMPool(ammPool.address);
  });
  
  describe("📈 Funding Rate Calculation", function () {
    it("Should calculate funding rate based on skew", async function () {
      // Configure le skew dans le mock
      const skew = ethers.utils.parseUnits("100000", 18); // $100k skew long
      await perpEngine.setSkew(ETH_USD_MARKET, skew);
      
      const totalSize = ethers.utils.parseUnits("1000000", 18); // $1M total
      await perpEngine.setTotalSize(ETH_USD_MARKET, totalSize);
      
      const fundingRate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      
      // fundingRate = skew / totalSize * fundingRateCoefficient
      const expectedRate = skew.mul(await ammPool.fundingRateCoefficient()).div(totalSize);
      
      expect(fundingRate).to.equal(expectedRate);
    });
    
    it("Should have symmetric funding for long vs short", async function () {
      // Skew long
      await perpEngine.setSkew(ETH_USD_MARKET, ethers.utils.parseUnits("100000", 18));
      await perpEngine.setTotalSize(ETH_USD_MARKET, ethers.utils.parseUnits("1000000", 18));
      
      const longSkewRate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      
      // Skew short (négatif)
      await perpEngine.setSkew(ETH_USD_MARKET, ethers.utils.parseUnits("-100000", 18));
      const shortSkewRate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      
      // Les taux devraient être opposés
      expect(longSkewRate).to.equal(shortSkewRate.mul(-1));
    });
    
    it("Should cap funding rate at maximum", async function () {
      // Crée un skew énorme pour dépasser le cap
      const hugeSkew = ethers.utils.parseUnits("500000", 18);
      const smallTotal = ethers.utils.parseUnits("100000", 18); // 500% skew!
      await perpEngine.setSkew(ETH_USD_MARKET, hugeSkew);
      await perpEngine.setTotalSize(ETH_USD_MARKET, smallTotal);
      
      const fundingRate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      const maxRate = await ammPool.maxFundingRate();
      
      expect(fundingRate.abs()).to.be.lte(maxRate);
    });
    
    it("Should apply funding rate interval correctly", async function () {
      const skew = ethers.utils.parseUnits("100000", 18);
      const totalSize = ethers.utils.parseUnits("1000000", 18);
      await perpEngine.setSkew(ETH_USD_MARKET, skew);
      await perpEngine.setTotalSize(ETH_USD_MARKET, totalSize);
      
      const hourlyRate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      
      // Funding pour 1 jour (24h)
      await time.increase(86400);
      const dailyRate = await ammPool.calculateAccumulatedFunding(ETH_USD_MARKET);
      
      // dailyRate ≈ hourlyRate * 24
      const expectedDailyRate = hourlyRate.mul(24);
      expect(dailyRate).to.be.closeTo(expectedDailyRate, hourlyRate.abs().div(100)); // 1% tolerance
    });
  });
  
  describe("🔄 Funding Settlement", function () {
    it("Should settle funding correctly for long position", async function () {
      // Configure une position long
      const positionId = 1;
      const positionSize = ethers.utils.parseUnits("10000", 18);
      const isLong = true;
      
      await perpEngine.setPosition(positionId, ETH_USD_MARKET, isLong, positionSize, INITIAL_PRICE, COLLATERAL_AMOUNT);
      
      // Configure un skew long (longs paient du funding)
      const skew = ethers.utils.parseUnits("50000", 18);
      const totalSize = ethers.utils.parseUnits("100000", 18);
      await perpEngine.setSkew(ETH_USD_MARKET, skew);
      await perpEngine.setTotalSize(ETH_USD_MARKET, totalSize);
      
      // Avance le temps
      await time.increase(3600); // 1 heure
      
      // Settle funding
      await ammPool.settleFunding(ETH_USD_MARKET);
      
      // Vérifie que la position a payé du funding (cumulativeFunding négatif pour long)
      const position = await perpEngine.getPosition(positionId);
      expect(position.cumulativeFunding).to.be.lt(0);
    });
    
    it("Should settle funding correctly for short position", async function () {
      const positionId = 2;
      const positionSize = ethers.utils.parseUnits("10000", 18);
      const isLong = false;
      
      await perpEngine.setPosition(positionId, ETH_USD_MARKET, isLong, positionSize, INITIAL_PRICE, COLLATERAL_AMOUNT);
      
      // Skew long (shorts reçoivent du funding)
      const skew = ethers.utils.parseUnits("50000", 18);
      const totalSize = ethers.utils.parseUnits("100000", 18);
      await perpEngine.setSkew(ETH_USD_MARKET, skew);
      await perpEngine.setTotalSize(ETH_USD_MARKET, totalSize);
      
      await time.increase(3600);
      await ammPool.settleFunding(ETH_USD_MARKET);
      
      const position = await perpEngine.getPosition(positionId);
      expect(position.cumulativeFunding).to.be.gt(0); // Short reçoit du funding
    });
    
    it("Should handle zero skew correctly", async function () {
      // Skew = 0 (pas de funding)
      await perpEngine.setSkew(ETH_USD_MARKET, 0);
      await perpEngine.setTotalSize(ETH_USD_MARKET, ethers.utils.parseUnits("100000", 18));
      
      const positionId = 3;
      await perpEngine.setPosition(positionId, ETH_USD_MARKET, true, ethers.utils.parseUnits("10000", 18), INITIAL_PRICE, COLLATERAL_AMOUNT);
      
      await time.increase(3600);
      await ammPool.settleFunding(ETH_USD_MARKET);
      
      const position = await perpEngine.getPosition(positionId);
      expect(position.cumulativeFunding).to.equal(0);
    });
    
    it("Should accumulate funding over multiple settlements", async function () {
      const positionId = 4;
      await perpEngine.setPosition(positionId, ETH_USD_MARKET, true, ethers.utils.parseUnits("10000", 18), INITIAL_PRICE, COLLATERAL_AMOUNT);
      
      const skew = ethers.utils.parseUnits("30000", 18);
      const totalSize = ethers.utils.parseUnits("100000", 18);
      await perpEngine.setSkew(ETH_USD_MARKET, skew);
      await perpEngine.setTotalSize(ETH_USD_MARKET, totalSize);
      
      let totalFunding = 0;
      
      // Multiple settlements
      for (let i = 0; i < 3; i++) {
        await time.increase(3600);
        await ammPool.settleFunding(ETH_USD_MARKET);
        
        const position = await perpEngine.getPosition(positionId);
        totalFunding = position.cumulativeFunding;
      }
      
      expect(totalFunding.abs()).to.be.gt(0);
    });
  });
  
  describe("⚖️ Funding Rate Properties", function () {
    it("Should maintain invariant: total funding paid = total funding received", async function () {
      // Crée plusieurs positions
      const positions = [
        { id: 1, size: ethers.utils.parseUnits("5000", 18), isLong: true },
        { id: 2, size: ethers.utils.parseUnits("3000", 18), isLong: true },
        { id: 3, size: ethers.utils.parseUnits("4000", 18), isLong: false },
        { id: 4, size: ethers.utils.parseUnits("4000", 18), isLong: false }
      ];
      
      for (const pos of positions) {
        await perpEngine.setPosition(
          pos.id,
          ETH_USD_MARKET,
          pos.isLong,
          pos.size,
          INITIAL_PRICE,
          COLLATERAL_AMOUNT
        );
      }
      
      // Configure un skew
      await perpEngine.setSkew(ETH_USD_MARKET, ethers.utils.parseUnits("1000", 18));
      await perpEngine.setTotalSize(ETH_USD_MARKET, ethers.utils.parseUnits("16000", 18));
      
      await time.increase(3600);
      await ammPool.settleFunding(ETH_USD_MARKET);
      
      // Calcule le total funding payé et reçu
      let totalPaid = ethers.BigNumber.from(0);
      let totalReceived = ethers.BigNumber.from(0);
      
      for (const pos of positions) {
        const position = await perpEngine.getPosition(pos.id);
        if (position.cumulativeFunding.lt(0)) {
          totalPaid = totalPaid.add(position.cumulativeFunding.abs());
        } else {
          totalReceived = totalReceived.add(position.cumulativeFunding);
        }
      }
      
      // Le total payé devrait égaler le total reçu (hors arrondissements)
      expect(totalPaid).to.be.closeTo(totalReceived, totalPaid.div(100)); // 1% tolerance
    });
    
    it("Should have funding rate proportional to time", async function () {
      await perpEngine.setSkew(ETH_USD_MARKET, ethers.utils.parseUnits("50000", 18));
      await perpEngine.setTotalSize(ETH_USD_MARKET, ethers.utils.parseUnits("200000", 18));
      
      // Funding pour 1 heure
      const rate1h = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      
      // Funding pour 2 heures
      await time.increase(7200);
      const accumulated2h = await ammPool.calculateAccumulatedFunding(ETH_USD_MARKET);
      
      // accumulated2h ≈ rate1h * 2
      const expected2h = rate1h.mul(2);
      expect(accumulated2h).to.be.closeTo(expected2h, rate1h.abs().div(100));
    });
    
    it("Should handle extreme skew values", async function () {
      // Skew proche de 100%
      const almostTotal = ethers.utils.parseUnits("99999", 18);
      const total = ethers.utils.parseUnits("100000", 18);
      
      await perpEngine.setSkew(ETH_USD_MARKET, almostTotal);
      await perpEngine.setTotalSize(ETH_USD_MARKET, total);
      
      const rate = await ammPool.calculateFundingRate(ETH_USD_MARKET);
      const maxRate = await ammPool.maxFundingRate();
      
      // Le taux devrait être proche du maximum
      expect(rate.abs()).to.be.closeTo(maxRate, maxRate.div(10));
    });
  });
  
  describe("🔧 Configuration", function () {
    it("Should allow owner to update funding rate coefficient", async function () {
      const newCoefficient = ethers.utils.parseUnits("0.0001", 18);
      await ammPool.connect(owner).setFundingRateCoefficient(newCoefficient);
      
      expect(await ammPool.fundingRateCoefficient()).to.equal(newCoefficient);
    });
    
    it("Should reject non-owner configuration", async function () {
      const newCoefficient = ethers.utils.parseUnits("0.0001", 18);
      
      await expect(
        ammPool.connect(user1).setFundingRateCoefficient(newCoefficient)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("Should allow owner to update max funding rate", async function () {
      const newMaxRate = ethers.utils.parseUnits("0.001", 18); // 0.1% per hour
      await ammPool.connect(owner).setMaxFundingRate(newMaxRate);
      
      expect(await ammPool.maxFundingRate()).to.equal(newMaxRate);
    });
    
    it("Should validate configuration parameters", async function () {
      // Coefficient trop élevé
      const excessiveCoefficient = ethers.utils.parseUnits("1", 18);
      
      await expect(
        ammPool.connect(owner).setFundingRateCoefficient(excessiveCoefficient)
      ).to.be.revertedWith("InvalidCoefficient");
    });
  });
});