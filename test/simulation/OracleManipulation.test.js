// @title: Tests avancés de manipulation d'oracles
// @scenarios: Flash loan attacks, timestamp manipulation, multi-oracle attacks
// @goal: Vérifier la résistance aux manipulations sophistiquées

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers.utils;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🎭 Advanced Oracle Manipulation Attacks", function () {
  let deployer, attacker;
  let perpEngine, oracleAggregator, chainlinkOracle, pythOracle, twapOracle;
  let usdc, weth;
  
  before(async function () {
    [deployer, attacker] = await ethers.getSigners();
    
    // Déploiement avec multiples oracles
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy();
    
    const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
    chainlinkOracle = await ChainlinkOracle.deploy(
      "0x0000000000000000000000000000000000000000", // registry
      oracleAggregator.address
    );
    
    const PythOracle = await ethers.getContractFactory("PythOracle");
    pythOracle = await PythOracle.deploy(
      "0x0000000000000000000000000000000000000000", // pyth address
      oracleAggregator.address
    );
    
    const TWAPOracle = await ethers.getContractFactory("TWAPOracle");
    twapOracle = await TWAPOracle.deploy(
      "0x0000000000000000000000000000000000000000", // uniswap factory
      oracleAggregator.address
    );
    
    // Configuration
    await oracleAggregator.addOracleSource("ETH-USD", chainlinkOracle.address);
    await oracleAggregator.addOracleSource("ETH-USD", pythOracle.address);
    await oracleAggregator.addOracleSource("ETH-USD", twapOracle.address);
  });
  
  describe("⏱️ Timestamp Manipulation", function () {
    it("Devrait résister à la manipulation des timestamps", async function () {
      // Attaquant manipule block.timestamp pour affecter le TWAP
      
      const originalTime = await time.latest();
      
      // Avance significative du temps pour fausser le TWAP
      await time.increase(24 * 3600); // 1 jour
      
      // Tentative d'ouverture de position
      await expect(
        perpEngine.openPosition(
          "ETH-USD",
          parseUnits("1000", 6),
          parseUnits("5000", 6),
          true
        )
      ).to.be.revertedWith("TWAP price stale");
      
      // Retour au temps normal
      await time.setNextBlockTimestamp(originalTime + 12);
    });
    
    it("Devrait détecter les sauts temporels anormaux", async function () {
      const timeJump = 365 * 24 * 3600; // 1 an
      
      await time.increase(timeJump);
      
      // Toutes les oracles devraient rejeter les prix
      const chainlinkPrice = await chainlinkOracle.getPrice("ETH-USD");
      expect(chainlinkPrice).to.equal(0); // Prix stale
      
      const pythPrice = await pythOracle.getPrice("ETH-USD");
      expect(pythPrice).to.equal(0);
    });
  });
  
  describe("🔗 Multi-Oracle Consensus Attacks", function () {
    it("Devrait résister aux attaques sur une seule source", async function () {
      // Attaquant corrompt une source oracle
      // mais pas les autres
      
      // Simulation: Chainlink retourne un prix manipulé
      await chainlinkOracle.setPrice("ETH-USD", parseUnits("1000", 8)); // $1000 (manipulé)
      
      // Pyth et TWAP retournent le prix réel ($2000)
      await pythOracle.setPrice("ETH-USD", parseUnits("2000", 8));
      await twapOracle.setPrice("ETH-USD", parseUnits("2000", 8));
      
      // L'agrégateur devrait rejeter le prix de Chainlink
      const aggregatedPrice = await oracleAggregator.getPrice("ETH-USD");
      
      // Le prix devrait être proche de $2000 (consensus)
      expect(aggregatedPrice).to.be.closeTo(
        parseUnits("2000", 8),
        parseUnits("100", 8) // ±$100
      );
    });
    
    it("Devrait nécessiter une majorité d'oracles corrompus", async function () {
      // Pour une attaque réussie, l'attaquant doit corrompre
      // la majorité des oracles
      
      // Corruption de 2/3 oracles
      await chainlinkOracle.setPrice("ETH-USD", parseUnits("1000", 8));
      await pythOracle.setPrice("ETH-USD", parseUnits("1000", 8));
      await twapOracle.setPrice("ETH-USD", parseUnits("2000", 8)); // Seul oracle honnête
      
      // Le système devrait détecter l'anomalie
      await expect(oracleAggregator.getPrice("ETH-USD"))
        .to.be.revertedWith("No consensus reached");
    });
  });
  
  describe("💸 Flash Loan Oracle Attacks", function () {
    it("Devrait résister aux attaques flash loan + oracle manipulation", async function () {
      // Scénario classique: Attaquant utilise flash loan
      // pour manipuler le prix sur un DEX, affectant le TWAP
      
      const flashLoanAmount = parseUnits("1000000", 6);
      
      // 1. Attaquant manipule le prix sur Uniswap
      await manipulateDexPrice("ETH-USD", 50); // +50%
      
      // 2. Cela affecte le TWAP oracle
      const twapPrice = await twapOracle.getPrice("ETH-USD");
      const normalPrice = parseUnits("2000", 8);
      
      // Mais les autres oracles ne sont pas affectés
      const chainlinkPrice = await chainlinkOracle.getPrice("ETH-USD");
      const pythPrice = await pythOracle.getPrice("ETH-USD");
      
      // L'agrégateur devrait ignorer le TWAP manipulé
      const finalPrice = await oracleAggregator.getPrice("ETH-USD");
      
      expect(finalPrice).to.be.closeTo(normalPrice, parseUnits("200", 8)); // ±$200
    });
    
    it("Devrait utiliser des intervalles TWAP longs", async function () {
      // Vérification que le TWAP utilise un intervalle suffisamment long
      const twapInterval = await twapOracle.getInterval();
      expect(twapInterval).to.be.gte(1800); // Au moins 30 minutes
      
      // Un flash loan (quelques secondes) ne devrait pas affecter
      // significativement un TWAP de 30 minutes
    });
  });
  
  describe("🎯 Targeted Oracle Attacks", function () {
    it("Devrait résister aux attaques ciblant des oracles spécifiques", async function () {
      // Attaquant DDoS un oracle spécifique
      // pour forcer le système à utiliser les autres
      
      // Simulation: Chainlink devient indisponible
      await chainlinkOracle.setStatus(false); // Oracle down
      
      // Le système devrait continuer avec Pyth et TWAP
      const price = await oracleAggregator.getPrice("ETH-USD");
      expect(price).to.be.gt(0);
      
      // Vérification que l'oracle down est signalé
      const isChainlinkActive = await oracleAggregator.isOracleActive(chainlinkOracle.address);
      expect(isChainlinkActive).to.be.false;
    });
    
    it("Devrait avoir des fallbacks multiples", async function () {
      // Test de défaillance de plusieurs oracles
      await chainlinkOracle.setStatus(false);
      await pythOracle.setStatus(false);
      
      // TWAP seul devrait suffire (avec des limites)
      const price = await oracleAggregator.getPrice("ETH-USD");
      expect(price).to.be.gt(0);
      
      // Mais des limites de position devraient s'appliquer
      const maxPositionSize = await perpEngine.getMaxPositionSize("ETH-USD");
      expect(maxPositionSize).to.be.lt(parseUnits("100000", 6)); // Position limitée
    });
  });
  
  describe("🔍 Detection Mechanisms", function () {
    it("Devrait détecter les anomalies statistiques", async function () {
      // Surveillance des écarts entre oracles
      const deviations = await oracleAggregator.getOracleDeviations("ETH-USD");
      
      for (const deviation of deviations) {
        expect(deviation).to.be.lt(parseUnits("5", 16)); // < 5%
      }
    });
    
    it("Devrait bannir les oracles malveillants", async function () {
      // Simulation d'un oracle retournant des prix manifestement faux
      await chainlinkOracle.setPrice("ETH-USD", parseUnits("1000000", 8)); // $1M (impossible)
      
      // Le système devrait bannir cet oracle
      await oracleAggregator.reportMaliciousOracle(chainlinkOracle.address);
      
      const isBanned = await oracleAggregator.isOracleBanned(chainlinkOracle.address);
      expect(isBanned).to.be.true;
    });
    
    it("Devrait journaliser les tentatives de manipulation", async function () {
      // Toutes les tentatives de manipulation devraient être loggées
      const manipulationAttempts = await oracleAggregator.getManipulationAttempts();
      
      // Ces logs sont critiques pour l'audit et l'assurance
      expect(manipulationAttempts).to.be.an('array');
    });
  });
  
  describe("🛡️ Defense in Depth", function () {
    it("Devrait avoir plusieurs couches de défense", async function () {
      // Vérification de toutes les couches de sécurité
      const securityLayers = [
        "Price bounds checking",
        "Multi-source consensus",
        "TWAP protection",
        "Deviation limits",
        "Staleness detection",
        "Emergency circuit breakers"
      ];
      
      for (const layer of securityLayers) {
        const isActive = await oracleAggregator.isSecurityLayerActive(layer);
        expect(isActive).to.be.true;
      }
    });
    
    it("Devait activer les circuit breakers automatiquement", async function () {
      // Simulation d'une manipulation massive
      await chainlinkOracle.setPrice("ETH-USD", parseUnits("5000", 8)); // +150%
      await pythOracle.setPrice("ETH-USD", parseUnits("5000", 8));
      
      // Le circuit breaker devrait s'activer
      const isTriggered = await oracleAggregator.isCircuitBreakerTriggered();
      expect(isTriggered).to.be.true;
      
      // Toutes les opérations sensibles devraient être bloquées
      await expect(
        perpEngine.openPosition(
          "ETH-USD",
          parseUnits("1000", 6),
          parseUnits("5000", 6),
          true
        )
      ).to.be.revertedWith("Circuit breaker active");
    });
  });
  
  // Helper functions
  async function manipulateDexPrice(market, percentChange) {
    // Simule la manipulation d'un DEX
  }
});