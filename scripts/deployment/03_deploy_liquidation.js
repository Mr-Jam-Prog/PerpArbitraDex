// @title: Déploiement Liquidation Engine avec queue MEV-resistant
// @mev: Queue ordonnée, random delays, flash loans
// @incentives: Distributor avec tokens natifs

const { ethers, upgrades } = require("hardhat");
const { saveDeployment, getDeployment } = require("../utils/deployment-utils");

module.exports = async () => {
  console.log("⚡ Déploiement Liquidation System");
  
  // Récupération des adresses core
  const core = await getDeployment("core");
  if (!core) throw new Error("Core deployment not found");
  
  // 1. Déploiement LiquidationEngine
  const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
  const liquidationEngine = await upgrades.deployProxy(LiquidationEngine, [
    core.PerpEngine,
    core.RiskManager,
    core.ProtocolConfig
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await liquidationEngine.deployed();
  console.log(`✅ LiquidationEngine: ${liquidationEngine.address}`);
  
  // 2. Déploiement LiquidationQueue
  const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
  const liquidationQueue = await upgrades.deployProxy(LiquidationQueue, [
    liquidationEngine.address,
    core.ProtocolConfig
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await liquidationQueue.deployed();
  console.log(`✅ LiquidationQueue: ${liquidationQueue.address}`);
  
  // 3. Déploiement IncentiveDistributor
  const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
  const incentiveDistributor = await upgrades.deployProxy(IncentiveDistributor, [
    core.ProtocolConfig,
    liquidationEngine.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await incentiveDistributor.deployed();
  console.log(`✅ IncentiveDistributor: ${incentiveDistributor.address}`);
  
  // 4. Déploiement FlashLiquidator (optionnel)
  const FlashLiquidator = await ethers.getContractFactory("FlashLiquidator");
  const flashLiquidator = await upgrades.deployProxy(FlashLiquidator, [
    liquidationEngine.address,
    core.ProtocolConfig
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await flashLiquidator.deployed();
  console.log(`✅ FlashLiquidator: ${flashLiquidator.address}`);
  
  // 5. Configuration des liens
  await liquidationEngine.setLiquidationQueue(liquidationQueue.address);
  await liquidationEngine.setIncentiveDistributor(incentiveDistributor.address);
  
  const deployment = {
    LiquidationEngine: liquidationEngine.address,
    LiquidationQueue: liquidationQueue.address,
    IncentiveDistributor: incentiveDistributor.address,
    FlashLiquidator: flashLiquidator.address,
    timestamp: Date.now()
  };
  
  await saveDeployment("liquidation", deployment);
  
  console.log("🎯 Liquidation System déployé avec succès");
  return deployment;
};