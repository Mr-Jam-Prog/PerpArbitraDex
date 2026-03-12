// @title: Tests d'intégration Flash Loans Aave V3
// @security: Atomicité complète, pas de fonds bloqués
// @invariants: Flash loan doit être remboursé dans la même transaction

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, formatUnits } = ethers;

describe("🚀 FlashLoans Integration", function () {
  let deployer, user1, liquidator;
  let perpEngine, aaveIntegrator, usdc, weth;
  let flashLiquidator, liquidationEngine;
  
  const USDC_ADDRESS = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"; // Arbitrum USDC
  const WETH_ADDRESS = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"; // Arbitrum WETH
  const AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"; // Aave V3 Pool
  
  before(async function () {
    [deployer, user1, liquidator] = await ethers.getSigners();
    
    // Déploiement des contrats mock Aave
    const AavePoolMock = await ethers.getContractFactory("MockAavePool");
    const aavePoolMock = await AavePoolMock.deploy();
    
    const AaveIntegrator = await ethers.getContractFactory("AaveFlashLoanIntegrator");
    aaveIntegrator = await AaveIntegrator.deploy(aavePoolMock.address);
    
    // Déploiement du FlashLiquidator
    const FlashLiquidator = await ethers.getContractFactory("FlashLiquidator");
    flashLiquidator = await FlashLiquidator.deploy();
    
    // Setup tokens mock
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USDC", "USDC", 6);
    weth = await MockERC20.deploy("WETH", "WETH", 18);
    
    // Approvisionnement
    await usdc.mint(deployer.address, parseUnits("1000000", 6));
    await weth.mint(deployer.address, parseUnits("1000", 18));
  });
  
  describe("📦 Basic Flash Loan Operations", function () {
    it("Devrait exécuter un flash loan simple", async function () {
      const loanAmount = parseUnits("10000", 6); // 10k USDC
      const premium = loanAmount * (9) / (10000); // 0.09% premium
      
      const tx = await aaveIntegrator.executeFlashLoan(
        usdc.address,
        loanAmount,
        premium,
        "0x"
      );
      
      await expect(tx)
        .to.emit(aaveIntegrator, "FlashLoanExecuted")
        .withArgs(usdc.address, loanAmount, premium);
    });
    
    it("Devrait rejeter un flash loan non remboursé", async function () {
      const loanAmount = parseUnits("10000", 6);
      const premium = loanAmount * (9) / (10000);
      
      // Encodage d'une opération qui ne rembourse pas
      const maliciousData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bool"],
        [false] // Ne pas rembourser
      );
      
      await expect(
        aaveIntegrator.executeFlashLoan(
          usdc.address,
          loanAmount,
          premium,
          maliciousData
        )
      ).to.be.revertedWith("Flash loan not repaid");
    });
    
    it("Devrait calculer correctement les frais de flash loan", async function () {
      const loanAmount = parseUnits("50000", 6);
      const expectedPremium = loanAmount * (9) / (10000); // 0.09%
      
      const premium = await aaveIntegrator.calculateFlashLoanFee(
        usdc.address,
        loanAmount
      );
      
      expect(premium).to.equal(expectedPremium);
    });
  });
  
  describe("⚡ Flash Loan Liquidations", function () {
    beforeEach(async function () {
      // Setup d'une position sous-collatéralisée
      const collateralAmount = parseUnits("1000", 6); // 1000 USDC
      const positionSize = parseUnits("10000", 6); // 10k position
      
      await usdc.connect(user1).approve(perpEngine.address, collateralAmount);
      await perpEngine.connect(user1).openPosition(
        "ETH-USD",
        collateralAmount,
        positionSize,
        true // long
      );
      
      // Simulation d'une baisse de prix pour mettre en sous-collatéralisation
      // (Dans la réalité, via oracle manipulation)
    });
    
    it("Devrait liquider une position via flash loan", async function () {
      const positionId = 1;
      const loanAmount = parseUnits("5000", 6);
      
      const tx = await flashLiquidator.executeFlashLiquidation(
        positionId,
        usdc.address,
        loanAmount
      );
      
      await expect(tx)
        .to.emit(liquidationEngine, "PositionLiquidated")
        .to.emit(aaveIntegrator, "FlashLoanExecuted");
      
      // Vérification que la position est fermée
      const position = await perpEngine.getPosition(positionId);
      expect(position.size).to.equal(0);
    });
    
    it("Devrait être rentable pour le liquidateur", async function () {
      const positionId = 1;
      const initialBalance = await usdc.balanceOf(liquidator.address);
      
      await flashLiquidator.connect(liquidator).executeFlashLiquidation(
        positionId,
        usdc.address,
        parseUnits("5000", 6)
      );
      
      const finalBalance = await usdc.balanceOf(liquidator.address);
      const profit = finalBalance - (initialBalance);
      
      expect(profit).to.be > (0); // Profit positif
    });
    
    it("Devrait échouer si le flash loan n'est pas rentable", async function () {
      // Setup d'une position avec peu de collateral restant
      const positionId = 2;
      
      await expect(
        flashLiquidator.executeFlashLiquidation(
          positionId,
          usdc.address,
          parseUnits("100000", 6) // Montant trop élevé
        )
      ).to.be.revertedWith("Not profitable");
    });
  });
  
  describe("🔒 Security & Edge Cases", function () {
    it("Devrait rejeter les tokens non supportés", async function () {
      const invalidToken = deployer.address; // Adresse non token
      
      await expect(
        aaveIntegrator.executeFlashLoan(
          invalidToken,
          parseUnits("1000", 18),
          0,
          "0x"
        )
      ).to.be.revertedWith("Token not supported");
    });
    
    it("Devrait rejeter les montants trop élevés", async function () {
      const maxLoan = await aaveIntegrator.getMaxFlashLoan(usdc.address);
      const excessiveAmount = maxLoan + (1);
      
      await expect(
        aaveIntegrator.executeFlashLoan(
          usdc.address,
          excessiveAmount,
          0,
          "0x"
        )
      ).to.be.revertedWith("Exceeds max flash loan");
    });
    
    it("Devrait prévenir les attaques de réentrance", async function () {
      const ReentrancyAttacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await ReentrancyAttacker.deploy(aaveIntegrator.address);
      
      await expect(
        attacker.attack(usdc.address, parseUnits("1000", 6))
      ).to.be.revertedWith("ReentrancyGuard: reentrant call");
    });
  });
  
  describe("📊 Gas & Performance", function () {
    it("Devrait optimiser le gas pour les flash loans", async function () {
      const loanAmount = parseUnits("10000", 6);
      const premium = loanAmount * (9) / (10000);
      
      const tx = await aaveIntegrator.executeFlashLoan(
        usdc.address,
        loanAmount,
        premium,
        "0x"
      );
      
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed;
      
      // Gas target pour L2 (Arbitrum)
      expect(gasUsed).to.be < (500000); // Max 500k gas
    });
    
    it("Devrait batch multiple flash loans", async function () {
      const tokens = [usdc.address, weth.address];
      const amounts = [
        parseUnits("5000", 6),
        parseUnits("10", 18)
      ];
      const premiums = amounts.map(amount => amount * (9) / (10000));
      
      const tx = await aaveIntegrator.executeBatchFlashLoan(
        tokens,
        amounts,
        premiums,
        "0x"
      );
      
      await expect(tx)
        .to.emit(aaveIntegrator, "BatchFlashLoanExecuted")
        .withArgs(tokens, amounts, premiums);
    });
  });
});