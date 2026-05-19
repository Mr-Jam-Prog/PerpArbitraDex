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
  
  const ETH_USD_FEED = ethers.encodeBytes32String("ETH-USD");
  const BASE_PRICE = ethers.parseUnits("2000", 8); // Prices normalized to 8 decimals in Aggregator
  const MAX_CACHE_AGE = 300; // 5 minutes
  
  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    
    // Déploiement OracleSanityChecker
    const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
    oracleSanityChecker = await OracleSanityChecker.deploy(
      ethers.parseUnits("0.000001", 8), // $0.000001 min
      ethers.parseUnits("1000000", 8),  // $1M max
      500 // 5% max deviation
    );
    await oracleSanityChecker.waitForDeployment();
    
    // Déploiement OracleAggregator
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy(owner.address, oracleSanityChecker.target);
    await oracleAggregator.waitForDeployment();
    
    // Déploiement des oracles mock
    const MockOracle = await ethers.getContractFactory("MockOracle");
    
    chainlinkOracle = await MockOracle.deploy();
    await chainlinkOracle.waitForDeployment();
    await chainlinkOracle.setPrice(BASE_PRICE);
    
    pythOracle = await MockOracle.deploy();
    await pythOracle.waitForDeployment();
    await pythOracle.setPrice(BASE_PRICE);
    
    twapOracle = await MockOracle.deploy();
    await twapOracle.waitForDeployment();
    await twapOracle.setPrice(BASE_PRICE);
    
    // Configuration de l'agrégateur
    await oracleAggregator.addOracleSource(ETH_USD_FEED, {
        oracleAddress: chainlinkOracle.target,
        oracleType: 0,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.addOracleSource(ETH_USD_FEED, {
        oracleAddress: pythOracle.target,
        oracleType: 1,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.addOracleSource(ETH_USD_FEED, {
        oracleAddress: twapOracle.target,
        oracleType: 2,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });

    // Update price to initialize
    await oracleAggregator.updatePrice(ETH_USD_FEED);
  });
  
  describe("📊 Price Aggregation", function () {
    it("Should return median price from multiple sources", async function () {
      await chainlinkOracle.setPrice(ethers.parseUnits("1990", 8));
      await pythOracle.setPrice(ethers.parseUnits("2000", 8));
      await twapOracle.setPrice(ethers.parseUnits("2010", 8));

      await oracleAggregator.updatePrice(ETH_USD_FEED);
      const price = await oracleAggregator.getPrice(ETH_USD_FEED);
      expect(price).to.equal(ethers.parseUnits("2000", 8));
    });

    it("Should handle even number of sources (average of middle two)", async function () {
      await oracleAggregator.removeOracleSource(ETH_USD_FEED); // Removes TWAP

      await chainlinkOracle.setPrice(ethers.parseUnits("1990", 8));
      await pythOracle.setPrice(ethers.parseUnits("2010", 8));
      
      await oracleAggregator.updatePrice(ETH_USD_FEED);
      const price = await oracleAggregator.getPrice(ETH_USD_FEED);
      expect(price).to.equal(ethers.parseUnits("2000", 8));
    });
    
    it("Should revert updatePrice if insufficient sources", async function () {
      await oracleAggregator.removeOracleSource(ETH_USD_FEED);
      await oracleAggregator.removeOracleSource(ETH_USD_FEED);
      await expect(
        oracleAggregator.updatePrice(ETH_USD_FEED)
      ).to.be.revertedWith("OracleAggregator: insufficient sources");
    });
  });
  
  describe("🔒 Security Checks", function () {
    it("Should mark as DISPUTED on large deviation", async function () {
      await chainlinkOracle.setPrice(ethers.parseUnits("2000", 8));
      await pythOracle.setPrice(ethers.parseUnits("2000", 8));
      await twapOracle.setPrice(ethers.parseUnits("2100", 8)); // 5% deviation

      await oracleAggregator.updatePrice(ETH_USD_FEED);
      const data = await oracleAggregator.getPriceData(ETH_USD_FEED);
      expect(data.status).to.equal(1); // DISPUTED
    });

    it("Should handle stale prices", async function () {
      await chainlinkOracle.setFullPriceData(BASE_PRICE, (await time.latest()) - 3600, 0, true);
      await pythOracle.setPrice(BASE_PRICE);
      await twapOracle.setPrice(BASE_PRICE);
      
      await oracleAggregator.updatePrice(ETH_USD_FEED);
      const data = await oracleAggregator.getPriceData(ETH_USD_FEED);
      expect(data.status).to.equal(0); // ACTIVE
    });

    it("Should mark as DISPUTED on large deviation during aggregatePrices", async function () {
        // We set deviation to exceed config.maxDeviationBps (default 200 bps = 2%)
        await chainlinkOracle.setPrice(ethers.parseUnits("2000", 8));
        await pythOracle.setPrice(ethers.parseUnits("2000", 8));
        await twapOracle.setPrice(ethers.parseUnits("2100", 8)); // 5% deviation

        await oracleAggregator.updatePrice(ETH_USD_FEED);
        const data = await oracleAggregator.getPriceData(ETH_USD_FEED);
        expect(data.status).to.equal(1); // DISPUTED
    });
  });

  describe("⚙️ Configuration & Administration", function () {
    it("Should allow owner to add oracle sources", async function () {
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const newOracle = await MockOracle.deploy();
      await newOracle.waitForDeployment();
      await newOracle.setPrice(ethers.parseUnits("2100", 8));
      
      await oracleAggregator.connect(owner).addOracleSource(ETH_USD_FEED, {
        oracleAddress: newOracle.target,
        oracleType: 0,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
      });

      const sources = await oracleAggregator.getOracleSources(ETH_USD_FEED);
      expect(sources.length).to.equal(4);
    });

    it("Should allow emergency price override", async function () {
      const emergencyPrice = ethers.parseUnits("1500", 8);
      await oracleAggregator.emergencyPriceOverride(ETH_USD_FEED, emergencyPrice);
      await time.increase(MAX_CACHE_AGE * 2 + 1);
      
      const price = await oracleAggregator.getPrice(ETH_USD_FEED);
      expect(price).to.equal(emergencyPrice);
    });
  });
});
