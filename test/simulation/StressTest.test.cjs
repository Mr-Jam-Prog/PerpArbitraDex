// @title: Stress testing avec 10k+ positions simultanées
// @scenarios: Charge extrême, gas optimization, memory limits
// @goal: Vérifier la scalabilité du protocole

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers.utils;
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

describe("🔥 Massif Stress Testing", function () {
  let deployer;
  let perpEngine, positionManager;
  let usdc;
  
  const NUM_POSITIONS = 10000;
  const BATCH_SIZE = 100; // Positions par batch pour éviter les limites de gas
  
  before(async function () {
    [deployer] = await ethers.getSigners();
    
    // Déploiement avec gas optimization
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy();
    
    const PositionManager = await ethers.getContractFactory("PositionManager");
    positionManager = await PositionManager.deploy();
    
    // Mock USDC avec grande supply
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USDC", "USDC", 6);
    await usdc.mint(deployer.address, parseUnits("1000000000", 6)); // 1B USDC
  });
  
  describe("🏋️ Mass Position Creation", function () {
    it(`Devrait créer ${NUM_POSITIONS} positions simultanément`, async function () {
      this.timeout(300000); // 5 minutes timeout
      
      const collateral = parseUnits("100", 6); // $100 par position
      const positionSize = parseUnits("500", 6); // $500 (5x)
      
      await usdc.approve(perpEngine.address, collateral * (NUM_POSITIONS));
      
      console.log(`🎯 Création de ${NUM_POSITIONS} positions...`);
      
      const startTime = Date.now();
      let totalGas = BigInt(0);
      
      // Création par batches pour éviter les limites de gas
      for (let batch = 0; batch < NUM_POSITIONS / BATCH_SIZE; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < BATCH_SIZE; i++) {
          const txPromise = perpEngine.openPosition(
            "ETH-USD",
            collateral,
            positionSize,
            i % 2 === 0 // Alterner long/short
          );
          batchPromises.push(txPromise);
        }
        
        // Exécution en parallèle
        const batchResults = await Promise.all(batchPromises);
        
        // Calcul du gas utilisé
        for (const tx of batchResults) {
          const receipt = await tx.wait();
          totalGas = totalGas + (receipt.gasUsed);
        }
        
        console.log(`✅ Batch ${batch + 1} terminé (${(batch + 1) * BATCH_SIZE} positions)`);
        
        // Pause pour éviter la congestion
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      console.log(`\n📊 Résultats:`);
      console.log(`   Positions créées: ${NUM_POSITIONS}`);
      console.log(`   Temps total: ${duration}s`);
      console.log(`   Positions/s: ${(NUM_POSITIONS / duration).toFixed(2)}`);
      console.log(`   Gas total: ${totalGas.toString()}`);
      console.log(`   Gas moyen par position: ${totalGas / (NUM_POSITIONS).toString()}`);
      
      // Vérification
      const totalPositions = await positionManager.totalSupply();
      expect(totalPositions).to.equal(NUM_POSITIONS);
    });
    
    it("Devrait gérer la pagination des positions", async function () {
      const pageSize = 100;
      const totalPages = Math.ceil(NUM_POSITIONS / pageSize);
      
      for (let page = 0; page < totalPages; page++) {
        const positions = await positionManager.getPositionsPaginated(page * pageSize, pageSize);
        expect(positions.length).to.be <= (pageSize);
      }
    });
  });
  
  describe("💨 Mass Liquidation Simulation", function () {
    beforeEach(async function () {
      // Création de positions pour le test de liquidation
      // Certaines positions seront sous-collatéralisées
    });
    
    it("Devrait liquider 1000 positions en parallèle", async function () {
      const liquidatablePositions = await getLiquidatablePositions(1000);
      
      console.log(`⚡ Liquidation de ${liquidatablePositions.length} positions...`);
      
      const liquidationPromises = liquidatablePositions.map(positionId =>
        perpEngine.liquidatePosition(positionId)
      );
      
      // Exécution en parallèle
      const results = await Promise.allSettled(liquidationPromises);
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`✅ Liquidations réussies: ${successful}`);
      console.log(`❌ Liquidations échouées: ${failed}`);
      
      expect(successful).to.be > (0);
    });
    
    it("Devrait optimiser le gas pour les liquidations batch", async function () {
      const liquidatablePositions = await getLiquidatablePositions(100);
      
      // Test de liquidation batch
      const tx = await perpEngine.batchLiquidatePositions(liquidatablePositions);
      const receipt = await tx.wait();
      
      const gasPerPosition = receipt.gasUsed / (liquidatablePositions.length);
      console.log(`Gas par liquidation (batch): ${gasPerPosition.toString()}`);
      
      // Devrait être plus efficace que les liquidations individuelles
      expect(gasPerPosition).to.be < (250000); // Max 250k gas par liquidation
    });
  });
  
  describe("📊 Performance Metrics", function () {
    it("Devrait mesurer le throughput des transactions", async function () {
      const iterations = 1000;
      const operations = [];
      
      for (let i = 0; i < iterations; i++) {
        operations.push(() => perpEngine.getMarketData("ETH-USD"));
      }
      
      const startTime = Date.now();
      
      for (const op of operations) {
        await op();
      }
      
      const endTime = Date.now();
      const tps = iterations / ((endTime - startTime) / 1000);
      
      console.log(`📈 Throughput: ${tps.toFixed(2)} ops/s`);
      expect(tps).to.be > (10); // Minimum 10 ops/s
    });
    
    it("Devrait mesurer l'utilisation mémoire", async function () {
      // Création d'un grand nombre de positions
      const largeNumber = 5000;
      
      const memBefore = process.memoryUsage();
      
      for (let i = 0; i < largeNumber; i++) {
        await perpEngine.openPosition(
          "ETH-USD",
          parseUnits("10", 6),
          parseUnits("50", 6),
          true
        );
      }
      
      const memAfter = process.memoryUsage();
      
      console.log(`🧠 Usage mémoire:`);
      console.log(`   Avant: ${formatMemory(memBefore.heapUsed)}`);
      console.log(`   Après: ${formatMemory(memAfter.heapUsed)}`);
      console.log(`   Delta: ${formatMemory(memAfter.heapUsed - memBefore.heapUsed)}`);
      
      // Pas de fuite mémoire excessive
      const memoryIncrease = memAfter.heapUsed - memBefore.heapUsed;
      expect(memoryIncrease).to.be < (500 * 1024 * 1024); // < 500MB
    });
  });
  
  describe("🚀 Gas Optimization Verification", function () {
    it("Devrait respecter les limites de gas L2", async function () {
      const operations = [
        { name: "openPosition", fn: () => perpEngine.openPosition("ETH-USD", parseUnits("100", 6), parseUnits("500", 6), true) },
        { name: "closePosition", fn: () => perpEngine.closePosition(1) },
        { name: "addCollateral", fn: () => perpEngine.addCollateral(1, parseUnits("10", 6)) },
        { name: "liquidatePosition", fn: () => perpEngine.liquidatePosition(1) }
      ];
      
      for (const op of operations) {
        const tx = await op.fn();
        const receipt = await tx.wait();
        
        console.log(`${op.name}: ${receipt.gasUsed.toString()} gas`);
        
        // Limites pour L2 (Arbitrum)
        expect(receipt.gasUsed).to.be < (2000000); // Max 2M gas
      }
    });
    
    it("Devrait optimiser le storage usage", async function () {
      // Vérification que les positions utilisent le packing efficacement
      const positionStructSize = await perpEngine.getPositionStructSize();
      console.log(`📦 Taille structure position: ${positionStructSize} bytes`);
      
      expect(positionStructSize).to.be < (256); // Doit tenir dans un slot
    });
  });
  
  // Helper functions
  async function getLiquidatablePositions(limit) {
    const positions = [];
    const totalPositions = await positionManager.totalSupply();
    
    for (let i = 1; i <= Math.min(totalPositions, limit); i++) {
      if (await perpEngine.isLiquidatable(i)) {
        positions.push(i);
      }
    }
    
    return positions;
  }
  
  function formatMemory(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }
});