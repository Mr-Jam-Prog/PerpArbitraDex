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
      ethers.parseUnits("0.001", 18),// min position size 0.001 ETH
      ethers.parseUnits("0.025", 18),// liquidation fee ratio 2.5%
      ethers.parseUnits("0.001", 18) // protocol fee ratio 0.1% (10 bps)
    );

    return { engine, vault, quote, base, oracle, amm, liqEngine, posManager, risk, deployer, t1, t2, lp, liq, quoteDecimals };
  }

  function toVaultUnits(wadAmount, dec = 18) {
    if (dec === 18) return wadAmount;
    return wadAmount / BigInt(10 ** (18 - dec));
  }

  function fromVaultUnits(vaultAmount, dec = 18) {
    if (dec === 18) return vaultAmount;
    return vaultAmount * BigInt(10 ** (18 - dec));
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
  });

  describe("Required Regression Tests (Codex P1 & P2 Fixes)", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      // LP deposits $500,000 WAD
      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    it("Regression Test 1 — Partial decrease loss consumes remaining position collateral before bad debt", async function () {
      // Position Q = 10 ETH, M = $10,000 margin
      const margin = ethers.parseUnits("10000", 18);
      const size = ethers.parseUnits("10", 18);

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

      // Price drops from $2,000 to $1,800 (-$200 per ETH)
      // Loss on 2 ETH partial decrease = $400 loss + $3.6 fee = $403.6 total deduction
      // Proportional released margin M_rel on 20% = ~$1,996 (after $20 open fee)
      const dropPrice = ethers.parseUnits("1800", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, dropPrice);

      const ifBefore = await sys.vault.insuranceFundBalance();
      const lpBefore = await sys.vault.totalLpAssets();

      // Partial decrease by 2 ETH (caller passes marginReduced = 0)
      const dQ = ethers.parseUnits("2", 18);
      await sys.engine.connect(sys.t1).decreasePosition(1, dQ, 0n);

      const ifAfter = await sys.vault.insuranceFundBalance();
      const lpAfter = await sys.vault.totalLpAssets();

      // Insurance Fund and LP Assets MUST NOT absorb bad debt because position collateral covers loss!
      expect(ifAfter).to.equal(ifBefore);
      expect(lpAfter).to.be.gte(lpBefore); // LP received the loss!

      // Engine totalCollateral and Vault traderMarginTotal MUST remain 100% in sync
      const engineCollateral = await sys.engine.totalCollateral();
      const vaultTraderMargin = await sys.vault.traderMarginTotal();
      expect(engineCollateral).to.equal(vaultTraderMargin);
    });

    it("Regression Test 2 — Closing fee exceeds released margin debits remaining position collateral", async function () {
      // Position Q = 10 ETH, M = $1,000 margin
      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

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

      // Small partial decrease dQ = 0.01 ETH
      // Fee on 0.01 ETH @ $2000 = $0.02
      // Proportional margin M_rel on 0.001 fraction is small
      const dQ = ethers.parseUnits("0.01", 18);
      await sys.engine.connect(sys.t1).decreasePosition(1, dQ, 0n);

      // Subsequent full close MUST succeed without 'Vault: margin underflow'
      await expect(sys.engine.connect(sys.t1).closePosition(1)).to.emit(sys.engine, "PositionClosed");

      // Engine totalCollateral and Vault traderMarginTotal MUST equal 0 after full close
      expect(await sys.engine.totalCollateral()).to.equal(0n);
      expect(await sys.vault.traderMarginTotal()).to.equal(0n);
    });

    it("Regression Test 3 — Combined loss + fee partial decrease (covered by collateral vs genuine bad debt)", async function () {
      // Case A: Covered by remaining position collateral
      const margin = ethers.parseUnits("1000", 18);
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

      // Price drops to $1,600 (-$400 loss per ETH). Loss on 1 ETH decrease = $400 + $1.6 fee = $401.6
      // Released margin M_rel on 50% = ~$498. Deficit $401.6 <= M_rel $498.
      const priceA = ethers.parseUnits("1600", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, priceA);

      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("1", 18), 0n);

      expect(await sys.vault.insuranceFundBalance()).to.equal(0n);
      expect(await sys.engine.totalCollateral()).to.equal(await sys.vault.traderMarginTotal());

      // Case B: Genuine insolvency where total trader collateral is exhausted
      // Price drops to $500 (-$1500 loss per ETH on 1 ETH remaining). Loss = $1500 > remaining margin (~$594).
      const priceB = ethers.parseUnits("500", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, priceB);

      // Full close enters bad debt waterfall
      await expect(sys.engine.connect(sys.t1).closePosition(1)).to.emit(sys.engine, "PositionClosed");
      expect(await sys.engine.totalCollateral()).to.equal(0n);
      expect(await sys.vault.traderMarginTotal()).to.equal(0n);
    });

    it("P2 Normalization — getBalanceSheet() returns identical WAD Quote units in 6d and 18d modes", async function () {
      // 18d system
      const bs18 = await sys.engine.getBalanceSheet();
      expect(bs18.totalLpAssets).to.equal(ethers.parseUnits("500000", 18));

      // 6d system
      const sys6 = await deploySystem(6);
      const lpDeposit6 = ethers.parseUnits("500000", 6);
      await sys6.quote.mint(sys6.lp.address, lpDeposit6);
      await sys6.quote.connect(sys6.lp).approve(sys6.vault.target, lpDeposit6);
      await sys6.vault.connect(sys6.lp).deposit(lpDeposit6, sys6.lp.address);

      const bs6 = await sys6.engine.getBalanceSheet();
      // Even though token is 6 decimals, getBalanceSheet() normalizes totalLpAssets to Quote WAD (1e18)
      expect(bs6.totalLpAssets).to.equal(ethers.parseUnits("500000", 18));
      expect(bs6.vaultQuoteBalance).to.equal(ethers.parseUnits("500000", 18));
    });
  });

  describe("Cross-Contract Reconciliation & Multi-Actor Sequence Conservation", function () {
    it("Multi-Actor Sequence: Cross-contract reconciliation holds at every single checkpoint", async function () {
      const sys = await deploySystem(18);

      async function verifyReconciliation() {
        const physicalBal = await sys.quote.balanceOf(sys.vault.target);
        const lpAssets = await sys.vault.totalLpAssets();
        const traderMargin = await sys.vault.traderMarginTotal();
        const insurance = await sys.vault.insuranceFundBalance();
        const protocolFees = await sys.vault.protocolFeeBalance();

        // 1. Physical vault conservation
        expect(physicalBal).to.equal(lpAssets + traderMargin + insurance + protocolFees);

        // 2. Position-liability reconciliation
        const engineCollateral = await sys.engine.totalCollateral();
        expect(engineCollateral).to.equal(traderMargin);
      }

      // Checkpoint 0: Initial LP Deposit
      const lpAmount = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpAmount);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpAmount);
      await sys.vault.connect(sys.lp).deposit(lpAmount, sys.lp.address);
      await verifyReconciliation();

      // Checkpoint 1: Trader 1 opens Long 2 ETH
      const t1Margin = ethers.parseUnits("1000", 18);
      await sys.quote.mint(sys.t1.address, t1Margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, t1Margin);
      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("2", 18),
        margin: t1Margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });
      await verifyReconciliation();

      // Checkpoint 2: Trader 2 opens Short 1 ETH
      const t2Margin = ethers.parseUnits("1000", 18);
      await sys.quote.mint(sys.t2.address, t2Margin);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, t2Margin);
      latestTime = await time.latest();
      await sys.engine.connect(sys.t2).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("1", 18),
        margin: t2Margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 99n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });
      await verifyReconciliation();

      // Checkpoint 3: Add margin Trader 1
      const addAmount = ethers.parseUnits("500", 18);
      await sys.quote.mint(sys.t1.address, addAmount);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addAmount);
      await sys.engine.connect(sys.t1).addMargin(1, addAmount);
      await verifyReconciliation();

      // Checkpoint 4: Price moves up to $2,200 (Trader 1 profit, Trader 2 loss)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2200", 8));

      // Checkpoint 5: Profitable partial decrease Trader 1 (decrease 1 ETH)
      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("1", 18), 0n);
      await verifyReconciliation();

      // Checkpoint 6: Losing partial decrease Trader 2 (decrease 0.5 ETH)
      await sys.engine.connect(sys.t2).decreasePosition(2, ethers.parseUnits("0.5", 18), 0n);
      await verifyReconciliation();

      // Checkpoint 7: Full close Trader 1
      await sys.engine.connect(sys.t1).closePosition(1);
      await verifyReconciliation();

      // Checkpoint 8: Full close Trader 2
      await sys.engine.connect(sys.t2).closePosition(2);
      await verifyReconciliation();
    });
  });
});
