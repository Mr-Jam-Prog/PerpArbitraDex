// @title: Déploiement Token, Treasury, Timelock, Governor
// @security: Timelock obligatoire, aucun EOA admin final
// @tokenomics: veToken model avec vote pondéré

const { ethers, upgrades } = require("hardhat");
const { saveDeployment, getDeployment } = require("../utils/deployment-utils");
const { TOKENOMICS, VESTING_SCHEDULE } = require("../utils/constants");

module.exports = async () => {
  console.log("🏛️ Déploiement Governance System");
  
  // 1. Déploiement token natif (ERC-20 avec votes)
  const PerpDexToken = await ethers.getContractFactory("PerpDexToken");
  const token = await PerpDexToken.deploy(
    TOKENOMICS.NAME,
    TOKENOMICS.SYMBOL,
    TOKENOMICS.INITIAL_SUPPLY
  );
  await token.deployed();
  console.log(`✅ PerpDexToken: ${token.address}`);
  
  // 2. Déploiement TimelockController
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(
    TOKENOMICS.TIMELOCK_DELAY, // 2 jours pour mainnet
    [], // proposers vides initialement
    [], // executors vides initialement
    ethers.constants.AddressZero // admin = timelock lui-même
  );
  await timelock.deployed();
  console.log(`✅ TimelockController: ${timelock.address}`);
  
  // 3. Déploiement Governor
  const Governor = await ethers.getContractFactory("Governor");
  const governor = await Governor.deploy(
    token.address,
    timelock.address,
    TOKENOMICS.VOTING_DELAY,
    TOKENOMICS.VOTING_PERIOD,
    TOKENOMICS.PROPOSAL_THRESHOLD,
    TOKENOMICS.QUORUM_PERCENTAGE
  );
  await governor.deployed();
  console.log(`✅ Governor: ${governor.address}`);
  
  // 4. Déploiement VotingEscrow (veToken)
  const VotingEscrow = await ethers.getContractFactory("VotingEscrow");
  const votingEscrow = await upgrades.deployProxy(VotingEscrow, [
    token.address,
    "Vote-escrowed PERP",
    "vePERP",
    TOKENOMICS.VE_MAX_TIME
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await votingEscrow.deployed();
  console.log(`✅ VotingEscrow: ${votingEscrow.address}`);
  
  // 5. Déploiement Treasury
  const Treasury = await ethers.getContractFactory("Treasury");
  const treasury = await upgrades.deployProxy(Treasury, [
    token.address,
    timelock.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await treasury.deployed();
  console.log(`✅ Treasury: ${treasury.address}`);
  
  // 6. Déploiement FeeDistributor
  const FeeDistributor = await ethers.getContractFactory("FeeDistributor");
  const feeDistributor = await upgrades.deployProxy(FeeDistributor, [
    token.address,
    votingEscrow.address,
    timelock.address
  ], {
    kind: 'uups',
    initializer: 'initialize'
  });
  await feeDistributor.deployed();
  console.log(`✅ FeeDistributor: ${feeDistributor.address}`);
  
  // 7. Configuration Timelock roles
  const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
  const ADMIN_ROLE = await timelock.TIMELOCK_ADMIN_ROLE();
  
  await timelock.grantRole(PROPOSER_ROLE, governor.address);
  await timelock.grantRole(EXECUTOR_ROLE, governor.address);
  await timelock.revokeRole(ADMIN_ROLE, (await ethers.getSigners())[0].address);
  
  const deployment = {
    PerpDexToken: token.address,
    TimelockController: timelock.address,
    Governor: governor.address,
    VotingEscrow: votingEscrow.address,
    Treasury: treasury.address,
    FeeDistributor: feeDistributor.address,
    timestamp: Date.now()
  };
  
  await saveDeployment("governance", deployment);
  
  console.log("🎯 Governance System déployé avec succès");
  return deployment;
};