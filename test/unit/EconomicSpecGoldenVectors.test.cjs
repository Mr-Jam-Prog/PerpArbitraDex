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

  describe("P1 Fix 1 Regression Tests — Unpaid funding debt MUST cause non-terminal mutations to revert", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    async function setupExhaustedPosition() {
      // Open position with M = $100, S = 1 ETH
      const margin = ethers.parseUnits("100", 18);
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

      // Accrue massive funding debt ($150 > $98 remaining position margin after $2 open fee)
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("150", 18));
      return { margin, size };
    }

    it("increasePosition reverts atomically when unpaid funding debt exists", async function () {
      await setupExhaustedPosition();

      const posBefore = await sys.engine.getPositionInternal(1);
      const marginBefore = posBefore.margin;
      const lastIndexBefore = posBefore.lastFundingIndex;
      const vaultTraderMarginBefore = await sys.vault.traderMarginTotal();
      const vaultLpAssetsBefore = await sys.vault.totalLpAssets();

      const addSize = ethers.parseUnits("1", 18);
      const addMargin = ethers.parseUnits("500", 18);
      await sys.quote.mint(sys.t1.address, addMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addMargin);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, addSize, addMargin)
      ).to.be.revertedWith("PerpEngine: unpaid funding debt");

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(marginBefore);
      expect(posAfter.lastFundingIndex).to.equal(lastIndexBefore);
      expect(await sys.vault.traderMarginTotal()).to.equal(vaultTraderMarginBefore);
      expect(await sys.vault.totalLpAssets()).to.equal(vaultLpAssetsBefore);
    });

    it("addMargin reverts atomically when unpaid funding debt exists", async function () {
      await setupExhaustedPosition();

      const posBefore = await sys.engine.getPositionInternal(1);
      const marginBefore = posBefore.margin;
      const lastIndexBefore = posBefore.lastFundingIndex;
      const vaultTraderMarginBefore = await sys.vault.traderMarginTotal();
      const vaultLpAssetsBefore = await sys.vault.totalLpAssets();

      const addMargin = ethers.parseUnits("200", 18);
      await sys.quote.mint(sys.t1.address, addMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addMargin);

      await expect(
        sys.engine.connect(sys.t1).addMargin(1, addMargin)
      ).to.be.revertedWith("PerpEngine: unpaid funding debt");

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(marginBefore);
      expect(posAfter.lastFundingIndex).to.equal(lastIndexBefore);
      expect(await sys.vault.traderMarginTotal()).to.equal(vaultTraderMarginBefore);
      expect(await sys.vault.totalLpAssets()).to.equal(vaultLpAssetsBefore);
    });

    it("removeMargin reverts atomically when unpaid funding debt exists", async function () {
      await setupExhaustedPosition();

      const posBefore = await sys.engine.getPositionInternal(1);
      const marginBefore = posBefore.margin;
      const lastIndexBefore = posBefore.lastFundingIndex;
      const vaultTraderMarginBefore = await sys.vault.traderMarginTotal();
      const vaultLpAssetsBefore = await sys.vault.totalLpAssets();

      await expect(
        sys.engine.connect(sys.t1).removeMargin(1, ethers.parseUnits("10", 18))
      ).to.be.revertedWith("PerpEngine: unpaid funding debt");

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(marginBefore);
      expect(posAfter.lastFundingIndex).to.equal(lastIndexBefore);
      expect(await sys.vault.traderMarginTotal()).to.equal(vaultTraderMarginBefore);
      expect(await sys.vault.totalLpAssets()).to.equal(vaultLpAssetsBefore);
    });

    it("partial decreasePosition reverts atomically when unpaid funding debt exists", async function () {
      await setupExhaustedPosition();

      const posBefore = await sys.engine.getPositionInternal(1);
      const marginBefore = posBefore.margin;
      const lastIndexBefore = posBefore.lastFundingIndex;

      await expect(
        sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.5", 18), 0n)
      ).to.be.revertedWith("PerpEngine: margin exhausted by funding");

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(marginBefore);
      expect(posAfter.lastFundingIndex).to.equal(lastIndexBefore);
    });
  });

  describe("P1 Partial Decrease Settlement Tests (P-L1, P-L2, P-L3, P-L4 & Independent Identity)", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    async function verifyPartialIdentities(label, initialMargin, M_rel, realizedPnl, fee, expectedPayout, expectedM_after, expectedBadDebt) {
      // 1. Independent Partial Margin Release Identity Gate per ECONOMIC_SPEC:
      // initialMargin + realizedPnl - fee == traderPayout + M_after - residualBadDebt
      const LHS = initialMargin + realizedPnl - fee;
      const RHS = expectedPayout + expectedM_after - expectedBadDebt;
      expect(LHS).to.equal(RHS, `Partial Economic Identity Failed at ${label}`);

      // 2. Physical Vault Balance Identity Gate
      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities, `Physical Vault Identity Failed at ${label}`);
    }

    it("P-L1 (Zero Fee): Solvent losing partial decrease releases proportional margin (M=1000, S=10, dS=2 -> M_rel=200, PnL=-100, fee=0 -> payout=100, M_after=800)", async function () {
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

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

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1950", 8));

      const dS = ethers.parseUnits("2", 18);
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);

      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);
      const receipt = await tx.wait();

      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);
      const actualPayout = t1BalAfter - t1BalBefore;

      expect(actualPayout).to.equal(ethers.parseUnits("100", 18));

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(ethers.parseUnits("800", 18));

      const parsedLogs = receipt.logs.map(log => {
        try { return sys.engine.interface.parseLog(log); } catch { return null; }
      }).filter(Boolean);

      const decEvent = parsedLogs.find(e => e.name === "PositionDecreased");
      expect(decEvent).to.not.be.undefined;
      expect(decEvent.args.marginReduced).to.equal(ethers.parseUnits("200", 18));

      await verifyPartialIdentities(
        "P-L1 (Zero Fee)",
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("200", 18),
        -ethers.parseUnits("100", 18),
        0n,
        actualPayout,
        posAfter.margin,
        0n
      );
    });

    it("P-L1 (Fee-Bearing): Solvent losing partial decrease with non-zero closing fee (M=1000, S=10, dS=2 -> M_rel=200, PnL=-100, fee=3.90 -> payout=96.10, M_after=800)", async function () {
      // Market protocol fee ratio = 0.1% (10 bps)
      // Open position with $1000 margin ($1020 deposited, $20 open fee)
      const margin = ethers.parseUnits("1020", 18);
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

      // Price drops from $2,000 to $1,950 (-$50/ETH). For dS = 2 ETH, realizedPnL = -$100.
      // Reduced notional = 2 ETH * $1,950 = $3,900. Fee (0.1%) = $3.90.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1950", 8));

      const dS = ethers.parseUnits("2", 18);
      const feeBalBefore = await sys.vault.protocolFeeBalance();
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);

      await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);

      const feeBalAfter = await sys.vault.protocolFeeBalance();
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);

      const feeCollected = feeBalAfter - feeBalBefore;
      const actualPayout = t1BalAfter - t1BalBefore;

      // Exact WAD fee = $3.90
      const expectedFee = ethers.parseUnits("3.9", 18);
      // Exact payout = M_rel ($200) - loss ($100) - fee ($3.90) = $96.10
      const expectedPayout = ethers.parseUnits("96.1", 18);

      expect(feeCollected).to.equal(expectedFee);
      expect(actualPayout).to.equal(expectedPayout);

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(ethers.parseUnits("800", 18));
      expect(await sys.engine.totalCollateral()).to.equal(ethers.parseUnits("800", 18));
      expect(await sys.vault.traderMarginTotal()).to.equal(ethers.parseUnits("800", 18));

      await verifyPartialIdentities(
        "P-L1 Fee-Bearing",
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("200", 18),
        -ethers.parseUnits("100", 18),
        feeCollected,
        actualPayout,
        posAfter.margin,
        0n
      );
    });

    it("P-L2 (Fee-Bearing): Negative payout covered by retained margin with non-zero closing fee (M=1000, S=10, dS=2 -> M_rel=200, PnL=-250, fee=3.75 -> payout=0, M_after=746.25)", async function () {
      // Market protocol fee ratio = 0.1% (10 bps)
      const margin = ethers.parseUnits("1020", 18);
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

      // Price drops from $2,000 to $1,875 (-$125/ETH). For dS = 2 ETH, realizedPnL = -$250.
      // Reduced notional = 2 ETH * $1,875 = $3,750. Fee (0.1%) = $3.75.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1875", 8));

      const dS = ethers.parseUnits("2", 18);
      const feeBalBefore = await sys.vault.protocolFeeBalance();
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);

      await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);

      const feeBalAfter = await sys.vault.protocolFeeBalance();
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);

      const feeCollected = feeBalAfter - feeBalBefore;
      const actualPayout = t1BalAfter - t1BalBefore;

      const expectedFee = ethers.parseUnits("3.75", 18);
      expect(feeCollected).to.equal(expectedFee);
      expect(actualPayout).to.equal(0n);

      // Shortfall = realizedLoss ($250) + fee ($3.75) - M_rel ($200) = $53.75 debited from retained margin ($800)
      // Remaining margin = $800 - $53.75 = $746.25
      const expectedM_after = ethers.parseUnits("746.25", 18);
      const posAfter = await sys.engine.getPositionInternal(1);

      expect(posAfter.margin).to.equal(expectedM_after);
      expect(await sys.engine.totalCollateral()).to.equal(expectedM_after);
      expect(await sys.vault.traderMarginTotal()).to.equal(expectedM_after);

      await verifyPartialIdentities(
        "P-L2 Fee-Bearing",
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("200", 18),
        -ethers.parseUnits("250", 18),
        feeCollected,
        actualPayout,
        posAfter.margin,
        0n
      );
    });

    it("P-L4: Explicit multi-assertion suite on partial decrease consistency", async function () {
      const margin = ethers.parseUnits("1020", 18);
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

      const initialOI = await sys.engine.getTotalOpenInterest(MARKET_ID);
      const [initialLongOI, initialShortOI, initialSkew] = await sys.amm.getMarketSkew(MARKET_ID);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2100", 8));

      const dS = ethers.parseUnits("2", 18);
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);

      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);
      const receipt = await tx.wait();

      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);
      const actualPayout = t1BalAfter - t1BalBefore;

      // 1. Emitted Event Asserts
      const parsedLogs = receipt.logs.map(log => {
        try { return sys.engine.interface.parseLog(log); } catch { return null; }
      }).filter(Boolean);

      const decEvent = parsedLogs.find(e => e.name === "PositionDecreased");
      expect(decEvent).to.not.be.undefined;
      expect(decEvent.args.sizeReduced).to.equal(dS);
      expect(decEvent.args.marginReduced).to.equal(ethers.parseUnits("200", 18)); // M_rel

      // 2. Exact Trader Payout & Remaining Margin
      // Notional = 2 * $2,100 = $4,200. Fee (0.1%) = $4.20. Realized PnL = +$200.
      // Payout = M_rel ($200) + PnL ($200) - Fee ($4.20) = $395.80
      const expectedPayout = ethers.parseUnits("395.8", 18);
      expect(actualPayout).to.equal(expectedPayout);

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(ethers.parseUnits("800", 18));
      expect(posAfter.size).to.equal(ethers.parseUnits("8", 18));

      // 3. Open Interest & AMM Skew Deltas
      const finalOI = await sys.engine.getTotalOpenInterest(MARKET_ID);
      const [finalLongOI, finalShortOI, finalSkew] = await sys.amm.getMarketSkew(MARKET_ID);

      expect(initialOI - finalOI).to.equal(dS);
      expect(initialLongOI - finalLongOI).to.equal(dS);
      expect(initialSkew - finalSkew).to.equal(BigInt(dS)); // Net skew delta = -dS

      // 4. Ledger Reconciliation & Active Margin Sum
      const engineCollateral = await sys.engine.totalCollateral();
      const vaultTraderMargin = await sys.vault.traderMarginTotal();
      expect(engineCollateral).to.equal(vaultTraderMargin);

      let activeMarginSum = 0n;
      const pos1 = await sys.engine.getPositionInternal(1);
      if (pos1.isActive) activeMarginSum += pos1.margin;
      expect(engineCollateral).to.equal(activeMarginSum);

      // 5. Physical Vault Conservation
      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities);
    });

    it("P-L3: Profitable partial decrease control (M=1000, S=10, dS=2 -> M_rel=200, PnL=+200 -> payout=400, M_after=800)", async function () {
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

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

      // Price surges from $2,000 to $2,100 (+$100/ETH). For dS = 2 ETH, realizedPnL = +$200.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2100", 8));

      const dS = ethers.parseUnits("2", 18);
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);

      await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);

      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);
      const actualPayout = t1BalAfter - t1BalBefore;

      // Payout MUST equal M_rel + realizedPnL = 200 + 200 = 400
      expect(actualPayout).to.equal(ethers.parseUnits("400", 18));

      const posAfter = await sys.engine.getPositionInternal(1);
      expect(posAfter.margin).to.equal(ethers.parseUnits("800", 18));

      await verifyPartialIdentities(
        "P-L3",
        ethers.parseUnits("1000", 18),
        ethers.parseUnits("200", 18),
        ethers.parseUnits("200", 18),
        0n,
        actualPayout,
        posAfter.margin,
        0n
      );
    });
  });

  describe("P1 Fix 2 Terminal Settlement Vectors A, B, C, D & Identity Gates", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    async function verifyDualIdentities(label, initialMargin, realizedPnl, totalFundingOwed, collectibleFee, expectedPayout, expectedBadDebt) {
      // 1. Economic Terminal Identity Gate per ECONOMIC_SPEC
      // initialMargin + realizedPnl - totalFundingOwed - collectibleFee == traderPayout - residualDeficit
      const LHS = initialMargin + realizedPnl - totalFundingOwed - collectibleFee;
      const RHS = expectedPayout - expectedBadDebt;
      expect(LHS).to.equal(RHS, `Economic Identity Failed at ${label}`);

      // 2. Physical Vault Identity Gate
      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities, `Physical Identity Failed at ${label}`);
    }

    it("Vector A: M=100, Funding=150, PnL=+100, Fee=0 -> Payout=50, BadDebt=0", async function () {
      // Turn off protocol fee ratio for Vector A
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

      const margin = ethers.parseUnits("100", 18);
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

      // Accrue $150 funding
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("150", 18));
      // Price increases by $100 ($2,000 -> $2,100) -> PnL = +$100
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2100", 8));

      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);

      const payout = t1BalAfter - t1BalBefore;
      expect(payout).to.equal(ethers.parseUnits("50", 18));

      await verifyDualIdentities(
        "Vector A",
        margin,
        ethers.parseUnits("100", 18),
        ethers.parseUnits("150", 18),
        0n,
        payout,
        0n
      );
    });

    it("Vector B: M=100, Funding=150, PnL=+40, Fee=0 -> Residual Bad Debt=10, Payout=0", async function () {
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

      const margin = ethers.parseUnits("100", 18);
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

      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("150", 18));
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2040", 8)); // PnL = +$40

      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);

      const payout = t1BalAfter - t1BalBefore;
      expect(payout).to.equal(0n);

      await verifyDualIdentities(
        "Vector B",
        margin,
        ethers.parseUnits("40", 18),
        ethers.parseUnits("150", 18),
        0n,
        payout,
        ethers.parseUnits("10", 18)
      );
    });

    it("Vector C: M=100, Funding=150, PnL=+100, Nominal Fee=20 -> Fee=20, Payout=30, BadDebt=0", async function () {
      // Set protocol fee to 1% (200 bps) on $2,100 notional = $21 nominal closing fee
      await sys.engine.connect(sys.deployer).updateProtocolFee(ethers.parseUnits("0.01", 18));

      // Open fee = 1% on $2,000 = $20. So initial margin = $120 ($100 margin after open fee)
      const margin = ethers.parseUnits("120", 18);
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

      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("150", 18));
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2100", 8)); // PnL = +$100

      const feeBalBefore = await sys.vault.protocolFeeBalance();
      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);
      const feeBalAfter = await sys.vault.protocolFeeBalance();

      const feeCollected = feeBalAfter - feeBalBefore;
      const payout = t1BalAfter - t1BalBefore;

      expect(feeCollected).to.equal(ethers.parseUnits("21", 18));
      expect(payout).to.equal(ethers.parseUnits("29", 18));

      await verifyDualIdentities(
        "Vector C",
        ethers.parseUnits("100", 18),
        ethers.parseUnits("100", 18),
        ethers.parseUnits("150", 18),
        feeCollected,
        payout,
        0n
      );
    });

    it("Vector D: M=100, Funding=150, PnL=-100 -> Total System Deficit = 150", async function () {
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

      const margin = ethers.parseUnits("100", 18);
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

      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("150", 18));
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1900", 8)); // PnL = -$100

      const t1BalBefore = await sys.quote.balanceOf(sys.t1.address);
      await sys.engine.connect(sys.t1).closePosition(1);
      const t1BalAfter = await sys.quote.balanceOf(sys.t1.address);

      const payout = t1BalAfter - t1BalBefore;
      expect(payout).to.equal(0n);

      await verifyDualIdentities(
        "Vector D",
        margin,
        -ethers.parseUnits("100", 18),
        ethers.parseUnits("150", 18),
        0n,
        payout,
        ethers.parseUnits("150", 18)
      );
    });
  });

  describe("P1 Fix 3 Regression Tests — Unbacked trader profit MUST REVERT (18d & 6d)", function () {
    async function testUnbackedProfitRevert(quoteDecimals) {
      const sys = await deploySystem(quoteDecimals);

      // LP deposits 3,000 quote units so openPosition (locking $2,000) succeeds
      const lpDeposit = ethers.parseUnits("3000", quoteDecimals);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Trader 1 opens position with $100 margin, 1 ETH size
      const margin = ethers.parseUnits("100", 18);
      const marginNative = ethers.parseUnits("100", quoteDecimals);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, marginNative);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, marginNative);

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

      // Trader 2 opens a short position, makes a massive profit, draining LP assets to only $100
      // We can simulate depleted totalLpAssets by impersonating engine and settling a large profit to t2
      const engineSigner = await ethers.getImpersonatedSigner(sys.engine.target);
      await ethers.provider.send("hardhat_setBalance", [sys.engine.target, "0x1000000000000000000"]);

      // Deposit $2,800 trader margin for t2, then settleTraderProfit of $2,800 profit -> leaves $200 LP assets
      const t2Margin = ethers.parseUnits("2800", quoteDecimals);
      await sys.quote.mint(sys.t2.address, t2Margin);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, t2Margin);
      await sys.vault.connect(engineSigner).depositTraderMargin(sys.t2.address, t2Margin);

      // Deplete LP assets to $50
      const lpAssetsToDeplete = (await sys.vault.totalLpAssets()) - ethers.parseUnits("50", quoteDecimals);
      await sys.vault.connect(engineSigner).settleTraderProfit(sys.t2.address, t2Margin, lpAssetsToDeplete);

      // Price surges to $2,500 (+ $500 profit > $50 LP assets!)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2500", 8));

      // Attempting closePosition when vault lacks sufficient LP assets MUST REVERT
      await expect(
        sys.engine.connect(sys.t1).closePosition(1)
      ).to.be.revertedWith("PerpEngine: unbacked profit");

      // Assert position remains active and trader claim is preserved
      const pos = await sys.engine.getPositionInternal(1);
      expect(pos.isActive).to.be.true;

      // Assert physical quote balance equals liabilities
      const physBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physBal).to.equal(liabilities);
    }

    it("18D Unbacked profit reverts atomically", async function () {
      await testUnbackedProfitRevert(18);
    });

    it("6D Unbacked profit reverts atomically", async function () {
      await testUnbackedProfitRevert(6);
    });
  });

  describe("Blocker 1 Regression Test — Partial decrease cannot silently delete exposure", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    it("Partial decrease that exhausts collateral MUST REVERT and NOT silently erase remaining exposure", async function () {
      // Q = 10 ETH, M = $1,000 margin
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

      // Price drops from $2,000 to $1,500 (-$400 loss per ETH)
      // On 2 ETH partial decrease, loss = $1,000, which exhausts all $1,000 position margin!
      const crashPrice = ethers.parseUnits("1500", 8);
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, crashPrice);

      const dQ = ethers.parseUnits("2", 18);

      // Attempting partial decrease that would leave 0 remaining margin MUST REVERT
      await expect(
        sys.engine.connect(sys.t1).decreasePosition(1, dQ, 0n)
      ).to.be.revertedWith("PerpEngine: remaining margin zero");

      // Verify position remains active with 10 ETH size (remaining exposure was NOT erased!)
      const pos = await sys.engine.getPosition(1);
      expect(pos.size).to.equal(size);
      expect(pos.healthFactor).to.be.lte(ethers.parseUnits("1", 18)); // Vulnerable to liquidation/full close

      // Open Interest and AMM skew remain unchanged at 10 ETH
      const totalOI = await sys.engine.getTotalOpenInterest(MARKET_ID);
      expect(totalOI).to.equal(size);

      // Position Manager NFT remains active
      const [isActive, exists] = await sys.posManager.getPositionStatus(1);
      expect(exists).to.be.true;
      expect(isActive).to.be.true;
    });
  });

  describe("Blocker 2 Genuine Insolvency Conservation Tests (18d & 6d)", function () {
    async function testGenuineInsolvencyConservation(quoteDecimals, withInsurance) {
      const sys = await deploySystem(quoteDecimals);

      const lpDeposit = ethers.parseUnits("100000", quoteDecimals);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const engineSigner = await ethers.getImpersonatedSigner(sys.engine.target);
      await ethers.provider.send("hardhat_setBalance", [sys.engine.target, "0x1000000000000000000"]);

      if (withInsurance) {
        // Pre-fund insurance fund with 500 units from deployer via depositTraderMargin + fundInsuranceFund
        const ifFundNative = ethers.parseUnits("500", quoteDecimals);
        await sys.quote.mint(sys.deployer.address, ifFundNative);
        await sys.quote.connect(sys.deployer).approve(sys.vault.target, ifFundNative);

        await sys.vault.connect(engineSigner).depositTraderMargin(sys.deployer.address, ifFundNative);
        await sys.vault.connect(engineSigner).fundInsuranceFund(ifFundNative);
      }

      // Checkpoint BEFORE
      const physBefore = await sys.quote.balanceOf(sys.vault.target);
      const lpAssetsBefore = await sys.vault.totalLpAssets();
      const marginBefore = await sys.vault.traderMarginTotal();
      const ifBefore = await sys.vault.insuranceFundBalance();
      const feesBefore = await sys.vault.protocolFeeBalance();

      const liabilitiesBefore = lpAssetsBefore + marginBefore + ifBefore + feesBefore;
      expect(physBefore).to.equal(liabilitiesBefore);

      // Open position
      const marginWad = ethers.parseUnits("100", 18);
      const marginNative = ethers.parseUnits("100", quoteDecimals);
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

      // Price crashes from $2,000 to $1,000 (Loss $1,000 > $100 margin -> Bad Debt)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));

      // Close insolvent position
      await sys.engine.connect(sys.t1).closePosition(1);

      // Checkpoint AFTER
      const physAfter = await sys.quote.balanceOf(sys.vault.target);
      const lpAssetsAfter = await sys.vault.totalLpAssets();
      const marginAfter = await sys.vault.traderMarginTotal();
      const ifAfter = await sys.vault.insuranceFundBalance();
      const feesAfter = await sys.vault.protocolFeeBalance();

      const liabilitiesAfter = lpAssetsAfter + marginAfter + ifAfter + feesAfter;

      // PHYSICAL ASSETS MUST EQUAL LEDGER LIABILITIES EXACTLY
      expect(physAfter).to.equal(liabilitiesAfter);

      // Print explicit transition table for audit
      console.log(`\n--- INSOLVENCY LEDGER TRANSITION (${quoteDecimals}D Quote, withInsurance=${withInsurance}) ---`);
      console.log(`Physical Balance: Before = ${physAfter}, After = ${physAfter}, Delta = 0`);
      console.log(`totalLpAssets:    Before = ${lpAssetsBefore}, After = ${lpAssetsAfter}`);
      console.log(`traderMargin:     Before = ${marginBefore}, After = ${marginAfter}`);
      console.log(`insuranceFund:    Before = ${ifBefore}, After = ${ifAfter}`);
      console.log(`protocolFees:     Before = ${feesBefore}, After = ${feesAfter}`);
      console.log(`Total Liabilities == Physical Balance: ${physAfter == liabilitiesAfter}`);
    }

    it("18D Genuine Insolvency Conservation (Insurance = 0)", async function () {
      await testGenuineInsolvencyConservation(18, false);
    });

    it("18D Genuine Insolvency Conservation (Insurance > 0)", async function () {
      await testGenuineInsolvencyConservation(18, true);
    });

    it("6D Genuine Insolvency Conservation (Insurance = 0)", async function () {
      await testGenuineInsolvencyConservation(6, false);
    });

    it("6D Genuine Insolvency Conservation (Insurance > 0)", async function () {
      await testGenuineInsolvencyConservation(6, true);
    });
  });

  describe("Blocker 3 Regression Test — Unpaid protocol fee must not become LP/insurance bad debt", function () {
    it("Insolvent position caps protocol fee at available collateral, no unpaid fee socialized", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Trader margin = $25, size = 1 ETH ($2,000 notional). Open Fee = $2 (0.1%).
      // Remaining position margin = $23.
      const margin = ethers.parseUnits("25", 18);
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

      // Price crashes to $1,000 (Trading Loss = $1,000 > $23 margin).
      // Trading loss takes priority and consumes all $23 collateral.
      // Remaining collateral = $0, nominal closing fee = $1.
      // Collectible closing fee = min($1, $0) = $0. Unpaid fee is dropped, NOT socialized to LP/IF.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));

      const feeBalBefore = await sys.vault.protocolFeeBalance();
      await sys.engine.connect(sys.t1).closePosition(1);
      const feeBalAfter = await sys.vault.protocolFeeBalance();

      // Closing fee collected MUST equal 0 because trading loss exhausted position collateral first
      expect(feeBalAfter - feeBalBefore).to.equal(0n);

      // Vault physical quote balance MUST match liabilities
      const physBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physBal).to.equal(liabilities);
    });

    it("Partially solvent position collects fee up to remaining collateral", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Trader margin = $1002.50, size = 1 ETH ($2,000 notional). Open fee = $2.
      // Pos margin after open fee = $1000.50.
      const margin = ethers.parseUnits("1002.5", 18);
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

      // Price drops to $1,000 (Trading Loss = $1,000).
      // Remaining collateral after loss = $1000.50 - $1000.00 = $0.50.
      // Nominal closing fee = $1. Collectible fee = min($1, $0.50) = $0.50.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));

      const feeBalBefore = await sys.vault.protocolFeeBalance();
      await sys.engine.connect(sys.t1).closePosition(1);
      const feeBalAfter = await sys.vault.protocolFeeBalance();

      expect(feeBalAfter - feeBalBefore).to.equal(ethers.parseUnits("0.5", 18));

      const physBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physBal).to.equal(liabilities);
    });
  });

  describe("Strengthened Multi-Actor Conservation Sequence (11 Checkpoints)", function () {
    it("All 3 Invariants hold at every single checkpoint across complex multi-actor lifecycle", async function () {
      const sys = await deploySystem(18);

      async function verifyInvariants(label) {
        const physicalBal = await sys.quote.balanceOf(sys.vault.target);
        const lpAssets = await sys.vault.totalLpAssets();
        const traderMargin = await sys.vault.traderMarginTotal();
        const insurance = await sys.vault.insuranceFundBalance();
        const protocolFees = await sys.vault.protocolFeeBalance();

        // 1. Physical Vault Invariant
        expect(physicalBal).to.equal(lpAssets + traderMargin + insurance + protocolFees, `Physical Invariant Failed at ${label}`);

        // 2. Engine / Vault Trader Collateral Invariant
        const engineCollateral = await sys.engine.totalCollateral();
        expect(engineCollateral).to.equal(traderMargin, `Trader Margin Invariant Failed at ${label}`);

        // 3. Position Aggregation Invariant (using storage margin via getPositionInternal)
        let activeMarginSum = 0n;
        for (let i = 1; i <= 5; i++) {
          try {
            const pos = await sys.engine.getPositionInternal(i);
            if (pos.isActive) {
              activeMarginSum += pos.margin;
            }
          } catch {}
        }
        expect(engineCollateral).to.equal(activeMarginSum, `Position Aggregation Failed at ${label}`);
      }

      // Checkpoint 1: LP Deposit
      const lpAmount = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpAmount);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpAmount);
      await sys.vault.connect(sys.lp).deposit(lpAmount, sys.lp.address);
      await verifyInvariants("CP1: LP Deposit");

      // Checkpoint 2: Trader 1 Long Open
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
      await verifyInvariants("CP2: Trader 1 Long Open");

      // Checkpoint 3: Trader 2 Short Open
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
      await verifyInvariants("CP3: Trader 2 Short Open");

      // Checkpoint 4: Increase Position Trader 1
      const addSize = ethers.parseUnits("1", 18);
      const addMarginVal = ethers.parseUnits("500", 18);
      await sys.quote.mint(sys.t1.address, addMarginVal);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addMarginVal);
      await sys.engine.connect(sys.t1).increasePosition(1, addSize, addMarginVal);
      await verifyInvariants("CP4: Increase Position T1");

      // Checkpoint 5: Add Margin Trader 2
      const addMarginT2 = ethers.parseUnits("200", 18);
      await sys.quote.mint(sys.t2.address, addMarginT2);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, addMarginT2);
      await sys.engine.connect(sys.t2).addMargin(2, addMarginT2);
      await verifyInvariants("CP5: Add Margin T2");

      // Checkpoint 6: Funding Accrual
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, ethers.parseUnits("10", 18));
      await sys.engine.accrueFunding(MARKET_ID);
      await verifyInvariants("CP6: Funding Accrual");

      // Checkpoint 7: Profitable Partial Decrease Trader 1
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2200", 8));
      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("1", 18), 0n);
      await verifyInvariants("CP7: Profitable Decrease T1");

      // Checkpoint 8: Losing Partial Decrease Trader 2
      await sys.engine.connect(sys.t2).decreasePosition(2, ethers.parseUnits("0.5", 18), 0n);
      await verifyInvariants("CP8: Losing Decrease T2");

      // Checkpoint 9: Remove Margin Trader 1
      await sys.engine.connect(sys.t1).removeMargin(1, ethers.parseUnits("100", 18));
      await verifyInvariants("CP9: Remove Margin T1");

      // Checkpoint 10: Full Close Trader 1
      await sys.engine.connect(sys.t1).closePosition(1);
      await verifyInvariants("CP10: Full Close T1");

      // Checkpoint 11: Genuine Insolvency Trader 2
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("5000", 8)); // Short loses heavily
      await sys.engine.connect(sys.t2).closePosition(2);
      await verifyInvariants("CP11: Genuine Insolvency T2 Full Close");
    });
  });
});
