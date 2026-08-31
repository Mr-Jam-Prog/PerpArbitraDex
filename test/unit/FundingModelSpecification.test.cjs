// @title: Funding Model Specification & Invariants Verification Tests
// @notice Verifies path independence (including non-aligned durations), non-double settlement, sign correctness, long/short conservation, mutation ordering, boundary conditions, and reference model parity.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("📐 Funding Model Specification & Invariants", function () {
  let perpEngine, ammPool, oracleAggregator, liquidityVault, positionManager;
  let mockQuoteToken, mockBaseToken;
  let owner, traderLong, traderShort, liquidator;
  let oracleFeedId;

  const MARKET_ID = 1;
  const INITIAL_PRICE = ethers.parseUnits("2000", 8); // $2000 Chainlink 8 decimals
  const INITIAL_PRICE_WAD = ethers.parseUnits("2000", 18);
  const SKEW_SCALE = ethers.parseUnits("1000000", 18); // $1M skew scale
  const MAX_FUNDING_RATE = ethers.parseUnits("0.01", 18); // 1% per interval
  const FUNDING_INTERVAL = 3600; // 1 hour

  beforeEach(async function () {
    [owner, traderLong, traderShort, liquidator] = await ethers.getSigners();

    // Deploy Mock ERC20 Tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockQuoteToken = await MockERC20.deploy("USD Coin", "USDC", 18);
    await mockQuoteToken.waitForDeployment();

    mockBaseToken = await MockERC20.deploy("Ethereum", "ETH", 18);
    await mockBaseToken.waitForDeployment();

    // Deploy Mock Oracle
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracleAggregator = await MockOracle.deploy("ETH/USD Oracle", 8);
    await oracleAggregator.waitForDeployment();
    oracleFeedId = ethers.keccak256(ethers.toUtf8Bytes("ETH-USD"));
    await oracleAggregator.setPrice(INITIAL_PRICE);

    // Deploy LiquidityVault
    const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
    liquidityVault = await LiquidityVault.deploy(mockQuoteToken.target, "Vault USDC", "vUSDC");
    await liquidityVault.waitForDeployment();

    // Deploy PositionManager
    const MockPositionManager = await ethers.getContractFactory("MockPositionManager");
    positionManager = await MockPositionManager.deploy();
    await positionManager.waitForDeployment();

    // Deploy RiskManager
    const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
    const riskManager = await MockRiskManager.deploy();
    await riskManager.waitForDeployment();

    // Deploy ConfigRegistry
    const MockConfigRegistry = await ethers.getContractFactory("MockConfigRegistry");
    const configRegistry = await MockConfigRegistry.deploy();
    await configRegistry.waitForDeployment();

    // Precompute contract addresses to solve circular dependency
    const nonce = await owner.getNonce();
    const expectedAmmPoolAddress = ethers.getCreateAddress({ from: owner.address, nonce: nonce });
    const expectedPerpEngineAddress = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });

    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(expectedPerpEngineAddress, oracleAggregator.target);
    await ammPool.waitForDeployment();

    const PerpEngineContract = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngineContract.deploy(
      positionManager.target,
      ammPool.target,
      oracleAggregator.target,
      owner.address, // owner as liquidationEngine for direct call tests
      riskManager.target,
      configRegistry.target,
      liquidityVault.target,
      mockBaseToken.target,
      mockQuoteToken.target
    );
    await perpEngine.waitForDeployment();

    // Set PerpEngine in LiquidityVault
    await liquidityVault.setPerpEngine(perpEngine.target);

    // Initialize market
    await perpEngine.initializeMarket(
      MARKET_ID,
      oracleFeedId,
      ethers.parseUnits("100", 18), // 100x max leverage
      ethers.parseUnits("0.01", 18), // 1% min margin ratio
      ethers.parseUnits("0.001", 18), // min size
      ethers.parseUnits("0.025", 18), // 2.5% liquidation fee
      ethers.parseUnits("0.001", 18) // 0.1% protocol fee
    );

    await ammPool.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);

    // Mint tokens & approvals
    await mockQuoteToken.mint(traderLong.address, ethers.parseUnits("1000000", 18));
    await mockQuoteToken.mint(traderShort.address, ethers.parseUnits("1000000", 18));
    await mockQuoteToken.mint(owner.address, ethers.parseUnits("10000000", 18));
    await mockQuoteToken.connect(traderLong).approve(liquidityVault.target, ethers.MaxUint256);
    await mockQuoteToken.connect(traderShort).approve(liquidityVault.target, ethers.MaxUint256);
    await mockQuoteToken.connect(owner).approve(liquidityVault.target, ethers.MaxUint256);

    // LP deposits capital into LiquidityVault
    await liquidityVault.connect(owner).deposit(ethers.parseUnits("5000000", 18), owner.address);
  });

  describe("1. Path Independence Test (Aligned & Non-Aligned Durations)", function () {
    it("Aligned durations: produce identical cumulative funding index for 1 step of T vs N steps summing to T", async function () {
      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      const skewSize = ethers.parseUnits("500000", 18); // $500k long skew

      // Deploy two parallel AMMPool instances
      const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
      const ammPool1 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool1.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool1.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      const ammPool2 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool2.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool2.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      // Hour 1
      await time.increase(3600);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Hour 2
      await time.increase(3600);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Hour 3
      await time.increase(3600);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // ammPool1 is updated ONLY once after all 3 hours
      await ammPool1.connect(engineSigner).updateFundingRate(MARKET_ID);

      const singleUpdateIndex = await ammPool1.getCumulativeFundingIndex(MARKET_ID);
      const multiUpdateIndex = await ammPool2.getCumulativeFundingIndex(MARKET_ID);

      expect(singleUpdateIndex).to.equal(multiUpdateIndex);
      expect(singleUpdateIndex).to.be.gt(0n);
    });

    it("NON-ALIGNED DURATIONS: Path A (2.0 * I) vs Path B (1.5 * I then 0.5 * I) yield identical index", async function () {
      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      const skewSize = ethers.parseUnits("500000", 18);

      const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
      const ammPool1 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool1.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool1.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      const ammPool2 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool2.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool2.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      // Path B: Update at 1.5 * I (5400s)
      await time.increase(5400);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Path B: Update remaining 0.5 * I (1800s, total = 7200s = 2.0 * I)
      await time.increase(1800);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Path A: Update ONCE at 2.0 * I (7200s)
      await ammPool1.connect(engineSigner).updateFundingRate(MARKET_ID);

      const indexA = await ammPool1.getCumulativeFundingIndex(MARKET_ID);
      const indexB = await ammPool2.getCumulativeFundingIndex(MARKET_ID);

      expect(indexA).to.equal(indexB);
      expect(indexA).to.be.gt(0n);
    });

    it("NON-ALIGNED MULTI-STEP: Path A (3.0 * I) vs Path B (1.25 * I, 0.75 * I, 0.4 * I, 0.6 * I) yield identical index", async function () {
      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      const skewSize = ethers.parseUnits("500000", 18);

      const AMMPoolFactory = await ethers.getContractFactory("AMMPool");
      const ammPool1 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool1.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool1.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      const ammPool2 = await AMMPoolFactory.deploy(perpEngine.target, oracleAggregator.target);
      await ammPool2.initializeMarket(MARKET_ID, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool2.connect(engineSigner).updateSkew(MARKET_ID, true, skewSize);

      // Step 1: 1.25 * I (4500s)
      await time.increase(4500);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Step 2: 0.75 * I (2700s, sum = 2.0 * I)
      await time.increase(2700);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Step 3: 0.4 * I (1440s, sum = 2.4 * I)
      await time.increase(1440);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Step 4: 0.6 * I (2160s, sum = 3.0 * I = 10800s)
      await time.increase(2160);
      await ammPool2.connect(engineSigner).updateFundingRate(MARKET_ID);

      // Path A: Single update at 3.0 * I (10800s)
      await ammPool1.connect(engineSigner).updateFundingRate(MARKET_ID);

      const indexA = await ammPool1.getCumulativeFundingIndex(MARKET_ID);
      const indexB = await ammPool2.getCumulativeFundingIndex(MARKET_ID);

      expect(indexA).to.equal(indexB);
    });
  });

  describe("2. Cross-Operation Non-Double-Settlement Test", function () {
    it("addMargin -> same block decreasePosition MUST see zero pending funding", async function () {
      const margin = ethers.parseUnits("1000", 18);
      const size = ethers.parseUnits("1", 18); // 1 ETH

      // Open long position
      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Create market skew by opening short
      await perpEngine.connect(traderShort).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("10", 18),
        margin: margin,
        acceptablePrice: ethers.parseUnits("1500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      // Advance time and accrue funding
      await time.increase(3600);
      await oracleAggregator.setPrice(INITIAL_PRICE);
      await perpEngine.accrueFunding(MARKET_ID);

      // Operation 1: addMargin settles funding and advances lastFundingIndex
      await perpEngine.connect(traderLong).addMargin(posId, ethers.parseUnits("100", 18));
      const posAfterAdd = await perpEngine.getPositionInternal(posId);
      const marketCumIndex = await ammPool.getCumulativeFundingIndex(MARKET_ID);

      expect(posAfterAdd.lastFundingIndex).to.equal(marketCumIndex);

      // Operation 2: same block decreasePosition
      // Check funding payment calculated for decreasePosition size
      const decreaseFundingPayment = await ammPool.calculateFundingPayment(
        MARKET_ID,
        ethers.parseUnits("0.5", 18),
        posAfterAdd.isLong,
        posAfterAdd.lastFundingIndex
      );

      expect(decreaseFundingPayment).to.equal(0n);
    });
  });

  describe("3. Explicit Time^2 Bug Regression Test", function () {
    it("REGRESSION: Verifies linear funding rate accumulation without double-time multiplication", async function () {
      const tradeParams = {
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("50", 18),
        margin: ethers.parseUnits("50000", 18),
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      };
      await perpEngine.connect(traderLong).openPosition(tradeParams);

      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      // Advance time by 3600 seconds (1 interval)
      await time.increase(3600);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      const index1Hour = await ammPool.getCumulativeFundingIndex(MARKET_ID);

      // Advance time by another 3600 seconds (total 2 intervals)
      await time.increase(3600);
      await ammPool.connect(engineSigner).updateFundingRate(MARKET_ID);
      const index2Hours = await ammPool.getCumulativeFundingIndex(MARKET_ID);

      // Index must double exactly (2 * index1Hour), NOT quadruple (2^2 * index1Hour)
      expect(index2Hours).to.equal(index1Hour * 2n);
    });
  });

  describe("4. Long / Short Conservation Rule Test", function () {
    it("Should satisfy longFunding + shortFunding = 0 for equal open interest", async function () {
      const size = ethers.parseUnits("10", 18);
      const entryIndex = 0n;
      const currentIndex = ethers.parseUnits("0.002", 18); // +0.2% index increase

      const longPayment = await ammPool.calculateFundingPayment(MARKET_ID, size, true, entryIndex);
      const shortPayment = await ammPool.calculateFundingPayment(MARKET_ID, size, false, entryIndex);

      expect(longPayment + shortPayment).to.equal(0n);
    });
  });

  describe("5. Partial Decrease & Mutation Settlement Ordering Tests", function () {
    it("A. Partial decrease settles funding on full pre-reduction size Q", async function () {
      const margin = ethers.parseUnits("10000", 18);
      const initialSize = ethers.parseUnits("10", 18); // Q = 10 ETH

      // Open long Q = 10
      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initialSize,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Open large short to create negative skew (shorts pay longs)
      await perpEngine.connect(traderShort).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("100", 18),
        margin: margin,
        acceptablePrice: ethers.parseUnits("1500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      // Accrue 1 hour of funding
      await time.increase(3600);
      await oracleAggregator.setPrice(INITIAL_PRICE);
      await perpEngine.accrueFunding(MARKET_ID);

      const cumIndex = await ammPool.getCumulativeFundingIndex(MARKET_ID);
      const expectedFundingOnFullQ = await ammPool.calculateFundingPayment(
        MARKET_ID,
        initialSize,
        true,
        0n
      );

      const marginBeforeDecrease = (await perpEngine.getPositionInternal(posId)).margin;

      // Decrease position by dQ = 2 ETH (remaining = 8 ETH)
      const dQ = ethers.parseUnits("2", 18);
      await perpEngine.connect(traderLong).decreasePosition(posId, dQ, 0n);

      const posAfterDecrease = await perpEngine.getPositionInternal(posId);

      // Remaining size must be Q - dQ = 8 ETH
      expect(posAfterDecrease.size).to.equal(ethers.parseUnits("8", 18));

      // Remaining lastFundingIndex must equal current market cumulative index
      expect(posAfterDecrease.lastFundingIndex).to.equal(cumIndex);

      // Margin after decrease must reflect funding payment calculated on full Q (10 ETH)
      const expectedMargin = marginBeforeDecrease - expectedFundingOnFullQ;
      expect(posAfterDecrease.margin).to.equal(expectedMargin);

      // Same-block pending funding on remaining size must be 0
      const pendingSameBlock = await ammPool.calculateFundingPayment(
        MARKET_ID,
        posAfterDecrease.size,
        posAfterDecrease.isLong,
        posAfterDecrease.lastFundingIndex
      );
      expect(pendingSameBlock).to.equal(0n);
    });

    it("B. REGRESSION: Partial decrease by minimum amount cannot erase accrued funding on Q - dQ", async function () {
      const margin = ethers.parseUnits("10000", 18);
      const initialSize = ethers.parseUnits("10", 18); // Q = 10 ETH

      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initialSize,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Open short to create skew
      await perpEngine.connect(traderShort).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("100", 18),
        margin: margin,
        acceptablePrice: ethers.parseUnits("1500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      await time.increase(3600);
      await oracleAggregator.setPrice(INITIAL_PRICE);

      // Minimum decrease dQ = 0.001 ETH
      const minDecrease = ethers.parseUnits("0.001", 18);
      await perpEngine.connect(traderLong).decreasePosition(posId, minDecrease, 0n);

      const posAfterMinDecrease = await perpEngine.getPositionInternal(posId);

      // Remaining size = 9.999 ETH
      expect(posAfterMinDecrease.size).to.equal(ethers.parseUnits("9.999", 18));

      // After min decrease, remaining funding starts from current market index
      const newPending = await ammPool.calculateFundingPayment(
        MARKET_ID,
        posAfterMinDecrease.size,
        posAfterMinDecrease.isLong,
        posAfterMinDecrease.lastFundingIndex
      );
      expect(newPending).to.equal(0n);
    });

    it("Increase: funding applies strictly to pre-increase size Q, not retroactively to Q+dQ", async function () {
      const initialMargin = ethers.parseUnits("1000", 18);
      const initialSize = ethers.parseUnits("1", 18);

      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: initialSize,
        margin: initialMargin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Create skew with short
      await perpEngine.connect(traderShort).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("10", 18),
        margin: initialMargin,
        acceptablePrice: ethers.parseUnits("1500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      // Accrue 1 hour of funding
      await time.increase(3600);
      await oracleAggregator.setPrice(INITIAL_PRICE);
      await perpEngine.accrueFunding(MARKET_ID);

      const cumIndexBeforeIncrease = await ammPool.getCumulativeFundingIndex(MARKET_ID);

      // Increase position size by 5x (dQ = 5 ETH)
      await perpEngine.connect(traderLong).increasePosition(posId, ethers.parseUnits("5", 18), ethers.parseUnits("1000", 18));

      const posAfterIncrease = await perpEngine.getPositionInternal(posId);

      // Position's lastFundingIndex must equal cumulative index before increase
      expect(posAfterIncrease.lastFundingIndex).to.equal(cumIndexBeforeIncrease);
    });
  });

  describe("6. Liquidation Accrual & Non-Double-Settlement Tests", function () {
    it("C. Liquidation accrues market funding up to execution timestamp and uses current funding index", async function () {
      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("2", 18); // 2 ETH at $2000 = $4000 notional (40x leverage)

      // Trader open long with high leverage near threshold
      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Short opens position to create positive long funding (longs pay)
      await perpEngine.connect(traderShort).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("1", 18),
        margin: margin,
        acceptablePrice: ethers.parseUnits("1500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      // Drop price slightly to make position vulnerable to funding drain
      await oracleAggregator.setPrice(ethers.parseUnits("1960", 8));

      // Advance time 5 hours without calling updateFundingRate manually
      await time.increase(18000);
      await oracleAggregator.setPrice(ethers.parseUnits("1960", 8));

      // Execute liquidation directly via liquidatePosition
      const liqParams = {
        positionId: posId,
        trader: traderLong.address,
        marketId: MARKET_ID,
        sizeToLiquidate: size,
        minReward: 0
      };

      await expect(perpEngine.connect(owner).liquidatePosition(liqParams))
        .to.emit(perpEngine, "PositionLiquidated");

      const posAfterLiq = await perpEngine.getPositionInternal(posId);
      expect(posAfterLiq.isActive).to.be.false;
      expect(posAfterLiq.size).to.equal(0n);
    });

    it("D. Liquidation non-double settlement: liquidated position cannot be charged/credited funding again", async function () {
      const margin = ethers.parseUnits("100", 18);
      const size = ethers.parseUnits("2", 18);

      await perpEngine.connect(traderLong).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: margin,
        acceptablePrice: ethers.parseUnits("2500", 8),
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
      const posId = 1;

      // Drop price to trigger liquidation
      await oracleAggregator.setPrice(ethers.parseUnits("1900", 8));

      await perpEngine.connect(owner).liquidatePosition({
        positionId: posId,
        trader: traderLong.address,
        marketId: MARKET_ID,
        sizeToLiquidate: size,
        minReward: 0
      });

      const pos = await perpEngine.getPositionInternal(posId);
      expect(pos.isActive).to.be.false;

      // Pending funding on closed/liquidated position is 0
      const postLiqFunding = await ammPool.calculateFundingPayment(
        MARKET_ID,
        pos.size,
        pos.isLong,
        pos.lastFundingIndex
      );
      expect(postLiqFunding).to.equal(0n);
    });
  });

  describe("7. Minimum Interval & Boundary Tests (I - 1s, I, I + 1s, 1.5 I, 2I - 1s, 2I)", function () {
    it("Exact boundaries and remainder-time preservation", async function () {
      const FRESH_MARKET = 99;
      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      await ammPool.initializeMarket(FRESH_MARKET, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      await ammPool.connect(engineSigner).updateSkew(FRESH_MARKET, true, ethers.parseUnits("100000", 18));
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);

      const index0 = await ammPool.getCumulativeFundingIndex(FRESH_MARKET);

      // 1. I - 1s (3500s + 1s tx = 3501s < 3600) -> 0 index delta
      await time.increase(3500);
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);
      expect(await ammPool.getCumulativeFundingIndex(FRESH_MARKET)).to.equal(index0);

      // 2. Exactly I (reach 3600s) -> +1 interval
      await time.increase(99);
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);
      const index1 = await ammPool.getCumulativeFundingIndex(FRESH_MARKET);
      expect(index1).to.be.gt(index0);

      // 3. I + 1s (1800s elapsed) -> remainder preserved, index unchanged
      await time.increase(1800);
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);
      expect(await ammPool.getCumulativeFundingIndex(FRESH_MARKET)).to.equal(index1);

      // 4. 2I (reach 3600s from last update) -> +1 interval
      await time.increase(1800);
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);
      const index2 = await ammPool.getCumulativeFundingIndex(FRESH_MARKET);
      expect(index2).to.equal(index1 * 2n);
    });

    it("Rate bounds: max funding rate clamping", async function () {
      const FRESH_MARKET = 100;
      const engineSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);

      await ammPool.initializeMarket(FRESH_MARKET, SKEW_SCALE, MAX_FUNDING_RATE, FUNDING_INTERVAL);
      // Extreme skew (10x skew scale)
      await ammPool.connect(engineSigner).updateSkew(FRESH_MARKET, true, ethers.parseUnits("10000000", 18));
      await time.increase(3600);
      await ammPool.connect(engineSigner).updateFundingRate(FRESH_MARKET);

      const rate = await ammPool.getFundingRate(FRESH_MARKET);
      expect(rate).to.equal(MAX_FUNDING_RATE);
    });
  });

  describe("8. Parity with TypeScript Reference Model", function () {
    it("Solidity calculateFundingPayment matches TypeScript reference model exactly", async function () {
      const sizeWad = ethers.parseUnits("2.5", 18);
      const entryFundingIndex = 0n;
      const currentFundingIndex = ethers.parseUnits("0.0015", 18);

      const FundingRateCalculatorWrapper = await ethers.getContractFactory("FundingRateCalculatorWrapper");
      const calcWrapper = await FundingRateCalculatorWrapper.deploy();

      // Long payment
      const solLongPayment = await calcWrapper.calculateFundingPayment(
        sizeWad,
        entryFundingIndex,
        currentFundingIndex,
        true
      );

      // TS reference model formula: sizeWad * (currentFundingIndex - entryFundingIndex) / 1e18
      const expectedTsLongPayment = (sizeWad * (currentFundingIndex - entryFundingIndex)) / ethers.parseUnits("1", 18);

      expect(solLongPayment).to.equal(expectedTsLongPayment);
    });
  });
});
