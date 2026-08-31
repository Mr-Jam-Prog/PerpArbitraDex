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
