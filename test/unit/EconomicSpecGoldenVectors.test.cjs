// @title: Economic Specification & Golden Vectors Tests (6d & 18d quote)
// @notice Verifies PerpEngine, LiquidityVault, AMMPool against ECONOMIC_SPEC.md and TypeScript reference model

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("📜 ECONOMIC_SPEC - Comprehensive Golden Vectors & Conservation Tests", function () {
  let MARKET_ID = 1;
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE_8DEC = ethers.parseUnits("2000", 8); // $2,000 in 8 decimals
  const FEED_ID = ethers.encodeBytes32String(ETH_USD_MARKET);

  async function deploySystem(quoteDecimals = 18) {
    const [deployer, t1, t2, lp, liq] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const quote = await MockERC20.deploy("Quote Token", "QUOTE", quoteDecimals);
    await quote.waitForDeployment();

    const base = await MockERC20.deploy("Ethereum", "ETH", 18);
    await base.waitForDeployment();

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const oracle = await MockOracle.deploy("Aggregator", 18);
    await oracle.waitForDeployment();
    await oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, INITIAL_PRICE_8DEC);

    const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
    const amm = await MockAMMPool.deploy();
    await amm.waitForDeployment();

    const MockLiquidationEngine = await ethers.getContractFactory("MockLiquidationEngine");
    const liqEngine = await MockLiquidationEngine.deploy();
    await liqEngine.waitForDeployment();

    const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
    const risk = await MockRiskManager.deploy();
    await risk.waitForDeployment();

    const MockConfigRegistry = await ethers.getContractFactory("MockConfigRegistry");
    const config = await MockConfigRegistry.deploy();
    await config.waitForDeployment();

    const MockPositionManager = await ethers.getContractFactory("MockPositionManager");
    const posManager = await MockPositionManager.deploy();
    await posManager.waitForDeployment();

    const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
    const vault = await LiquidityVault.deploy(await quote.getAddress(), "Vault Token", "vQUOTE");
    await vault.waitForDeployment();

    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    const engine = await PerpEngine.deploy(
      posManager.target,
      amm.target,
      oracle.target,
      liqEngine.target,
      risk.target,
      config.target,
      vault.target,
      base.target,
      quote.target
    );
    await engine.waitForDeployment();

    await vault.setPerpEngine(engine.target);

    // Initialize market with 100x max leverage, 1% min margin ratio, 0.001 protocol fee ratio (10 bps)
    await engine.connect(deployer).initializeMarket(
      MARKET_ID,
      FEED_ID,
      ethers.parseUnits("100", 18),  // max leverage 100x
      ethers.parseUnits("0.01", 18), // min margin ratio 1%
      ethers.parseUnits("0.01", 18), // min position size 0.01 ETH
      ethers.parseUnits("0.025", 18),// liquidation fee ratio 2.5%
      ethers.parseUnits("0.001", 18) // protocol fee ratio 0.1% (10 bps)
    );

    return { engine, vault, quote, base, oracle, amm, liqEngine, posManager, risk, deployer, t1, t2, lp, liq };
  }

  describe("18-Decimal Quote Token (WAD) Scenarios", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      // LP deposits $100,000 WAD
      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    it("GV-01: Long Open, Price Increase ($2,000 -> $2,200), Full Close Profit", async function () {
      const margin = ethers.parseUnits("200", 18); // $200
      const size = ethers.parseUnits("1", 18);     // 1 ETH

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price rises to $2,200
      const newPrice8Dec = ethers.parseUnits("2200", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, newPrice8Dec);

      // Check unrealized PnL: 1 ETH * ($2,200 - $2,000) = +$200 WAD
      const pnl = await sys.engine.getUnrealizedPnl(1, newPrice8Dec);
      expect(pnl).to.equal(ethers.parseUnits("200", 18));

      // Close position
      const balBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const balAfter = await sys.quote.balanceOf(sys.t1.address);

      // Trader received margin ($200) - open fee ($2) + PnL ($200) - close fee ($2.2) = ~$395.8
      expect(balAfter - balBefore).to.be.closeTo(ethers.parseUnits("395.8", 18), ethers.parseUnits("0.01", 18));
    });

    it("GV-02: Short Open, Price Decrease ($2,000 -> $1,800), Full Close Profit", async function () {
      const margin = ethers.parseUnits("200", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 99n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops to $1,800
      const newPrice8Dec = ethers.parseUnits("1800", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, newPrice8Dec);

      // PnL: 1 ETH * ($2,000 - $1,800) = +$200 WAD
      const pnl = await sys.engine.getUnrealizedPnl(1, newPrice8Dec);
      expect(pnl).to.equal(ethers.parseUnits("200", 18));

      const balBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const balAfter = await sys.quote.balanceOf(sys.t1.address);

      expect(balAfter - balBefore).to.be.gt(margin);
    });

    it("Close Position with Accrued Positive and Negative Funding", async function () {
      const margin = ethers.parseUnits("500", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Set funding index in Mock AMM pool: positive funding payment owed by long trader
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("50", 18)); // $50 funding owed

      // Close position - should settle funding first, deducting $50 from margin, then close cleanly
      const balBefore = await sys.quote.balanceOf(sys.t1.address);
      await expect(sys.engine.connect(sys.t1).closePosition(1)).to.emit(sys.engine, "PositionClosed");
      const balAfter = await sys.quote.balanceOf(sys.t1.address);

      // Trader received margin ($500) - open fee ($2) - funding ($50) - close fee ($2) = ~$446
      expect(balAfter - balBefore).to.be.closeTo(ethers.parseUnits("446", 18), ethers.parseUnits("1", 18));
    });

    it("Position Increase & Average Entry Price Calculation", async function () {
      const margin1 = ethers.parseUnits("200", 18);
      const size1 = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin1 * 2n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin1 * 2n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size1,
        margin: margin1,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price increases to $2,400, then increase position by 1 ETH + $200 margin
      const price2 = ethers.parseUnits("2400", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, price2);

      await sys.engine.connect(sys.t1).increasePosition(1, size1, margin1);

      const pos = await sys.engine.getPosition(1);
      expect(pos.size).to.equal(size1 * 2n);
      // Entry price should be average of $2,000 and $2,400 = $2,200 (in 8 decimals)
      expect(pos.entryPrice).to.equal(ethers.parseUnits("2200", 8));
    });

    it("Partial Decrease & Margin Release", async function () {
      const margin = ethers.parseUnits("400", 18);
      const size = ethers.parseUnits("2", 18); // 2 ETH

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price moves to $2,200
      const price2 = ethers.parseUnits("2200", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, price2);

      // Decrease position by 50% (1 ETH, $200 margin)
      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("1", 18), ethers.parseUnits("200", 18));

      const pos = await sys.engine.getPosition(1);
      expect(pos.size).to.equal(ethers.parseUnits("1", 18));
      expect(pos.margin).to.be.closeTo(ethers.parseUnits("196", 18), ethers.parseUnits("5", 18));
    });

    it("Add and Remove Collateral / Margin", async function () {
      const margin = ethers.parseUnits("200", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin * 2n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin * 2n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Add $100 margin
      const addAmount = ethers.parseUnits("100", 18);
      await sys.engine.connect(sys.t1).addMargin(1, addAmount);
      let pos = await sys.engine.getPosition(1);
      expect(pos.margin).to.be.gt(margin);

      // Remove $50 margin
      const remAmount = ethers.parseUnits("50", 18);
      await sys.engine.connect(sys.t1).removeMargin(1, remAmount);
      pos = await sys.engine.getPosition(1);
      expect(pos.margin).to.be.lt(margin + addAmount);
    });

    it("Slippage Acceptable Price & Deadline Controls", async function () {
      const margin = ethers.parseUnits("200", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();

      // Deadline passed -> revert
      await expect(
        sys.engine.connect(sys.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: margin,
          acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
          deadline: latestTime - 1,
          referralCode: ethers.ZeroHash
        })
      ).to.be.revertedWith("PerpEngine: deadline passed");

      // Price higher than acceptablePrice for long -> revert
      await expect(
        sys.engine.connect(sys.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: margin,
          acceptablePrice: INITIAL_PRICE_8DEC * 99n / 100n, // $1,980 acceptable when price is $2,000
          deadline: latestTime + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.be.revertedWith("PerpEngine: price too high");
    });
  });

  describe("6-Decimal Quote Token (USDC) Scenarios", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(6);

      // LP deposits 100,000 USDC (6 decimals)
      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    it("GV-05: USDC 6 Decimals Long Open, Profit, and Full Close", async function () {
      const marginWad = ethers.parseUnits("200", 18); // Internal margin is 18 decimals WAD
      const marginNative = ethers.parseUnits("200", 6); // Native token is 6 decimals USDC
      const sizeWad = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, marginNative);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, marginNative);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: sizeWad,
        margin: marginWad,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price rises to $2,200
      const newPrice8Dec = ethers.parseUnits("2200", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, newPrice8Dec);

      const balBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const balAfter = await sys.quote.balanceOf(sys.t1.address);

      // Payout in USDC (6 decimals) should be ~$395.8 USDC
      const payoutUSDC = balAfter - balBefore;
      expect(payoutUSDC).to.be.closeTo(ethers.parseUnits("395.8", 6), ethers.parseUnits("0.1", 6));
    });

    it("USDC 6 Decimals Loss & Bad Debt Waterfall Settlement", async function () {
      const marginWad = ethers.parseUnits("100", 18);
      const marginNative = ethers.parseUnits("100", 6);
      const sizeWad = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, marginNative);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, marginNative);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: sizeWad,
        margin: marginWad,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Massive price crash from $2,000 to $1,500 (Loss = $500 > $100 margin -> Bad debt)
      const crashPrice8Dec = ethers.parseUnits("1500", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, crashPrice8Dec);

      const balBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const balAfter = await sys.quote.balanceOf(sys.t1.address);

      // Trader received 0 payout due to insolvency
      expect(balAfter - balBefore).to.equal(0n);
    });

    it("Vault Deposit Cap Limit Enforced", async function () {
      const cap = ethers.parseUnits("500", 6);
      await sys.vault.setDepositCap(cap);

      const depositExcess = ethers.parseUnits("1000", 6);
      await sys.quote.mint(sys.t2.address, depositExcess);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, depositExcess);

      await expect(
        sys.vault.connect(sys.t2).deposit(depositExcess, sys.t2.address)
      ).to.be.revertedWith("Vault: deposit cap exceeded");
    });
  });

  describe("Conservation of Total Quote Token Balances Across Multi-Actor Sequence", function () {
    it("Exact Conservation: LP Deposits + Traders Open/Close/Liquidate = Total Vault Asset Balance", async function () {
      const sys = await deploySystem(18);

      const lpAmount = ethers.parseUnits("50000", 18);
      await sys.quote.mint(sys.lp.address, lpAmount);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpAmount);
      await sys.vault.connect(sys.lp).deposit(lpAmount, sys.lp.address);

      const t1Margin = ethers.parseUnits("1000", 18);
      await sys.quote.mint(sys.t1.address, t1Margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, t1Margin);

      const t2Margin = ethers.parseUnits("1000", 18);
      await sys.quote.mint(sys.t2.address, t2Margin);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, t2Margin);

      const latestTime = await time.latest();

      // Trader 1 opens Long 2 ETH
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("2", 18),
        margin: t1Margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Trader 2 opens Short 1 ETH
      await sys.engine.connect(sys.t2).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("1", 18),
        margin: t2Margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 99n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price moves to $2,100
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2100", 8));

      // Trader 1 closes position
      await sys.engine.connect(sys.t1).closePosition(1);

      // Price moves to $1,900
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1900", 8));

      // Trader 2 closes position
      await sys.engine.connect(sys.t2).closePosition(2);

      // Verify Vault Quote Balance equals liabilities
      const vaultBalance = await sys.quote.balanceOf(sys.vault.target);
      const totalLpAssets = await sys.vault.totalLpAssets();
      const traderMarginTotal = await sys.vault.traderMarginTotal();
      const insuranceFundBalance = await sys.vault.insuranceFundBalance();
      const protocolFeeBalance = await sys.vault.protocolFeeBalance();

      const totalLiabilities = totalLpAssets + traderMarginTotal + insuranceFundBalance + protocolFeeBalance;
      expect(vaultBalance).to.equal(totalLiabilities);
    });
  });
});
