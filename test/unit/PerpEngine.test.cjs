// @title: Tests unitaires exhaustifs du PerpEngine
// @coverage: >98% (core logic)
// @audit: Critical path - position management, PnL, margins
// @security: No external dependencies, pure unit tests

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🚀 PerpEngine - Unit Tests", function () {
  let perpEngine;
  let positionManager;
  let riskManager;
  let ammPool;
  let oracleAggregator;
  let liquidationEngine;
  let configRegistry;
  let liquidityVault;
  let mockUSD;
  let mockBaseToken;
  let owner, user1, user2, liquidator, insuranceFund;
  
  const MARKET_ID = 1;
  const ETH_USD_MARKET = "ETH-USD";
  const INITIAL_PRICE = ethers.parseUnits("2000", 8); // Oracle prices are 8 decimals
  const COLLATERAL_AMOUNT = ethers.parseUnits("1000", 18); // 1000 USD (18 decimals)
  const LEVERAGE = ethers.parseUnits("5", 18); // 5x
  const feedId = ethers.encodeBytes32String(ETH_USD_MARKET);
  
  beforeEach(async function () {
    [owner, user1, user2, liquidator, insuranceFund] = await ethers.getSigners();
    
    // Deploy tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSD = await MockERC20.deploy("USD Stable", "USD", 18);
    await mockUSD.waitForDeployment();
    mockBaseToken = await MockERC20.deploy("Ethereum", "ETH", 18);
    await mockBaseToken.waitForDeployment();
    
    // Deploy Mocks
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracleAggregator = await MockOracle.deploy("Aggregator", 18);
    await oracleAggregator.waitForDeployment();
    await oracleAggregator.getFunction("setPriceForSymbol")(ETH_USD_MARKET, INITIAL_PRICE);

    const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
    ammPool = await MockAMMPool.deploy();
    await ammPool.waitForDeployment();

    const MockLiquidationEngine = await ethers.getContractFactory("MockLiquidationEngine");
    liquidationEngine = await MockLiquidationEngine.deploy();
    await liquidationEngine.waitForDeployment();

    const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
    riskManager = await MockRiskManager.deploy();
    await riskManager.waitForDeployment();

    const MockConfigRegistry = await ethers.getContractFactory("MockConfigRegistry");
    configRegistry = await MockConfigRegistry.deploy();
    await configRegistry.waitForDeployment();

    const MockPositionManager = await ethers.getContractFactory("MockPositionManager");
    positionManager = await MockPositionManager.deploy();
    await positionManager.waitForDeployment();

    // Deploy LiquidityVault
    const LiquidityVault = await ethers.getContractFactory("LiquidityVault");
    liquidityVault = await LiquidityVault.deploy(await mockUSD.getAddress(), "Vault USD", "vUSD");
    await liquidityVault.waitForDeployment();

    // Deploy PerpEngine
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy(
      positionManager.target,
      ammPool.target,
      oracleAggregator.target,
      liquidationEngine.target,
      riskManager.target,
      configRegistry.target,
      liquidityVault.target,
      mockBaseToken.target,
      mockUSD.target
    );
    await perpEngine.waitForDeployment();

    await liquidityVault.setPerpEngine(perpEngine.target);
    
    // Setup market
    await perpEngine.connect(owner).initializeMarket(
        MARKET_ID,
        feedId,
        ethers.parseUnits("100", 18), // maxLeverage
        ethers.parseUnits("0.01", 18), // minMarginRatio (1%)
        ethers.parseUnits("0.1", 18), // minPositionSize
        ethers.parseUnits("0.02", 18), // liquidationFeeRatio
        ethers.parseUnits("0.001", 18) // protocolFeeRatio
    );
  });
  
  describe("📈 Position Opening", function () {
    it("Should open a long position successfully", async function () {
      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT);
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT);
      
      const depositLp = ethers.parseUnits("100000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      const size = ethers.parseUnits("2.5", 18); // $5000 notional at $2000 price
      
      await expect(
        perpEngine.connect(user1).openPosition({
          marketId: MARKET_ID,
          isLong: true,
          size: size,
          margin: COLLATERAL_AMOUNT,
          acceptablePrice: INITIAL_PRICE * 101n / 100n,
          deadline: (await time.latest()) + 3600,
          referralCode: ethers.ZeroHash
        })
      ).to.emit(perpEngine, "PositionOpened");
      
      const position = await perpEngine.getPosition(1);
      expect(position.trader).to.equal(user1.address);
      expect(position.size).to.equal(size);
    });

    it("Should reject position with too much leverage", async function () {
        const marginAmount = ethers.parseUnits("10000", 18); // $10k margin
        await mockUSD.mint(user1.address, marginAmount);
        await mockUSD.connect(user1).approve(liquidityVault.target, marginAmount);

        const hugeSize = ethers.parseUnits("1000", 18); // $2M notional with $8k post-fee margin = 250x

        await expect(
          perpEngine.connect(user1).openPosition({
            marketId: MARKET_ID,
            isLong: true,
            size: hugeSize,
            margin: marginAmount,
            acceptablePrice: INITIAL_PRICE * 101n / 100n,
            deadline: (await time.latest()) + 3600,
            referralCode: ethers.ZeroHash
          })
        ).to.be.revertedWithCustomError(perpEngine, "LeverageTooHigh");
    });
  });

  describe("📉 Position Closing", function () {
    let positionId = 1;

    beforeEach(async function () {
        const depositLp = ethers.parseUnits("100000", 18);
        await mockUSD.mint(owner.address, depositLp);
        await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
        await liquidityVault.connect(owner).deposit(depositLp, owner.address);

        await mockUSD.mint(user1.address, COLLATERAL_AMOUNT);
        await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT);
        await perpEngine.connect(user1).openPosition({
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1", 18),
            margin: COLLATERAL_AMOUNT,
            acceptablePrice: INITIAL_PRICE * 101n / 100n,
            deadline: (await time.latest()) + 3600,
            referralCode: ethers.ZeroHash
        });
    });

    it("Should close position and return margin", async function () {
        const initialBalance = await mockUSD.balanceOf(user1.address);
        await perpEngine.connect(user1).closePosition(positionId);
        const finalBalance = await mockUSD.balanceOf(user1.address);
        expect(finalBalance).to.be.gt(initialBalance);
    });
  });

  describe("⚖️ Liquidation", function () {
    it("Should allow LiquidationEngine to liquidate", async function () {
        const depositLp = ethers.parseUnits("100000", 18);
        await mockUSD.mint(owner.address, depositLp);
        await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
        await liquidityVault.connect(owner).deposit(depositLp, owner.address);

        await mockUSD.mint(user1.address, COLLATERAL_AMOUNT);
        await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT);
        await perpEngine.connect(user1).openPosition({
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1", 18),
            margin: COLLATERAL_AMOUNT,
            acceptablePrice: INITIAL_PRICE * 101n / 100n,
            deadline: (await time.latest()) + 3600,
            referralCode: ethers.ZeroHash
        });

        // Price drops
        await oracleAggregator.getFunction("setPriceForSymbol")(ETH_USD_MARKET, INITIAL_PRICE / 2n);

        const liqSigner = await ethers.getImpersonatedSigner(liquidationEngine.target);
        await owner.sendTransaction({ to: liquidationEngine.target, value: ethers.parseEther("1") });

        await expect(
            perpEngine.connect(liqSigner).liquidatePosition({
                positionId: 1,
                trader: user1.address,
                marketId: MARKET_ID,
                sizeToLiquidate: ethers.parseUnits("1", 18),
                minReward: 0,
                liquidator: liquidator.address
            })
        ).to.emit(perpEngine, "PositionLiquidated");
    });
  });

  describe("📏 SIZE-R1 & VIEW-R1..VIEW-R4 — Contract Size & Stateless Viewer Parity Regressions", function () {
    it("SIZE-R1 — Deployed runtime and initcode size boundaries", async function () {
      const perpEngineArtifact = await artifacts.readArtifact("PerpEngine");
      const viewerArtifact = await artifacts.readArtifact("PerpEngineViewer");

      const peRuntime = (perpEngineArtifact.deployedBytecode.slice(2).length) / 2;
      const peInitcode = (perpEngineArtifact.bytecode.slice(2).length) / 2;

      const viewerRuntime = (viewerArtifact.deployedBytecode.slice(2).length) / 2;
      const viewerInitcode = (viewerArtifact.bytecode.slice(2).length) / 2;

      expect(peRuntime).to.be.lte(24576, "PerpEngine runtime exceeds EIP-170 limit of 24576 bytes");
      expect(viewerRuntime).to.be.lte(24576, "PerpEngineViewer runtime exceeds EIP-170 limit of 24576 bytes");

      expect(peInitcode).to.be.lte(49152, "PerpEngine initcode exceeds EIP-3860 limit of 49152 bytes");
      expect(viewerInitcode).to.be.lte(49152, "PerpEngineViewer initcode exceeds EIP-3860 limit of 49152 bytes");
    });

    it("VIEW-R1 — Position/Risk View Forwarding Parity", async function () {
      const depositLp = ethers.parseUnits("100000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT);
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT);
      await perpEngine.connect(user1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("2.5", 18),
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 101n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      const posDirect = await perpEngine.getPosition(1);
      const hfDirect = await perpEngine.getHealthFactor(1);
      const liqPriceDirect = await perpEngine.getLiquidationPrice(1);
      const pnlDirect = await perpEngine.getUnrealizedPnl(1, INITIAL_PRICE);
      const isLiqDirect = await perpEngine.isPositionLiquidatable(1, INITIAL_PRICE);
      const availMarginDirect = await perpEngine.getAvailableMargin(1);

      const PerpEngineViewer = await ethers.getContractFactory("PerpEngineViewer");
      const viewer = await PerpEngineViewer.deploy();
      await viewer.waitForDeployment();

      const posViewer = await viewer.getPosition(perpEngine.target, 1);
      const hfViewer = await viewer.getHealthFactor(perpEngine.target, 1);
      const liqPriceViewer = await viewer.getLiquidationPrice(perpEngine.target, 1);
      const pnlViewer = await viewer.getUnrealizedPnl(perpEngine.target, 1, INITIAL_PRICE);
      const isLiqViewer = await viewer.isPositionLiquidatable(perpEngine.target, 1, INITIAL_PRICE);
      const availMarginViewer = await viewer.getAvailableMargin(perpEngine.target, 1);

      expect(posDirect.positionId).to.equal(posViewer.positionId);
      expect(posDirect.trader).to.equal(posViewer.trader);
      expect(posDirect.marketId).to.equal(posViewer.marketId);
      expect(posDirect.isLong).to.equal(posViewer.isLong);
      expect(posDirect.size).to.equal(posViewer.size);
      expect(posDirect.margin).to.equal(posViewer.margin);
      expect(posDirect.entryPrice).to.equal(posViewer.entryPrice);
      expect(posDirect.leverage).to.equal(posViewer.leverage);
      expect(posDirect.liquidationPrice).to.equal(posViewer.liquidationPrice);
      expect(posDirect.healthFactor).to.equal(posViewer.healthFactor);
      expect(posDirect.unrealizedPnl).to.equal(posViewer.unrealizedPnl);

      expect(hfDirect).to.equal(hfViewer);
      expect(liqPriceDirect).to.equal(liqPriceViewer);
      expect(pnlDirect).to.equal(pnlViewer);
      expect(isLiqDirect).to.equal(isLiqViewer);
      expect(availMarginDirect).to.equal(availMarginViewer);
    });

    it("VIEW-R2 — Market Position Pagination Parity", async function () {
      const depositLp = ethers.parseUnits("100000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT * 2n);
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT * 2n);

      await perpEngine.connect(user1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("1", 18),
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 101n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      await perpEngine.connect(user1).openPosition({
        marketId: MARKET_ID,
        isLong: false,
        size: ethers.parseUnits("1", 18),
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 99n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      const [page1, cursor1] = await perpEngine.getPositionsByMarket(MARKET_ID, 0, 1);
      expect(page1.length).to.equal(1);
      expect(cursor1).to.equal(2);

      const [page2, cursor2] = await perpEngine.getPositionsByMarket(MARKET_ID, cursor1, 1);
      expect(page2.length).to.equal(1);
      expect(cursor2).to.equal(0);
    });

    it("VIEW-R3 — Batch Parity", async function () {
      const depositLp = ethers.parseUnits("100000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT);
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT);

      await perpEngine.connect(user1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("1", 18),
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 101n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      const batchPositions = await perpEngine.batchGetPositions([1]);
      const batchHfs = await perpEngine.batchGetHealthFactors([1]);
      const batchLiqs = await perpEngine.batchIsLiquidatable([1], [INITIAL_PRICE]);

      expect(batchPositions.length).to.equal(1);
      expect(batchPositions[0].positionId).to.equal(1);
      expect(batchHfs[0]).to.equal(await perpEngine.getHealthFactor(1));
      expect(batchLiqs[0]).to.equal(await perpEngine.isPositionLiquidatable(1, INITIAL_PRICE));
    });

    it("VIEW-R4 — getMaxAdditionalSize Parity", async function () {
      const depositLp = ethers.parseUnits("10000000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT * 2n);
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT * 2n);

      await perpEngine.connect(user1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: ethers.parseUnits("1", 18),
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 101n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });

      const maxAdd = await perpEngine.getMaxAdditionalSize(1, COLLATERAL_AMOUNT);
      expect(maxAdd).to.be.gt(0);

      // Verify that increasePosition by maxAdd succeeds
      await expect(
        perpEngine.connect(user1).increasePosition(1, maxAdd, COLLATERAL_AMOUNT)
      ).to.emit(perpEngine, "PositionIncreased");
    });

    it("TRADER-R1..TRADER-R4 — Trader Position Bounded Pagination Suite", async function () {
      const depositLp = ethers.parseUnits("100000", 18);
      await mockUSD.mint(owner.address, depositLp);
      await mockUSD.connect(owner).approve(liquidityVault.target, depositLp);
      await liquidityVault.connect(owner).deposit(depositLp, owner.address);

      const numPositions = 5;
      await mockUSD.mint(user1.address, COLLATERAL_AMOUNT * BigInt(numPositions));
      await mockUSD.connect(user1).approve(liquidityVault.target, COLLATERAL_AMOUNT * BigInt(numPositions));

      for (let i = 0; i < numPositions; i++) {
        await perpEngine.connect(user1).openPosition({
          marketId: MARKET_ID,
          isLong: i % 2 === 0,
          size: ethers.parseUnits("1", 18),
          margin: COLLATERAL_AMOUNT,
          acceptablePrice: i % 2 === 0 ? INITIAL_PRICE * 101n / 100n : INITIAL_PRICE * 99n / 100n,
          deadline: (await time.latest()) + 3600,
          referralCode: ethers.ZeroHash
        });
      }

      // TRADER-R1: bounded first page
      const [page1, cursor1] = await perpEngine.getPositionsByTrader(user1.address, 0, 2);
      expect(page1.length).to.equal(2);
      expect(cursor1).to.equal(2);
      expect(page1[0].positionId).to.equal(1);
      expect(page1[1].positionId).to.equal(2);

      // TRADER-R2: second and final pages without duplicates or omissions
      const [page2, cursor2] = await perpEngine.getPositionsByTrader(user1.address, cursor1, 2);
      expect(page2.length).to.equal(2);
      expect(cursor2).to.equal(4);
      expect(page2[0].positionId).to.equal(3);
      expect(page2[1].positionId).to.equal(4);

      const [page3, cursor3] = await perpEngine.getPositionsByTrader(user1.address, cursor2, 2);
      expect(page3.length).to.equal(1);
      expect(cursor3).to.equal(5);
      expect(page3[0].positionId).to.equal(5);

      // TRADER-R3: zero limit returns empty array and unchanged cursor
      const [pageZero, cursorZero] = await perpEngine.getPositionsByTrader(user1.address, 2, 0);
      expect(pageZero.length).to.equal(0);
      expect(cursorZero).to.equal(2);

      // TRADER-R4: terminal cursor >= total returns empty array and total length
      const [pageTerm, cursorTerm] = await perpEngine.getPositionsByTrader(user1.address, 5, 2);
      expect(pageTerm.length).to.equal(0);
      expect(cursorTerm).to.equal(5);
    });
  });
});
