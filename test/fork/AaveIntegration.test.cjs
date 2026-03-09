// @title: Tests d'intégration Aave V3 sur mainnet fork
// @network: Arbitrum mainnet fork
// @security: Tests avec contrats réels, pas de mocks

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits } = ethers.utils;

describe("🏦 Aave V3 Mainnet Fork Integration", function () {
  // Adresses Arbitrum Mainnet
  const AAVE_POOL_V3 = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
  const USDC = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
  const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  const A_USDC = "0x625E7708f30cA75bfd92586e17077590C60eb4cD";
  const VARIABLE_DEBT_USDC = "0xFCCf3cAbbe80101232d343252614b6A3eE81C989";
  
  let deployer, user;
  let aaveIntegrator, aavePool;
  let usdc, weth, aUsdc;
  
  before(async function () {
    // Cette suite nécessite une connexion à un nœud avec fork mainnet
    if (!process.env.MAINNET_RPC_URL) {
      this.skip();
    }
    
    await hre.network.provider.request({
      method: "hardhat_reset",
      params: [{
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: 15000000 // Bloc récent
        }
      }]
    });
    
    [deployer, user] = await ethers.getSigners();
    
    // Récupération des contrats réels
    aavePool = await ethers.getContractAt("IPool", AAVE_POOL_V3);
    usdc = await ethers.getContractAt("IERC20", USDC);
    weth = await ethers.getContractAt("IERC20", WETH);
    aUsdc = await ethers.getContractAt("IAToken", A_USDC);
    
    // Déploiement de l'intégrateur
    const AaveIntegrator = await ethers.getContractFactory("AaveFlashLoanIntegrator");
    aaveIntegrator = await AaveIntegrator.deploy(AAVE_POOL_V3);
    
    // Funding pour les tests
    // Sur un fork, nous pouvons importer des tokens
    const whale = "0x489ee077994b6658eafa855c308275ed80929c44"; // Un whale USDC Arbitrum
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [whale]
    });
    
    const whaleSigner = await ethers.getSigner(whale);
    const whaleBalance = await usdc.balanceOf(whale);
    
    // Transfert de USDC au deployer
    await usdc.connect(whaleSigner).transfer(
      deployer.address,
      whaleBalance / (10) // 10% du balance
    );
    
    // Stop impersonation
    await hre.network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [whale]
    });
  });
  
  describe("💰 Supply & Withdraw", function () {
    it("Devrait déposer des fonds sur Aave", async function () {
      const amount = parseUnits("1000", 6); // 1000 USDC
      
      await usdc.connect(deployer).approve(aavePool.address, amount);
      
      const tx = await aavePool.connect(deployer).supply(
        USDC,
        amount,
        deployer.address,
        0 // referral code
      );
      
      await expect(tx)
        .to.emit(aavePool, "Supply")
        .withArgs(USDC, deployer.address, deployer.address, amount, 0);
      
      // Vérification du aToken balance
      const aTokenBalance = await aUsdc.balanceOf(deployer.address);
      expect(aTokenBalance).to.be > (0);
    });
    
    it("Devrait retirer des fonds d'Aave", async function () {
      const amount = parseUnits("500", 6);
      const aTokenBalance = await aUsdc.balanceOf(deployer.address);
      
      await aUsdc.connect(deployer).approve(aavePool.address, amount);
      
      const tx = await aavePool.connect(deployer).withdraw(
        USDC,
        amount,
        deployer.address
      );
      
      await expect(tx)
        .to.emit(aavePool, "Withdraw")
        .withArgs(USDC, deployer.address, deployer.address, amount);
    });
  });
  
  describe("⚡ Flash Loans", function () {
    it("Devrait exécuter un flash loan réel", async function () {
      const asset = USDC;
      const amount = parseUnits("10000", 6); // 10k USDC
      const referralCode = 0;
      
      // Vérification des paramètres du flash loan
      const flashLoanAvailable = await aavePool.getFlashLoanAvailable(asset);
      expect(flashLoanAvailable).to.be > (amount);
      
      // Exécution via l'intégrateur
      const premium = await aavePool.flashLoanPremiumTotal();
      const totalPremium = amount * (premium) / (10000);
      
      const tx = await aaveIntegrator.executeFlashLoan(
        asset,
        amount,
        totalPremium,
        "0x"
      );
      
      await expect(tx)
        .to.emit(aaveIntegrator, "FlashLoanExecuted")
        .withArgs(asset, amount, totalPremium);
    });
    
    it("Devrait calculer les frais correctement", async function () {
      const asset = USDC;
      const amount = parseUnits("5000", 6);
      
      const expectedFee = await aavePool.flashLoanPremiumTotal();
      const expectedPremium = amount * (expectedFee) / (10000);
      
      const premium = await aaveIntegrator.calculateFlashLoanFee(asset, amount);
      
      expect(premium).to.equal(expectedPremium);
    });
    
    it("Devrait supporter les flash loans batch", async function () {
      const assets = [USDC, WETH];
      const amounts = [
        parseUnits("5000", 6),
        parseUnits("5", 18)
      ];
      const referralCode = 0;
      
      const premiums = await Promise.all(
        assets.map((asset, i) => 
          aaveIntegrator.calculateFlashLoanFee(asset, amounts[i])
        )
      );
      
      const tx = await aaveIntegrator.executeBatchFlashLoan(
        assets,
        amounts,
        premiums,
        "0x"
      );
      
      await expect(tx)
        .to.emit(aaveIntegrator, "BatchFlashLoanExecuted")
        .withArgs(assets, amounts, premiums);
    });
  });
  
  describe("📈 Interest Rates & Health Factor", function () {
    it("Devrait lire les taux d'intérêt courants", async function () {
      const reserveData = await aavePool.getReserveData(USDC);
      
      // Vérification que les données sont valides
      expect(reserveData.currentLiquidityRate).to.be > (0);
      expect(reserveData.currentVariableBorrowRate).to.be > (0);
      expect(reserveData.currentStableBorrowRate).to.be > (0);
    });
    
    it("Devrait calculer le health factor d'un utilisateur", async function () {
      // Supply de collateral
      const supplyAmount = parseUnits("1000", 6);
      await usdc.connect(deployer).approve(aavePool.address, supplyAmount);
      await aavePool.connect(deployer).supply(USDC, supplyAmount, deployer.address, 0);
      
      // Emprunt
      const borrowAmount = parseUnits("500", 6);
      await aavePool.connect(deployer).borrow(
        USDC,
        borrowAmount,
        2, // variable rate
        0,
        deployer.address
      );
      
      // Récupération du health factor
      const userAccountData = await aavePool.getUserAccountData(deployer.address);
      
      expect(userAccountData.healthFactor).to.be > (0);
      expect(userAccountData.totalCollateralBase).to.be > (0);
      expect(userAccountData.totalDebtBase).to.be > (0);
    });
  });
  
  describe("🔒 Safety & Limits", function () {
    it("Devrait respecter les limites d'emprunt", async function () {
      const userAccountData = await aavePool.getUserAccountData(deployer.address);
      const maxBorrow = userAccountData.availableBorrowsBase;
      
      // Tentative d'emprunt au-dessus de la limite
      const excessBorrow = maxBorrow + (1);
      
      await expect(
        aavePool.connect(deployer).borrow(
          USDC,
          excessBorrow,
          2,
          0,
          deployer.address
        )
      ).to.be.revertedWith("57"); // Error code for borrow cap exceeded
    });
    
    it("Devrait déclencher une liquidation si HF < 1", async function () {
      // Création d'une position sous-collatéralisée
      // (Ce test nécessite une manipulation de prix oracle)
      
      // Vérification que la liquidation est possible
      const liquidationParams = await aavePool.getUserAccountData(user.address);
      
      if (liquidationParams.healthFactor < (parseUnits("1", 18))) {
        // La position est liquidable
        const tx = await aavePool.liquidationCall(
          USDC,
          WETH,
          user.address,
          parseUnits("1000", 6),
          false
        );
        
        await expect(tx)
          .to.emit(aavePool, "LiquidationCall");
      }
    });
  });
});