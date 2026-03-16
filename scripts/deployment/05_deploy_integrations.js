// @title: Déploiement intégrations Aave, Lido, LayerZero, Account Abstraction
// @security: Whitelist stricte, aucun approve illimité
// @audit: Toutes les intégrations optionnelles et toggleables

const { ethers, upgrades } = require("hardhat");
const { saveDeployment, getDeployment } = require("../utils/deployment-utils");
const { INTEGRATION_CONFIG } = require("../utils/constants");

module.exports = async () => {
  console.log("🔗 Déploiement External Integrations");
  
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const core = await getDeployment("core");
  
  const deployments = {};
  
  // 1. Aave FlashLoan Integrator (si Aave disponible sur le réseau)
  if (INTEGRATION_CONFIG.AAVE_POOL_ADDRESSES[network.chainId]) {
    const AaveFlashLoanIntegrator = await ethers.getContractFactory("AaveFlashLoanIntegrator");
    const aaveIntegrator = await upgrades.deployProxy(AaveFlashLoanIntegrator, [
      INTEGRATION_CONFIG.AAVE_POOL_ADDRESSES[network.chainId],
      core.ProtocolConfig
    ], {
      kind: 'uups',
      initializer: 'initialize'
    });
    await aaveIntegrator.deployed();
    console.log(`✅ AaveFlashLoanIntegrator: ${aaveIntegrator.address}`);
    deployments.AaveFlashLoanIntegrator = aaveIntegrator.address;
  }
  
  // 2. Lido stETH Integrator (si Ethereum Mainnet)
  if (INTEGRATION_CONFIG.LIDO_STETH[network.chainId]) {
    const LidoStETHIntegrator = await ethers.getContractFactory("LidoStETHIntegrator");
    const lidoIntegrator = await upgrades.deployProxy(LidoStETHIntegrator, [
      INTEGRATION_CONFIG.LIDO_STETH[network.chainId],
      core.ProtocolConfig
    ], {
      kind: 'uups',
      initializer: 'initialize'
    });
    await lidoIntegrator.deployed();
    console.log(`✅ LidoStETHIntegrator: ${lidoIntegrator.address}`);
    deployments.LidoStETHIntegrator = lidoIntegrator.address;
  }
  
  // 3. CrossChain Messenger (LayerZero)
  if (INTEGRATION_CONFIG.LAYERZERO_ENDPOINT[network.chainId]) {
    const CrossChainMessenger = await ethers.getContractFactory("CrossChainMessenger");
    const crossChainMessenger = await upgrades.deployProxy(CrossChainMessenger, [
      INTEGRATION_CONFIG.LAYERZERO_ENDPOINT[network.chainId],
      core.ProtocolConfig
    ], {
      kind: 'uups',
      initializer: 'initialize'
    });
    await crossChainMessenger.deployed();
    console.log(`✅ CrossChainMessenger: ${crossChainMessenger.address}`);
    deployments.CrossChainMessenger = crossChainMessenger.address;
  }
  
  // 4. Account Abstraction Adapter (ERC-4337)
  if (INTEGRATION_CONFIG.ENTRY_POINT[network.chainId]) {
    const AccountAbstractionAdapter = await ethers.getContractFactory("AccountAbstractionAdapter");
    const aaAdapter = await upgrades.deployProxy(AccountAbstractionAdapter, [
      INTEGRATION_CONFIG.ENTRY_POINT[network.chainId],
      core.ProtocolConfig
    ], {
      kind: 'uups',
      initializer: 'initialize'
    });
    await aaAdapter.deployed();
    console.log(`✅ AccountAbstractionAdapter: ${aaAdapter.address}`);
    deployments.AccountAbstractionAdapter = aaAdapter.address;
  }
  
  // Sauvegarde
  deployments.timestamp = Date.now();
  await saveDeployment("integrations", deployments);
  
  console.log("🎯 External Integrations déployées avec succès");
  return deployments;
};