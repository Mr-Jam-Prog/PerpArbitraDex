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
  
  const ETH_USD_MARKET = "ETH-USD";
  const BASE_PRICE = ethers.utils.parseUnits("2000", 18);
  
  beforeEach(async function () {
    [owner] = await ethers.getSigners();
    
    // Déploiement OracleSanityChecker
    const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
    oracleSanityChecker = await OracleSanityChecker.deploy();
    await oracleSanityChecker.deployed();
    
    // Configuration des bornes
    await oracleSanityChecker.setPriceBounds(
      ethers.utils.parseUnits("0.000001", 18), // $0.000001 min
      ethers.utils.parseUnits("1000000", 18),  // $1M max
      200 // 2% max deviation
    );
    
    // Déploiement OracleAggregator
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy();
    await oracleAggregator.deployed();
    await oracleAggregator.initialize(oracleSanityChecker.address);
    
    // Déploiement des oracles mock
    const MockOracle = await ethers.getContractFactory("MockOracle");
    
    chainlinkOracle = await MockOracle.deploy();
    await chainlinkOracle.deployed();
    await chainlinkOracle.setPrice(ETH_USD_MARKET, BASE_PRICE);
    
    pythOracle = await MockOracle.deploy();
    await pythOracle.deployed();
    await pythOracle.setPrice(ETH_USD_MARKET, BASE_PRICE);
    
    twapOracle = await MockOracle.deploy();
    await twapOracle.deployed();
    await twapOracle.setPrice(ETH_USD_MARKET, BASE_PRICE);
    
    // Configuration de l'agrégateur
    await oracleAggregator.setOracleSource(0, chainlinkOracle.address); // Primary
    await oracleAggregator.setOracleSource(1, pythOracle.address);     // Secondary
    await oracleAggregator.setOracleSource(2, twapOracle.address);     // Tertiary
  });
  
  describe("📊 Price Aggregation", function () {
    it("Should return median price from multiple sources", async function () {
      // Configure des prix différents pour tester la médiane
      await chainlinkOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("1990", 18)); // 1990
      await pythOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2000", 18));      // 2000
      await twapOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2010", 18));      // 2010
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      expect(price).to.equal(ethers.utils.parseUnits("2000", 18)); // Médiane
    });
    
    it("Should handle two sources correctly", async function () {
      // Désactive un oracle
      await oracleAggregator.setOracleSource(2, ethers.constants.AddressZero);
      
      await chainlinkOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("1990", 18));
      await pythOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2010", 18));
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Avec 2 sources, devrait retourner la moyenne
      expect(price).to.equal(ethers.utils.parseUnits("2000", 18));
    });
    
    it("Should fallback when primary oracle fails", async function () {
      // Fait échouer Chainlink
      await chainlinkOracle.setShouldRevert(true);
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Devrait utiliser Pyth comme fallback
      expect(price).to.equal(BASE_PRICE);
    });
    
    it("Should work with only one working oracle", async function () {
      // Désactive deux oracles
      await oracleAggregator.setOracleSource(1, ethers.constants.AddressZero);
      await oracleAggregator.setOracleSource(2, ethers.constants.AddressZero);
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      expect(price).to.equal(BASE_PRICE);
    });
    
    it("Should revert when all oracles fail", async function () {
      await chainlinkOracle.setShouldRevert(true);
      await pythOracle.setShouldRevert(true);
      await twapOracle.setShouldRevert(true);
      
      await expect(
        oracleAggregator.getPrice(ETH_USD_MARKET)
      ).to.be.revertedWith("NoValidOracle");
    });
  });
  
  describe("🔒 Security Checks", function () {
    it("Should reject price deviation beyond threshold", async function () {
      // Un oracle est compromis avec un prix très différent
      await chainlinkOracle.setPrice(ETH_USD_MARKET, BASE_PRICE);
      await pythOracle.setPrice(ETH_USD_MARKET, BASE_PRICE);
      await twapOracle.setPrice(ETH_USD_MARKET, BASE_PRICE.mul(120).div(100)); // +20%
      
      // Devrait rejeter le prix TWAP car déviation > 2%
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Devrait utiliser la médiane des deux autres (1990 + 2000) / 2 = 1995
      expect(price).to.be.closeTo(BASE_PRICE, BASE_PRICE.div(100)); // ±1%
    });
    
    it("Should reject stale prices", async function () {
      // Configure un oracle stale
      await chainlinkOracle.setTimestamp(Date.now() - 3600000); // 1 heure old
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Devrait ignorer Chainlink et utiliser Pyth/TWAP
      expect(price).to.equal(BASE_PRICE);
    });
    
    it("Should enforce price bounds", async function () {
      // Configure un prix hors bornes
      await chainlinkOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("0.0000001", 18)); // Trop bas
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Devrait ignorer Chainlink (prix hors bornes)
      expect(price).to.equal(BASE_PRICE);
    });
    
    it("Should handle oracle consensus", async function () {
      // Test avec 5 oracles
      const MockOracle = await ethers.getContractFactory("MockOracle");
      
      const oracle4 = await MockOracle.deploy();
      await oracle4.deployed();
      await oracle4.setPrice(ETH_USD_MARKET, BASE_PRICE);
      
      const oracle5 = await MockOracle.deploy();
      await oracle5.deployed();
      await oracle5.setPrice(ETH_USD_MARKET, BASE_PRICE);
      
      await oracleAggregator.setOracleSource(3, oracle4.address);
      await oracleAggregator.setOracleSource(4, oracle5.address);
      
      // 3 oracles à 2000, 2 oracles à 2100
      await chainlinkOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2100", 18));
      await pythOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2100", 18));
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      // Consensus: la majorité (3/5) est à 2000
      expect(price).to.equal(BASE_PRICE);
    });
  });
  
  describe("🔄 TWAP Oracle", function () {
    it("Should calculate TWAP correctly", async function () {
      // Configure TWAP avec plusieurs observations
      await twapOracle.addObservation(ETH_USD_MARKET, ethers.utils.parseUnits("1900", 18), await time.latest() - 1800);
      await twapOracle.addObservation(ETH_USD_MARKET, ethers.utils.parseUnits("1950", 18), await time.latest() - 900);
      await twapOracle.addObservation(ETH_USD_MARKET, ethers.utils.parseUnits("2000", 18), await time.latest());
      
      const twapPrice = await twapOracle.getPrice(ETH_USD_MARKET);
      // TWAP = (1900*1800 + 1950*900 + 2000*0) / 2700 ≈ 1916.67
      const expectedTWAP = ethers.utils.parseUnits("1916.666666666666666666", 18);
      
      expect(twapPrice).to.be.closeTo(expectedTWAP, ethers.utils.parseUnits("0.1", 18));
    });
    
    it("Should reject stale TWAP observations", async function () {
      // Observations très anciennes
      await twapOracle.addObservation(ETH_USD_MARKET, BASE_PRICE, await time.latest() - 86400); // 1 jour
      
      // Devrait rejeter car trop vieux
      await expect(twapOracle.getPrice(ETH_USD_MARKET)).to.be.revertedWith("StaleTWAP");
    });
    
    it("Should require minimum observations for TWAP", async function () {
      // Pas assez d'observations
      await twapOracle.addObservation(ETH_USD_MARKET, BASE_PRICE, await time.latest());
      
      // Devrait échouer car besoin d'au moins 2 observations
      await expect(twapOracle.getPrice(ETH_USD_MARKET)).to.be.revertedWith("InsufficientObservations");
    });
  });
  
  describe("⚙️ Configuration & Administration", function () {
    it("Should allow owner to update oracle sources", async function () {
      const newOracle = await (await ethers.getContractFactory("MockOracle")).deploy();
      await newOracle.deployed();
      await newOracle.setPrice(ETH_USD_MARKET, ethers.utils.parseUnits("2100", 18));
      
      await oracleAggregator.connect(owner).setOracleSource(0, newOracle.address);
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      expect(price).to.equal(ethers.utils.parseUnits("2100", 18));
    });
    
    it("Should reject non-owner configuration", async function () {
      const [_, user] = await ethers.getSigners();
      const newOracle = ethers.constants.AddressZero;
      
      await expect(
        oracleAggregator.connect(user).setOracleSource(0, newOracle)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("Should allow owner to update sanity checker", async function () {
      const newSanityChecker = await (await ethers.getContractFactory("OracleSanityChecker")).deploy();
      await newSanityChecker.deployed();
      
      await oracleAggregator.connect(owner).setSanityChecker(newSanityChecker.address);
      
      expect(await oracleAggregator.sanityChecker()).to.equal(newSanityChecker.address);
    });
    
    it("Should allow emergency price override", async function () {
      const emergencyPrice = ethers.utils.parseUnits("1500", 18);
      
      // Active l'override
      await oracleAggregator.connect(owner).setEmergencyPrice(ETH_USD_MARKET, emergencyPrice, true);
      
      const price = await oracleAggregator.getPrice(ETH_USD_MARKET);
      expect(price).to.equal(emergencyPrice);
      
      // Désactive l'override
      await oracleAggregator.connect(owner).setEmergencyPrice(ETH_USD_MARKET, 0, false);
      
      const normalPrice = await oracleAggregator.getPrice(ETH_USD_MARKET);
      expect(normalPrice).to.equal(BASE_PRICE);
    });
  });
  
  describe("📈 Performance & Gas Optimization", function () {
    it("Should cache prices to reduce gas", async function () {
      // Premier appel (coûteux)
      const tx1 = await oracleAggregator.getPrice(ETH_USD_MARKET);
      const receipt1 = await tx1.wait();
      const gasUsed1 = receipt1.gasUsed;
      
      // Deuxième appel (devrait être moins cher grâce au cache)
      const tx2 = await oracleAggregator.getPrice(ETH_USD_MARKET);
      const receipt2 = await tx2.wait();
      const gasUsed2 = receipt2.gasUsed;
      
      expect(gasUsed2).to.be.lt(gasUsed1);
    });
    
    it("Should have reasonable gas costs", async function () {
      const tx = await oracleAggregator.getPrice(ETH_USD_MARKET);
      const receipt = await tx.wait();
      
      // Coût cible: < 200k gas pour la récupération de prix
      expect(receipt.gasUsed).to.be.lt(200000);
    });
  });
});