const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("🏦 LiquidityVault - Comprehensive Unit Tests & Ledger Scenarios", function () {
  let owner, lp1, lp2, trader, liquidator, recipient;
  let quoteToken6, quoteToken18;
  let vault6, vault18;
  let mockEngine;

  const parse6 = (val) => ethers.parseUnits(val.toString(), 6);
  const parse18 = (val) => ethers.parseUnits(val.toString(), 18);

  beforeEach(async function () {
    [owner, lp1, lp2, trader, liquidator, recipient] = await ethers.getSigners();

    // Deploy Mock ERC20 Tokens with 6 and 18 decimals
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    quoteToken6 = await MockERC20.deploy("USD Coin", "USDC", 6);
    quoteToken18 = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);

    // Deploy Vaults
    const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
    vault6 = await LiquidityVault.deploy(await quoteToken6.getAddress(), "Vault USDC", "vUSDC");
    vault18 = await LiquidityVault.deploy(await quoteToken18.getAddress(), "Vault DAI", "vDAI");

    // Set mock engine as caller for engine-restricted methods
    mockEngine = owner; // Owner impersonates engine for unit testing restricted methods
    await vault6.setPerpEngine(mockEngine.address);
    await vault18.setPerpEngine(mockEngine.address);

    // Mint tokens to LPs and Trader
    await quoteToken6.mint(lp1.address, parse6(100000));
    await quoteToken6.mint(lp2.address, parse6(100000));
    await quoteToken6.mint(trader.address, parse6(100000));

    await quoteToken18.mint(lp1.address, parse18(100000));
    await quoteToken18.mint(lp2.address, parse18(100000));
    await quoteToken18.mint(trader.address, parse18(100000));

    // Approvals
    await quoteToken6.connect(lp1).approve(await vault6.getAddress(), ethers.MaxUint256);
    await quoteToken6.connect(lp2).approve(await vault6.getAddress(), ethers.MaxUint256);
    await quoteToken6.connect(trader).approve(await vault6.getAddress(), ethers.MaxUint256);

    await quoteToken18.connect(lp1).approve(await vault18.getAddress(), ethers.MaxUint256);
    await quoteToken18.connect(lp2).approve(await vault18.getAddress(), ethers.MaxUint256);
    await quoteToken18.connect(trader).approve(await vault18.getAddress(), ethers.MaxUint256);
  });

  describe("🔹 ERC-4626 Share Math & 6 vs 18 Decimals", function () {
    it("Should correctly handle initial deposit for 6-decimal token", async function () {
      const depositAmount = parse6(10000);
      await vault6.connect(lp1).deposit(depositAmount, lp1.address);

      expect(await vault6.totalAssets()).to.equal(depositAmount);
      expect(await vault6.balanceOf(lp1.address)).to.equal(depositAmount);
      expect(await vault6.availableLiquidity()).to.equal(depositAmount);
    });

    it("Should correctly handle initial deposit for 18-decimal token", async function () {
      const depositAmount = parse18(10000);
      await vault18.connect(lp1).deposit(depositAmount, lp1.address);

      expect(await vault18.totalAssets()).to.equal(depositAmount);
      expect(await vault18.balanceOf(lp1.address)).to.equal(depositAmount);
      expect(await vault18.availableLiquidity()).to.equal(depositAmount);
    });

    it("Should handle proportional deposits accurately", async function () {
      await vault6.connect(lp1).deposit(parse6(10000), lp1.address);
      await vault6.connect(lp2).deposit(parse6(5000), lp2.address);

      expect(await vault6.totalAssets()).to.equal(parse6(15000));
      expect(await vault6.balanceOf(lp1.address)).to.equal(parse6(10000));
      expect(await vault6.balanceOf(lp2.address)).to.equal(parse6(5000));
    });
  });

  describe("🔒 Locked Liquidity & Withdrawal Protection", function () {
    it("Should prevent LP withdrawal when assets are locked by open positions", async function () {
      await vault6.connect(lp1).deposit(parse6(10000), lp1.address);

      // Engine locks 8000 USDC
      await vault6.connect(mockEngine).lockLiquidity(parse6(8000));

      expect(await vault6.lockedLiquidity()).to.equal(parse6(8000));
      expect(await vault6.availableLiquidity()).to.equal(parse6(2000));

      // Attempting to withdraw 3000 USDC should revert
      await expect(
        vault6.connect(lp1).withdraw(parse6(3000), lp1.address, lp1.address)
      ).to.be.revertedWith("Vault: insufficient available liquidity");

      // Withdrawing within available 2000 USDC should succeed
      await vault6.connect(lp1).withdraw(parse6(1500), lp1.address, lp1.address);
      expect(await vault6.availableLiquidity()).to.equal(parse6(500));
    });

    it("Should unlock liquidity properly", async function () {
      await vault6.connect(lp1).deposit(parse6(10000), lp1.address);
      await vault6.connect(mockEngine).lockLiquidity(parse6(5000));
      await vault6.connect(mockEngine).unlockLiquidity(parse6(3000));

      expect(await vault6.lockedLiquidity()).to.equal(parse6(2000));
      expect(await vault6.availableLiquidity()).to.equal(parse6(8000));
    });
  });

  describe("📜 Solvency Ledger & 3 Numerical Scenarios", function () {
    it("Scenario 1: Trader Net Profit (100% Asset-Backed LP Payout)", async function () {
      // 1. Initial LP Deposit: $50,000 USDC
      await vault6.connect(lp1).deposit(parse6(50000), lp1.address);

      // 2. Trader Margin Deposit: $2,000 USDC
      await vault6.connect(mockEngine).depositTraderMargin(trader.address, parse6(2000));

      // Initial state checks
      expect(await vault6.totalLpAssets()).to.equal(parse6(50000));
      expect(await vault6.traderMarginTotal()).to.equal(parse6(2000));

      // 3. Trader makes $1,000 profit upon closing
      // Engine calls settleTraderProfit(trader, marginToReturn=2000, profit=1000)
      const balanceBefore = await quoteToken6.balanceOf(trader.address);
      await vault6.connect(mockEngine).settleTraderProfit(trader.address, parse6(2000), parse6(1000));
      const balanceAfter = await quoteToken6.balanceOf(trader.address);

      // Verify explicit payout source
      expect(balanceAfter - balanceBefore).to.equal(parse6(3000)); // $2000 margin + $1000 profit
      expect(await vault6.traderMarginTotal()).to.equal(0);
      expect(await vault6.totalLpAssets()).to.equal(parse6(49000)); // LP paid $1000 profit
    });

    it("Scenario 2: Trader Net Loss (Credited to LP Capital)", async function () {
      // 1. Initial LP Deposit: $50,000 USDC
      await vault6.connect(lp1).deposit(parse6(50000), lp1.address);

      // 2. Trader Margin Deposit: $2,000 USDC
      await vault6.connect(mockEngine).depositTraderMargin(trader.address, parse6(2000));

      // 3. Trader loses $800 upon closing
      // Engine calls settleTraderLoss(trader, marginToReturn=1200, loss=800)
      const balanceBefore = await quoteToken6.balanceOf(trader.address);
      await vault6.connect(mockEngine).settleTraderLoss(trader.address, parse6(1200), parse6(800));
      const balanceAfter = await quoteToken6.balanceOf(trader.address);

      // Trader receives $1,200 remaining margin
      expect(balanceAfter - balanceBefore).to.equal(parse6(1200));
      expect(await vault6.traderMarginTotal()).to.equal(0);
      expect(await vault6.totalLpAssets()).to.equal(parse6(50800)); // $800 loss credited to LP capital!
    });

    it("Scenario 3: Liquidated Bad Debt Waterfall (Trader Margin -> IF -> LP)", async function () {
      // 1. Initial LP Deposit: $50,000 USDC
      await vault6.connect(lp1).deposit(parse6(50000), lp1.address);

      // 2. Fund Insurance Fund with $500 USDC
      await vault6.connect(mockEngine).depositTraderMargin(trader.address, parse6(500));
      await vault6.connect(mockEngine).fundInsuranceFund(parse6(500));
      expect(await vault6.insuranceFundBalance()).to.equal(parse6(500));

      // 3. Trader Margin Deposit: $1,000 USDC
      await vault6.connect(mockEngine).depositTraderMargin(trader.address, parse6(1000));

      // 4. Flash crash causes position deficit of $2,000 USDC (exceeds $1,000 margin by $1,000 bad debt)
      // Engine calls settleBadDebt(trader, marginForfeited=1000, totalDeficit=2000)
      await vault6.connect(mockEngine).settleBadDebt(trader.address, parse6(1000), parse6(2000));

      // Bad Debt Waterfall Breakdown:
      // - Step 1: Trader Margin Forfeited = $1,000 (transferred to totalLpAssets)
      // - Remaining Deficit = $1,000
      // - Step 2: Insurance Fund Reclassification = $500 (transferred to totalLpAssets)
      // - Uncovered Deficit = $500
      // Physical vault quote balance = $51,500 USDC
      // totalLpAssets = $50,000 (initial) + $1,000 (margin) + $500 (IF) = $51,500 USDC

      expect(await vault6.traderMarginTotal()).to.equal(0);
      expect(await vault6.insuranceFundBalance()).to.equal(0); // IF exhausted
      expect(await vault6.totalLpAssets()).to.equal(parse6(51500)); // Physical tokens = $51,500 = totalLpAssets!
    });
  });

  describe("🛡️ Security Controls & Access Roles", function () {
    it("Should enforce deposit cap", async function () {
      await vault6.setDepositCap(parse6(5000));
      await expect(vault6.connect(lp1).deposit(parse6(6000), lp1.address)).to.be.revertedWith(
        "Vault: deposit cap exceeded"
      );
    });

    it("Should allow emergency pause and unpause", async function () {
      await vault6.pause();
      await expect(vault6.connect(lp1).deposit(parse6(1000), lp1.address)).to.be.revertedWith(
        "Pausable: paused"
      );

      await vault6.unpause();
      await vault6.connect(lp1).deposit(parse6(1000), lp1.address);
      expect(await vault6.totalAssets()).to.equal(parse6(1000));
    });

    it("Should restrict engine-only functions", async function () {
      await expect(
        vault6.connect(lp1).depositTraderMargin(trader.address, parse6(100))
      ).to.be.revertedWith("Vault: only PerpEngine");

      await expect(
        vault6.connect(lp1).lockLiquidity(parse6(100))
      ).to.be.revertedWith("Vault: only PerpEngine");
    });

    it("Owner cannot arbitrarily withdraw LP capital", async function () {
      await vault6.connect(lp1).deposit(parse6(10000), lp1.address);

      // Owner has no function to transfer out totalLpAssets to arbitrary address
      // Only fee and insurance fund withdrawal methods exist
      await expect(
        vault6.connect(owner).withdrawProtocolFees(owner.address, parse6(100))
      ).to.be.revertedWith("Vault: insufficient fee balance");
    });
  });

  describe("🛡️ Bad Debt Waterfall Regression Tests (BD-W1 through BD-W5)", function () {
    it("BD-W1 — Codex numerical example: partial IF and LP write-off", async function () {
      // Setup: LP = 50,000, Trader margin = 1,000, Insurance = 500, Deficit = 2,000
      const lpDeposit = parse18(50000);
      const traderMargin = parse18(1000);
      const insuranceDeposit = parse18(500);
      const totalDeficit = parse18(2000);

      // LP deposit
      await quoteToken18.mint(lp1.address, lpDeposit);
      await quoteToken18.connect(lp1).approve(vault18.target, lpDeposit);
      await vault18.connect(lp1).deposit(lpDeposit, lp1.address);

      // Fund Insurance Fund by depositing margin first then reclassifying
      await quoteToken18.mint(owner.address, insuranceDeposit);
      await quoteToken18.connect(owner).approve(vault18.target, insuranceDeposit);
      await vault18.connect(mockEngine).depositTraderMargin(owner.address, insuranceDeposit);
      await vault18.connect(mockEngine).fundInsuranceFund(insuranceDeposit);

      // Deposit trader margin
      await quoteToken18.mint(trader.address, traderMargin);
      await quoteToken18.connect(trader).approve(vault18.target, traderMargin);
      await vault18.connect(mockEngine).depositTraderMargin(trader.address, traderMargin);

      const physBefore = await quoteToken18.balanceOf(vault18.target);
      expect(physBefore).to.equal(parse18(51500));

      // Call settleBadDebt
      const tx = await vault18.connect(mockEngine).settleBadDebt(trader.address, traderMargin, totalDeficit);
      const receipt = await tx.wait();

      const log = receipt.logs.map(l => {
        try { return vault18.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "BadDebtSettled");

      expect(log.args.marginForfeited).to.equal(parse18(1000));
      expect(log.args.coveredByInsurance).to.equal(parse18(500));
      expect(log.args.coveredByLP).to.equal(parse18(500));
      expect(log.args.residualBadDebt).to.equal(0n);

      // Final ledger assertions
      expect(await vault18.traderMarginTotal()).to.equal(0n);
      expect(await vault18.insuranceFundBalance()).to.equal(0n);
      expect(await vault18.totalLpAssets()).to.equal(parse18(51500));

      const physAfter = await quoteToken18.balanceOf(vault18.target);
      expect(physAfter).to.equal(parse18(51500));

      // Explicitly assert totalLpAssets MUST NOT be 51,000
      expect((await vault18.totalLpAssets()) === parse18(51000)).to.be.false;
    });

    it("BD-W2 — Insurance fully covers remaining deficit", async function () {
      const lpDeposit = parse18(50000);
      const traderMargin = parse18(1000);
      const insuranceDeposit = parse18(2000);
      const totalDeficit = parse18(2000);

      await quoteToken18.mint(lp1.address, lpDeposit);
      await quoteToken18.connect(lp1).approve(vault18.target, lpDeposit);
      await vault18.connect(lp1).deposit(lpDeposit, lp1.address);

      await quoteToken18.mint(owner.address, insuranceDeposit);
      await quoteToken18.connect(owner).approve(vault18.target, insuranceDeposit);
      await vault18.connect(mockEngine).depositTraderMargin(owner.address, insuranceDeposit);
      await vault18.connect(mockEngine).fundInsuranceFund(insuranceDeposit);

      await quoteToken18.mint(trader.address, traderMargin);
      await quoteToken18.connect(trader).approve(vault18.target, traderMargin);
      await vault18.connect(mockEngine).depositTraderMargin(trader.address, traderMargin);

      const tx = await vault18.connect(mockEngine).settleBadDebt(trader.address, traderMargin, totalDeficit);
      const receipt = await tx.wait();
      const log = receipt.logs.map(l => {
        try { return vault18.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "BadDebtSettled");

      expect(log.args.coveredByInsurance).to.equal(parse18(1000));
      expect(log.args.coveredByLP).to.equal(0n);
      expect(log.args.residualBadDebt).to.equal(0n);

      expect(await vault18.traderMarginTotal()).to.equal(0n);
      expect(await vault18.insuranceFundBalance()).to.equal(parse18(1000));
      expect(await vault18.totalLpAssets()).to.equal(parse18(52000));

      const physAfter = await quoteToken18.balanceOf(vault18.target);
      const liabilities = (await vault18.totalLpAssets()) +
                          (await vault18.traderMarginTotal()) +
                          (await vault18.insuranceFundBalance()) +
                          (await vault18.protocolFeeBalance());
      expect(physAfter).to.equal(liabilities);
    });

    it("BD-W3 — No insurance coverage, LP absorbs all remaining deficit", async function () {
      const lpDeposit = parse18(50000);
      const traderMargin = parse18(1000);
      const totalDeficit = parse18(2000);

      await quoteToken18.mint(lp1.address, lpDeposit);
      await quoteToken18.connect(lp1).approve(vault18.target, lpDeposit);
      await vault18.connect(lp1).deposit(lpDeposit, lp1.address);

      await quoteToken18.mint(trader.address, traderMargin);
      await quoteToken18.connect(trader).approve(vault18.target, traderMargin);
      await vault18.connect(mockEngine).depositTraderMargin(trader.address, traderMargin);

      const tx = await vault18.connect(mockEngine).settleBadDebt(trader.address, traderMargin, totalDeficit);
      const receipt = await tx.wait();
      const log = receipt.logs.map(l => {
        try { return vault18.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "BadDebtSettled");

      expect(log.args.coveredByInsurance).to.equal(0n);
      expect(log.args.coveredByLP).to.equal(parse18(1000));
      expect(log.args.residualBadDebt).to.equal(0n);

      expect(await vault18.totalLpAssets()).to.equal(parse18(51000));
      expect((await vault18.totalLpAssets()) === parse18(50000)).to.be.false;

      const physAfter = await quoteToken18.balanceOf(vault18.target);
      const liabilities = (await vault18.totalLpAssets()) +
                          (await vault18.traderMarginTotal()) +
                          (await vault18.insuranceFundBalance()) +
                          (await vault18.protocolFeeBalance());
      expect(physAfter).to.equal(liabilities);
    });

    it("BD-W4 — Paired winner/loser conservation and LP NAV accuracy", async function () {
      // 1. LP deposits 50,000
      const lpDeposit = parse18(50000);
      await quoteToken18.mint(lp1.address, lpDeposit);
      await quoteToken18.connect(lp1).approve(vault18.target, lpDeposit);
      await vault18.connect(lp1).deposit(lpDeposit, lp1.address);

      // 2. Winner trader deposits 1,000 margin and receives 1,500 profit
      const winnerMargin = parse18(1000);
      const winnerProfit = parse18(1500);
      await quoteToken18.mint(trader.address, winnerMargin);
      await quoteToken18.connect(trader).approve(vault18.target, winnerMargin);
      await vault18.connect(mockEngine).depositTraderMargin(trader.address, winnerMargin);
      await vault18.connect(mockEngine).settleTraderProfit(trader.address, winnerMargin, winnerProfit);

      // 3. Loser trader deposits 1,000 margin and realizes 2,000 insolvent loss
      const loserMargin = parse18(1000);
      const loserDeficit = parse18(2000);
      await quoteToken18.mint(recipient.address, loserMargin);
      await quoteToken18.connect(recipient).approve(vault18.target, loserMargin);
      await vault18.connect(mockEngine).depositTraderMargin(recipient.address, loserMargin);

      // 4. Settle bad debt for loser
      await vault18.connect(mockEngine).settleBadDebt(recipient.address, loserMargin, loserDeficit);

      // Assert final LP NAV reflects: initial LP (50,000) - winner payout (1,500) + loser recovered margin (1,000) = 49,500
      expect(await vault18.totalLpAssets()).to.equal(parse18(49500));

      const physAfter = await quoteToken18.balanceOf(vault18.target);
      const liabilities = (await vault18.totalLpAssets()) +
                          (await vault18.traderMarginTotal()) +
                          (await vault18.insuranceFundBalance()) +
                          (await vault18.protocolFeeBalance());
      expect(physAfter).to.equal(liabilities);
    });

    it("BD-W5 — Event/output semantics against exact numerical vectors", async function () {
      const lpDeposit = parse18(100000);
      const margin = parse18(2500);
      const insurance = parse18(1000);
      const deficit = parse18(5000);

      await quoteToken18.mint(lp1.address, lpDeposit);
      await quoteToken18.connect(lp1).approve(vault18.target, lpDeposit);
      await vault18.connect(lp1).deposit(lpDeposit, lp1.address);

      await quoteToken18.mint(owner.address, insurance);
      await quoteToken18.connect(owner).approve(vault18.target, insurance);
      await vault18.connect(mockEngine).depositTraderMargin(owner.address, insurance);
      await vault18.connect(mockEngine).fundInsuranceFund(insurance);

      await quoteToken18.mint(trader.address, margin);
      await quoteToken18.connect(trader).approve(vault18.target, margin);
      await vault18.connect(mockEngine).depositTraderMargin(trader.address, margin);

      const tx = await vault18.connect(mockEngine).settleBadDebt(trader.address, margin, deficit);
      const receipt = await tx.wait();
      const log = receipt.logs.map(l => {
        try { return vault18.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "BadDebtSettled");

      expect(log.args.trader).to.equal(trader.address);
      expect(log.args.marginForfeited).to.equal(parse18(2500));
      expect(log.args.coveredByInsurance).to.equal(parse18(1000));
      expect(log.args.coveredByLP).to.equal(parse18(1500));
      expect(log.args.residualBadDebt).to.equal(0n);
    });
  });
});
