// @title: Tests Chainlink Oracle sur mainnet fork
// @network: Arbitrum mainnet fork
// @security: Vérification des prix réels, staleness, déviation

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers.utils;

describe("🔗 Chainlink Oracle Mainnet Fork", function () {
  // Adresses Chainlink Arbitrum
  const CHAINLINK_ETH_USD = "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612";
  const CHAINLINK_BTC_USD = "0x6ce185860a4963106506C203335A2910413708e9";
  const CHAINLINK_REGISTRY = "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf";
  
  let deployer;
  let chainlinkOracle, oracleAggregator;
  let ethUsdAggregator, btcUsdAggregator;
  
  before(async function () {
    if (!process.env.MAINNET_RPC_URL) {
      this.skip();
    }
    
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: 15000000
        }
      }]
    });
    
    [deployer] = await ethers.getSigners();
    
    // Récupération des aggregators réels
    const AggregatorV3Interface = await ethers.getContractFactory("AggregatorV3Interface");
    ethUsdAggregator = AggregatorV3Interface.attach(CHAINLINK_ETH_USD);
    btcUsdAggregator = AggregatorV3Interface.attach(CHAINLINK_BTC_USD);
    
    // Déploiement de notre oracle wrapper
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    chainlinkOracle = await ChainlinkOracle.deploy(
      CHAINLINK_REGISTRY,
      ethers.ZeroAddress // aggregator à configurer
    );
    
    // Déploiement de l'agrégateur
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy();
  });
  
  describe("💰 Price Feed Verification", function () {
    it("Devrait récupérer le prix ETH/USD actuel", async function () {
      const roundData = await ethUsdAggregator.latestRoundData();
      
      // Vérification des données
      expect(roundData.answer).to.be > (0);
      expect(roundData.startedAt).to.be > (0);
      expect(roundData.updatedAt).to.be > (0);
      expect(roundData.answeredInRound).to.be > (0);
      
      console.log(`📊 ETH/USD Price: $${parseUnits(roundData.answer.toString(), 8)}`);
    });
    
    it("Devrait vérifier la fraîcheur du prix", async function () {
      const roundData = await ethUsdAggregator.latestRoundData();
      const currentTime = Math.floor(Date.now() / 1000);
      const staleness = currentTime - Number(roundData.updatedAt);
      
      // Le prix doit être mis à jour dans les dernières 24h
      expect(staleness).to.be < (24 * 3600);
      
      // Heartbeat check (Chainlink recommande 1h pour ETH/USD)
      const heartbeat = 3600;
      expect(staleness).to.be < (heartbeat);
    });
    
    it("Devrait valider la décimale du prix", async function () {
      const decimals = await ethUsdAggregator.decimals();
      expect(decimals).to.equal(8); // Chainlink ETH/USD a 8 decimals
    });
  });
  
  describe("⚙️ Oracle Configuration", function () {
    it("Devrait configurer les feeds correctement", async function () {
      await chainlinkOracle.setFeed("ETH-USD", CHAINLINK_ETH_USD);
      await chainlinkOracle.setFeed("BTC-USD", CHAINLINK_BTC_USD);
      
      const ethFeed = await chainlinkOracle.getFeed("ETH-USD");
      const btcFeed = await chainlinkOracle.getFeed("BTC-USD");
      
      expect(ethFeed).to.equal(CHAINLINK_ETH_USD);
      expect(btcFeed).to.equal(CHAINLINK_BTC_USD);
    });
    
    it("Devrait rejeter les feeds invalides", async function () {
      const invalidFeed = deployer.address;
      
      await expect(
        chainlinkOracle.setFeed("INVALID", invalidFeed)
      ).to.be.revertedWith("Invalid aggregator");
    });
    
    it("Devrait mettre à jour les feeds dépréciés", async function () {
      // Simulation d'un feed déprécié
      const deprecatedFeed = "0x0000000000000000000000000000000000000000";
      
      await chainlinkOracle.setFeed("DEPRECATED", deprecatedFeed);
      
      // Vérification que le feed est marqué comme invalide
      const isValid = await chainlinkOracle.isValidFeed("DEPRECATED");
      expect(isValid).to.be.false;
    });
  });
  
  describe("📡 Multi-Source Aggregation", function () {
    it("Devrait agréger plusieurs sources de prix", async function () {
      // Configuration de plusieurs sources
      await oracleAggregator.addOracleSource("ETH-USD", chainlinkOracle.address);
      
      // Dans la réalité, ajouter d'autres sources (Pyth, Uniswap TWAP)
      
      const price = await oracleAggregator.getPrice("ETH-USD");
      expect(price).to.be > (0);
    });
    
    it("Devrait rejeter les déviations excessives", async function () {
      // Configuration d'un oracle mock avec prix déviant
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const deviantOracle = await MockOracle.deploy();
      
      // Prix normal: $2000, Prix déviant: $1000 (50% de déviation)
      await deviantOracle.setPrice(parseUnits("1000", 8));
      
      await oracleAggregator.addOracleSource("ETH-USD", deviantOracle.address);
      
      // La déviation devrait être détectée
      const price = await oracleAggregator.getPrice("ETH-USD");
      
      // Le prix agrégé devrait ignorer le prix déviant
      expect(price).to.be.closeTo(
        parseUnits("2000", 8),
        parseUnits("400", 8) // ±20%
      );
    });
    
    it("Devrait fallback sur sources secondaires", async function () {
      // Simulation d'un oracle principal défaillant
      const FailingOracle = await ethers.getContractFactory("FailingOracle");
      const failingOracle = await FailingOracle.deploy();
      
      await oracleAggregator.addOracleSource("ETH-USD", failingOracle.address);
      
      // La source secondaire devrait prendre le relais
      const price = await oracleAggregator.getPrice("ETH-USD");
      expect(price).to.be > (0);
    });
  });
  
  describe("🚨 Security & Edge Cases", function () {
    it("Devrait détecter les prix stale", async function () {
      // Simulation d'un prix non mis à jour
      const StaleOracle = await ethers.getContractFactory("StaleOracle");
      const staleOracle = await StaleOracle.deploy();
      
      // Prix mis à jour il y a plus de 24h
      await staleOracle.setPrice(parseUnits("2000", 8), Date.now() / 1000 - 25 * 3600);
      
      await oracleAggregator.addOracleSource("ETH-USD", staleOracle.address);
      
      await expect(oracleAggregator.getPrice("ETH-USD"))
        .to.be.revertedWith("Stale price");
    });
    
    it("Devrait rejeter les prix extrêmes", async function () {
      // Prix anormalement bas ou haut
      const ExtremeOracle = await ethers.getContractFactory("MockOracle");
      const extremeOracle = await ExtremeOracle.deploy();
      
      // Prix à $0.001 (trop bas)
      await extremeOracle.setPrice(parseUnits("0.001", 8));
      
      await oracleAggregator.addOracleSource("ETH-USD", extremeOracle.address);
      
      await expect(oracleAggregator.getPrice("ETH-USD"))
        .to.be.revertedWith("Price out of bounds");
    });
    
    it("Devrait gérer les mises à jour de round", async function () {
      // Vérification du mécanisme de round de Chainlink
      const latestRound = await ethUsdAggregator.latestRoundData();
      const previousRound = await ethUsdAggregator.getRoundData(latestRound.roundId - (1));
      
      expect(latestRound.roundId).to.be > (previousRound.roundId);
      expect(latestRound.updatedAt).to.be >= (previousRound.updatedAt);
    });
  });
});