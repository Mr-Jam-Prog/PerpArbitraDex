// @title: Déploiement Core Protocol (PerpEngine, RiskManager, MarketRegistry)
// @audit: Critical Path - Doit être idempotent et sécurisé
// @network: Arbitrum, Base, Optimism
// @dependencies: ProxyAdmin, ProtocolConfig

const { ethers, upgrades } = require("hardhat");
const { saveDeployment, validateDeployment } = require("../utils/deployment-utils");
const { PROTOCOL_PARAMS, NETWORK_CONFIG } = require("../utils/constants");

module.exports = async () => {
  console.log("🚀 Déploiement Core Protocol");
  
  // 1. Déploiement ProtocolConfig
  const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
  const config = await upgrades.deployProxy(ProtocolConfig, [], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await config.deployed();
  console.log(`✅ ProtocolConfig: ${config.address}`);
  
  // 2. Déploiement MarketRegistry
  const MarketRegistry = await ethers.getContractFactory("MarketRegistry");
  const registry = await upgrades.deployProxy(MarketRegistry, [config.address], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await registry.deployed();
  console.log(`✅ MarketRegistry: ${registry.address}`);
  
  // 3. Déploiement PositionManager (ERC-721)
  const PositionManager = await ethers.getContractFactory("PositionManager");
  const positionManager = await upgrades.deployProxy(PositionManager, [
    "PerpArbitraDEX Positions",
    "PERP-POS",
    config.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await positionManager.deployed();
  console.log(`✅ PositionManager: ${positionManager.address}`);
  
  // 4. Déploiement PerpEngine
  const PerpEngine = await ethers.getContractFactory("PerpEngine");
  const perpEngine = await upgrades.deployProxy(PerpEngine, [
    config.address,
    registry.address,
    positionManager.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await perpEngine.deployed();
  console.log(`✅ PerpEngine: ${perpEngine.address}`);
  
  // 5. Déploiement RiskManager
  const RiskManager = await ethers.getContractFactory("RiskManager");
  const riskManager = await upgrades.deployProxy(RiskManager, [
    config.address,
    perpEngine.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await riskManager.deployed();
  console.log(`✅ RiskManager: ${riskManager.address}`);
  
  // 6. Configuration des liens
  await config.setPerpEngine(perpEngine.address);
  await config.setRiskManager(riskManager.address);
  await positionManager.setPerpEngine(perpEngine.address);
  await registry.setPerpEngine(perpEngine.address);
  
  // 7. Validation et sauvegarde
  const deployment = {
    ProtocolConfig: config.address,
    MarketRegistry: registry.address,
    PositionManager: positionManager.address,
    PerpEngine: perpEngine.address,
    RiskManager: riskManager.address,
    timestamp: Date.now(),
    network: network.name
  };
  
  await saveDeployment("core", deployment);
  await validateDeployment(deployment);
  
  console.log("🎯 Core Protocol déployé avec succès");
  return deployment;
};