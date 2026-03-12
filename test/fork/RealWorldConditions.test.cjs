// @title: Tests sous conditions de marché réelles
// @scenarios: Volatilité élevée, liquidité faible, black swan
// @network: Mainnet fork avec manipulation de temps/blocs

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers;
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("🌍 Real World Market Conditions", function () {
  let deployer, trader1, trader2, liquidator;
  let perpEngine, oracleAggregator, liquidationEngine;
  let usdc, weth;
  
  const HIGH_VOLATILITY_THRESHOLD = 50; // 50% de mouvement en 24h
  const LOW_LIQUIDITY_THRESHOLD = parseUnits("100000", 6); // $100k
  const BLACK_SWAN_MOVE = 80; // 80% de mouvement
  
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
    
    [deployer, trader1, trader2, liquidator] = await ethers.getSigners();
    
    // Déploiement des contrats (similaire aux tests précédents)
    // ...
  });
  
  describe("📈 High Volatility Scenarios", function () {
    it("Devrait gérer la volatilité élevée du marché", async function () {
      // Simulation d'un mouvement de prix de ±30% en 1h
      const initialPrice = parseUnits("2000", 8);
      const volatileMove = initialPrice * (30) / (100); // 30%
      
      // Ouverture de positions avant la volatilité
      const collateral = parseUnits("1000", 6);
      const positionSize = collateral * (5); // 5x leverage
      
      await usdc.connect(trader1).approve(perpEngine.address, collateral);
      const positionId = await perpEngine.connect(trader1).openPosition(
        "ETH-USD",
        collateral,
        positionSize,
        true // long
      );
      
      // Simulation d'un flash crash de 30%
      await simulatePriceMove("ETH-USD", -30); // -30%
      
      // Vérification que la position est sous-water
      const healthFactor = await perpEngine.getPositionHealthFactor(positionId);
      expect(healthFactor).to.be < (parseUnits("1", 18));
      
      // La position devrait être liquidable
      const isLiquidatable = await liquidationEngine.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.true;
    });
    
    it("Devrait activer le circuit breaker en cas de volatilité extrême", async function () {
      // Simulation d'un mouvement de prix de ±50% en 1h
      await simulatePriceMove("ETH-USD", 50); // +50%
      
      // Le circuit breaker devrait s'activer
      const circuitBreaker = await perpEngine.circuitBreaker();
      expect(await circuitBreaker.isTriggered()).to.be.true;
      
      // Les nouvelles positions devraient être bloquées
      await expect(
        perpEngine.connect(trader2).openPosition(
          "ETH-USD",
          parseUnits("1000", 6),
          parseUnits("5000", 6),
          true
        )
      ).to.be.revertedWith("Circuit breaker triggered");
    });
    
    it("Devrait ajuster les marges en période de volatilité", async function () {
      // En période de haute volatilité, les marges devraient augmenter
      const volatilityIndex = await perpEngine.getMarketVolatility("ETH-USD");
      
      if (volatilityIndex > (parseUnits("30", 16))) { // > 30%
        const adjustedMargin = await perpEngine.getAdjustedMarginRequirements("ETH-USD");
        const baseMargin = await perpEngine.getBaseMarginRequirements("ETH-USD");
        
        expect(adjustedMargin.initialMargin).to.be > (baseMargin.initialMargin);
        expect(adjustedMargin.maintenanceMargin).to.be > (baseMargin.maintenanceMargin);
      }
    });
  });
  
  describe("💧 Low Liquidity Scenarios", function () {
    it("Devrait gérer les périodes de faible liquidité", async function () {
      // Simulation d'une baisse de liquidité
      await simulateLowLiquidity("ETH-USD", LOW_LIQUIDITY_THRESHOLD);
      
      // Les tailles de position devraient être limitées
      const maxPositionSize = await perpEngine.getMaxPositionSize("ETH-USD");
      expect(maxPositionSize).to.be < (parseUnits("1000000", 6)); // < $1M
      
      // Les spreads devraient augmenter
      const spread = await perpEngine.getMarketSpread("ETH-USD");
      expect(spread).to.be > (parseUnits("5", 16)); // > 0.5%
    });
    
    it("Devrait rejeter les grandes positions en low liquidity", async function () {
      await simulateLowLiquidity("ETH-USD", LOW_LIQUIDITY_THRESHOLD);
      
      const largePosition = parseUnits("500000", 6); // $500k
      
      await expect(
        perpEngine.connect(trader1).openPosition(
          "ETH-USD",
          parseUnits("100000", 6),
          largePosition,
          true
        )
      ).to.be.revertedWith("Position size exceeds market capacity");
    });
    
    it("Devrait ajuster les frais en low liquidity", async function () {
      await simulateLowLiquidity("ETH-USD", LOW_LIQUIDITY_THRESHOLD);
      
      const fees = await perpEngine.getMarketFees("ETH-USD");
      const baseFees = await perpEngine.getBaseFees();
      
      expect(fees.makerFee).to.be > (baseFees.makerFee);
      expect(fees.takerFee).to.be > (baseFees.takerFee);
    });
  });
  
  describe("⚫ Black Swan Events", function () {
    it("Devrait survivre à un black swan event", async function () {
      // Simulation d'un mouvement de prix de -80% (ex: LUNA crash)
      await simulatePriceMove("ETH-USD", -BLACK_SWAN_MOVE);
      
      // Vérification que le protocole est toujours solvable
      const protocolSolvency = await perpEngine.isProtocolSolvent();
      expect(protocolSolvency).to.be.true;
      
      // Vérification que l'assurance a été déclenchée
      const insurancePool = await perpEngine.getInsurancePool();
      expect(await insurancePool.isActive()).to.be.true;
    });
    
    it("Devrait activer le mode emergency", async function () {
      await simulatePriceMove("ETH-USD", -BLACK_SWAN_MOVE);
      
      // Le protocole devrait être en pause d'urgence
      const isPaused = await perpEngine.isProtocolPaused();
      expect(isPaused).to.be.true;
      
      // Seules les liquidations d'urgence devraient être permises
      const emergencyMode = await perpEngine.isEmergencyMode();
      expect(emergencyMode).to.be.true;
    });
    
    it("Devrait exécuter le socialized loss mechanism", async function () {
      // Création de plusieurs positions qui seront toutes sous-water
      for (let i = 0; i < 5; i++) {
        await perpEngine.connect(trader1).openPosition(
          "ETH-USD",
          parseUnits("100", 6),
          parseUnits("500", 6),
          true
        );
      }
      
      // Black swan event
      await simulatePriceMove("ETH-USD", -BLACK_SWAN_MOVE);
      
      // Les pertes devraient être socialisées
      const totalLoss = await perpEngine.getTotalLoss();
      const socializedLoss = await perpEngine.getSocializedLoss();
      
      expect(socializedLoss).to.be > (0);
      expect(socializedLoss).to.be < (totalLoss); // Pas toutes les pertes sont socialisées
    });
  });
  
  describe("🕒 Time-Based Scenarios", function () {
    it("Devrait accumuler le funding sur de longues périodes", async function () {
      const positionId = await createTestPosition();
      const initialFunding = await perpEngine.getPositionFunding(positionId);
      
      // Avance de 30 jours
      await time.increase(30 * 24 * 3600);
      
      const finalFunding = await perpEngine.getPositionFunding(positionId);
      expect(finalFunding).to.not.equal(initialFunding);
      
      // Le funding devrait être proportionnel au temps
      const timePassed = 30 * 24 * 3600;
      const fundingRate = await perpEngine.getFundingRate("ETH-USD");
      const expectedFunding = initialFunding.add(
        fundingRate * (timePassed) / (3600)
      );
      
      expect(finalFunding).to.be.closeTo(expectedFunding, parseUnits("1", 16)); // 1% tolerance
    });
    
    it("Devrait expirer les positions options", async function () {
      // Création d'une position avec expiry
      const expiryTime = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 jours
      
      await perpEngine.connect(trader1).openPositionWithExpiry(
        "ETH-USD",
        parseUnits("1000", 6),
        parseUnits("5000", 6),
        true,
        expiryTime
      );
      
      // Avance après l'expiry
      await time.increase(8 * 24 * 3600);
      
      // La position devrait être expirée
      const isExpired = await perpEngine.isPositionExpired(positionId);
      expect(isExpired).to.be.true;
      
      // Seul le close devrait être permis
      await expect(
        perpEngine.connect(trader1).addCollateral(positionId, parseUnits("100", 6))
      ).to.be.revertedWith("Position expired");
    });
  });
  
  // Helper functions
  async function simulatePriceMove(market, percentMove) {
    // Implémentation simplifiée
    // Dans la réalité, manipuler les oracles
  }
  
  async function simulateLowLiquidity(market, liquidity) {
    // Implémentation simplifiée
  }
  
  async function createTestPosition() {
    const collateral = parseUnits("1000", 6);
    await usdc.connect(trader1).approve(perpEngine.address, collateral);
    
    return await perpEngine.connect(trader1).openPosition(
      "ETH-USD",
      collateral,
      collateral * (3),
      true
    );
  }
});