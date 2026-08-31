// @title: Déploiement Oracle Stack avec sécurité multi-couches
// @security: Multi-sources, TWAP, Sanity Checker
// @fallback: Chainlink → Pyth → TWAP

const { ethers, upgrades } = require("hardhat");
const { saveDeployment, validateOracleSetup } = require("../utils/deployment-utils");
const { ORACLE_CONFIG, NETWORK_CONFIG } = require("../utils/constants");
const { validateContractDeployment, validateScriptExecution } = require("../utils/allowlist-validator.cjs");

module.exports = async () => {
  validateScriptExecution("02_deploy_oracles.js");
  console.log("🔮 Déploiement Oracle System");
  
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  
  // 1. Déploiement OracleAggregator
  validateContractDeployment("OracleAggregator");
  const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
  const aggregator = await upgrades.deployProxy(OracleAggregator, [], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await aggregator.deployed();
  console.log(`✅ OracleAggregator: ${aggregator.address}`);
  
  // 2. Déploiement OracleSanityChecker
  validateContractDeployment("OracleSanityChecker");
  const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
  const sanityChecker = await upgrades.deployProxy(OracleSanityChecker, [], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await sanityChecker.deployed();
  console.log(`✅ OracleSanityChecker: ${sanityChecker.address}`);
  
  // 3. Configuration des bornes de sécurité
  await sanityChecker.setPriceBounds(
    ORACLE_CONFIG.MIN_PRICE_BOUND,
    ORACLE_CONFIG.MAX_PRICE_BOUND,
    ORACLE_CONFIG.MAX_DEVIATION_BPS
  );
  
  // 4. Déploiement ChainlinkOracle (Primary)
  validateContractDeployment("ChainlinkOracle");
  const ChainlinkOracle = await ethers.getContractFactory("ChainlinkOracle");
  const chainlinkOracle = await upgrades.deployProxy(ChainlinkOracle, [
    ORACLE_CONFIG.CHAINLINK_REGISTRY[network.chainId],
    aggregator.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await chainlinkOracle.deployed();
  console.log(`✅ ChainlinkOracle: ${chainlinkOracle.address}`);
  
  // 5. Déploiement PythOracle (Secondary - TEST_ONLY in MVP)
  validateContractDeployment("PythOracle");
  const PythOracle = await ethers.getContractFactory("PythOracle");
  const pythOracle = await upgrades.deployProxy(PythOracle, [
    ORACLE_CONFIG.PYTH_ADDRESS[network.chainId],
    aggregator.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await pythOracle.deployed();
  console.log(`✅ PythOracle: ${pythOracle.address}`);
  
  // 6. Déploiement TWAPOracle (Tertiary - QUARANTINED in MVP)
  validateContractDeployment("TWAPOracle");
  const TWAPOracle = await ethers.getContractFactory("TWAPOracle");
  const twapOracle = await upgrades.deployProxy(TWAPOracle, [
    ORACLE_CONFIG.UNISWAP_V3_FACTORY[network.chainId],
    aggregator.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await twapOracle.deployed();
  console.log(`✅ TWAPOracle: ${twapOracle.address}`);
  
  // 7. Configuration de l'agrégateur
  await aggregator.setSanityChecker(sanityChecker.address);
  
  const deployment = {
    OracleAggregator: aggregator.address,
    OracleSanityChecker: sanityChecker.address,
    ChainlinkOracle: chainlinkOracle.address,
    PythOracle: pythOracle.address,
    TWAPOracle: twapOracle.address,
    timestamp: Date.now()
  };
  
  await saveDeployment("oracles", deployment);
  await validateOracleSetup(deployment);
  
  console.log("🎯 Oracle System déployé avec succès");
  return deployment;
};
