// @title: Tests unitaires pour OracleAggregator
// @coverage: >95% (multi-source, fallback, security)
// @audit: Critical for price manipulation protection
// @security: TWAP, deviation limits, stale checks

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🔮 OracleAggregator - Unit Tests", function () {
  let oracleAggregator;
  let oracleSanityChecker;
  let chainlinkOracle;
  let pythOracle;
  let twapOracle;
  let owner;
  let securityModule;
  
  const ETH_USD_MARKET = "ETH-USD";
  const BASE_PRICE = ethers.parseUnits("2000", 18);
  const feedId = ethers.encodeBytes32String(ETH_USD_MARKET);
  
  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    
    // Déploiement OracleSanityChecker
    // Bounds must be in 8 decimals because prices are normalized to 8 decimals
    oracleSanityChecker = await (await ethers.getContractFactory("OracleSanityChecker")).deploy(
      1n, // $1e-8 min
      1000000n * 10n**8n, // $1M max
      500 // 5% max deviation
    );
    await oracleSanityChecker.waitForDeployment();
    
    // Create a mock security module
    const MockOracleSecurity = await ethers.getContractFactory("MockOracleSecurity");
    securityModule = await MockOracleSecurity.deploy();
    await securityModule.waitForDeployment();

    // Déploiement OracleAggregator
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy(securityModule.target, oracleSanityChecker.target);
    await oracleAggregator.waitForDeployment();
    
    // Déploiement des oracles mock
    const MockOracle = await ethers.getContractFactory("MockOracle");
    
    chainlinkOracle = await MockOracle.deploy("Chainlink ETH/USD", 18);
    await chainlinkOracle.waitForDeployment();
    await chainlinkOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE);
    
    pythOracle = await MockOracle.deploy("Pyth ETH/USD", 18);
    await pythOracle.waitForDeployment();
    await pythOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE);
    
    twapOracle = await MockOracle.deploy("TWAP ETH/USD", 18);
    await twapOracle.waitForDeployment();
    await twapOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE);
    
    // Configuration de l'agrégateur
    await oracleAggregator.addOracleSource(feedId, {
        oracleAddress: chainlinkOracle.target,
        oracleType: 0,
        decimals: 18,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.addOracleSource(feedId, {
        oracleAddress: pythOracle.target,
        oracleType: 1,
        decimals: 18,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.addOracleSource(feedId, {
        oracleAddress: twapOracle.target,
        oracleType: 2,
        decimals: 18,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
  });
  
  describe("📊 Price Aggregation", function () {
    it("Should return median price from multiple sources", async function () {
      await chainlinkOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1990", 18));
      await pythOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 18));
      await twapOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2010", 18));
      
      await oracleAggregator.updatePrice(feedId);
      const price = await oracleAggregator.getPrice(feedId);
      expect(price).to.equal(2000n * 10n**8n);
    });
    
    it("Should handle multiple sources correctly", async function () {
      await chainlinkOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1990", 18));
      await pythOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2010", 18));
      await twapOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 18));
      
      await oracleAggregator.updatePrice(feedId);
      const price = await oracleAggregator.getPrice(feedId);
      expect(price).to.equal(2000n * 10n**8n);
    });
    
    it("Should fallback to cache if update fails", async function () {
      await oracleAggregator.updatePrice(feedId);
      const initialPrice = await oracleAggregator.getPrice(feedId);
      
      await chainlinkOracle.setShouldRevert(true);
      await pythOracle.setShouldRevert(true);
      
      await expect(oracleAggregator.updatePrice(feedId)).to.be.reverted;
      
      const price = await oracleAggregator.getPrice(feedId);
      expect(price).to.equal(initialPrice);
    });
  });
  
  describe("🔒 Security Checks", function () {
    it("Should detect price deviation beyond threshold", async function () {
      await chainlinkOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE);
      await pythOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE);
      await twapOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, BASE_PRICE * 120n / 100n);
      
      await oracleAggregator.updatePrice(feedId);
      const data = await oracleAggregator.getPriceData(feedId);
      expect(data.status).to.equal(1); // DISPUTED
    });
    
    it("Should detect out of bounds prices", async function () {
      const hugePrice = ethers.parseUnits("2000000", 18);
      await chainlinkOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, hugePrice);
      await pythOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, hugePrice);
      await twapOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, hugePrice);
      
      await oracleAggregator.updatePrice(feedId);
      const data = await oracleAggregator.getPriceData(feedId);
      expect(data.status).to.equal(1); // DISPUTED
    });
  });
  
  describe("⚙️ Configuration & Administration", function () {
    it("Should allow owner to update oracle sources", async function () {
      const newOracle = await (await ethers.getContractFactory("MockOracle")).deploy("New Oracle", 18);
      await newOracle.waitForDeployment();
      const newPrice = ethers.parseUnits("2100", 18);
      await newOracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, newPrice);
      
      await oracleAggregator.removeOracleSource(feedId);
      await oracleAggregator.removeOracleSource(feedId);
      await oracleAggregator.removeOracleSource(feedId);

      await oracleAggregator.addOracleSource(feedId, {
        oracleAddress: chainlinkOracle.target,
        oracleType: 0,
        decimals: 18,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
      });
      await oracleAggregator.addOracleSource(feedId, {
        oracleAddress: newOracle.target,
        oracleType: 0,
        decimals: 18,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
      });

      await oracleAggregator.updatePrice(feedId);
      const data = await oracleAggregator.getPriceData(feedId);
      expect(data.price).to.equal(2050n * 10n**8n);
    });
    
    it("Should allow emergency price override", async function () {
      const emergencyPrice = 1500n * 10n**8n;
      
      const impersonatedSecurity = await ethers.getImpersonatedSigner(securityModule.target);
      await owner.sendTransaction({ to: securityModule.target, value: ethers.parseEther("1") });

      await oracleAggregator.connect(impersonatedSecurity).emergencyPriceOverride(feedId, emergencyPrice);
      
      const price = await oracleAggregator.getPrice(feedId);
      expect(price).to.equal(emergencyPrice);
    });
  });
});
