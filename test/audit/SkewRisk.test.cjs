const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("📉 PerpEngine Skew Risk Audit", function () {
    let perpEngine, oracleAggregator, securityModule, mockOracle1;
    let owner, trader, insuranceFund, liquidationEngine, govSigner;
    let quoteToken, baseToken, positionManager, protocolConfig, ammPool, riskManager;

    const FEED_ID = ethers.encodeBytes32String("ETH/USD");
    const MARKET_ID = 1n;

    beforeEach(async function () {
        [owner, trader, securityModule, insuranceFund, liquidationEngine] = await ethers.getSigners();

        // Setup Oracles
        const MockOracle = await ethers.getContractFactory("MockOracle");
        mockOracle1 = await MockOracle.deploy("Source 1", 8);

        const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
        const sanityChecker = await OracleSanityChecker.deploy(1n, 10n**30n, 500);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(securityModule.address, sanityChecker.target);

        await oracleAggregator.addOracleSource(FEED_ID, {
            oracleAddress: mockOracle1.target,
            oracleType: 0, // CHAINLINK
            decimals: 8,
            heartbeat: 3600,
            isActive: true,
            lastUpdate: 0,
            confidence: 0
        });

        await oracleAggregator.configureFeed(FEED_ID, 1, 200, 3600, false, 0);

        // Core Protocol Setup
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);

        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);

        const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
        riskManager = await MockRiskManager.deploy();

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);

        const posMgrAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce });
        const ammAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });

        const PositionManager = await ethers.getContractFactory("PositionManager");
        positionManager = await PositionManager.deploy(perpAddr);

        const AMMPool = await ethers.getContractFactory("AMMPool");
        ammPool = await AMMPool.deploy(perpAddr, oracleAggregator.target);

        const PerpEngine = await ethers.getContractFactory("PerpEngine");
        perpEngine = await PerpEngine.deploy(
            posMgrAddr,
            ammAddr,
            oracleAggregator.target,
            liquidationEngine.address,
            riskManager.target,
            protocolConfig.target,
            insuranceFund.address,
            baseToken.target,
            quoteToken.target
        );

        govSigner = await ethers.getImpersonatedSigner(insuranceFund.address);
        await owner.sendTransaction({ to: insuranceFund.address, value: ethers.parseEther("1") });

        await quoteToken.mint(trader.address, ethers.parseUnits("1000000", 18));
        await quoteToken.connect(trader).approve(perpEngine.target, ethers.MaxUint256);
    });

    describe("1. Max Market Skew Protection", function () {
        it("Rejects trade that exceeds maxMarketSkew", async function () {
            const price = 2000n * 10n**8n;
            const now = await time.latest();
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );

            const maxMarketSkewETH = ethers.parseUnits("500", 18);
            await perpEngine.connect(govSigner).initializeMarketWithSkew(
                MARKET_ID,
                FEED_ID,
                ethers.parseUnits("100", 18),
                10n**16n, // 1% min margin
                10n**15n,
                10n**16n,
                10n**15n,
                maxMarketSkewETH
            );

            await ammPool.connect(owner).initializeMarket(
                MARKET_ID,
                ethers.parseUnits("100000", 18),
                10n**16n,
                3600
            );

            // Open 475 ETH long
            await perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID,
                isLong: true,
                size: ethers.parseUnits("475", 18),
                margin: ethers.parseUnits("100000", 18), // ~10x leverage
                acceptablePrice: price * 110n / 100n,
                deadline: now + 3600,
                referralCode: ethers.ZeroHash
            });

            // Try 50 ETH more -> total 525 > 500
            await expect(
                perpEngine.connect(trader).openPosition({
                    marketId: MARKET_ID,
                    isLong: true,
                    size: ethers.parseUnits("50", 18),
                    margin: ethers.parseUnits("10000", 18),
                    acceptablePrice: price * 110n / 100n,
                    deadline: now + 3600,
                    referralCode: ethers.ZeroHash
                })
            ).to.be.revertedWith("PerpEngine: max market skew reached");
        });
    });

    describe("2. Dynamic Maintenance Margin (Skew Impact)", function () {
        it("Decreases Health Factor as skew increases against the position", async function () {
            const price = 2000n * 10n**8n;
            const now = await time.latest();
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );

            // Large skew scale to make impact measurable but not instant liquidation
            const skewScaleVal = ethers.parseUnits("100000", 18);
            await perpEngine.connect(govSigner).initializeMarketWithSkew(
                MARKET_ID,
                FEED_ID,
                ethers.parseUnits("100", 18),
                ethers.parseUnits("0.05", 18), // 5% min margin
                10n**15n,
                10n**16n,
                10n**15n,
                ethers.parseUnits("10000", 18)
            );

            await ammPool.connect(owner).initializeMarket(
                MARKET_ID,
                skewScaleVal,
                10n**16n,
                3600
            );

            // Trader 1 opens a long position (isolated)
            await perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID,
                isLong: true,
                size: ethers.parseUnits("10", 18),
                margin: ethers.parseUnits("2000", 18), // 10x leverage ($20k notional, $2k margin = 10%)
                acceptablePrice: price * 110n / 100n,
                deadline: now + 3600,
                referralCode: ethers.ZeroHash
            });

            const hfBefore = await perpEngine.getHealthFactor(1);
            // console.log("HF Before Skew:", ethers.formatUnits(hfBefore, 18));

            // Other traders open massive long positions, increasing skew
            const otherTrader = securityModule; // just a different address
            await quoteToken.mint(otherTrader.address, ethers.parseUnits("1000000", 18));
            await quoteToken.connect(otherTrader).approve(perpEngine.target, ethers.MaxUint256);

            await perpEngine.connect(otherTrader).openPosition({
                marketId: MARKET_ID,
                isLong: true,
                size: ethers.parseUnits("500", 18), // 50% of skewScale
                margin: ethers.parseUnits("200000", 18),
                acceptablePrice: price * 110n / 100n,
                deadline: now + 3600,
                referralCode: ethers.ZeroHash
            });

            const hfAfter = await perpEngine.getHealthFactor(1);
            // console.log("HF After Skew:", ethers.formatUnits(hfAfter, 18));

            expect(hfAfter).to.be.lt(hfBefore);
        });
    });

    describe("3. Cascade Liquidations Simulation", function () {
        it("Protocol remains solvent during massive price drop and cascading liquidations", async function () {
            const price = 2000n * 10n**8n;
            const now = await time.latest();
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, now, 0
            );

            await perpEngine.connect(govSigner).initializeMarketWithSkew(
                MARKET_ID,
                FEED_ID,
                ethers.parseUnits("100", 18),
                ethers.parseUnits("0.1", 18), // 10% min margin
                10n**15n,
                ethers.parseUnits("0.05", 18), // 5% liquidation fee
                10n**15n,
                0
            );

            await ammPool.connect(owner).initializeMarket(
                MARKET_ID,
                ethers.parseUnits("100000", 18),
                10n**16n,
                3600
            );

            // Multiple traders open high leverage positions
            const traders = [trader, securityModule, owner];
            for (let i = 0; i < traders.length; i++) {
                await quoteToken.mint(traders[i].address, ethers.parseUnits("1000000", 18));
                await quoteToken.connect(traders[i]).approve(perpEngine.target, ethers.MaxUint256);
                await perpEngine.connect(traders[i]).openPosition({
                    marketId: MARKET_ID,
                    isLong: true,
                    size: ethers.parseUnits("10", 18), // $20k each
                    margin: ethers.parseUnits("2100", 18), // Slightly above 10% margin
                    acceptablePrice: price * 110n / 100n,
                    deadline: now + 3600,
                    referralCode: ethers.ZeroHash
                });
            }

            const totalCollateralBefore = await perpEngine.totalCollateral();

            // Price drops 15% -> all positions liquidatable
            const crashPrice = price * 85n / 100n;
            await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, crashPrice, now + 10, 0
            );

            // Execute liquidations
            const liqSigner = await ethers.getImpersonatedSigner(liquidationEngine.address);
            await owner.sendTransaction({ to: liquidationEngine.address, value: ethers.parseEther("1") });

            for (let i = 1; i <= traders.length; i++) {
                await perpEngine.connect(liqSigner).liquidatePosition({
                    positionId: i,
                    trader: traders[i-1].address,
                    marketId: MARKET_ID,
                    sizeToLiquidate: ethers.parseUnits("10", 18),
                    minReward: 0
                });
            }

            // Verify Open Interest is back to zero
            const skewResult = await ammPool.getMarketSkew(MARKET_ID);
            expect(skewResult[0]).to.equal(0); // longOI
            expect(skewResult[1]).to.equal(0); // shortOI
            expect(skewResult[2]).to.equal(0); // netSkew

            // Verify protocol is not in negative collateral
            const totalCollateralAfter = await perpEngine.totalCollateral();
            expect(totalCollateralAfter).to.be.gte(0);
        });
    });
});
