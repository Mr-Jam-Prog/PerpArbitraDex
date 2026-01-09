// @title: Proposer un upgrade via gouvernance
// @security: Vérification ABI, compatibilité storage
// @governance: Timelock enforced, no direct upgrades

const { ethers, upgrades } = require("hardhat");
const { getDeployment, saveUpgradeProposal } = require("../utils/deployment-utils");

module.exports = async (contractName, newImplementation) => {
  console.log(`📝 Proposal d'upgrade pour ${contractName}`);
  
  const governance = await getDeployment("governance");
  if (!governance) throw new Error("Governance not deployed");
  
  const [proposer] = await ethers.getSigners();
  
  // 1. Vérification de la nouvelle implémentation
  const factory = await ethers.getContractFactory(contractName);
  const newImpl = await factory.deploy();
  await newImpl.deployed();
  
  console.log(`✅ New implementation deployed: ${newImpl.address}`);
  
  // 2. Vérification de compatibilité
  const proxyAddress = await getProxyAddress(contractName);
  if (!proxyAddress) throw new Error(`Proxy not found for ${contractName}`);
  
  await upgrades.validateUpgrade(proxyAddress, factory, {
    kind: 'uups'
  });
  console.log(`✅ Upgrade validation passed`);
  
  // 3. Création de la proposal
  const Governor = await ethers.getContractFactory("Governor");
  const governor = Governor.attach(governance.Governor);
  
  const calldata = await getUpgradeCalldata(proxyAddress, newImpl.address);
  
  const proposalId = await governor.propose(
    [proxyAddress], // targets
    [0], // values
    [calldata], // calldatas
    `Upgrade ${contractName} to ${newImpl.address.slice(0, 10)}...`
  );
  
  console.log(`✅ Upgrade proposal created: ${proposalId}`);
  
  // 4. Sauvegarde pour suivi
  const proposal = {
    id: proposalId.toString(),
    contract: contractName,
    proxy: proxyAddress,
    newImplementation: newImpl.address,
    proposer: proposer.address,
    timestamp: Date.now(),
    status: "proposed"
  };
  
  await saveUpgradeProposal(proposal);
  
  return proposal;
};