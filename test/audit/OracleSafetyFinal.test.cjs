const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🛡️ Final Oracle Safety Audit", function () {
    let perpEngine, oracleAggregator, securityModule, mockOracle1, mockOracle2;
    let owner, trader, insuranceFund, liquidationEngine;
    let quoteToken, baseToken, positionManager, protocolConfig, ammPool, riskManager;

    const FEED_ID = ethers.encodeBytes32String("ETH/USD");
    const MARKET_ID = 1n;

    beforeEach(async function () {
        [owner, trader, securityModule, insuranceFund, liquidationEngine] = await ethers.getSigners();

        // Setup Oracles
        const MockOracle = await ethers.getContractFactory("MockOracle");
        mockOracle1 = await MockOracle.deploy("Source 1", 8);
        mockOracle2 = await MockOracle.deploy("Source 2", 8);

        const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
        const sanityChecker = await OracleSanityChecker.deploy(1n, 10n**30n, 500);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(securityModule.address, sanityChecker.target);

        // Add sources
        await oracleAggregator.addOracleSource(FEED_ID, {
            oracleAddress: mockOracle1.target,
            oracleType: 0, // CHAINLINK
            decimals: 8,
            heartbeat: 300, // 5 min
            isActive: true,
            lastUpdate: 0,
            confidence: 0
        });
        await oracleAggregator.addOracleSource(FEED_ID, {
            oracleAddress: mockOracle2.target,
            oracleType: 0, // CHAINLINK
            decimals: 8,
            heartbeat: 300, // 5 min
            isActive: true,
            lastUpdate: 0,
            confidence: 0
        });

        // Config: 2 sources required, 2% deviation, 60s staleness
        await oracleAggregator.configureFeed(FEED_ID, 2, 200, 60, false, 0);

        // Core Protocol Setup
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);

        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);

        const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
        ammPool = await MockAMMPool.deploy();

        const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
        riskManager = await MockRiskManager.deploy();

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });

        const PositionManager = await ethers.getContractFactory("PositionManager");
        positionManager = await PositionManager.deploy(perpAddr);

        const PerpEngine = await ethers.getContractFactory("PerpEngine");
        perpEngine = await PerpEngine.deploy(
            positionManager.target,
            ammPool.target,
            oracleAggregator.target,
            liquidationEngine.address, // Real address for test
            riskManager.target,
            protocolConfig.target,
            insuranceFund.address,
            baseToken.target,
            quoteToken.target
        );

        const govSigner = await ethers.getImpersonatedSigner(insuranceFund.address);
        await owner.sendTransaction({ to: insuranceFund.address, value: ethers.parseEther("1") });

        await perpEngine.connect(govSigner).initializeMarket(
            MARKET_ID,
            FEED_ID,
            10n**19n, // 10x
            10n**16n, // 1%
            10n**18n, // 1 unit
            10n**16n, // 1%
            10n**15n  // 0.1%
        );

        await quoteToken.mint(trader.address, ethers.parseUnits("10000", 18));
        await quoteToken.connect(trader).approve(perpEngine.target, ethers.MaxUint256);
    });

    describe("1. Future & Stale Timestamp Rejection", function () {
        it("OracleAggregator.updatePrice (push) rejects future timestamps", async function () {
            const future = (await time.latest()) + 1000;
            await expect(
                oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                    FEED_ID, 2000n * 10n**8n, future, 0
                )
            ).to.be.revertedWith("OracleAggregator: future timestamp");
        });

        it("OracleAggregator.updatePrice (push) rejects stale timestamps", async function () {
            const stale = (await time.latest()) - 100; // config is 60s
            await expect(
                oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                    FEED_ID, 2000n * 10n**8n, stale, 0
                )
            ).to.be.revertedWith("OracleAggregator: stale price");
        });

        it("OracleAggregator.updatePrice (pull) ignores future/stale source timestamps", async function () {
            // Set source 1 to valid
            const now = await time.latest();
            await mockOracle1.setFullPriceData(2000n * 10n**8n, now, 0, true);
            // Set source 2 to future
            await mockOracle2.setFullPriceData(2100n * 10n**8n, now + 1000, 0, true);

            // Pull update - should fail because only 1 valid source left
            await expect(
                oracleAggregator.updatePrice(FEED_ID)
            ).to.be.revertedWith("OracleAggregator: insufficient valid sources");
        });
    describe("2. Configurable maxPriceDelay", function () {
        it("Correctly updates and enforces new maxStaleness", async function () {
            const now = await time.latest();
            const price = 2000n * 10n**8n;

            // Push valid price (50s old, limit is 60s)
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now - 50, 0
            );
            expect(await oracleAggregator.isPriceStale(FEED_ID)).to.be.false;

            // Tighten config to 30s
            await oracleAggregator.configureFeed(FEED_ID, 2, 200, 30, false, 0);
            expect(await oracleAggregator.isPriceStale(FEED_ID)).to.be.true;
            expect(await oracleAggregator.getPrice(FEED_ID)).to.equal(0);
        });

        it("Stale Oracle Attack (Time Manipulation)", async function () {
            const now = await time.latest();
            const price = 2000n * 10n**8n;

            // Push valid price
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );

            // Wait until just before stale
            await time.increase(59);
            expect(await oracleAggregator.getPrice(FEED_ID)).to.equal(price);

            // One more second -> STALE
            await time.increase(2);
            expect(await oracleAggregator.getPrice(FEED_ID)).to.equal(0);
            expect(await oracleAggregator.isPriceStale(FEED_ID)).to.be.true;
        });

        it("Delayed Oracle Update (Flash Loan / Atomic Attack Resistance)", async function () {
            const now = await time.latest();
            const stalePrice = 1000n * 10n**8n;

            // Try to push an update that is already stale (delayed by 1 hour)
            await expect(
                oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                    FEED_ID, stalePrice, now - 3600, 0
                )
            ).to.be.revertedWith("OracleAggregator: stale price");
        });
    });

    describe("3. Trading Halt on Invalid Price", function () {
        it("PerpEngine.openPosition reverts on stale price", async function () {
            const now = await time.latest();
            const price = 2000n * 10n**8n;

            // Push price
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );

            // Move time past staleness
            await time.increase(100);

            await expect(
                perpEngine.connect(trader).openPosition({
                    marketId: MARKET_ID,
                    isLong: true,
                    size: ethers.parseUnits("1", 18),
                    margin: ethers.parseUnits("1000", 18),
                    acceptablePrice: 2100n * 10n**8n,
                    deadline: now + 3600,
                    referralCode: ethers.ZeroHash
                })
            ).to.be.revertedWith("PerpEngine: invalid price");
        });
    });

    describe("4. Liquidation Halt on Invalid Price", function () {
        it("PerpEngine.liquidatePosition reverts on stale price", async function () {
            const now = await time.latest();
            const price = 2000n * 10n**8n;

            // 1. Open healthy position
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );
            await perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID,
                isLong: true,
                size: ethers.parseUnits("1", 18),
                margin: ethers.parseUnits("1000", 18),
                acceptablePrice: 2100n * 10n**8n,
                deadline: now + 3600,
                referralCode: ethers.ZeroHash
            });

            // 2. Make it liquidatable (price drop)
            const lowPrice = 1500n * 10n**8n;
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, lowPrice, now + 1, 0
            );

            // 3. Move time past staleness
            await time.increase(100);

            // 4. Try liquidate
            await expect(
                perpEngine.connect(liquidationEngine).liquidatePosition({
                    positionId: 1,
                    trader: trader.address,
                    marketId: MARKET_ID,
                    sizeToLiquidate: ethers.parseUnits("1", 18),
                    minReward: 0
                })
            ).to.be.revertedWith("PerpEngine: invalid price");
        });
    });

    describe("5. Simulations", function () {
        it("Conflicting Oracle Sources (Deviation Attack)", async function () {
            const now = await time.latest();
            // Source 1: 2000
            await mockOracle1.setFullPriceData(2000n * 10n**8n, now, 0, true);
            // Source 2: 2100 (5% deviation, limit is 2%)
            await mockOracle2.setFullPriceData(2100n * 10n**8n, now, 0, true);

            // Pull update
            await oracleAggregator.updatePrice(FEED_ID);

            const aggPrice = await oracleAggregator.getAggregatedPrice(FEED_ID);
            expect(aggPrice.status).to.equal(1); // DISPUTED

            expect(await oracleAggregator.isPriceStale(FEED_ID)).to.be.true;
            expect(await oracleAggregator.getPrice(FEED_ID)).to.equal(0);
        });
    });
});
});
