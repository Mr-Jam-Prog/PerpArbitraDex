// @title: Retrait emergency (dernier recours)
// @security: Guardian only, accounting preserved, snapshot préalable
// @audit: Tous les fonds trackés, signature multi-sig recommandée

const { ethers } = require("hardhat");
const { getDeployment, takeEmergencySnapshot } = require("../utils/deployment-utils");

module.exports = async (tokenAddress, amount, recipient) => {
  console.log(`🚨 Emergency withdraw: ${amount} to ${recipient}`);
  
  const [guardian] = await ethers.getSigners();
  const governance = await getDeployment("governance");
  
  // 1. Vérification guardian role
  const EmergencyGuardian = await ethers.getContractFactory("EmergencyGuardian");
  const emergencyGuardian = EmergencyGuardian.attach(governance.EmergencyGuardian);
  
  const isValid = await emergencyGuardian.isValidGuardian(guardian.address);
  if (!isValid) {
    throw new Error("Not a valid emergency guardian");
  }
  
  // 2. Snapshot de l'état avant retrait
  const snapshot = await takeEmergencySnapshot();
  console.log("📸 Emergency snapshot taken");
  
  // 3. Retrait via Treasury (si disponible) ou directement
  let tx;
  if (governance.Treasury) {
    const Treasury = await ethers.getContractFactory("Treasury");
    const treasury = Treasury.attach(governance.Treasury);
    
    tx = await treasury.emergencyWithdraw(
      tokenAddress,
      amount,
      recipient,
      "Emergency withdrawal"
    );
  } else {
    // Fallback: retrait direct (seulement pour les contrats avec emergency withdraw)
    const token = await ethers.getContractAt("IERC20", tokenAddress);
    tx = await token.transfer(recipient, amount);
  }
  
  await tx.wait();
  
  console.log("✅ Emergency withdraw executed");
  
  // 4. Log détaillé
  await logEmergencyAction({
    action: "EMERGENCY_WITHDRAW",
    token: tokenAddress,
    amount: amount.toString(),
    recipient,
    guardian: guardian.address,
    snapshotId: snapshot.id,
    transactionHash: tx.hash,
    timestamp: Date.now()
  });
  
  return {
    success: true,
    amount,
    recipient,
    transactionHash: tx.hash,
    snapshot: snapshot.id
  };
};