const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🌪️ Protocol Systemic Stress Test", function () {
    let perpEngine, oracleAggregator, securityModule, mockOracle1, mockOracle2;
    let owner, trader1, trader2, trader3, liquidator, insuranceFund, govSigner;
    let quoteToken, baseToken, positionManager, protocolConfig, ammPool, riskManager;
    let liquidationEngine, incentiveDistributor, liquidationQueue;

    const FEED_ID = ethers.encodeBytes32String("ETH/USD");
    const MARKET_ID = 1n;

    beforeEach(async function () {
        await network.provider.send("hardhat_reset");
        [owner, trader1, trader2, trader3, liquidator, securityModule, insuranceFund] = await ethers.getSigners();

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
        await mockOracle1.setPrice(price);
        await mockOracle2.setPrice(price);
        await oracleAggregator.updatePrice(FEED_ID);

        await perpEngine.connect(govSigner).initializeMarketWithSkew(
            MARKET_ID, FEED_ID, ethers.parseUnits("100", 18), 10n**17n, 10n**15n, 5n*10n**16n, 10n**15n, 0
        );
        await ammPool.connect(owner).initializeMarket(MARKET_ID, ethers.parseUnits("100000", 18), 10n**16n, 3600);

        for (const trader of [trader1, trader2, trader3]) {
            await quoteToken.mint(trader.address, ethers.parseUnits("1000000", 18));
            await quoteToken.connect(trader).approve(perpEngine.target, ethers.MaxUint256);
        }
    });

    it("Scenario A: 50% Flash Crash + Cascade Liquidations", async function () {
        const traders = [trader1, trader2, trader3];
        const now = await time.latest();

        for (let i = 0; i < traders.length; i++) {
            await perpEngine.connect(traders[i]).openPosition({
                marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("50", 18),
                margin: ethers.parseUnits("20000", 18), acceptablePrice: 2200n * 10n**8n,
                deadline: now + 3600, referralCode: ethers.ZeroHash
            });
        }

        const crashPrice = 1000n * 10n**8n;
        await mockOracle1.setPrice(crashPrice);
        await mockOracle2.setPrice(crashPrice);
        await oracleAggregator.updatePrice(FEED_ID);

        const perpAddr = perpEngine.target;
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [perpAddr],
        });
        const perpSigner = await ethers.getSigner(perpAddr);

        for (let i = 1; i <= 3; i++) {
            const hf = await perpEngine.getHealthFactor(i);
            await liquidationEngine.connect(perpSigner).queueLiquidation(i, hf);
        }

        await time.increase(3600);

        await mockOracle1.setPrice(crashPrice);
        await mockOracle2.setPrice(crashPrice);
        await oracleAggregator.updatePrice(FEED_ID);

        for (let i = 1; i <= 3; i++) {
            await liquidationEngine.connect(liquidator).executeLiquidation(i, 0);
        }

        expect(await perpEngine.totalBadDebt()).to.be.gt(0);
        expect(await perpEngine.totalCollateral()).to.be.lt(ethers.parseUnits("60000", 18));
    });

    it("Scenario B: 90% Market Skew + Dynamic Maintenance Margin", async function () {
        const now = await time.latest();

        const perpAddr = perpEngine.target;
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [perpAddr],
        });
        const perpSigner = await ethers.getSigner(perpAddr);

        await ammPool.connect(perpSigner).updateSkewScale(MARKET_ID, ethers.parseUnits("20000", 18));

        await perpEngine.connect(trader1).openPosition({
            marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("10", 18),
            margin: ethers.parseUnits("10000", 18),
            acceptablePrice: 2200n * 10n**8n,
            deadline: now + 3600, referralCode: ethers.ZeroHash
        });

        const hf1 = await perpEngine.getHealthFactor(1);

        await perpEngine.connect(trader2).openPosition({
            marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("890", 18),
            margin: ethers.parseUnits("500000", 18),
            acceptablePrice: 2500n * 10n**8n,
            deadline: now + 3600, referralCode: ethers.ZeroHash
        });

        const hf2 = await perpEngine.getHealthFactor(1);
        expect(hf2).to.be.lt(hf1);

        await perpEngine.connect(govSigner).initializeMarketWithSkew(
            MARKET_ID + 1n, FEED_ID, ethers.parseUnits("100", 18), 10n**17n, 10n**15n, 5n*10n**16n, 10n**15n,
            ethers.parseUnits("1000", 18)
        );
        await ammPool.connect(owner).initializeMarket(MARKET_ID + 1n, ethers.parseUnits("100000", 18), 10n**16n, 3600);

        await expect(perpEngine.connect(trader3).openPosition({
            marketId: MARKET_ID + 1n, isLong: true, size: ethers.parseUnits("1100", 18),
            margin: ethers.parseUnits("100000", 18),
            acceptablePrice: 2500n * 10n**8n,
            deadline: (await time.latest()) + 3600, referralCode: ethers.ZeroHash
        })).to.be.revertedWith("PerpEngine: max market skew reached");
    });

    it("Scenario C: Oracle Delay/Staleness during volatility", async function () {
        const now = await time.latest();
        await perpEngine.connect(trader1).openPosition({
            marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("10", 18),
            margin: ethers.parseUnits("10000", 18),
            acceptablePrice: 2200n * 10n**8n,
            deadline: now + 3600, referralCode: ethers.ZeroHash
        });

        await oracleAggregator.connect(owner).configureFeed(FEED_ID, 2, 1000, 60, false, 0);

        await time.increase(120);

        await expect(perpEngine.connect(trader2).openPosition({
            marketId: MARKET_ID, isLong: true, size: ethers.parseUnits("10", 18),
            margin: ethers.parseUnits("5000", 18), acceptablePrice: 2200n * 10n**8n,
            deadline: (await time.latest()) + 3600, referralCode: ethers.ZeroHash
        })).to.be.revertedWith("PerpEngine: invalid price");

        const perpAddr = perpEngine.target;
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [perpAddr],
        });
        const perpSigner = await ethers.getSigner(perpAddr);

        await expect(perpEngine.getHealthFactor(1)).to.be.revertedWith("PerpEngine: invalid price");
        await expect(liquidationEngine.connect(perpSigner).queueLiquidation(1, 0)).to.be.revertedWith("PerpEngine: invalid price");
    });
});
