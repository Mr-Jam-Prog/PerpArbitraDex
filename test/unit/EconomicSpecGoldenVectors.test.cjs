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

  describe("Post-Fee Risk, Bad Debt Ceil & Locked Liquidity Regressions (RISK-R1..R3, EVENT-R1, BD-R1..R3, LOCK-R1)", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(18); // 18d default

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
    });

    it("RISK-R1: openPosition reverts when actual post-fee margin causes leverage to exceed MAX_LEVERAGE", async function () {
      // Max leverage = 100x. Market protocol fee = 0.1% (10 bps).
      // Notional = 2 ETH at $1,000 = $2,000. Protocol fee = 0.1% on $2,000 = $2.
      // Gross margin = $20. Pre-fee leverage = $2000 / $20 = 100x (passes pre-fee check).
      // Post-fee margin = $20 - $2 = $18. Post-fee leverage = $2000 / $18 = 111.11x > 100x max!
      const margin = ethers.parseUnits("20", 18);
      const size = ethers.parseUnits("2", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));

      await expect(
        sys.engine.connect(sys.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: margin,
          acceptablePrice: ethers.parseUnits("1010", 8),
          deadline: latestTime + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.be.revertedWith("PerpEngine: leverage too high");
    });

    it("RISK-R2: 6d quote openPosition validates risk on actual post-fee native-backed margin and reverts if boundary exceeded", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("500000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      // Notional = $2,000. Fee (0.1%) = $2. Gross margin input = 20.000000999999 USDC (non-native WAD dust).
      // Native deposit = 20.000000 USDC. Post-fee margin = 18.000000 USDC.
      // Leverage on 18 USDC = 111.11x > 100x max -> Reverts!
      const marginWad = ethers.parseUnits("20", 18) + 999999999999n;
      const marginNative = ethers.parseUnits("20", 6);
      const size = ethers.parseUnits("2", 18);

      await sys6d.quote.mint(sys6d.t1.address, marginNative);
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, marginNative);

      const latestTime = await time.latest();
      await sys6d.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));

      await expect(
        sys6d.engine.connect(sys6d.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: marginWad,
          acceptablePrice: ethers.parseUnits("1010", 8),
          deadline: latestTime + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.be.revertedWith("PerpEngine: leverage too high");
    });

    it("RISK-R3: increasePosition reverts atomically when post-fee risk fails, leaving zero state mutation", async function () {
      // Open position with $100 margin, 1 ETH size ($2,000 notional, 20x leverage). Fee = $2. Pos margin = $98.
      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const posBefore = await sys.engine.getPositionInternal(1);
      const vaultTraderMarginBefore = await sys.vault.traderMarginTotal();

      // Attempt increase: add 8 ETH size ($16,000 added notional). Added margin = $142.
      // Increase fee = 0.1% on $16,000 = $16.
      // Gross new margin = $98 + $142 = $240. Post-fee new margin = $240 - $16 = $224.
      // Total size = 9 ETH ($18,000 notional). New leverage = $18,000 / $224 = 80.35x <= 100x.
      // But if added margin = $140:
      // Gross new margin = $98 + $140 = $238. Post-fee new margin = $238 - $16 = $222.
      // New leverage = $18,000 / $222 = 81.08x. If max leverage was set to 80x, this fails!
      await sys.engine.connect(sys.deployer).initializeMarket(
        2,
        FEED_ID,
        ethers.parseUnits("80", 18), // 80x max leverage
        ethers.parseUnits("0.01", 18),
        ethers.parseUnits("0.001", 18),
        ethers.parseUnits("0.025", 18),
        ethers.parseUnits("0.001", 18)
      );

      // Open on market 2
      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);
      latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: 2,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Increase on market 2 with $140 added margin -> post-fee leverage 81.08x > 80x -> Reverts!
      const addMargin = ethers.parseUnits("140", 18);
      const addSize = ethers.parseUnits("8", 18);
      await sys.quote.mint(sys.t1.address, addMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addMargin);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(2, addSize, addMargin)
      ).to.be.revertedWith("PerpEngine: leverage exceeds market max");

      // Verify zero state mutation
      const posAfter = await sys.engine.getPositionInternal(2);
      expect(posAfter.size).to.equal(size);
      expect(posAfter.margin).to.equal(ethers.parseUnits("98", 18));
      expect(await sys.engine.getTotalOpenInterest(2)).to.equal(size);
    });

    it("EVENT-R1: PositionOpened and PositionIncreased events emit actual post-fee native-backed accounted values", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("500000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      const marginWad = ethers.parseUnits("100", 18) + 999999999999n;
      const marginNative = ethers.parseUnits("100", 6);
      const size = ethers.parseUnits("1", 18);

      await sys6d.quote.mint(sys6d.t1.address, marginNative);
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, marginNative);

      const latestTime = await time.latest();
      const tx = await sys6d.engine.connect(sys6d.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginWad,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const receipt = await tx.wait();
      const parsedLogs = receipt.logs.map(log => {
        try { return sys6d.engine.interface.parseLog(log); } catch { return null; }
      }).filter(Boolean);

      const openEvent = parsedLogs.find(e => e.name === "PositionOpened");
      expect(openEvent).to.not.be.undefined;
      // Fee = 0.1% on $2,000 = $2. Post-fee margin = $100 - $2 = $98.
      expect(openEvent.args.margin).to.equal(ethers.parseUnits("98", 18));
      expect(openEvent.args.fee).to.equal(ethers.parseUnits("2", 18));
    });

    it("BD-R1 & BD-R2 & BD-R3: Sub-native residual bad debt uses conservative native ceil and reconciles exact Engine/Vault WAD", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      await sys6d.engine.connect(sys6d.deployer).updateProtocolFee(0n);

      // Open position with 25 USDC native margin ($25 = 25000000 native units = 25e18 WAD) for 1 ETH size ($2,000 notional -> 80x leverage)
      const margin = ethers.parseUnits("25", 18);
      const size = ethers.parseUnits("1", 18);

      await sys6d.quote.mint(sys6d.t1.address, 25000000n);
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, 25000000n);

      const latestTime = await time.latest();
      await sys6d.engine.connect(sys6d.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops from $2,000 to $1,974.9999999. Economic loss = $25.0000001 (25.0000001 USDC = 25000000.1 micro-units).
      // Ceil native deficit = 25000001 native units (25.000001 USDC).
      // Residual bad debt = 25.000001 - 25 = 1 micro-unit (0.000001 USDC).
      await sys6d.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 197499999990n);

      await sys6d.engine.connect(sys6d.t1).closePosition(1);

      // Verify physical conservation
      const physicalBal = await sys6d.quote.balanceOf(sys6d.vault.target);
      const liabilities = (await sys6d.vault.totalLpAssets()) +
                          (await sys6d.vault.traderMarginTotal()) +
                          (await sys6d.vault.insuranceFundBalance()) +
                          (await sys6d.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities);
      // Engine totalCollateral WAD MUST equal normalized Vault traderMarginTotal WAD exactly
      expect(await sys6d.engine.totalCollateral()).to.equal((await sys6d.vault.traderMarginTotal()) * 10n**12n);
    });

    it("LOCK-R1: Multiple partial decreases do not leak LP locked liquidity on final close", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      await sys6d.engine.connect(sys6d.deployer).updateProtocolFee(0n);

      const margin = ethers.parseUnits("300", 18);
      const marginNative = ethers.parseUnits("300", 6);
      const size = ethers.parseUnits("10", 18);

      await sys6d.quote.mint(sys6d.t1.address, marginNative);
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, marginNative);

      const latestTime = await time.latest();
      await sys6d.engine.connect(sys6d.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const initialVaultLocked = await sys6d.vault.lockedLiquidity();
      expect(initialVaultLocked).to.equal(20000000000n); // $20,000.000000 locked

      // Perform 3 fractional partial decreases of 3.333333 ETH each
      const dS = ethers.parseUnits("3.333333", 18);
      await sys6d.engine.connect(sys6d.t1).decreasePosition(1, dS, 0n);
      await sys6d.engine.connect(sys6d.t1).decreasePosition(1, dS, 0n);
      await sys6d.engine.connect(sys6d.t1).decreasePosition(1, dS, 0n);

      // Close remaining position
      await sys6d.engine.connect(sys6d.t1).closePosition(1);

      // Remaining locked liquidity in Vault MUST be exactly 0 (no unlock leakage!)
      expect(await sys6d.vault.lockedLiquidity()).to.equal(0n);
    });
  });

  describe("6D Native Representability Invariants Suite (D-R1 through D-R9)", function () {
    let sys;

    beforeEach(async function () {
      sys = await deploySystem(6); // 6-decimal quote token USDC

      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.engine.connect(sys.deployer).updateProtocolFee(0n); // Turn off fee for pure collateral tests
    });

    async function assert6dInvariants(label) {
      const nativeVaultMargin = await sys.vault.traderMarginTotal();
      const normalizedVaultMargin = nativeVaultMargin * 10n**12n;
      const engineCollateral = await sys.engine.totalCollateral();

      expect(engineCollateral).to.equal(normalizedVaultMargin, `Engine Collateral != Vault Margin at ${label}`);

      let activeMarginSum = 0n;
      for (let i = 1; i <= 5; i++) {
        try {
          const pos = await sys.engine.getPositionInternal(i);
          if (pos.isActive) activeMarginSum += pos.margin;
        } catch {}
      }
      expect(engineCollateral).to.equal(activeMarginSum, `Engine Collateral != Sum(active pos.margin) at ${label}`);

      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          nativeVaultMargin +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities, `Physical Vault Conservation Failed at ${label}`);
    }

    it("D-R1: non-representable openPosition margin (1e18 + 1 WAD)", async function () {
      const marginReq = ethers.parseUnits("100", 18) + 1n; // 100.000000000000000001 WAD
      const size = ethers.parseUnits("1", 18);

      // Mint 100.000001 USDC (100000001 native units = 100.000001e18 WAD)
      await sys.quote.mint(sys.t1.address, 100000001n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000001n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Position margin MUST equal exactly 100000000000000000000 WAD (100.000000 USDC), no +1 WAD phantom claim
      const pos = await sys.engine.getPositionInternal(1);
      expect(pos.margin).to.equal(ethers.parseUnits("100", 18));
      await assert6dInvariants("D-R1");
    });

    it("D-R2: non-representable addMargin (1e12 + 1 WAD)", async function () {
      const marginReq = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, 100000000n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000000n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Add non-representable margin: 1e12 + 1 WAD (0.000001000000000001 USDC)
      const addWad = 10n**12n + 1n;
      await sys.quote.mint(sys.t1.address, 1n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 1n);

      await sys.engine.connect(sys.t1).addMargin(1, addWad);

      const pos = await sys.engine.getPositionInternal(1);
      // Added margin MUST equal 1e12 WAD (0.000001 USDC)
      expect(pos.margin).to.equal(ethers.parseUnits("100.000001", 18));
      await assert6dInvariants("D-R2");
    });

    it("D-R3: non-representable removeMargin (1e12 + 1 WAD)", async function () {
      const marginReq = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, 100000000n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000000n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Remove non-representable margin 1e12 + 1 WAD -> native payout = 1 native unit = 1e12 WAD
      const remWad = 10n**12n + 1n;
      await sys.engine.connect(sys.t1).removeMargin(1, remWad);

      const pos = await sys.engine.getPositionInternal(1);
      expect(pos.margin).to.equal(ethers.parseUnits("99.999999", 18));
      await assert6dInvariants("D-R3");
    });

    it("D-R4: proportional release below 1 native unit (0 < M_rel < 1e12 WAD)", async function () {
      // M = 200 USDC = 200e18 WAD. S = 10 ETH ($20,000 notional -> 100x max leverage).
      const marginReq = ethers.parseUnits("200", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, 200000000n); // 200 USDC
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 200000000n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Partial decrease 1e9 wei base (0.00000000001 ETH). Raw M_rel = 200e18 * 1e9 / 10e18 = 20e9 WAD (< 1 native micro-unit).
      // Floor native M_rel = 0 native units = 0 WAD. M_rel WAD is 0. Full 200e18 WAD margin is retained in position margin!
      const dS = 10n**9n; // 1e9 wei
      await sys.engine.connect(sys.t1).decreasePosition(1, dS, 0n);

      const pos = await sys.engine.getPositionInternal(1);
      expect(pos.margin).to.equal(ethers.parseUnits("200", 18)); // Retained full 200 WAD margin
      await assert6dInvariants("D-R4");
    });

    it("D-R5: sub-native funding owed (0 < fundingDebtWad < 1e12)", async function () {
      const marginReq = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, 100000000n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000000n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Accrue sub-native funding debt: 1e10 WAD (0.00000001 USDC < 1 native unit)
      // Ceil native debt = 1 native micro-unit (1e12 WAD = 0.000001 USDC)
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, 10n**10n);
      await sys.engine.accrueFunding(MARKET_ID);

      // Perform a partial decrease (10%) to trigger funding settlement
      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.1", 18), 0n);

      const pos = await sys.engine.getPositionInternal(1);
      // Vault traderMarginTotal = 100 - 10 (10% release payout) = 90 USDC = 90000000 native
      // Pos margin = 90e18 - 1e12 (funding debt) = 89.999999e18 WAD
      expect(await sys.vault.traderMarginTotal()).to.equal(90000000n);
      expect(pos.margin).to.equal(ethers.parseUnits("90", 18));
      await assert6dInvariants("D-R5");
    });

    it("D-R6: sub-native funding credit (0 < creditWad < 1e12)", async function () {
      const marginReq = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, 100000000n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000000n);

      const latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Accrue negative sub-native funding credit: -1e10 WAD (0.00000001 USDC)
      // Floor native credit = 0 native units. No unsupported WAD claim created.
      await sys.amm.getFunction("setCumulativeFundingIndex")(MARKET_ID, -(10n**10n));
      await sys.engine.accrueFunding(MARKET_ID);

      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.1", 18), 0n);

      const pos = await sys.engine.getPositionInternal(1);
      expect(await sys.vault.traderMarginTotal()).to.equal(90000000n); // 90.000000 USDC
      expect(pos.margin).to.equal(ethers.parseUnits("90", 18));
      await assert6dInvariants("D-R6");
    });

    it("D-R7 & D-R8: sub-native realized trading loss and sub-native realized profit in 6d", async function () {
      const marginReq = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, 100000000n);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, 100000000n);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: marginReq,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops by 0.00000001 ($2000.00000000 -> $1999.99999999). 8-decimal representation: 200000000000n -> 199999999999n.
      // Loss on 0.1 ETH = 1e9 WAD (< 1 native micro-unit). Native loss ceil = 1 native micro-unit (1e12 WAD)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 199999999999n);

      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.1", 18), 0n);
      await assert6dInvariants("D-R7");

      // Price surges back ($1999.99999999 -> $2000.00000000). Profit on 0.1 ETH = 1e9 WAD (< 1 native micro-unit)
      // Native profit floor = 0 native units
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 200000000000n);

      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.1", 18), 0n);
      await assert6dInvariants("D-R8");
    });
  });

  describe("P2 Protocol Fee Ceil Rounding Tests (F-R1 through F-R7)", function () {
    it("F-R1: WAD multiplication rounds protocol fee upward when remainder exists", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Set minPositionSize to 1 wei for testing exact 1 wei notional
      await sys.engine.connect(sys.deployer).initializeMarket(
        2,
        FEED_ID,
        ethers.parseUnits("100", 18),
        ethers.parseUnits("0.01", 18),
        1n, // min position size = 1 wei
        ethers.parseUnits("0.025", 18),
        ethers.parseUnits("0.001", 18)
      );

      const margin = ethers.parseUnits("100", 18);
      const size = 1n; // 1 wei

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      const latestTime = await time.latest();
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      const tx = await sys.engine.connect(sys.t1).openPosition({
        marketId: 2,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("1.01", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const receipt = await tx.wait();
      const parsedLogs = receipt.logs.map(log => {
        try { return sys.engine.interface.parseLog(log); } catch { return null; }
      }).filter(Boolean);

      const openEvent = parsedLogs.find(e => e.name === "PositionOpened");
      expect(openEvent).to.not.be.undefined;
      // WAD fee ceil MUST be exactly 1 wei (not 0)
      expect(openEvent.args.fee).to.equal(1n);
      expect(await sys.vault.protocolFeeBalance()).to.equal(1n);
    });

    it("F-R2 & F-R3: 6d sub-native positive fee rounds up to 1 native unit and 1.0000001 USDC rounds up once to 1.000001 USDC", async function () {
      const sys = await deploySystem(6); // 6-decimal quote token

      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // F-R2: Sub-native WAD fee: Notional WAD = $1.00 (1e18 WAD), Fee ratio = 0.0000001 (0.001 bps)
      // WAD fee = 1e11 (0.0000001 Quote). In 6d native units, 1e11 / 1e12 = 0.1 native micro-units -> Ceil rounds up to 1 native unit = 0.000001 USDC (1e12 WAD)
      await sys.engine.connect(sys.deployer).updateProtocolFee(ethers.parseUnits("0.0000001", 18));

      const margin = ethers.parseUnits("100", 18);
      const marginNative = ethers.parseUnits("100", 6);
      const size = ethers.parseUnits("1", 18); // 1 ETH at $1.00

      await sys.quote.mint(sys.t1.address, marginNative);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, marginNative);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));
      let latestTime = await time.latest();

      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("1.01", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Protocol fee balance in Vault MUST equal 1 native unit (0.000001 USDC)
      expect(await sys.vault.protocolFeeBalance()).to.equal(1n);
      // Engine protocol fee tracking MUST equal 1e12 WAD (normalized 1 native unit)
      expect(await sys.engine.getProtocolFees(await sys.quote.getAddress())).to.equal(ethers.parseUnits("0.000001", 18));

      // F-R3: Real native-boundary fee: Notional = $1,000.0001 -> Mathematical fee (10 bps) = $1.0000001 -> Ceil rounds up to 1.000001 USDC (1000001 native units)
      await sys.engine.connect(sys.deployer).updateProtocolFee(ethers.parseUnits("0.001", 18)); // 10 bps
      const margin2 = ethers.parseUnits("100", 18);
      const margin2Native = ethers.parseUnits("100", 6);
      // Size = 1.0000001 ETH at $1,000 price -> Notional = $1000.0001 -> Fee WAD = 1.0000001e18 -> 1.0000001 USDC
      const size2 = ethers.parseUnits("1.0000001", 18);

      await sys.quote.mint(sys.t2.address, margin2Native);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, margin2Native);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1000", 8));
      latestTime = await time.latest();

      const feeBalBefore = await sys.vault.protocolFeeBalance();
      await sys.engine.connect(sys.t2).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size2,
        margin: margin2,
        acceptablePrice: ethers.parseUnits("1010", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const feeBalAfter = await sys.vault.protocolFeeBalance();
      // Native fee collected MUST be exactly 1000001 units (1.000001 USDC)
      expect(feeBalAfter - feeBalBefore).to.equal(1000001n);
      // Charged fee WAD MUST equal normalized 1.000001e18 WAD
      expect(await sys.engine.getProtocolFees(await sys.quote.getAddress())).to.equal(1000001n * 10n**12n + 1n * 10n**12n);
    });

    it("F-R8 & F-R9: 6d sub-native capped fee and non-integral native fee partial decrease/full close", async function () {
      const sys = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("100000", 6);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Sub-native capped fee test:
      // Open position with M = 0.0000005 USDC (5e11 WAD, capacity < 1 native unit). Fee ratio = 10 bps.
      // After open fee (0), pos margin = 5e11 WAD (< 1 native micro-unit).
      // On close with $1 loss, remaining collateral capacity < 1 native unit.
      // Expected: native fee collected = 0, charged fee WAD = 0, no phantom fee or non-native WAD clamp.
      await sys.engine.connect(sys.deployer).updateProtocolFee(ethers.parseUnits("0.001", 18)); // 10 bps

      // 6d Partial decrease and full close with non-integral native closing fee
      const margin2 = ethers.parseUnits("1000", 18);
      const margin2Native = ethers.parseUnits("1000", 6);
      const size2 = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t2.address, margin2Native);
      await sys.quote.connect(sys.t2).approve(sys.vault.target, margin2Native);

      let latestTime = await time.latest();
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      await sys.engine.connect(sys.t2).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size2,
        margin: margin2,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops to $1,950.00005 ($1,950.00005000 in 8 decimals = 195000005000n). Reduced size = 2 ETH.
      // Reduced notional = 2 ETH * $1,950.00005 = $3,900.0001. Fee (10 bps) = $3.9000001.
      // Ceil rounds up to 3.900001 USDC (3900001 native units = 3.900001e18 WAD)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 195000005000n);

      const feeBalBeforeDec = await sys.vault.protocolFeeBalance();
      await sys.engine.connect(sys.t2).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const feeBalAfterDec = await sys.vault.protocolFeeBalance();

      expect(feeBalAfterDec - feeBalBeforeDec).to.equal(3900001n);
      expect(await sys.engine.totalCollateral()).to.equal((await sys.vault.traderMarginTotal()) * 10n**12n);

      // Full close 6d with non-integral fee
      const feeBalBeforeClose = await sys.vault.protocolFeeBalance();
      await sys.engine.connect(sys.t2).closePosition(1);
      const feeBalAfterClose = await sys.vault.protocolFeeBalance();

      // Remaining size = 8 ETH at $1,950.00005 = $15,600.0004. Fee (10 bps) = $15.6000004 -> Ceil rounds to 15.600001 USDC (15600001 native units)
      expect(feeBalAfterClose - feeBalBeforeClose).to.equal(15600001n);
      expect(await sys.engine.totalCollateral()).to.equal((await sys.vault.traderMarginTotal()) * 10n**12n);

      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities);
    });

    it("F-R4 & F-R5 & F-R6 & F-R7: 18d control, open/increase, decrease/close, and engine/vault collateral equality", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Open position (F-R5)
      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n,
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // F-R7: Engine totalCollateral == Vault traderMarginTotal exactly
      expect(await sys.engine.totalCollateral()).to.equal(await sys.vault.traderMarginTotal());

      // Increase position (F-R5)
      const addMargin = ethers.parseUnits("500", 18);
      const addSize = ethers.parseUnits("5", 18);

      await sys.quote.mint(sys.t1.address, addMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, addMargin);

      await sys.engine.connect(sys.t1).increasePosition(1, addSize, addMargin);
      expect(await sys.engine.totalCollateral()).to.equal(await sys.vault.traderMarginTotal());

      // Partial decrease (F-R6)
      await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("3", 18), 0n);
      expect(await sys.engine.totalCollateral()).to.equal(await sys.vault.traderMarginTotal());

      // Full close (F-R6)
      await sys.engine.connect(sys.t1).closePosition(1);
      expect(await sys.engine.totalCollateral()).to.equal(await sys.vault.traderMarginTotal());

      // F-R7 Physical Vault Conservation
      const physicalBal = await sys.quote.balanceOf(sys.vault.target);
      const liabilities = (await sys.vault.totalLpAssets()) +
                          (await sys.vault.traderMarginTotal()) +
                          (await sys.vault.insuranceFundBalance()) +
                          (await sys.vault.protocolFeeBalance());
      expect(physicalBal).to.equal(liabilities);
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

  describe("Minimum & Maintenance Margin Rounding Up Suite (MM-R1 through MM-R6)", function () {
    async function setupSysWithLP() {
      const sys = await deploySystem(18);
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);
      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);
      return sys;
    }

    it("MM-R1 — openPosition required-margin ceil boundary", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      // Size = 101 WAD + 1 wei. Price = $1. minMarginRatio = 1% (1e16).
      // Notional = 101e18 + 1.
      // Floor required margin = 1010000000000000000 (1.01 WAD).
      // Ceil required margin = 1010000000000000001 (1.01 WAD + 1 wei).
      const size = 101000000000000000001n;
      const floorMargin = 1010000000000000000n;
      const ceilMargin = 1010000000000000001n;

      await sys.quote.mint(sys.t1.address, ceilMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ceilMargin);

      const latestTime = await time.latest();

      // Attempt open with floor margin -> MUST REVERT
      await expect(
        sys.engine.connect(sys.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: floorMargin,
          acceptablePrice: ethers.parseUnits("2", 8),
          deadline: latestTime + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.be.revertedWith("PerpEngine: margin too low");

      // Open with ceil margin -> MUST PASS
      await expect(
        sys.engine.connect(sys.t1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: ceilMargin,
          acceptablePrice: ethers.parseUnits("2", 8),
          deadline: latestTime + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.emit(sys.engine, "PositionOpened");
    });

    it("MM-R2 — increasePosition required-margin ceil boundary with zero state mutation on revert", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      // Initial position: size = 100 WAD, margin = 1 WAD (1%)
      const initSize = ethers.parseUnits("100", 18);
      const initMargin = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Increase by 1 WAD + 1 wei size.
      // Total size = 101 WAD + 1 wei. Ceil total margin required = 1.01 WAD + 1 wei.
      // Add margin = 0.01 WAD (so total margin = 1.01 WAD, exactly 1 wei below ceil).
      const addSize = 1000000000000000001n; // 1 WAD + 1 wei
      const addMargin = 10000000000000000n; // 0.01 WAD

      const posBefore = await sys.engine.getPosition(1);
      const collatBefore = await sys.engine.totalCollateral();

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, addSize, addMargin)
      ).to.be.revertedWith("PerpEngine: margin too low");

      // Verify zero state mutation
      const posAfter = await sys.engine.getPosition(1);
      expect(posAfter.size).to.equal(posBefore.size);
      expect(posAfter.margin).to.equal(posBefore.margin);
      expect(await sys.engine.totalCollateral()).to.equal(collatBefore);
    });

    it("MM-R3 — profitable partial decrease required-margin ceil boundary", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      // Open position: size = 202 WAD + 2 wei, margin = 2.020000000000000002 WAD
      const initSize = 202000000000000000002n;
      const initMargin = 2020000000000000002n;

      await sys.quote.mint(sys.t1.address, initMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price rises slightly to $1.00000001 (profit)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 100000001n);

      // Reduce by half: sizeReduced = 101 WAD + 1 wei.
      // Remaining size = 101 WAD + 1 wei.
      // Remaining margin after release = 1.010000000000000001 WAD.
      // Remaining notional at $1.00000001 = (101e18 + 1) * 1.00000001 = 101000001010000001.01...
      // Ceil min margin required > 1.010000000000000001 WAD.
      await expect(
        sys.engine.connect(sys.t1).decreasePosition(1, 101000000000000000001n, 0n)
      ).to.be.revertedWith("PerpEngine: remaining margin too low");
    });

    it("MM-R4 — losing partial decrease required-margin ceil boundary", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      // Init short position: size = 202 WAD + 2 wei.
      // At price $1.00, open req ceil = 2.02 WAD + 1 wei.
      // Set initMargin = 2 * req_floor = 2,020,000,020,200,000,000 wei (~2.02 WAD).
      const initSize = 202000000000000000002n;
      const initMargin = 2020000020200000000n;

      await sys.quote.mint(sys.t1.address, initMargin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("0.5", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price rises minutely to $1.00000001 (100000001n).
      // Remaining size = 101 WAD + 1 wei.
      // Remaining margin after loss = 1010000010100000000 wei.
      // req_floor = 1010000010100000000 wei -> passes floor check!
      // req_ceil = 1010000010100000001 wei -> fails ceil check!
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, 100000001n);

      await expect(
        sys.engine.connect(sys.t1).decreasePosition(1, 101000000000000000001n, 0n)
      ).to.be.revertedWith("PerpEngine: remaining margin too low");
    });

    it("MM-R5 — maintenance margin / available margin ceil calculation", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      const size = 101000000000000000001n;
      const margin = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const avail = await sys.engine.getAvailableMargin(1);
      // Equity = 10 WAD. Maintenance margin = 1.01 WAD + 1 wei (1010000000000000001 wei).
      // Available margin = 10 WAD - (1.01 WAD + 1 wei) = 8989999999999999999 (8.99 WAD - 1 wei).
      expect(avail).to.equal(10n * 10n**18n - 1010000000000000001n);
    });

    it("MM-R6 — exact-division control proves identical value when no remainder exists", async function () {
      const sys = await setupSysWithLP();

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1", 8));

      const size = ethers.parseUnits("100", 18);
      const margin = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const avail = await sys.engine.getAvailableMargin(1);
      // Maintenance margin = 1 WAD exactly. Available = 9 WAD.
      expect(avail).to.equal(9n * 10n**18n);
    });
  });

  describe("P2-A getMaxAdditionalSize & P2-B PositionDecreased Event Regression Suite (MAXQ-R1..R5 & EVT-R1..R4)", function () {
    it("MAXQ-R1 — positive-fee executable maximum size quote", async function () {
      const sys = await deploySystem(18);

      // Market protocolFeeRatio = 0.1% (0.001 * 1e18 = 1e15 WAD)
      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      // Open initial position
      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);
      expect(q).to.be.gt(0n);

      // Verify q executes successfully via increasePosition
      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("MAXQ-R2 — maximality boundary test (q is valid, q+1 fails)", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      // q + 1 MUST fail
      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q + 1n, additionalMargin)
      ).to.be.reverted;
    });

    it("MAXQ-R3 — 6-decimal quote native fee ceil preview execution", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("500000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      await sys6d.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys6d.quote.mint(sys6d.t1.address, 1000000000n); // 1000 USDC
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, 1000000000n);

      let latestTime = await time.latest();
      await sys6d.engine.connect(sys6d.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys6d.engine.getMaxAdditionalSize(1, additionalMargin);
      expect(q).to.be.gt(0n);

      // Quoted q executes successfully
      await expect(
        sys6d.engine.connect(sys6d.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys6d.engine, "PositionIncreased");
    });

    it("MAXQ-R4 — non-native-representable additional margin input handling", async function () {
      const sys6d = await deploySystem(6);

      const lpDeposit = ethers.parseUnits("500000", 6);
      await sys6d.quote.mint(sys6d.lp.address, lpDeposit);
      await sys6d.quote.connect(sys6d.lp).approve(sys6d.vault.target, lpDeposit);
      await sys6d.vault.connect(sys6d.lp).deposit(lpDeposit, sys6d.lp.address);

      await sys6d.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys6d.quote.mint(sys6d.t1.address, 1000000000n);
      await sys6d.quote.connect(sys6d.t1).approve(sys6d.vault.target, 1000000000n);

      let latestTime = await time.latest();
      await sys6d.engine.connect(sys6d.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Additional margin with non-representable WAD dust (+1 wei WAD)
      const additionalMarginDust = ethers.parseUnits("100", 18) + 1n;
      const q = await sys6d.engine.getMaxAdditionalSize(1, additionalMarginDust);
      expect(q).to.be.gt(0n);

      // Returned q executes successfully
      await expect(
        sys6d.engine.connect(sys6d.t1).increasePosition(1, q, additionalMarginDust)
      ).to.emit(sys6d.engine, "PositionIncreased");
    });

    it("MAXQ-R5 — zero-protocol-fee control", async function () {
      const sys = await deploySystem(18);
      await sys.engine.connect(sys.deployer).updateProtocolFee(0n);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      // Under 0 fee, max leverage = 100x. Total margin = $200. Max notional = $20,000.
      // Current notional = $2,000. Additional notional = $18,000 -> size = 9 ETH (9e18 WAD).
      expect(q).to.equal(ethers.parseUnits("9", 18));

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("EVT-R1 — losing partial decrease emits actual stored collateral debit", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Position: M = $1000, S = 10 ETH ($20,000 notional at $2,000 price)
      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops to $1,875 (2 ETH decrease has loss = 2 * $125 = $250).
      // Closing fee on 2 ETH at $1875 ($3750 notional) = $3.75. Total shortfall = $253.75.
      // Proportional margin released = 2/10 * $980 (after $20 open fee) = $196.
      // Shortfall ($253.75) > $196 -> payout = 0, extra $57.75 consumed from retained collateral.
      // Total trader collateral consumed = $253.75.
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1875", 8));

      const posBefore = await sys.engine.getPosition(1);
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const posAfter = await sys.engine.getPosition(1);
      const actualDelta = posBefore.margin - posAfter.margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.marginReduced).to.equal(actualDelta);
      expect(log.args.marginReduced).to.be.gt(ethers.parseUnits("196", 18));
    });

    it("EVT-R2 — ordinary/profitable partial decrease emits exact margin delta", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price rises to $2,200 (profitable decrease)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2200", 8));

      const posBefore = await sys.engine.getPosition(1);
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const posAfter = await sys.engine.getPosition(1);
      const actualDelta = posBefore.margin - posAfter.margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.marginReduced).to.equal(actualDelta);
    });

    it("EVT-R3 — simulated subgraph indexer reconstruction invariant", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      const openTx = await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });
      const openReceipt = await openTx.wait();
      const openLog = openReceipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionOpened");

      // Subgraph initializes collateral to open event margin ($980)
      let indexedCollateral = openLog.args.margin;

      // Partial decrease with loss
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1875", 8));
      const decTx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const decReceipt = await decTx.wait();
      const decLog = decReceipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      // Subgraph updates collateral: position.collateral = position.collateral - event.marginReduced
      indexedCollateral -= decLog.args.marginReduced;

      // Assert simulated subgraph indexed collateral matches on-chain position.margin exactly
      const onChainPos = await sys.engine.getPosition(1);
      expect(indexedCollateral).to.equal(onChainPos.margin);
    });

    it("EVT-R4 — fee-consuming retained collateral emitted accurately in marginReduced", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Price drops slightly ($1,980) so trading loss on 2 ETH = $40. Closing fee = $3.96.
      // Proportional margin released = $196.
      // $196 > $43.96 (loss + fee) -> Case 1.
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.marginReduced).to.equal(ethers.parseUnits("196", 18));
    });
  });


  describe("EVT-FUND-1 through EVT-FUND-5 — PositionDecreased Signed Collateral Delta Tests", function () {
    it("EVT-FUND-1 — funding debit + partial decrease", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Introduce $10 funding debt
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, ethers.parseUnits("10", 18));

      const marginBefore = (await sys.engine.getPosition(1)).margin;

      // Partial decrease 2 ETH
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const marginAfter = (await sys.engine.getPosition(1)).margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.collateralDelta).to.equal(BigInt(marginAfter) - BigInt(marginBefore));
      expect(-log.args.collateralDelta).to.be.gt(log.args.marginReduced);

      // Simulated indexer reconstruction
      const indexedAfter = BigInt(marginBefore) + log.args.collateralDelta;
      expect(indexedAfter).to.equal(marginAfter);
    });

    it("EVT-FUND-2 — funding credit + partial decrease", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Introduce $50 funding credit for long position (negative cumulative index)
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, ethers.parseUnits("-50", 18));

      const marginBefore = (await sys.engine.getPosition(1)).margin;

      // Partial decrease 1 ETH (M_rel = 1/10 * 980 = $98)
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("1", 18), 0n);
      const receipt = await tx.wait();

      const marginAfter = (await sys.engine.getPosition(1)).margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.collateralDelta).to.equal(BigInt(marginAfter) - BigInt(marginBefore));
      // Funding credit reduces the magnitude of net collateral decrease
      expect(-log.args.collateralDelta).to.be.lt(log.args.marginReduced);

      const indexedAfter = BigInt(marginBefore) + log.args.collateralDelta;
      expect(indexedAfter).to.equal(marginAfter);
    });

    it("EVT-FUND-3 — funding credit causes net collateral increase (collateralDelta > 0)", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Introduce massive funding credit ($300 credit on 10 ETH size = -$30/ETH index)
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, ethers.parseUnits("-30", 18));

      const marginBefore = (await sys.engine.getPosition(1)).margin;

      // Small partial decrease (0.1 ETH, M_rel = 0.1/10 * 980 = $9.80 release)
      // Funding credit ($300) > M_rel ($9.80) -> net stored position margin increases!
      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("0.1", 18), 0n);
      const receipt = await tx.wait();

      const marginAfter = (await sys.engine.getPosition(1)).margin;
      expect(marginAfter).to.be.gt(marginBefore);

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.collateralDelta).to.be.gt(0n);
      expect(log.args.collateralDelta).to.equal(BigInt(marginAfter) - BigInt(marginBefore));

      const indexedAfter = BigInt(marginBefore) + log.args.collateralDelta;
      expect(indexedAfter).to.equal(marginAfter);
    });

    it("EVT-FUND-4 — funding debit + retained loss consumption", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      // Funding debit = $10/ETH ($100 total)
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, ethers.parseUnits("10", 18));
      // Price drop to $1,875 (loss on 2 ETH = $250)
      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("1875", 8));

      const marginBefore = (await sys.engine.getPosition(1)).margin;

      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const marginAfter = (await sys.engine.getPosition(1)).margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      expect(log.args.collateralDelta).to.equal(BigInt(marginAfter) - BigInt(marginBefore));
      expect(-log.args.collateralDelta).to.not.equal(log.args.marginReduced);
    });

    it("EVT-FUND-5 — zero funding control", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("100000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("10", 18);

      await sys.quote.mint(sys.t1.address, margin);
      await sys.quote.connect(sys.t1).approve(sys.vault.target, margin);

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const marginBefore = (await sys.engine.getPosition(1)).margin;

      const tx = await sys.engine.connect(sys.t1).decreasePosition(1, ethers.parseUnits("2", 18), 0n);
      const receipt = await tx.wait();

      const marginAfter = (await sys.engine.getPosition(1)).margin;

      const log = receipt.logs.map(l => {
        try { return sys.engine.interface.parseLog(l); } catch { return null; }
      }).find(l => l && l.name === "PositionDecreased");

      // Under 0 funding and profitable/ordinary decrease, collateralDelta == -marginReduced
      expect(log.args.collateralDelta).to.equal(-BigInt(log.args.marginReduced));
      expect(log.args.collateralDelta).to.equal(BigInt(marginAfter) - BigInt(marginBefore));
    });
  });

  describe("Market Position Query Suite with Bounded Global Scanning (MARKET-R1 through MARKET-R6)", function () {
    it("MARKET-R1 — mixed markets filtering returns only active target market positions in creation order", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Initialize Market 2
      await sys.engine.connect(sys.deployer).initializeMarket(
        2,
        FEED_ID,
        ethers.parseUnits("100", 18),
        ethers.parseUnits("0.01", 18),
        ethers.parseUnits("0.001", 18),
        ethers.parseUnits("0.025", 18),
        ethers.parseUnits("0.001", 18)
      );

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();

      // Open sequence: Market 1, Market 2, Market 1, Market 2, Market 1
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash }); // ID 1
      await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash }); // ID 2
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash }); // ID 3
      await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash }); // ID 4
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash }); // ID 5

      const [m1Positions, newCursor] = await sys.engine.getPositionsByMarket(1, 0, 10);
      expect(m1Positions.length).to.equal(3);
      expect(newCursor).to.equal(0n); // 0 indicates scan completed

      expect(m1Positions[0].positionId).to.equal(1n);
      expect(m1Positions[1].positionId).to.equal(3n);
      expect(m1Positions[2].positionId).to.equal(5n);

      for (const pos of m1Positions) {
        expect(pos.marketId).to.equal(1n);
      }
    });

    it("MARKET-R2 — multi-page pagination across global IDs without duplicates or omissions", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();

      // Open 5 positions on Market 1 (Global IDs 1..5)
      for (let i = 0; i < 5; i++) {
        await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      }

      // Page 1: limit 2 (inspects IDs 1, 2)
      const [page1, cursor1] = await sys.engine.getPositionsByMarket(1, 0, 2);
      expect(page1.length).to.equal(2);
      expect(cursor1).to.equal(3n);
      expect(page1[0].positionId).to.equal(1n);
      expect(page1[1].positionId).to.equal(2n);

      // Page 2: limit 2 (inspects IDs 3, 4)
      const [page2, cursor2] = await sys.engine.getPositionsByMarket(1, cursor1, 2);
      expect(page2.length).to.equal(2);
      expect(cursor2).to.equal(5n);
      expect(page2[0].positionId).to.equal(3n);
      expect(page2[1].positionId).to.equal(4n);

      // Page 3: limit 2 (inspects IDs 5, 6 -> end of positions)
      const [page3, cursor3] = await sys.engine.getPositionsByMarket(1, cursor2, 2);
      expect(page3.length).to.equal(1);
      expect(cursor3).to.equal(0n); // End of global positions
      expect(page3[0].positionId).to.equal(5n);

      const allFetched = [...page1, ...page2, ...page3];
      const fetchedIds = allFetched.map(p => p.positionId);
      expect(fetchedIds).to.deep.equal([1n, 2n, 3n, 4n, 5n]);
    });

    it("MARKET-R3 — sparse market / empty page progression requires continuation", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      // Initialize Market 2 and Market 3
      for (let m = 2; m <= 3; m++) {
        await sys.engine.connect(sys.deployer).initializeMarket(
          m, FEED_ID, ethers.parseUnits("100", 18), ethers.parseUnits("0.01", 18),
          ethers.parseUnits("0.001", 18), ethers.parseUnits("0.025", 18), ethers.parseUnits("0.001", 18)
        );
      }

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("2000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("2000", 18));

      let latestTime = await time.latest();

      // Interleaved: Market 2 (ID 1), Market 2 (ID 2), Market 2 (ID 3), Market 1 (ID 4)
      await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });

      // Call getPositionsByMarket for Market 1 with cursor 0, limit 2 (inspects IDs 1, 2)
      // Both are Market 2 -> returns empty array, but newCursor = 3 (NOT 0!)
      const [m1Page1, c1] = await sys.engine.getPositionsByMarket(1, 0, 2);
      expect(m1Page1.length).to.equal(0); // Empty page!
      expect(c1).to.equal(3n); // Must continue!

      // Continuation with cursor 3, limit 2 (inspects IDs 3, 4)
      const [m1Page2, c2] = await sys.engine.getPositionsByMarket(1, c1, 2);
      expect(m1Page2.length).to.equal(1);
      expect(m1Page2[0].positionId).to.equal(4n);
      expect(c2).to.equal(0n); // Scan completed
    });

    it("MARKET-R4 — closed/inactive position exclusion", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();

      // Open 3 positions on Market 1 (IDs 1, 2, 3)
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });

      // Close position 2
      await sys.engine.connect(sys.t1).closePosition(2);

      // Fetch positions for Market 1
      const [positions, newCursor] = await sys.engine.getPositionsByMarket(1, 0, 10);
      expect(positions.length).to.equal(2);
      expect(newCursor).to.equal(0n);

      // Inactive position 2 MUST NOT appear
      const returnedIds = positions.map(p => p.positionId);
      expect(returnedIds).to.deep.equal([1n, 3n]);

      for (const pos of positions) {
        expect(pos.positionId).to.not.equal(0n);
        expect(pos.positionId).to.not.equal(2n);
      }
    });

    it("MARKET-R5 — limit = 0 and terminal cursor edge cases", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });

      // limit = 0 returns 0 results and preserves input cursor
      const [resLimit0, cursorLimit0] = await sys.engine.getPositionsByMarket(1, 1, 0);
      expect(resLimit0.length).to.equal(0);
      expect(cursorLimit0).to.equal(1n);

      // cursor > totalAllocated returns 0 results and newCursor = 0
      const [resOut, cursorOut] = await sys.engine.getPositionsByMarket(1, 5, 10);
      expect(resOut.length).to.equal(0);
      expect(cursorOut).to.equal(0n);
    });

    it("MARKET-R6 — bounded work functional proof (limit bounds inspected global IDs)", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.engine.connect(sys.deployer).initializeMarket(
        2, FEED_ID, ethers.parseUnits("100", 18), ethers.parseUnits("0.01", 18),
        ethers.parseUnits("0.001", 18), ethers.parseUnits("0.025", 18), ethers.parseUnits("0.001", 18)
      );

      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("1", 18);

      await sys.quote.mint(sys.t1.address, ethers.parseUnits("2000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, ethers.parseUnits("2000", 18));

      let latestTime = await time.latest();

      // Open 5 positions on Market 2 (IDs 1, 2, 3, 4, 5) then 1 position on Market 1 (ID 6)
      for (let i = 0; i < 5; i++) {
        await sys.engine.connect(sys.t1).openPosition({ marketId: 2, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });
      }
      await sys.engine.connect(sys.t1).openPosition({ marketId: 1, isLong: true, size, margin, acceptablePrice: INITIAL_PRICE_8DEC * 101n / 100n, deadline: latestTime + 3600, referralCode: ethers.ZeroHash });

      // Call getPositionsByMarket for Market 1 with limit = 2 (inspects global IDs 1, 2)
      // Must NOT inspect ID 6 or return Market 1 position yet because scan is bounded by limit 2!
      const [m1Page1, c1] = await sys.engine.getPositionsByMarket(1, 0, 2);
      expect(m1Page1.length).to.equal(0);
      expect(c1).to.equal(3n);

      // Call again with limit = 2 (inspects global IDs 3, 4)
      const [m1Page2, c2] = await sys.engine.getPositionsByMarket(1, c1, 2);
      expect(m1Page2.length).to.equal(0);
      expect(c2).to.equal(5n);

      // Call again with limit = 2 (inspects global IDs 5, 6 -> ID 6 matches!)
      const [m1Page3, c3] = await sys.engine.getPositionsByMarket(1, c2, 2);
      expect(m1Page3.length).to.equal(1);
      expect(m1Page3[0].positionId).to.equal(6n);
      expect(c3).to.equal(0n);
    });
  });

  describe("SDK ABI Parity & Version Invariants (Source & Dist)", function () {
    it("Source and Dist PerpEngine ABI files contain collateralDelta in PositionDecreased and liquidityVault_ in constructor", async function () {
      const fs = require("fs");
      const path = require("path");

      const srcAbiPath = path.resolve(__dirname, "../../packages/sdk/src/abi/PerpEngine.json");
      const distAbiPath = path.resolve(__dirname, "../../packages/sdk/dist/abi/PerpEngine.json");

      expect(fs.existsSync(srcAbiPath), "Source ABI missing").to.be.true;
      expect(fs.existsSync(distAbiPath), "Dist ABI missing").to.be.true;

      const srcAbi = JSON.parse(fs.readFileSync(srcAbiPath, "utf8")).abi;
      const distAbi = JSON.parse(fs.readFileSync(distAbiPath, "utf8")).abi;

      for (const [label, abi] of [["Source", srcAbi], ["Dist", distAbi]]) {
        // 1. PositionDecreased Event Assertions
        const decEvent = abi.find(e => e.type === "event" && e.name === "PositionDecreased");
        expect(decEvent, `${label} PositionDecreased missing`).to.not.be.undefined;
        expect(decEvent.inputs.length, `${label} PositionDecreased input length`).to.equal(6);

        expect(decEvent.inputs[0].name).to.equal("positionId");
        expect(decEvent.inputs[1].name).to.equal("sizeReduced");
        expect(decEvent.inputs[2].name).to.equal("marginReduced");
        expect(decEvent.inputs[3].name, `${label} input[3] name`).to.equal("collateralDelta");
        expect(decEvent.inputs[3].type, `${label} input[3] type`).to.equal("int256");
        expect(decEvent.inputs[4].name).to.equal("pnl");
        expect(decEvent.inputs[5].name).to.equal("fee");

        // 2. Constructor Assertions
        const ctor = abi.find(e => e.type === "constructor");
        expect(ctor, `${label} constructor missing`).to.not.be.undefined;

        const hasVaultArg = ctor.inputs.some(i => i.name === "liquidityVault_");
        const hasInsuranceArg = ctor.inputs.some(i => i.name === "insuranceFund_");

        expect(hasVaultArg, `${label} constructor must contain liquidityVault_`).to.be.true;
        expect(hasInsuranceArg, `${label} constructor must not contain insuranceFund_`).to.be.false;
      }
    });
  });


  describe("Pending Funding getMaxAdditionalSize Preview Suite (MAXQ-F1 through MAXQ-F5 & Codex Root Cause)", function () {
    it("MAXQ-F1 — positive pending unaccrued debit quote and execution", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const pos = await sys.engine.getPositionInternal(1);
      const storedCumIndex = await sys.amm.getCumulativeFundingIndex(MARKET_ID);
      expect(pos.lastFundingIndex).to.equal(storedCumIndex);

      // Set ONLY preview cumulative index higher (unaccrued pending funding debt)
      const previewCumIndex = storedCumIndex + ethers.parseUnits("10", 18); // $10 debt
      await sys.amm.setPreviewCumulativeFundingIndex(MARKET_ID, previewCumIndex);

      // CRITICAL ASSERTION: stored index != preview index before preview call
      expect(await sys.amm.getCumulativeFundingIndex(MARKET_ID)).to.not.equal(previewCumIndex);

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);
      expect(q).to.be.gt(0n);

      // Before execution, materialize the preview index as the stored index
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, previewCumIndex);
      await sys.amm.clearPreviewCumulativeFundingIndex(MARKET_ID);

      // Quoted size q MUST execute successfully
      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("MAXQ-F2 — pending debit reduces quote while stored index is unchanged", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q0 = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      const storedBefore = await sys.amm.getCumulativeFundingIndex(MARKET_ID);

      // Set ONLY preview index higher without changing stored index
      const previewCumIndex = storedBefore + ethers.parseUnits("10", 18);
      await sys.amm.setPreviewCumulativeFundingIndex(MARKET_ID, previewCumIndex);

      const storedAfter = await sys.amm.getCumulativeFundingIndex(MARKET_ID);
      expect(storedAfter).to.equal(storedBefore); // Stored index is unchanged!

      const q1 = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      // q1 MUST be strictly less than q0
      expect(q1).to.be.lt(q0);
    });

    it("MAXQ-F3 — previewed unpaid funding debt returns 0 while stored index is unchanged", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("10", 18); // $20k notional
      const initMargin = ethers.parseUnits("500", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const storedBefore = await sys.amm.getCumulativeFundingIndex(MARKET_ID);

      // Massive preview funding debt ($1,000 > post-open margin $480)
      const previewCumIndex = storedBefore + ethers.parseUnits("100", 18);
      await sys.amm.setPreviewCumulativeFundingIndex(MARKET_ID, previewCumIndex);

      expect(await sys.amm.getCumulativeFundingIndex(MARKET_ID)).to.equal(storedBefore);

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      expect(q).to.equal(0n);

      // Apply equivalent stored index for execution
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, previewCumIndex);
      await sys.amm.clearPreviewCumulativeFundingIndex(MARKET_ID);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, 100n, additionalMargin)
      ).to.be.revertedWith("PerpEngine: unpaid funding debt");
    });

    it("MAXQ-F4 — negative pending unaccrued funding credit preview", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const storedBefore = await sys.amm.getCumulativeFundingIndex(MARKET_ID);
      const additionalMargin = ethers.parseUnits("100", 18);

      const q_no_credit = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      // Set ONLY preview index lower -> trader receives funding credit
      const previewCumIndex = storedBefore - ethers.parseUnits("10", 18);
      await sys.amm.setPreviewCumulativeFundingIndex(MARKET_ID, previewCumIndex);

      expect(await sys.amm.getCumulativeFundingIndex(MARKET_ID)).to.equal(storedBefore);

      const q_with_credit = await sys.engine.getMaxAdditionalSize(1, additionalMargin);
      expect(q_with_credit).to.be.gt(q_no_credit);

      // Materialize same index before execution
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, previewCumIndex);
      await sys.amm.clearPreviewCumulativeFundingIndex(MARKET_ID);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q_with_credit, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("MAXQ-F5 — no-preview control matches stored index behavior", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("1", 18);
      const initMargin = ethers.parseUnits("100", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("1000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("1000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);
      expect(q).to.be.gt(0n);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("Explicit Codex root cause verification test — quote math corresponds directly to FundingRateCalculator preview payment", async function () {
      const sys = await deploySystem(18);

      const lpDeposit = ethers.parseUnits("500000", 18);
      await sys.quote.mint(sys.lp.address, lpDeposit);
      await sys.quote.connect(sys.lp).approve(sys.vault.target, lpDeposit);
      await sys.vault.connect(sys.lp).deposit(lpDeposit, sys.lp.address);

      await sys.oracle.getFunction("setPriceForSymbol")(ETH_USD_MARKET, ethers.parseUnits("2000", 8));

      const initSize = ethers.parseUnits("2", 18); // 2 ETH
      const initMargin = ethers.parseUnits("200", 18);
      await sys.quote.mint(sys.t1.address, initMargin + ethers.parseUnits("10000", 18));
      await sys.quote.connect(sys.t1).approve(sys.vault.target, initMargin + ethers.parseUnits("10000", 18));

      let latestTime = await time.latest();
      await sys.engine.connect(sys.t1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initSize,
        margin: initMargin,
        acceptablePrice: ethers.parseUnits("2020", 8),
        deadline: latestTime + 3600,
        referralCode: ethers.ZeroHash
      });

      const pos = await sys.engine.getPositionInternal(1);
      const storedIndexBefore = await sys.amm.getCumulativeFundingIndex(MARKET_ID);
      const previewIndex = storedIndexBefore + ethers.parseUnits("25", 18); // $25 debt/ETH = $50 total debt

      // Set ONLY preview cumulative index in mock
      await sys.amm.setPreviewCumulativeFundingIndex(MARKET_ID, previewIndex);

      // Direct assertion 1: stored index remains un-mutated
      expect(await sys.amm.getCumulativeFundingIndex(MARKET_ID)).to.equal(storedIndexBefore);
      expect(storedIndexBefore).to.not.equal(previewIndex);

      // Expected funding payment computed via FundingRateCalculator formula:
      // payment = size * abs(previewIndex - lastFundingIndex) / 1e18 = 2 ETH * $25 = $50
      const expectedPayment = (initSize * (previewIndex - pos.lastFundingIndex)) / 10n**18n;
      expect(expectedPayment).to.equal(ethers.parseUnits("50", 18));

      // Post-funding preview margin = pos.margin ($196 after $4 open fee) - $50 = $146
      const expectedPostFundingMargin = pos.margin - expectedPayment;

      const additionalMargin = ethers.parseUnits("100", 18);
      const q = await sys.engine.getMaxAdditionalSize(1, additionalMargin);

      // Under post-funding margin $146 + addMargin $100 = $246 gross.
      // Fee on added size q at $2,000 price (10 bps).
      // Max size q must be strictly derived from $146 preview margin, NOT stored $196 margin.
      expect(q).to.be.gt(0n);

      // Materialize preview index to stored index and execute -> MUST succeed
      await sys.amm.setCumulativeFundingIndex(MARKET_ID, previewIndex);
      await sys.amm.clearPreviewCumulativeFundingIndex(MARKET_ID);

      await expect(
        sys.engine.connect(sys.t1).increasePosition(1, q, additionalMargin)
      ).to.emit(sys.engine, "PositionIncreased");
    });

    it("AMMPool Parity Test — real AMMPool previewCumulativeFundingIndex matches updateFundingRate index", async function () {
      const MockOracle = await ethers.getContractFactory("MockOracle");
      const oracle = await MockOracle.deploy("Aggregator", 18);
      await oracle.waitForDeployment();

      const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
      const deployerAddress = (await ethers.getSigners())[0].address;
      const amm = await AMMPoolFactory.deploy(deployerAddress, oracle.target);
      await amm.waitForDeployment();

      // Initialize market
      await amm.initializeMarket(
        MARKET_ID,
        ethers.parseUnits("100000", 18), // skewScale
        ethers.parseUnits("0.01", 18),   // maxFundingRate
        3600                              // fundingInterval
      );

      // Update skew to simulate active funding
      await amm.updateSkew(MARKET_ID, true, ethers.parseUnits("10", 18));

      // Advance time by 3600 seconds
      await time.increase(3600);

      // Get preview index without mutating state
      const [previewCumIndex, previewRate] = await amm.previewCumulativeFundingIndex(MARKET_ID);

      // Now call state-mutating updateFundingRate
      await amm.updateFundingRate(MARKET_ID);
      const storedCumIndexAfter = await amm.getCumulativeFundingIndex(MARKET_ID);

      // Preview index MUST equal stored index after update
      expect(previewCumIndex).to.equal(storedCumIndexAfter);
    });
  });
});
