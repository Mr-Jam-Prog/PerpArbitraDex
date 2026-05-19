const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🛡️ Liquidation Safety & Solvency Audit", function () {
    let perpEngine, oracleAggregator, securityModule, mockOracle1, mockOracle2;
    let owner, trader, liquidator, insuranceFund, govSigner;
    let quoteToken, baseToken, positionManager, protocolConfig, ammPool, riskManager;
    let liquidationEngine, incentiveDistributor, liquidationQueue;

    const FEED_ID = ethers.encodeBytes32String("ETH/USD");
    const MARKET_ID = 1n;

    beforeEach(async function () {
        await network.provider.send("hardhat_reset");
        [owner, trader, liquidator, securityModule, insuranceFund] = await ethers.getSigners();

        const MockOracle = await ethers.getContractFactory("MockOracle");
        mockOracle1 = await MockOracle.deploy("Source 1", 8);
        await mockOracle1.waitForDeployment();
        mockOracle2 = await MockOracle.deploy("Source 2", 8);
        await mockOracle2.waitForDeployment();

        const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
        const sanityChecker = await OracleSanityChecker.deploy(1n, 10n**30n, 500);
        await sanityChecker.waitForDeployment();

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(securityModule.address, sanityChecker.target);
        await oracleAggregator.waitForDeployment();

        const source1 = {
            oracleAddress: mockOracle1.target,
            oracleType: 0, decimals: 8, heartbeat: 3600, isActive: true, lastUpdate: 0, confidence: 0
        };
        const source2 = {
            oracleAddress: mockOracle2.target,
            oracleType: 0, decimals: 8, heartbeat: 3600, isActive: true, lastUpdate: 0, confidence: 0
        };

        await oracleAggregator.addOracleSource(FEED_ID, source1);
        await oracleAggregator.addOracleSource(FEED_ID, source2);
        await oracleAggregator.configureFeed(FEED_ID, 2, 1000, 3600, false, 0);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        await quoteToken.waitForDeployment();
        baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);
        await baseToken.waitForDeployment();

        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
        await protocolConfig.waitForDeployment();

        const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
        riskManager = await MockRiskManager.deploy();
        await riskManager.waitForDeployment();

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);

        const posMgrAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce });
        const liqQueueAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });
        const distributorAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
        const liqEngineAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
        const ammAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 4 });
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 5 });

        positionManager = await (await ethers.getContractFactory("PositionManager")).deploy(perpAddr);
        await positionManager.waitForDeployment();

        liquidationQueue = await (await ethers.getContractFactory("LiquidationQueue")).deploy(liqEngineAddr);
        await liquidationQueue.waitForDeployment();

        incentiveDistributor = await (await ethers.getContractFactory("IncentiveDistributor")).deploy(
            quoteToken.target, perpAddr, protocolConfig.target, owner.address, insuranceFund.address, owner.address
        );
        await incentiveDistributor.waitForDeployment();

        liquidationEngine = await (await ethers.getContractFactory("LiquidationEngine")).deploy(
            perpAddr, protocolConfig.target, oracleAggregator.target, quoteToken.target, liqQueueAddr, distributorAddr
        );
        await liquidationEngine.waitForDeployment();

        ammPool = await (await ethers.getContractFactory("AMMPool")).deploy(perpAddr, oracleAggregator.target);
        await ammPool.waitForDeployment();

        perpEngine = await (await ethers.getContractFactory("PerpEngine")).deploy(
            posMgrAddr, ammAddr, oracleAggregator.target, liqEngineAddr, riskManager.target, protocolConfig.target, insuranceFund.address, baseToken.target, quoteToken.target
        );
        await perpEngine.waitForDeployment();

        await incentiveDistributor.setLiquidationEngine(liqEngineAddr);

        const accountsToImpersonate = [insuranceFund.address, liqEngineAddr, perpAddr];
        for (const addr of accountsToImpersonate) {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [addr],
            });
            await network.provider.send("hardhat_setBalance", [
                addr,
                "0x1000000000000000000",
            ]);
        }

        govSigner = await ethers.getSigner(insuranceFund.address);

        const price = 2000n * 10n**8n;
        await mockOracle1.setPriceForSymbol("ETH/USD", price);
        await mockOracle2.setPriceForSymbol("ETH/USD", price);
        await oracleAggregator.updatePrice(FEED_ID);

        await perpEngine.connect(govSigner).initializeMarketWithSkew(
            MARKET_ID, FEED_ID, ethers.parseUnits("100", 18), 10n**17n, 10n**15n, 5n*10n**16n, 10n**15n, 0
        );
        await ammPool.connect(owner).initializeMarket(MARKET_ID, ethers.parseUnits("100000", 18), 10n**16n, 3600);

        await quoteToken.mint(trader.address, ethers.parseUnits("100000", 18));
        await quoteToken.connect(trader).approve(perpEngine.target, ethers.MaxUint256);
    });

    describe("1. Bad Debt & Solvency", function () {
        it("Handles 30% price crash causing bankruptcy (Negative Equity)", async function () {
            await perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("10", 18),
                margin: ethers.parseUnits("2100", 18), acceptablePrice: 2200n * 10n**8n,
                deadline: (await time.latest()) + 3600, referralCode: ethers.ZeroHash
            });

            const crashPrice = 1400n * 10n**8n;
            await mockOracle1.setPriceForSymbol("ETH/USD", crashPrice);
            await mockOracle2.setPriceForSymbol("ETH/USD", crashPrice);
            await oracleAggregator.updatePrice(FEED_ID);

            const liqEngineSigner = await ethers.getSigner(liquidationEngine.target);

            await perpEngine.connect(liqEngineSigner).liquidatePosition({
                positionId: 1, trader: trader.address, marketId: MARKET_ID,
                sizeToLiquidate: ethers.parseUnits("10", 18), minReward: 0
            });

            const totalBadDebt = await perpEngine.totalBadDebt();
            expect(totalBadDebt).to.equal(ethers.parseUnits("4620", 18));

            await quoteToken.mint(insuranceFund.address, ethers.parseUnits("5000", 18));
            await quoteToken.connect(govSigner).approve(perpEngine.target, ethers.MaxUint256);

            await perpEngine.connect(govSigner).settleBadDebt(ethers.parseUnits("4620", 18));
            expect(await perpEngine.totalBadDebt()).to.equal(0);
        });
    });

    describe("2. Liquidation Incentive Synchronization", function () {
        it("Properly distributes rewards through IncentiveDistributor", async function () {
            await perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("10", 18),
                margin: ethers.parseUnits("3000", 18), acceptablePrice: 2200n * 10n**8n,
                deadline: (await time.latest()) + 3600, referralCode: ethers.ZeroHash
            });

            const dropPrice = 1800n * 10n**8n;
            await mockOracle1.setPriceForSymbol("ETH/USD", dropPrice);
            await mockOracle2.setPriceForSymbol("ETH/USD", dropPrice);
            await oracleAggregator.updatePrice(FEED_ID);

            const hf = await perpEngine.getHealthFactor(1);
            const perpEngineSigner = await ethers.getSigner(perpEngine.target);

            await liquidationEngine.connect(perpEngineSigner).queueLiquidation(1, hf);

            await time.increase(1000);

            const liquidatorBalanceBefore = await quoteToken.balanceOf(liquidator.address);
            await liquidationEngine.connect(liquidator).executeLiquidation(1, 0);
            const liquidatorBalanceAfter = await quoteToken.balanceOf(liquidator.address);

            expect(liquidatorBalanceAfter).to.be.gt(liquidatorBalanceBefore);

            const stats = await incentiveDistributor.rewardStats();
            expect(stats.totalDistributed).to.be.gt(0);
        });
    });
});
