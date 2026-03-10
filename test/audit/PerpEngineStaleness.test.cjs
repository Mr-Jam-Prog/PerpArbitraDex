const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PerpEngine Staleness Protection", function () {
    let perpEngine, oracleAggregator, securityModule, mockOracle;
    let owner, trader, insuranceFund;
    const FEED_ID = ethers.encodeBytes32String("ETH/USD");
    const MARKET_ID = 1n;

    beforeEach(async function () {
        [owner, trader, securityModule, insuranceFund] = await ethers.getSigners();

        // Mocks
        const MockOracle = await ethers.getContractFactory("MockOracle");
        mockOracle = await MockOracle.deploy("Source", 8);

        const MockSanityChecker = await ethers.getContractFactory("MockOracle");
        const sanityChecker = await MockSanityChecker.deploy("Sanity", 18);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(securityModule.address, sanityChecker.target);

        await oracleAggregator.addOracleSource(FEED_ID, {
            oracleAddress: mockOracle.target,
            oracleType: 0,
            decimals: 8,
            heartbeat: 3600,
            isActive: true,
            lastUpdate: 0,
            confidence: 0
        });
        await oracleAggregator.configureFeed(FEED_ID, 1, 200, 60, false, 0); // 60s staleness

        // Core contracts
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        const baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);

        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        const protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);

        // Minimal deployment for PerpEngine
        const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
        const ammPool = await MockAMMPool.deploy();

        const MockLiquidationEngine = await ethers.getContractFactory("MockLiquidationEngine");
        const liquidationEngine = await MockLiquidationEngine.deploy();

        const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
        const riskManager = await MockRiskManager.deploy();

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
            liquidationEngine.target,
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

        // Mint and approve
        await quoteToken.mint(trader.address, ethers.parseUnits("10000", 18));
        await quoteToken.connect(trader).approve(perpEngine.target, ethers.MaxUint256);
    });

    it("Should revert openPosition if price is stale", async function () {
        const price = ethers.parseUnits("2000", 8);
        const now = await time.latest();

        // Push a price that is almost stale (50s ago, limit is 60s)
        await oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
            FEED_ID, price, now - 50, 0
        );

        // This should pass
        await perpEngine.connect(trader).openPosition({
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1", 18),
            margin: ethers.parseUnits("1000", 18),
            acceptablePrice: ethers.parseUnits("2100", 8),
            deadline: now + 3600,
            referralCode: ethers.ZeroHash
        });

        // Advance time so price becomes stale
        await time.increase(20); // now is -70 relative to price timestamp

        await expect(
            perpEngine.connect(trader).openPosition({
                marketId: MARKET_ID,
                isLong: true,
                size: ethers.parseUnits("1", 18),
                margin: ethers.parseUnits("1000", 18),
                acceptablePrice: ethers.parseUnits("2100", 8),
                deadline: now + 3600,
                referralCode: ethers.ZeroHash
            })
        ).to.be.revertedWith("PerpEngine: invalid price");
    });
});
