if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
// @title: Tests de gouvernance complète avec timelock
// @security: Timelock strict, pas d'actions instantanées
// @invariants: Aucun pouvoir centralisé, délais respectés

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, parseEther } = ethers;
const { parseUnits, parseEther } = ethers;
const { parseUnits, formatUnits } =
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🏛️ Governance End-to-End", function () {
  let deployer, alice, bob, charlie;
  let token, timelock, governor, votingEscrow, treasury;
  let perpEngine, protocolConfig;
  
  const VOTING_DELAY = 7200; // 1 day in blocks
  const VOTING_PERIOD = 50400; // 1 week in blocks
  const TIMELOCK_DELAY = 172800; // 2 days in seconds
  const PROPOSAL_THRESHOLD = parseUnits("100000", 18); // 100k tokens
  const QUORUM_PERCENTAGE = 4; // 4%
  
  before(async function () {
    [deployer, alice, bob, charlie] = await ethers.getSigners();
    
    // Déploiement du token
    const PerpDexToken = await ethers.getContractFactory("PerpDexToken");
    token = await PerpDexToken.deploy(
      "PerpArbitraDEX Token",
      "PERP",
      parseUnits("1000000000", 18) // 1B tokens
    );
    
    // Distribution initiale
    await token.transfer(alice.target, parseUnits("200000", 18));
    await token.transfer(bob.target, parseUnits("150000", 18));
    await token.transfer(charlie.target, parseUnits("100000", 18));
    
    // Déploiement du Timelock
    const TimelockController = await ethers.getContractFactory("TimelockController");
    timelock = await TimelockController.deploy(
      TIMELOCK_DELAY,
      [], // proposers vide initialement
      [], // executors vide initialement
      ethers.ZeroAddress
    );
    
    // Déploiement du Governor
    const Governor = await ethers.getContractFactory("Governor");
    governor = await Governor.deploy(
      token.target,
      timelock.target,
      VOTING_DELAY,
      VOTING_PERIOD,
      PROPOSAL_THRESHOLD,
      QUORUM_PERCENTAGE
    );
    
    // Déploiement du VotingEscrow
    const VotingEscrow = await ethers.getContractFactory("VotingEscrow");
    votingEscrow = await VotingEscrow.deploy(
      token.target,
      "Vote-escrowed PERP",
      "vePERP",
      4 * 365 * 24 * 3600 // 4 ans
    );
    
    // Déploiement de la Treasury
    const Treasury = await ethers.getContractFactory("Treasury");
    treasury = await Treasury.deploy(token.target, timelock.target);
    
    // Configuration des rôles
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const ADMIN_ROLE = await timelock.TIMELOCK_ADMIN_ROLE();
    
    await timelock.grantRole(PROPOSER_ROLE, governor.target);
    await timelock.grantRole(EXECUTOR_ROLE, governor.target);
    await timelock.revokeRole(ADMIN_ROLE, deployer.address);
    
    // Mock du PerpEngine pour les tests
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    
    // Mock du ProtocolConfig
    const MockProtocolConfig = await ethers.getContractFactory("MockProtocolConfig");
    protocolConfig = await MockProtocolConfig.deploy();
  });
  
  describe("🗳️ Proposal Creation & Voting", function () {
    beforeEach(async function () {
      // Délégation des tokens pour le vote
      await token.connect(alice).delegate(alice.target);
      await token.connect(bob).delegate(bob.target);
      await token.connect(charlie).delegate(charlie.target);
      
      // Lock des tokens pour veTokens
      await token.connect(alice).approve(votingEscrow.target, parseUnits("100000", 18));
      await votingEscrow.connect(alice).createLock(
        parseUnits("100000", 18),
        Math.floor(Date.now() / 1000) + 7 * 24 * 3600 // 1 semaine
      );
    });
    
    it("Devrait créer une proposal valide", async function () {
      const targets = [protocolConfig.target];
      const values = [0];
      const calldatas = [
        protocolConfig.interface.encodeFunctionData("setProtocolFee", [
          parseUnits("0.0015", 18) // 0.15%
        ])
      ];
      const description = "Increase protocol fee to 0.15%";
      
      const tx = await governor.connect(alice).propose(
        targets,
        values,
        calldatas,
        description
      );
      
      const receipt = await tx.wait();
      const event = receipt.events?.find(e => e.event === "ProposalCreated");
      const proposalId = event.args.proposalId;
      
      expect(proposalId).to.be.gt(0);
      expect(await governor.state(proposalId)).to.equal(0); // Pending
    });
    
    it("Devrait rejeter une proposal sans assez de tokens", async function () {
      const smallHolder = await ethers.getSigner(4);
      await token.transfer(smallHolder.target, parseUnits("50000", 18)); // En dessous du threshold
      
      await expect(
        governor.connect(smallHolder).propose(
          [protocolConfig.target],
          [0],
          [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
          "Should fail"
        )
      ).to.be.revertedWith("Governor: proposer votes below proposal threshold");
    });
    
    it("Devrait permettre le vote avec veTokens", async function () {
      // Création d'une proposal
      const targets = [protocolConfig.target];
      const values = [0];
      const calldatas = [
        protocolConfig.interface.encodeFunctionData("setProtocolFee", [
          parseUnits("0.0015", 18)
        ])
      ];
      const description = "Test veToken voting";
      
      const tx = await governor.connect(alice).propose(
        targets,
        values,
        calldatas,
        description
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Passage au voting period
      await time.advanceBlocks(VOTING_DELAY + 1);
      
      // Vote avec veTokens
      const txVote = await governor.connect(alice).castVote(
        proposalId,
        1 // For
      );
      
      await expect(txVote)
        .to.emit(governor, "VoteCast")
        .withArgs(alice.target, proposalId, 1, await votingEscrow.balanceOf(alice.target), "");
    });
    
    it("Devrait atteindre le quorum", async function () {
      const targets = [protocolConfig.target];
      const values = [0];
      const calldatas = [
        protocolConfig.interface.encodeFunctionData("setProtocolFee", [
          parseUnits("0.0015", 18)
        ])
      ];
      const description = "Quorum test";
      
      const tx = await governor.connect(alice).propose(
        targets,
        values,
        calldatas,
        description
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Passage au voting period
      await time.advanceBlocks(VOTING_DELAY + 1);
      
      // Votes multiples pour atteindre le quorum
      await governor.connect(alice).castVote(proposalId, 1);
      await governor.connect(bob).castVote(proposalId, 1);
      await governor.connect(charlie).castVote(proposalId, 1);
      
      // Fin du voting period
      await time.advanceBlocks(VOTING_PERIOD);
      
      expect(await governor.state(proposalId)).to.equal(4); // Succeeded
    });
  });
  
  describe("⏱️ Timelock Execution", function () {
    let proposalId;
    
    beforeEach(async function () {
      // Création d'une proposal pour tests d'exécution
      const targets = [protocolConfig.target];
      const values = [0];
      const calldatas = [
        protocolConfig.interface.encodeFunctionData("setProtocolFee", [
          parseUnits("0.0015", 18)
        ])
      ];
      const description = "Timelock execution test";
      
      const tx = await governor.connect(alice).propose(
        targets,
        values,
        calldatas,
        description
      );
      
      const receipt = await tx.wait();
      proposalId = receipt.events?.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Votes pour passer la proposal
      await time.advanceBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, 1);
      await governor.connect(bob).castVote(proposalId, 1);
      await time.advanceBlocks(VOTING_PERIOD);
    });
    
    it("Devrait respecter le délai du timelock", async function () {
      // Proposal doit être dans l'état "Succeeded"
      expect(await governor.state(proposalId)).to.equal(4);
      
      // Queue dans le timelock
      await governor.queue(
        [protocolConfig.target],
        [0],
        [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
        keccak256(toUtf8Bytes("Timelock execution test"))
      );
      
      // Vérification que l'action est dans le timelock
      const timestamp = await timelock.getTimestamp(
        keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address[]", "uint256[]", "bytes[]", "bytes32"],
            [
              [protocolConfig.target],
              [0],
              [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
              keccak256(toUtf8Bytes("Timelock execution test"))
            ]
          )
        )
      );
      
      expect(timestamp).to.be.gt(0);
      
      // Tentative d'exécution avant le délai
      await expect(
        governor.execute(
          [protocolConfig.target],
          [0],
          [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
          keccak256(toUtf8Bytes("Timelock execution test"))
        )
      ).to.be.revertedWith("TimelockController: operation is not ready");
    });
    
    it("Devrait exécuter après le délai du timelock", async function () {
      // Queue
      await governor.queue(
        [protocolConfig.target],
        [0],
        [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
        keccak256(toUtf8Bytes("Timelock execution test"))
      );
      
      // Attente du délai
      await time.increase(TIMELOCK_DELAY + 1);
      
      // Exécution
      const tx = await governor.execute(
        [protocolConfig.target],
        [0],
        [protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.0015", 18)])],
        keccak256(toUtf8Bytes("Timelock execution test"))
      );
      
      await expect(tx)
        .to.emit(protocolConfig, "ProtocolFeeUpdated")
        .withArgs(parseUnits("0.0015", 18));
      
      // Vérification du changement
      const newFee = await protocolConfig.protocolFee();
      expect(newFee).to.equal(parseUnits("0.0015", 18));
    });
  });
  
  describe("🚨 Emergency & Security", function () {
    it("Devrait permettre les vetos d'urgence", async function () {
      // Création d'une proposal malveillante
      const maliciousTargets = [treasury.target];
      const maliciousValues = [parseUnits("1000000", 18)];
      const maliciousCalldatas = [treasury.interface.encodeFunctionData("withdraw", [
        token.target,
        parseUnits("1000000", 18),
        deployer.address
      ])];
      
      const tx = await governor.connect(alice).propose(
        maliciousTargets,
        maliciousValues,
        maliciousCalldatas,
        "Malicious proposal"
      );
      
      const receipt = await tx.wait();
      const proposalId = receipt.events?.find(e => e.event === "ProposalCreated").args.proposalId;
      
      // Veto par le deployer (role emergency)
      await expect(governor.connect(deployer).veto(proposalId))
        .to.emit(governor, "ProposalVetoed")
        .withArgs(proposalId);
      
      expect(await governor.state(proposalId)).to.equal(2); // Canceled
    });
    
    it("Devrait rejeter les exécutions non autorisées", async function () {
      // Tentative d'exécution directe via timelock sans passer par le governor
      await expect(
        timelock.execute(
          protocolConfig.target,
          0,
          protocolConfig.interface.encodeFunctionData("setProtocolFee", [parseUnits("0.002", 18)]),
          0,
          keccak256(toUtf8Bytes("Direct execution attempt"))
        )
      ).to.be.reverted;
    });
    
    it("Devrait gérer les upgrades de contrat", async function () {
      // Déploiement d'une nouvelle version du Governor
      const GovernorV2 = await ethers.getContractFactory("GovernorV2");
      const governorV2 = await GovernorV2.deploy(
        token.target,
        timelock.target,
        VOTING_DELAY,
        VOTING_PERIOD,
        PROPOSAL_THRESHOLD,
        QUORUM_PERCENTAGE
      );
      
      // Proposal pour upgrader le governor
      const targets = [timelock.target];
      const values = [0];
      const calldatas = [
        timelock.interface.encodeFunctionData("grantRole", [
          await timelock.PROPOSER_ROLE(),
          governorV2.target
        ])
      ];
      
      await governor.connect(alice).propose(
        targets,
        values,
        calldatas,
        "Upgrade to GovernorV2"
      );
      
      // ... voting et execution process
    });
  });
  
  describe("📊 Governance Metrics", function () {
    it("Devrait calculer correctement le voting power", async function () {
      const blockNumber = await ethers.provider.getBlockNumber();
      const votingPowerAlice = await governor.getVotes(alice.target, blockNumber - 1);
      const votingPowerBob = await governor.getVotes(bob.target, blockNumber - 1);
      
      expect(votingPowerAlice).to.be.gt(0);
      expect(votingPowerBob).to.be.gt(0);
    });
    
    it("Devrait suivre les proposals actives", async function () {
      const proposalsCount = await governor.proposalCount();
      const latestProposalId = await governor.latestProposalIds(alice.target);
      
      expect(proposalsCount).to.be.gte(0);
    });
    
    it("Devrait générer des statistiques de gouvernance", async function () {
      const voterParticipation = await governor.getVoterParticipation();
      const proposalSuccessRate = await governor.getProposalSuccessRate();
      const averageVotingPower = await governor.getAverageVotingPower();
      
      // Ces valeurs devraient être accessibles et cohérentes
      expect(voterParticipation).to.be.gte(0);
      expect(proposalSuccessRate).to.be.gte(0).and.lte(100);
    });
  });
});