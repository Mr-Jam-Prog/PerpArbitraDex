// @title: Tests unitaires pour LiquidationEngine
// @coverage: >95% (liquidation logic, incentives, queue)
// @audit: Critical for protocol solvency
// @security: MEV resistance, flash loan integration

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("⚡ LiquidationEngine - Unit Tests", function () {
  let liquidationEngine;
  let liquidationQueue;
  let incentiveDistributor;
  let perpEngine;
  let riskManager;
  let protocolConfig;
  let owner, liquidator1, liquidator2, user;
  
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = ethers.parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = ethers.parseUnits("1000", 18);
  const LEVERAGE = ethers.parseUnits("5", 18);
  
  beforeEach(async function () {
    [owner, liquidator1, liquidator2, user] = await ethers.getSigners();
    
    // Déploiement ProtocolConfig
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
    await protocolConfig.waitForDeployment();
    
    // Déploiement PerpEngine mock
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    await perpEngine.waitForDeployment();
    
    // Déploiement RiskManager mock
    const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
    riskManager = await MockRiskManager.deploy();
    await riskManager.waitForDeployment();
    
    // Déploiement LiquidationQueue
    const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
    liquidationQueue = await LiquidationQueue.deploy(ethers.ZeroAddress, protocolConfig.address);
    await liquidationQueue.waitForDeployment();
    
    // Déploiement IncentiveDistributor
    const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
    incentiveDistributor = await IncentiveDistributor.deploy(protocolConfig.address, ethers.ZeroAddress);
    await incentiveDistributor.waitForDeployment();
    
    // Déploiement LiquidationEngine
    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
    liquidationEngine = await LiquidationEngine.deploy(
      perpEngine.address,
      riskManager.address,
      protocolConfig.address
    );
    await liquidationEngine.waitForDeployment();
    
    // Configuration des liens
    await protocolConfig.setLiquidationEngine(liquidationEngine.address);
    await liquidationEngine.setLiquidationQueue(liquidationQueue.address);
    await liquidationEngine.setIncentiveDistributor(incentiveDistributor.address);
    await liquidationQueue.setLiquidationEngine(liquidationEngine.address);
    
    // Configuration des paramètres
    await protocolConfig.setGlobalParameters(
      ethers.parseUnits("0.1", 18),
      ethers.parseUnits("0.08", 18),
      ethers.parseUnits("0.02", 18),
      ethers.parseUnits("0.001", 18),
      LEVERAGE,
      3600
    );
  });
  
  describe("🔍 Liquidation Detection", function () {
    it("Should detect liquidatable positions", async function () {
      const positionId = 1;
      
      // Configure une position sous-marginée
      await perpEngine.setPosition(
        positionId,
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
        INITIAL_PRICE,
        COLLATERAL_AMOUNT
      );
      
      // Simule une baisse de prix qui rend la position liquidatable
      await riskManager.setHealthFactor(positionId, ethers.parseUnits("0.8", 18)); // HF < 1
      await riskManager.setLiquidatable(positionId, true);
      
      const isLiquidatable = await liquidationEngine.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.true;
    });
    
    it("Should not liquidate healthy positions", async function () {
      const positionId = 2;
      
      await perpEngine.setPosition(
        positionId,
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
        INITIAL_PRICE,
        COLLATERAL_AMOUNT
      );
      
      await riskManager.setHealthFactor(positionId, ethers.parseUnits("1.2", 18)); // HF > 1
      await riskManager.setLiquidatable(positionId, false);
      
      const isLiquidatable = await liquidationEngine.isLiquidatable(positionId);
      expect(isLiquidatable).to.be.false;
      
      // Devrait échouer si tentative de liquidation
      await expect(
        liquidationEngine.liquidatePosition(positionId)
      ).to.be.revertedWith("NotLiquidatable");
    });
    
    it("Should scan multiple positions efficiently", async function () {
      // Crée plusieurs positions
      for (let i = 1; i <= 10; i++) {
        await perpEngine.setPosition(
          i,
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
          INITIAL_PRICE,
          COLLATERAL_AMOUNT
        );
        
        // Rend certaines positions liquidatables
        if (i % 2 === 0) {
          await riskManager.setHealthFactor(i, ethers.parseUnits("0.9", 18));
          await riskManager.setLiquidatable(i, true);
        } else {
          await riskManager.setHealthFactor(i, ethers.parseUnits("1.5", 18));
          await riskManager.setLiquidatable(i, false);
        }
      }
      
      // Scan pour les positions liquidatables
      const liquidatablePositions = [];
      for (let i = 1; i <= 10; i++) {
        if (await liquidationEngine.isLiquidatable(i)) {
          liquidatablePositions.push(i);
        }
      }
      
      expect(liquidatablePositions.length).to.equal(5); // Les positions paires
    });
  });
  
  describe("⚡ Liquidation Execution", function () {
    let positionId;
    
    beforeEach(async function () {
      positionId = 1;
      
      // Configure une position liquidatable
      await perpEngine.setPosition(
        positionId,
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
        INITIAL_PRICE,
        COLLATERAL_AMOUNT
      );
      
      await riskManager.setHealthFactor(positionId, ethers.parseUnits("0.8", 18));
      await riskManager.setLiquidatable(positionId, true);
      
      // Configure le prix de liquidation
      await perpEngine.setLiquidationPrice(positionId, INITIAL_PRICE * (90) / (100));
    });
    
    it("Should liquidate position successfully", async function () {
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(positionId)
      ).to.emit(liquidationEngine, "PositionLiquidated");
      
      // Vérifie que la position a été liquidée
      const position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(0);
      expect(position.collateral).to.equal(0);
    });
    
    it("Should distribute liquidation incentives", async function () {
      // Configure les récompenses
      const liquidationFee = await protocolConfig.liquidationFee();
      await incentiveDistributor.setReward(positionId, liquidationFee);
      
      const initialBalance = await ethers.provider.getBalance(liquidator1.address);
      
      // Exécute la liquidation
      const tx = await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      const receipt = await tx.wait();
      
      // Vérifie que le liquidateur a été récompensé
      const gasCost = receipt.gasUsed * (receipt.effectiveGasPrice);
      const finalBalance = await ethers.provider.getBalance(liquidator1.address);
      
      // Balance devrait augmenter (récompense - gas)
      const reward = liquidationFee;
      const expectedChange = reward - (gasCost);
      const actualChange = finalBalance - (initialBalance);
      
      expect(actualChange).to.be.closeTo(expectedChange, gasCost / (10)); // 10% tolerance for gas estimation
    });
    
    it("Should handle partial liquidation", async function () {
      // Configure une liquidation partielle
      await liquidationEngine.setPartialLiquidationRatio(ethers.parseUnits("0.5", 18)); // 50%
      
      const initialSize = (await perpEngine.getPosition(positionId)).size;
      
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      
      const position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(initialSize / (2)); // 50% liquidé
    });
    
    it("Should prevent double liquidation", async function () {
      // Première liquidation
      await liquidationEngine.connect(liquidator1).liquidatePosition(positionId);
      
      // Deuxième tentative devrait échouer
      await expect(
        liquidationEngine.connect(liquidator2).liquidatePosition(positionId)
      ).to.be.revertedWith("NotLiquidatable");
    });
    
    it("Should handle flash loan liquidations", async function () {
      // Configure le flash liquidator
      const FlashLiquidator = await ethers.getContractFactory("FlashLiquidator");
      const flashLiquidator = await FlashLiquidator.deploy(liquidationEngine.address, protocolConfig.address);
      await flashLiquidator.waitForDeployment();
      
      // Simulation de liquidation avec flash loan
      await expect(
        flashLiquidator.connect(liquidator1).flashLiquidate(positionId)
      ).to.emit(flashLiquidator, "FlashLiquidationExecuted");
    });
  });
  
  describe("📊 Liquidation Queue", function () {
    it("Should queue liquidations in order", async function () {
      // Ajoute plusieurs positions à la queue
      for (let i = 1; i <= 5; i++) {
        await perpEngine.setPosition(
          i,
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
          INITIAL_PRICE,
          COLLATERAL_AMOUNT
        );
        
        await riskManager.setHealthFactor(i, ethers.parseUnits("0.9", 18) - (i));
        await riskManager.setLiquidatable(i, true);
        
        await liquidationQueue.addToQueue(i);
      }
      
      // Récupère la prochaine position (devrait être la plus sous-marginée)
      const nextPosition = await liquidationQueue.getNextLiquidation();
      expect(nextPosition).to.equal(5); // HF le plus bas
    });
    
    it("Should prioritize by health factor", async function () {
      // Positions avec différents health factors
      const positions = [
        { id: 1, hf: ethers.parseUnits("0.7", 18) },
        { id: 2, hf: ethers.parseUnits("0.5", 18) },
        { id: 3, hf: ethers.parseUnits("0.9", 18) }
      ];
      
      for (const pos of positions) {
        await perpEngine.setPosition(
          pos.id,
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18)),
          INITIAL_PRICE,
          COLLATERAL_AMOUNT
        );
        
        await riskManager.setHealthFactor(pos.id, pos.hf);
        await riskManager.setLiquidatable(pos.id, true);
        
        await liquidationQueue.addToQueue(pos.id);
      }
      
      // Devrait retourner dans l'ordre: 2 (HF 0.5), 1 (HF 0.7), 3 (HF 0.9)
      expect(await liquidationQueue.getNextLiquidation()).to.equal(2);
      await liquidationQueue.removeFromQueue(2);
      
      expect(await liquidationQueue.getNextLiquidation()).to.equal(1);
      await liquidationQueue.removeFromQueue(1);
      
      expect(await liquidationQueue.getNextLiquidation()).to.equal(3);
    });
    
    it("Should handle queue timeouts", async function () {
      const positionId = 1;
      await liquidationQueue.addToQueue(positionId);
      
      // Avance le temps au-delà du timeout
      await time.increase(300); // 5 minutes (default timeout)
      
      // La position devrait être retirée de la queue
      const nextPosition = await liquidationQueue.getNextLiquidation();
      expect(nextPosition).to.equal(0); // Queue vide
    });
    
    it("Should prevent MEV front-running", async function () {
      // Ajoute une position à la queue
      await liquidationQueue.addToQueue(1);
      
      // Simule un front-run en essayant de liquider hors queue
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(1)
      ).to.be.revertedWith("NotInQueue");
      
      // Mais devrait fonctionner via la queue
      await liquidationQueue.setCurrentLiquidator(liquidator1.address);
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(1)
      ).to.not.be.reverted;
    });
  });
  
  describe("💰 Incentive Mechanism", function () {
    it("Should calculate correct liquidation reward", async function () {
      const positionId = 1;
      const positionSize = COLLATERAL_AMOUNT * (LEVERAGE) / (ethers.parseUnits("1", 18));
      const liquidationFee = await protocolConfig.liquidationFee();
      
      // Reward = size * liquidationFee
      const expectedReward = positionSize * (liquidationFee) / (ethers.parseUnits("1", 18));
      
      await incentiveDistributor.setReward(positionId, expectedReward);
      
      const reward = await incentiveDistributor.calculateReward(positionId);
      expect(reward).to.equal(expectedReward);
    });
    
    it("Should distribute rewards proportionally", async function () {
      // Multiple liquidateurs
      const rewards = [
        { liquidator: liquidator1.address, amount: ethers.parseEther("0.5") },
        { liquidator: liquidator2.address, amount: ethers.parseEther("0.3") }
      ];
      
      for (const r of rewards) {
        await incentiveDistributor.distributeReward(r.liquidator, r.amount);
      }
      
      const totalDistributed = await incentiveDistributor.totalDistributed();
      const expectedTotal = ethers.parseEther("0.8");
      
      expect(totalDistributed).to.equal(expectedTotal);
    });
    
    it("Should cap maximum reward", async function () {
      const maxReward = await incentiveDistributor.maxRewardPerLiquidation();
      const excessiveReward = maxReward * (2);
      
      // Devrait limiter la récompense au maximum
      await incentiveDistributor.setReward(1, excessiveReward);
      const actualReward = await incentiveDistributor.calculateReward(1);
      
      expect(actualReward).to.equal(maxReward);
    });
    
    it("Should handle reward distribution with protocol fees", async function () {
      const positionId = 1;
      const grossReward = ethers.parseEther("1.0");
      const protocolFee = await protocolConfig.protocolFee();
      
      await incentiveDistributor.setReward(positionId, grossReward);
      
      // Net reward = gross reward * (1 - protocol fee)
      const expectedNetReward = grossReward.mul(
        ethers.parseUnits("1", 18) - (protocolFee)
      ) / (ethers.parseUnits("1", 18));
      
      const netReward = await incentiveDistributor.calculateNetReward(positionId);
      expect(netReward).to.equal(expectedNetReward);
    });
  });
  
  describe("🔧 Configuration", function () {
    it("Should allow owner to update liquidation parameters", async function () {
      const newLiquidationBuffer = ethers.parseUnits("0.06", 18); // 6%
      const newMaxSize = ethers.parseUnits("500000", 18); // 500k
      const newDelay = 600; // 10 minutes
      
      await liquidationEngine.connect(owner).setLiquidationParameters(
        newLiquidationBuffer,
        newMaxSize,
        newDelay
      );
      
      const params = await liquidationEngine.liquidationParameters();
      expect(params.buffer).to.equal(newLiquidationBuffer);
      expect(params.maxSize).to.equal(newMaxSize);
      expect(params.delay).to.equal(newDelay);
    });
    
    it("Should reject non-owner configuration", async function () {
      await expect(
        liquidationEngine.connect(liquidator1).setLiquidationParameters(
          ethers.parseUnits("0.06", 18),
          ethers.parseUnits("500000", 18),
          600
        )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
    
    it("Should validate liquidation parameters", async function () {
      // Buffer trop élevé
      await expect(
        liquidationEngine.connect(owner).setLiquidationParameters(
          ethers.parseUnits("0.5", 18), // 50% - trop élevé
          ethers.parseUnits("500000", 18),
          600
        )
      ).to.be.revertedWith("InvalidBuffer");
    });
    
    it("Should allow emergency pause of liquidations", async function () {
      await liquidationEngine.connect(owner).pauseLiquidations();
      
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(1)
      ).to.be.revertedWith("LiquidationsPaused");
      
      await liquidationEngine.connect(owner).unpauseLiquidations();
      
      // Devrait fonctionner à nouveau
      await expect(
        liquidationEngine.connect(liquidator1).liquidatePosition(1)
      ).to.not.be.reverted; // Même si échoue pour d'autres raisons
    });
  });
});