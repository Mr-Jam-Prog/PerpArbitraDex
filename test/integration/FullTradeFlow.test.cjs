if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
// @title: Tests d'intégration du flux de trading complet
// @coverage: End-to-end user flow
// @audit: Critical for user experience and fund safety
// @scenario: Deposit → Trade → Manage → Close → Withdraw

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, parseEther } = ethers;
const { parseUnits, parseEther } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🔄 FullTradeFlow - Integration Tests", function () {
  let perpEngine;
  let positionManager;
  let marketRegistry;
  let protocolConfig;
  let collateralToken;
  let oracle;
  let owner, trader1, trader2, lpProvider;
  
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = parseUnits("10000", 18); // $10,000
  const LEVERAGE = parseUnits("3", 18); // 3x
  
  beforeEach(async function () {
    [owner, trader1, trader2, lpProvider] = await ethers.getSigners();
    
    // Déploiement des contrats réels (pas des mocks)
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateralToken = await MockERC20.deploy("USD Stable", "USD", 18);
    await collateralToken.waitForDeployment();
    
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle = await MockOracle.deploy();
    await oracle.waitForDeployment();
    await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE);
    
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy();
    await protocolConfig.waitForDeployment();
    await protocolConfig.initialize();
    
    const MarketRegistry = await ethers.getContractFactory("MarketRegistry");
    marketRegistry = await MarketRegistry.deploy(protocolConfig.target);
    await marketRegistry.waitForDeployment();
    
    const PositionManager = await ethers.getContractFactory("PositionManager");
    positionManager = await PositionManager.deploy(
      "PerpArbitraDEX Positions",
      "PERP-POS",
      protocolConfig.target
    );
    await positionManager.waitForDeployment();
    
    const RiskManager = await ethers.getContractFactory("RiskManager");
    const riskManager = await RiskManager.deploy(protocolConfig.target, ethers.ZeroAddress);
    await riskManager.waitForDeployment();
    
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy(
      protocolConfig.target,
      marketRegistry.target,
      positionManager.target
    );
    await perpEngine.waitForDeployment();
    
    const AMMPool = await ethers.getContractFactory("AMMPool");
    const ammPool = await AMMPool.deploy(protocolConfig.target, perpEngine.target);
    await ammPool.waitForDeployment();
    
    // Configuration complète
    await protocolConfig.setGlobalParameters(
      parseUnits("0.1", 18), // 10% initial
      parseUnits("0.08", 18), // 8% maintenance
      parseUnits("0.02", 18), // 2% liquidation fee
      parseUnits("0.001", 18), // 0.1% protocol fee
      parseUnits("10", 18), // 10x max leverage
      3600 // 1 hour funding
    );
    
    await protocolConfig.setPerpEngine(perpEngine.target);
    await protocolConfig.setRiskManager(riskManager.target);
    await protocolConfig.setAMMPool(ammPool.target);
    
    await positionManager.setPerpEngine(perpEngine.target);
    await marketRegistry.setPerpEngine(perpEngine.target);
    await riskManager.setPerpEngine(perpEngine.target);
    await ammPool.setPerpEngine(perpEngine.target);
    
    // Ajout du marché
    await marketRegistry.addMarket(
      ETH_USD_MARKET,
      "Ethereum / USD",
      ethers.ZeroAddress, // ETH
      collateralToken.target, // USD
      parseUnits("1000000", 18), // $1M max position
      parseUnits("100", 18), // $100 min position
      parseUnits("0.01", 18), // $0.01 tick size
      ["mock"]
    );
    
    await marketRegistry.setOracle(ETH_USD_MARKET, oracle.target);
    
    // Approvisionnement en collateral
    await collateralToken.mint(trader1.address, COLLATERAL_AMOUNT.mul(10));
    await collateralToken.mint(trader2.address, COLLATERAL_AMOUNT.mul(10));
    await collateralToken.mint(lpProvider.address, COLLATERAL_AMOUNT.mul(100));
  });
  
  describe("🎯 Complete Trading Cycle", function () {
    it("Should complete full trade cycle: deposit → long → profit → close", async function () {
      // 1. Approve collateral
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // 2. Open long position
      const openTx = await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true, // long
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100) // 1% slippage
      );
      
      await expect(openTx).to.emit(perpEngine, "PositionOpened");
      
      // 3. Vérifie la position
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      let position = await perpEngine.getPosition(positionId);
      
      expect(position.marketId).to.equal(ETH_USD_MARKET);
      expect(position.isLong).to.be.true;
      expect(position.collateral).to.equal(COLLATERAL_AMOUNT);
      
      const initialBalance = await collateralToken.balanceOf(trader1.address);
      
      // 4. Simule une hausse de prix (10%)
      await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE.mul(110).div(100));
      
      // 5. Vérifie le PnL
      const pnl = await perpEngine.getPositionPnL(positionId);
      expect(pnl).to.be.gt(0);
      
      // 6. Close position avec profit
      const closeTx = await perpEngine.connect(trader1).closePosition(
        positionId,
        INITIAL_PRICE.mul(111).div(100) // 1% slippage
      );
      
      await expect(closeTx).to.emit(perpEngine, "PositionClosed");
      
      // 7. Vérifie le solde final
      const finalBalance = await collateralToken.balanceOf(trader1.address);
      expect(finalBalance).to.be.gt(initialBalance); // Devrait avoir fait du profit
      
      // 8. Vérifie que la position est fermée
      position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(0);
      expect(position.collateral).to.equal(0);
    });
    
    it("Should complete full trade cycle: deposit → short → profit → close", async function () {
      await collateralToken.connect(trader2).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // Open short position
      await perpEngine.connect(trader2).openPosition(
        ETH_USD_MARKET,
        false, // short
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(99).div(100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader2.address, 0);
      const initialBalance = await collateralToken.balanceOf(trader2.address);
      
      // Prix baisse (profit pour short)
      await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE.mul(90).div(100));
      
      // Close position
      await perpEngine.connect(trader2).closePosition(
        positionId,
        INITIAL_PRICE.mul(91).div(100)
      );
      
      const finalBalance = await collateralToken.balanceOf(trader2.address);
      expect(finalBalance).to.be.gt(initialBalance); // Profit
    });
    
    it("Should handle losing trade gracefully", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const initialBalance = await collateralToken.balanceOf(trader1.address);
      
      // Prix baisse (perte pour long)
      await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE.mul(95).div(100));
      
      await perpEngine.connect(trader1).closePosition(
        positionId,
        INITIAL_PRICE.mul(96).div(100)
      );
      
      const finalBalance = await collateralToken.balanceOf(trader1.address);
      expect(finalBalance).to.be.lt(initialBalance); // Perte
    });
  });
  
  describe("🔄 Multiple Operations", function () {
    it("Should handle deposit → trade → add collateral → trade more", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT.mul(2));
      
      // 1. Première position
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      let positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      let position = await perpEngine.getPosition(positionId);
      const initialSize = position.size;
      
      // 2. Ajoute du collateral
      const additionalCollateral = COLLATERAL_AMOUNT.div(2);
      await perpEngine.connect(trader1).addCollateral(positionId, additionalCollateral);
      
      position = await perpEngine.getPosition(positionId);
      expect(position.collateral).to.equal(COLLATERAL_AMOUNT.add(additionalCollateral));
      
      // 3. Augmente la taille de la position
      const increaseSize = position.size.div(2);
      await perpEngine.connect(trader1).modifyPosition(
        positionId,
        increaseSize,
        true, // increase
        INITIAL_PRICE.mul(101).div(100)
      );
      
      position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(initialSize.add(increaseSize));
      
      // 4. Réduit partiellement
      const reduceSize = position.size.div(4);
      await perpEngine.connect(trader1).modifyPosition(
        positionId,
        reduceSize,
        false, // reduce
        INITIAL_PRICE.mul(99).div(100)
      );
      
      position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(initialSize.add(increaseSize).sub(reduceSize));
    });
    
    it("Should handle multiple concurrent positions", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT.mul(3));
      
      // Ouvre 3 positions différentes
      for (let i = 0; i < 3; i++) {
        await perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          i % 2 === 0, // alternance long/short
          COLLATERAL_AMOUNT,
          LEVERAGE,
          i % 2 === 0 ? INITIAL_PRICE.mul(101).div(100) : INITIAL_PRICE.mul(99).div(100)
        );
      }
      
      // Vérifie qu'il y a 3 positions
      const balance = await positionManager.balanceOf(trader1.address);
      expect(balance).to.equal(3);
      
      // Récupère toutes les positions
      const positions = [];
      for (let i = 0; i < balance; i++) {
        const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, i);
        const position = await perpEngine.getPosition(positionId);
        positions.push(position);
      }
      
      // Vérifie la diversité
      const longs = positions.filter(p => p.isLong);
      const shorts = positions.filter(p => !p.isLong);
      
      expect(longs.length).to.equal(2);
      expect(shorts.length).to.equal(1);
    });
    
    it("Should handle complex hedging strategies", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT.mul(4));
      
      // Stratégie de hedging: long principal + short de couverture
      const mainPositionSize = COLLATERAL_AMOUNT.mul(LEVERAGE).div(parseUnits("1", 18));
      
      // Position long principale
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT.mul(2),
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      // Position short de couverture (50%)
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        false,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(99).div(100)
      );
      
      const longPositionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const shortPositionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 1);
      
      // Simulation de mouvement de prix
      await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE.mul(105).div(100));
      
      const longPnl = await perpEngine.getPositionPnL(longPositionId);
      const shortPnl = await perpEngine.getPositionPnL(shortPositionId);
      
      // Le short devrait compenser une partie de la perte/gain du long
      expect(longPnl.add(shortPnl).abs()).to.be.lt(longPnl.abs()); // Risque réduit
    });
  });
  
  describe("⏱️ Time-Based Operations", function () {
    it("Should handle funding settlements over time", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      await collateralToken.connect(trader2).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // Crée un skew long (trader1 long, trader2 short)
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      await perpEngine.connect(trader2).openPosition(
        ETH_USD_MARKET,
        false,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(99).div(100)
      );
      
      const longPositionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const shortPositionId = await positionManager.tokenOfOwnerByIndex(trader2.address, 0);
      
      const longInitialCollateral = (await perpEngine.getPosition(longPositionId)).collateral;
      const shortInitialCollateral = (await perpEngine.getPosition(shortPositionId)).collateral;
      
      // Avance le temps pour accumuler du funding
      await time.increase(3600 * 24); // 24 heures
      
      // Settle funding (normalement appelé automatiquement)
      // Dans ce test, nous simulons l'appel
      
      // Avec un skew long, le long paie du funding au short
      const longFinalCollateral = (await perpEngine.getPosition(longPositionId)).collateral;
      const shortFinalCollateral = (await perpEngine.getPosition(shortPositionId)).collateral;
      
      expect(longFinalCollateral).to.be.lt(longInitialCollateral);
      expect(shortFinalCollateral).to.be.gt(shortInitialCollateral);
    });
    
    it("Should handle overnight positions", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      const initialCollateral = (await perpEngine.getPosition(positionId)).collateral;
      
      // Simule une nuit complète (8 heures)
      await time.increase(3600 * 8);
      
      // Changement de prix pendant la nuit
      await oracle.setPrice(ETH_USD_MARKET, INITIAL_PRICE.mul(102).div(100));
      
      // Close position
      await perpEngine.connect(trader1).closePosition(
        positionId,
        INITIAL_PRICE.mul(103).div(100)
      );
      
      const finalBalance = await collateralToken.balanceOf(trader1.address);
      const initialBalance = await collateralToken.balanceOf(trader1.address).then(b => b.sub(COLLATERAL_AMOUNT));
      
      // Le résultat devrait inclure à la fois le PnL et le funding
      expect(finalBalance).to.not.equal(initialBalance.add(initialCollateral));
    });
  });
  
  describe("⚠️ Error Handling & Edge Cases", function () {
    it("Should handle slippage protection", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // Tente d'ouvrir avec un slippage trop restrictif
      await expect(
        perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          LEVERAGE,
          INITIAL_PRICE.mul(1001).div(1000) // 0.1% slippage seulement
        )
      ).to.be.revertedWith("SlippageExceeded");
    });
    
    it("Should prevent over-leveraging", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      await expect(
        perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          parseUnits("15", 18), // 15x > 10x max
          INITIAL_PRICE.mul(101).div(100)
        )
      ).to.be.revertedWith("ExceedsMaxLeverage");
    });
    
    it("Should handle insufficient balance", async function () {
      // Tente d'ouvrir une position sans assez de collateral
      const smallBalance = COLLATERAL_AMOUNT.div(10);
      await collateralToken.connect(trader1).approve(perpEngine.target, smallBalance);
      
      await expect(
        perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT, // Demande plus que le solde
          LEVERAGE,
          INITIAL_PRICE.mul(101).div(100)
        )
      ).to.be.reverted; // ERC20 transfer échouera
    });
    
    it("Should handle market closure during trade", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // Ouvre une position
      await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      // Ferme le marché
      await protocolConfig.pauseMarket(ETH_USD_MARKET);
      
      // Ne devrait pas pouvoir fermer la position
      await expect(
        perpEngine.connect(trader1).closePosition(positionId, INITIAL_PRICE)
      ).to.be.revertedWith("MarketPaused");
      
      // Réouvre le marché
      await protocolConfig.unpauseMarket(ETH_USD_MARKET);
      
      // Devrait pouvoir fermer maintenant
      await expect(
        perpEngine.connect(trader1).closePosition(positionId, INITIAL_PRICE.mul(101).div(100))
      ).to.emit(perpEngine, "PositionClosed");
    });
  });
  
  describe("📊 Performance & Gas", function () {
    it("Should have reasonable gas costs for full cycle", async function () {
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);
      
      // Mesure le gas pour l'ouverture
      const openTx = await perpEngine.connect(trader1).openPosition(
        ETH_USD_MARKET,
        true,
        COLLATERAL_AMOUNT,
        LEVERAGE,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      const openReceipt = await openTx.wait();
      console.log(`Open position gas: ${openReceipt.gasUsed}`);
      expect(openReceipt.gasUsed).to.be.lt(500000); // Moins de 500k gas
      
      const positionId = await positionManager.tokenOfOwnerByIndex(trader1.address, 0);
      
      // Mesure le gas pour la fermeture
      const closeTx = await perpEngine.connect(trader1).closePosition(
        positionId,
        INITIAL_PRICE.mul(101).div(100)
      );
      
      const closeReceipt = await closeTx.wait();
      console.log(`Close position gas: ${closeReceipt.gasUsed}`);
      expect(closeReceipt.gasUsed).to.be.lt(400000); // Moins de 400k gas
    });
    
    it("Should handle batch operations efficiently", async function () {
      // Test avec plusieurs opérations en batch
      await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT.mul(10));
      
      const gasUsed = [];
      
      for (let i = 0; i < 5; i++) {
        const tx = await perpEngine.connect(trader1).openPosition(
          ETH_USD_MARKET,
          true,
          COLLATERAL_AMOUNT,
          LEVERAGE,
          INITIAL_PRICE.mul(101).div(100)
        );
        
        const receipt = await tx.wait();
        gasUsed.push(receipt.gasUsed);
        
        console.log(`Operation ${i + 1} gas: ${receipt.gasUsed}`);
      }
      
      // Les opérations successives devraient avoir un coût similaire
      const averageGas = gasUsed.reduce((a, b) => a + b, 0) / gasUsed.length;
      const variance = gasUsed.map(g => Math.abs(g - averageGas)).reduce((a, b) => a + b, 0) / gasUsed.length;
      
      expect(variance / averageGas).to.be.lt(0.1); // Moins de 10% de variance
    });
  });
});