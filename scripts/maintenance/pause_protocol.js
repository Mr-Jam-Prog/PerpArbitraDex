// @title: Pause immédiate du protocole
// @security: Role-based, event emitted, all entrypoints blocked
// @emergency: Guardian only, time-limited

const { ethers } = require("hardhat");
const { getDeployment, logEmergencyAction } = require("../utils/deployment-utils");

module.exports = async (reason = "Emergency pause") => {
  console.log(`⏸️ Emergency pause: ${reason}`);
  
  const core = await getDeployment("core");
  const [sender] = await ethers.getSigners();
  
  // 1. Vérification des permissions
  const PausableController = await ethers.getContractFactory("PausableController");
  const pausable = PausableController.attach(core.PausableController || core.ProtocolConfig);
  
  const hasRole = await pausable.hasRole(
    await pausable.PAUSER_ROLE(),
    sender.address
  );
  
  if (!hasRole) {
    throw new Error("Sender does not have PAUSER_ROLE");
  }
  
  // 2. Pause globale
  const tx = await pausable.pauseProtocol(reason);
  await tx.wait();
  
  // 3. Vérification que tout est bien paused
  const isPaused = await pausable.isProtocolPaused();
  if (!isPaused) {
    throw new Error("Protocol pause failed");
  }
  
  console.log("✅ Protocol paused successfully");
  
  // 4. Log pour audit trail
  await logEmergencyAction({
    action: "PAUSE",
    reason,
    executor: sender.address,
    timestamp: Date.now(),
    transactionHash: tx.hash
  });
  
  return {
    paused: true,
    reason,
    transactionHash: tx.hash,
    timestamp: Date.now()
  };
};