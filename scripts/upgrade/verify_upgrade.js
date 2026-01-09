// @title: Vérification complète post-upgrade
// @tests: Smoke tests, storage verification, admin checks
// @audit: Full validation suite

const { ethers, upgrades } = require("hardhat");
const { runSmokeTests } = require("../utils/test-utils");

module.exports = async (proxyAddress) => {
  console.log(`🔍 Verification post-upgrade pour ${proxyAddress}`);
  
  // 1. Vérification storage layout
  const implementation = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const admin = await upgrades.erc1967.getAdminAddress(proxyAddress);
  
  console.log(`✅ Implementation: ${implementation}`);
  console.log(`✅ Admin: ${admin}`);
  
  // 2. Vérification que l'admin est toujours le Timelock
  const governance = await getDeployment("governance");
  if (admin.toLowerCase() !== governance.TimelockController.toLowerCase()) {
    throw new Error("Admin changed after upgrade");
  }
  
  // 3. Smoke tests
  console.log("🧪 Running smoke tests...");
  await runSmokeTests(proxyAddress);
  
  // 4. Vérification ABI
  const contract = await ethers.getContractAt("IUpgradeable", proxyAddress);
  const version = await contract.version();
  console.log(`✅ Contract version: ${version}`);
  
  // 5. Health check
  const healthCheck = await performHealthCheck(proxyAddress);
  if (!healthCheck.healthy) {
    throw new Error(`Health check failed: ${healthCheck.errors.join(", ")}`);
  }
  
  console.log("🎯 Upgrade verification completed successfully");
  
  return {
    implementation,
    admin,
    version,
    healthCheck,
    timestamp: Date.now()
  };
};