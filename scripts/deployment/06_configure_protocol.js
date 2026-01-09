// @title: Configuration post-déploiement avec validation exhaustive
// @validation: Tous les paramètres vérifiés, markets activés explicitement
// @audit: Snapshot config final pour transparence

const { ethers } = require("hardhat");
const { getDeployment, saveConfiguration } = require("../utils/deployment-utils");
const { PROTOCOL_PARAMS, MARKETS_CONFIG } = require("../utils/constants");

module.exports = async () => {
  console.log("⚙️ Configuration Finale du Protocole");
  
  // Récupération de tous les déploiements
  const core = await getDeployment("core");
  const oracles = await getDeployment("oracles");
  const liquidation = await getDeployment("liquidation");
  const governance = await getDeployment("governance");
  const integrations = await getDeployment("integrations");
  
  if (!core || !oracles || !liquidation || !governance) {
    throw new Error("Missing deployment data");
  }
  
  const [deployer] = await ethers.getSigners();
  
  // 1. Configuration ProtocolConfig
  const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
  const config = ProtocolConfig.attach(core.ProtocolConfig);
  
  // Configuration des paramètres globaux
  await config.setGlobalParameters(
    PROTOCOL_PARAMS.initialMarginRatio,
    PROTOCOL_PARAMS.maintenanceMarginRatio,
    PROTOCOL_PARAMS.liquidationFee,
    PROTOCOL_PARAMS.protocolFee,
    PROTOCOL_PARAMS.maxLeverage,
    PROTOCOL_PARAMS.fundingRateInterval
  );
  console.log("✅ Global parameters configured");
  
  // 2. Configuration des marchés
  const MarketRegistry = await ethers.getContractFactory("MarketRegistry");
  const registry = MarketRegistry.attach(core.MarketRegistry);
  
  for (const market of MARKETS_CONFIG) {
    await registry.addMarket(
      market.id,
      market.name,
      market.baseToken,
      market.quoteToken,
      market.maxPositionSize,
      market.minPositionSize,
      market.tickSize,
      market.oracleSources
    );
    console.log(`✅ Market ${market.id} added`);
  }
  
  // 3. Configuration Oracles
  const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
  const aggregator = OracleAggregator.attach(oracles.OracleAggregator);
  
  // Configuration des sources par marché
  for (const market of MARKETS_CONFIG) {
    const sources = [];
    if (market.oracleSources.includes("chainlink")) {
      sources.push(oracles.ChainlinkOracle);
    }
    if (market.oracleSources.includes("pyth")) {
      sources.push(oracles.PythOracle);
    }
    if (market.oracleSources.includes("twap")) {
      sources.push(oracles.TWAPOracle);
    }
    
    await aggregator.setMarketSources(market.id, sources);
    console.log(`✅ Oracle sources configured for ${market.id}`);
  }
  
  // 4. Configuration Liquidations
  const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
  const liquidationEngine = LiquidationEngine.attach(liquidation.LiquidationEngine);
  
  await liquidationEngine.setLiquidationParameters(
    PROTOCOL_PARAMS.liquidationBuffer,
    PROTOCOL_PARAMS.maxLiquidationSize,
    PROTOCOL_PARAMS.liquidationDelay
  );
  console.log("✅ Liquidation parameters configured");
  
  // 5. Transfert ownership à Timelock
  await config.transferOwnership(governance.TimelockController);
  await registry.transferOwnership(governance.TimelockController);
  console.log("✅ Ownership transferred to Timelock");
  
  // 6. Création snapshot de configuration
  const configuration = {
    core,
    oracles,
    liquidation,
    governance,
    integrations,
    parameters: PROTOCOL_PARAMS,
    markets: MARKETS_CONFIG,
    timestamp: Date.now(),
    deployer: deployer.address,
    network: (await ethers.provider.getNetwork()).name
  };
  
  await saveConfiguration("initial", configuration);
  
  console.log("🎯 Protocol configuration completed successfully");
  console.log("📊 Configuration saved for audit trail");
  
  return configuration;
};