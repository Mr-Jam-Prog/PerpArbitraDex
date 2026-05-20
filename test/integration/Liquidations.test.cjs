// LEGACY: needs full rewrite for current contract interfaces
// @title: Tests d'intégration pour le système de liquidation
// @coverage: Multi-position, queue, incentives
// @audit: Critical for protocol solvency
// @security: MEV resistance, flash loan integration

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, formatUnits } = ethers;

const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe.skip("⚡ Liquidations - Integration Tests", function () {
  let perpEngine;
  let positionManager;
  let liquidationEngine;
  let liquidationQueue;
  let incentiveDistributor;
  let protocolConfig;
  let collateralToken;
  let oracle;
  let owner, liquidator1, liquidator2, trader1, trader2;
  
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = parseUnits("10000", 18);
  const HIGH_LEVERAGE = parseUnits("8", 18); // 8x pour être proche de la liquidation
  
  beforeEach(async function () {
    [owner, liquidator1, liquidator2, trader1, trader2] = await ethers.getSigners();
    
    // Déploiement complet du système
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateralToken = await MockERC20.deploy("USD Stable", "USD", 18);
    await collateralToken.waitForDeployment();
    
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle = await MockOracle.deploy("Mock Oracle", 18);
    await oracle.waitForDeployment();
    await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE);
    
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
    await protocolConfig.waitForDeployment();
    
    const MarketRegistry = await ethers.getContractFactory("MarketRegistry");
    const marketRegistry = await MarketRegistry.deploy(protocolConfig.target);
    await marketRegistry.waitForDeployment();
    
    const PositionManager = await ethers.getContractFactory("PositionManager");
    positionManager = await PositionManager.deploy(perpEngine.target);
    await positionManager.waitForDeployment();
    
    const RiskManager = await ethers.getContractFactory("RiskManager");
    const riskManager = await RiskManager.deploy(marketRegistry.target, perpEngine.target, protocolConfig.target);
    await riskManager.waitForDeployment();
    
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy(positionManager.target, ammPool.target, oracle.target, liquidationEngine.target, riskManager.target, protocolConfig.target, owner.address, ethers.ZeroAddress, collateralToken.target);
    await perpEngine.waitForDeployment();
    
    const AMMPool = await ethers.getContractFactory("AMMPool");
    const ammPool = await AMMPool.deploy(perpEngine.target, oracle.target);
    await ammPool.waitForDeployment();
    
    const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
    liquidationQueue = await LiquidationQueue.deploy(ethers.ZeroAddress, protocolConfig.target);
    await liquidationQueue.waitForDeployment();
    
    const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
    incentiveDistributor = await IncentiveDistributor.deploy(protocolConfig.target, ethers.ZeroAddress);
    await incentiveDistributor.waitForDeployment();
    
    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
    liquidationEngine = await LiquidationEngine.deploy(
      perpEngine.target,
      riskManager.target,
      protocolConfig.target
    );
    await liquidationEngine.waitForDeployment();
    
    // Configuration complète
    await protocolConfig.setGlobalParameters(
      parseUnits("0.1", 18), // 10% initial
      parseUnits("0.08", 18), // 8% maintenance
      parseUnits("0.02", 18), // 2% liquidation fee
      parseUnits("0.001", 18), // 0.1% protocol fee
      parseUnits("10", 18), // 10x max leverage
      3600
    );
    
    await protocolConfig.setPerpEngine(perpEngine.target);
    await protocolConfig.setRiskManager(riskManager.target);
    await protocolConfig.setAMMPool(ammPool.target);
    await protocolConfig.setLiquidationEngine(liquidationEngine.target);
    
    await positionManager.setPerpEngine(perpEngine.target);
    await marketRegistry.setPerpEngine(perpEngine.target);
    await riskManager.setPerpEngine(perpEngine.target);
    await ammPool.setPerpEngine(perpEngine.target);
    
    await liquidationEngine.setLiquidationQueue(liquidationQueue.target);
    await liquidationEngine.setIncentiveDistributor(incentiveDistributor.target);
    await liquidationQueue.setLiquidationEngine(liquidationEngine.target);
    
    // Ajout du marché
    await marketRegistry.addMarket(
      ETH_USD_MARKET,
      "Ethereum / USD",
      ethers.ZeroAddress,
      collateralToken.target,
      parseUnits("1000000", 18),
      parseUnits("100", 18),
      parseUnits("0.01", 18),
      ["mock"]
    );
    
    await marketRegistry.setOracle(ETH_USD_MARKET, oracle.target);
    
    // Funding pour les tests
    await collateralToken.mint(trader1.address, COLLATERAL_AMOUNT * (10));
    await collateralToken.mint(trader2.address, COLLATERAL_AMOUNT * (10));
    await collateralToken.mint(liquidator1.address, parseEther("100"));
    await collateralToken.mint(liquidator2.address, parseEther("100"));
  });
  
  describe.skip("🔍 Single Position Liquidation", function () {
    it("Should liquidate undercollateralized long position", async function () {
      // Trader ouvre une position long avec haut levier
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const initialPosition = await perpEngine.getPosition(positionId);
      
      // Prix baisse drastiquement pour rendre la position sous-marginée
      const liquidationPrice = INITIAL_PRICE * (92) / (100); // -8%
      await oracle.setPriceForSymbol(ETH_USD_MARKET, liquidationPrice);
      
      // Vérifie que la position est liquidatable
      const healthFactor = await perpEngine.getHealthFactor(positionId);
      expect(healthFactor).to.be < (parseUnits("1", 18));
      
      const isLiquidatable = await liquidationEngine.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.true;
      
      // Liquidateur exécute la liquidation
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.emit(liquidationEngine, "PositionLiquidated");
      
      // Vérifie que la position a été liquidée
      const liquidatedPosition = await perpEngine.getPosition(positionId);
      expect(liquidatedPosition.size).to.equal(0);
      expect(liquidatedPosition.collateral).to.equal(0);
      
      // Vérifie la distribution des récompenses
      const liquidatorBalance = await collateralToken.balanceOf(liquidator1.address);
      expect(liquidatorBalance).to.be > (parseEther("100")); // A reçu une récompense
    });
    
    it("Should liquidate undercollateralized short position", async function () {
      await collateralToken.connect(trader2).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader2).openPosition(
        ETH_USD_MARKET,
        false,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (99) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader2.address, 0);
      
      // Prix augmente (mauvais pour short)
      const liquidationPrice = INITIAL_PRICE * (108) / (100); // +8%
      await oracle.setPriceForSymbol(ETH_USD_MARKET, liquidationPrice);
      
      // Liquidation
      await liquidationEngine.connect(liquidator2).liquidatePosition(positionId);
      
      const position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(0);
    });
    
    it("Should not liquidate healthy position", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        parseUnits("3", 18), // Levier modéré
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      // Petit mouvement de prix
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (99) / (100));
      
      const isLiquidatable = await liquidationEngine.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.false;
      
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.be.revertedWith("NotLiquidatable");
    });
    
    it("Should handle partial liquidation", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const initialSize = (await perpEngine.getPosition(positionId)).size;
      
      // Configure la liquidation partielle (50%)
      await liquidationEngine.setPartialLiquidationRatio(parseUnits("0.5", 18));
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      
      const position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(initialSize / (2)); // 50% liquidé
      expect(position.collateral).to.be > (0); // Encore du collateral
    });
  });
  
  describe.skip("📊 Multiple Position Liquidations", function () {
    it("Should liquidate multiple positions in queue", async function () {
      // Crée plusieurs positions sous-marginées
      const positions = [];
      
      for (let i = 0; i < 3; i++) {
        const trader = i === 0 ? trader1 : trader2;
        await collateralToken.connect(trader).approve(perpEngine.target, COLLATERAL_AMOUNT);
        
        await perpEngine.connect(trader).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          HIGH_LEVERAGE,
          INITIAL_PRICE * (101) / (100)
        );
        
        const positionId = await positionManager.tokenOfOwnerByIndex(trader.address, 0);
        positions.push(positionId);
        
        // Ajoute à la queue de liquidation
        await liquidationQueue.addToQueue(positionId);
      }
      
      // Baisse le prix pour toutes les rendre liquidatables
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Liquide dans l'ordre de la queue
      for (const positionId of positions) {
        await liquidationQueue.setCurrentLiquidator(liquidator1.address);
        await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
        
        const position = await perpEngine.getPosition(positionId);
        expect(position.size).to.equal(0);
      }
      
      // La queue devrait être vide
      const nextPosition = await liquidationQueue.getNextLiquidation();
      expect(nextPosition).to.equal(0);
    });
    
    it("Should prioritize most undercollateralized positions", async function () {
      // Crée des positions avec différents niveaux de sous-marge
      const positionData = [
        { collateral: COLLATERAL_AMOUNT, leverage: parseUnits("7", 18) },
        { collateral: COLLATERAL_AMOUNT, leverage: parseUnits("8", 18) },
        { collateral: COLLATERAL_AMOUNT, leverage: parseUnits("9", 18) }
      ];
      
      for (const data of positionData) {
        await collateralToken.connect(trader1).approve(perpEngine.target, data.collateral);
        
        await perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          data.collateral,
          data.leverage,
          INITIAL_PRICE * (101) / (100)
        );
      }
      
      // Baisse le prix
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (90) / (100));
      
      // Récupère les health factors
      const healthFactors = [];
      for (let i = 0; i < 3; i++) {
        const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, i);
        const hf = await perpEngine.getHealthFactor(positionId);
        healthFactors.push({ positionId, hf });
      }
      
      // Trie par health factor (le plus bas en premier)
      healthFactors.sort((a, b) => a.hf - (b.hf) < (0) ? -1 : 1);
      
      // La position avec le plus haut levier devrait avoir le HF le plus bas
      expect(healthFactors[0].hf).to.be < (healthFactors[1].hf);
      expect(healthFactors[1].hf).to.be < (healthFactors[2].hf);
    });
    
    it("Should handle liquidation cascades", async function () {
      // Crée un réseau de positions interconnectées
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT * (3));
      
      for (let i = 0; i < 3; i++) {
        await perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          HIGH_LEVERAGE,
          INITIAL_PRICE * (101) / (100)
        );
      }
      
      // Baisse drastique du prix
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (85) / (100));
      
      // Toutes les positions devraient être liquidatables
      let liquidatableCount = 0;
      for (let i = 0; i < 3; i++) {
        const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, i);
        if (await liquidationEngine.isLiquidatable(positionId)) {
          liquidatableCount++;
          
          // Liquide chaque position
          await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
        }
      }
      
      expect(liquidatableCount).to.equal(3);
      
      // Toutes les positions devraient être fermées
      for (let i = 0; i < 3; i++) {
        const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, i);
        const position = await perpEngine.getPosition(positionId);
        expect(position.size).to.equal(0);
      }
    });
  });
  
  describe.skip("💰 Liquidation Incentives", function () {
    it("Should distribute correct liquidation rewards", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const position = await perpEngine.getPosition(positionId);
      
      // Calcule la récompense attendue
      const liquidationFee = await protocolConfig.liquidationFee();
      const expectedReward = position.size * (liquidationFee) / (parseUnits("1", 18));
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      const liquidatorInitialBalance = await collateralToken.balanceOf(liquidator1.address);
      
      // Liquidation
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      
      const liquidatorFinalBalance = await collateralToken.balanceOf(liquidator1.address);
      const rewardReceived = liquidatorFinalBalance - (liquidatorInitialBalance);
      
      // Vérifie que la récompense est proche de l'attendu (moins les frais de protocol)
      const tolerance = expectedReward / (20); // 5% tolerance
      expect(rewardReceived).to.be.closeTo(expectedReward, tolerance);
    });
    
    it("Should split rewards among multiple liquidators", async function () {
      // Crée plusieurs positions
      for (let i = 0; i < 2; i++) {
        const trader = i === 0 ? trader1 : trader2;
        await collateralToken.connect(trader).approve(perpEngine.target, COLLATERAL_AMOUNT);
        
        await perpEngine.connect(trader).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          HIGH_LEVERAGE,
          INITIAL_PRICE * (101) / (100)
        );
      }
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Différents liquidateurs liquident différentes positions
      const position1Id = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const position2Id = await positionManager.tokenOfOwnerByIndex(trader2.address, 0);
      
      const liquidator1Initial = await collateralToken.balanceOf(liquidator1.address);
      const liquidator2Initial = await collateralToken.balanceOf(liquidator2.address);
      
      await liquidationEngine.connect(liquidator1).liquidatePosition(position1Id);
      await liquidationEngine.connect(liquidator2).liquidatePosition(position2Id);
      
      const liquidator1Reward = (await collateralToken.balanceOf(liquidator1.address)) - (liquidator1Initial);
      const liquidator2Reward = (await collateralToken.balanceOf(liquidator2.address)) - (liquidator2Initial);
      
      // Les récompenses devraient être similaires (positions identiques)
      expect(liquidator1Reward).to.be.closeTo(liquidator2Reward, liquidator1Reward / (10));
    });
    
    it("Should cap maximum liquidation reward", async function () {
      // Crée une très grande position
      const hugeCollateral = parseUnits("1000000", 18); // $1M
      await collateralToken.mint(trader1.address, hugeCollateral);
      await collateralToken.connect(trader1).approve(perpEngine.target, hugeCollateral);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        hugeCollateral,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      const maxReward = await incentiveDistributor.maxRewardPerLiquidation();
      
      const liquidatorInitial = await collateralToken.balanceOf(liquidator1.address);
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      const liquidatorReward = (await collateralToken.balanceOf(liquidator1.address)) - (liquidatorInitial);
      
      // La récompense ne devrait pas dépasser le maximum
      expect(liquidatorReward).to.be <= (maxReward);
    });
  });
  
  describe.skip("⚡ Flash Loan Liquidations", function () {
    it("Should execute liquidation via flash loan", async function () {
      // Note: Ce test nécessite un environnement avec flash loans
      // Pour l'instant, nous testons juste que le chemin ne revert pas
      
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Normal liquidation should work
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.not.be.reverted;
    });
    
    it("Should handle flash loan liquidation with profit", async function () {
      // Test de la profitabilité des flash loans
      // Simule un scénario où le flash loan est profitable
      
      const positionId = 1;
      const isProfitable = await liquidationEngine.isFlashLoanProfitable(positionId);
      
      // Le résultat dépend des paramètres du marché
      // Nous vérifions juste que la fonction ne revert pas
      expect(isProfitable).to.not.be.undefined;
    });
  });
  
  describe.skip("🛡️ Security & MEV Protection", function () {
    it("Should prevent front-running via liquidation queue", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      // Ajoute à la queue
      await liquidationQueue.addToQueue(positionId);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Tente de liquider sans être dans la queue (front-running)
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.be.revertedWith("NotInQueue");
      
      // Mais devrait fonctionner via la queue
      await liquidationQueue.setCurrentLiquidator(liquidator1.address);
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.emit(liquidationEngine, "PositionLiquidated");
    });
    
    it("Should enforce liquidation delay", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Configure un délai de liquidation
      await liquidationEngine.setLiquidationParameters(
        parseUnits("0.05", 18),
        parseUnits("1000000", 18),
        300 // 5 minutes delay
      );
      
      // Devrait échouer immédiatement (délai non écoulé)
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.be.revertedWith("LiquidationDelay");
      
      // Avance le temps
      await time.increase(300);
      
      // Devrait fonctionner maintenant
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.not.be.reverted;
    });
    
    it("Should prevent double liquidation", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      // Première liquidation
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      
      // Deuxième tentative devrait échouer
      await expect(
        liquidationEngine.connect(liquidator2).liquidatePosition(positionId)
      ).to.be.revertedWith("NotLiquidatable");
    });
    
    it("Should handle oracle manipulation attempts", async function () {
      // Test de résistance à la manipulation d'oracle
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      // Tentative de manipulation: prix baisse drastiquement
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (50) / (100)); // -50%
      
      // Le système devrait détecter une déviation anormale
      // et rejeter le prix ou utiliser des mesures de sécurité
      
      // Dans notre système, cela dépend de OracleSanityChecker
      // Pour ce test, vérifions juste que la liquidation échoue
      // si le prix est invalide
      const isValidPrice = await oracle.isValidPrice(ETH_USD_MARKET, INITIAL_PRICE * (50) / (100));
      
      if (!isValidPrice) {
        await expect(
          liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
        ).to.be.revertedWith("InvalidPrice");
      }
    });
  });
  
  describe.skip("📈 Performance & Gas Optimization", function () {
    it("Should have reasonable gas costs for liquidation", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        HIGH_LEVERAGE,
        INITIAL_PRICE * (101) / (100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      const tx = await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      const receipt = await tx.wait();
      
      console.log(`Liquidation gas cost: ${receipt.gasUsed}`);
      expect(receipt.gasUsed).to.be < (300000); // Moins de 300k gas
    });
    
    it("Should handle batch liquidations efficiently", async function () {
      // Crée plusieurs positions
      for (let i = 0; i < 5; i++) {
        await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
        
        await perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          HIGH_LEVERAGE,
          INITIAL_PRICE * (101) / (100)
        );
      }
      
      await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * (92) / (100));
      
      let totalGas = 0;
      
      // Liquide toutes les positions
      for (let i = 0; i < 5; i++) {
        const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, i);
        const tx = await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
        const receipt = await tx.wait();
        
        totalGas += receipt.gasUsed;
        console.log(`Liquidation ${i + 1} gas: ${receipt.gasUsed}`);
      }
      
      console.log(`Total liquidation gas: ${totalGas}`);
      console.log(`Average per liquidation: ${totalGas / 5}`);
      
      // Coût moyen devrait être raisonnable
      expect(totalGas / 5).to.be < (350000);
    });
  });
});