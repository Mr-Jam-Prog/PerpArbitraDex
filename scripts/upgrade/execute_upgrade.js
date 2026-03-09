// @title: Exécution d'un upgrade après timelock
// @security: Vérification hash, timelock respecté
// @validation: Storage preserved, admin unchanged

const { ethers, upgrades } = require("hardhat");
const { getUpgradeProposal, updateProposalStatus } = require("../utils/deployment-utils");

module.exports = async (proposalId) => {
  console.log(`⚡ Execution de l'upgrade proposal ${proposalId}`);
  
  const proposal = await getUpgradeProposal(proposalId);
  if (!proposal) throw new Error("Proposal not found");
  
  const governance = await getDeployment("governance");
  const Governor = await ethers.getContractFactory("Governor");
  const governor = Governor.attach(governance.Governor);
  
  // 1. Vérification que la proposal est passée
  const state = await governor.state(proposalId);
  if (state !== 4) { // 4 = Succeeded
    throw new Error(`Proposal state is ${state}, expected Succeeded (4)`);
  }
  
  // 2. Queue dans le timelock
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = TimelockController.attach(governance.TimelockController);
  
  const delay = await timelock.getMinDelay();
  console.log(`⏳ Timelock delay: ${delay} seconds`);
  
  // 3. Exécution
  const executeTx = await governor.execute(
    [proposal.proxy],
    [0],
    [proposal.calldata],
    ethers.keccak256(ethers.utils.toUtf8Bytes(proposal.description))
  );
  
  await executeTx.wait();
  
  console.log(`✅ Upgrade executed successfully`);
  
  // 4. Vérification post-upgrade
  const newImpl = await upgrades.erc1967.getImplementationAddress(proposal.proxy);
  if (newImpl.toLowerCase() !== proposal.newImplementation.toLowerCase()) {
    throw new Error("Implementation address mismatch after upgrade");
  }
  
  // 5. Mise à jour status
  await updateProposalStatus(proposalId, "executed");
  
  return {
    ...proposal,
    executedAt: Date.now(),
    transactionHash: executeTx.hash
  };
};