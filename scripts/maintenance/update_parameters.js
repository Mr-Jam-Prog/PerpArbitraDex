// @title: Mise à jour paramètres économiques
// @governance: Via Timelock uniquement
// @validation: Bounds check, version bump, events

const { ethers } = require("hardhat");
const { getDeployment, validateParameters } = require("../utils/deployment-utils");

module.exports = async (parameters) => {
  console.log("🔄 Mise à jour des paramètres protocol");
  
  // 1. Validation des paramètres
  const validation = validateParameters(parameters);
  if (!validation.valid) {
    throw new Error(`Invalid parameters: ${validation.errors.join(", ")}`);
  }
  
  const core = await getDeployment("core");
  const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
  const config = ProtocolConfig.attach(core.ProtocolConfig);
  
  // 2. Vérification des permissions (doit être appelé via Timelock)
  const [sender] = await ethers.getSigners();
  const owner = await config.owner();
  
  if (sender.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Only owner (Timelock) can update parameters");
  }
  
  // 3. Mise à jour
  const tx = await config.setGlobalParameters(
    parameters.initialMarginRatio,
    parameters.maintenanceMarginRatio,
    parameters.liquidationFee,
    parameters.protocolFee,
    parameters.maxLeverage,
    parameters.fundingRateInterval
  );
  
  await tx.wait();
  
  // 4. Vérification
  const updated = await config.getGlobalParameters();
  if (updated.initialMarginRatio.toString() !== parameters.initialMarginRatio.toString()) {
    throw new Error("Parameters not updated correctly");
  }
  
  console.log("✅ Parameters updated successfully");
  
  // 5. Version bump
  const version = await config.version();
  await config.incrementVersion();
  
  return {
    parameters: updated,
    version: (parseInt(version) + 1).toString(),
    transactionHash: tx.hash,
    timestamp: Date.now()
  };
};