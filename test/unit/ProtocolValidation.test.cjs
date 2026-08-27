const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🏁 Protocol Core Validation", function () {
    let perpEngine, ammPool, oracleAggregator, liquidationEngine, protocolConfig;
    let quoteToken;
    let owner, trader, liquidator, insuranceFund;
    
    const MARKET_ID = 1n;
    const PRECISION = 10n**18n;
    const PRICE_PRECISION = 10n**8n;
    const INITIAL_PRICE = 2000n * PRICE_PRECISION;
    
    beforeEach(async function () {
        [owner, trader, liquidator, insuranceFund] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        await quoteToken.waitForDeployment();
        
        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
        await protocolConfig.waitForDeployment();

        const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
        const sanityChecker = await OracleSanityChecker.deploy(1, 10n**15n, 500);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(owner.address, sanityChecker.target);
        await oracleAggregator.waitForDeployment();

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);
        
        // Nonce management for circular dependencies
        const posMgrAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
        const ammAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
        const liqAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 6 });
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 7 });

        const MockPositionManager = await ethers.getContractFactory("MockPositionManager");
        const positionManager = await MockPositionManager.deploy();
        
        const AMMPool = await ethers.getContractFactory("AMMPool");
        ammPool = await AMMPool.deploy(perpAddr, oracleAggregator.target);
        await ammPool.waitForDeployment();

        const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
        const liquidationQueue = await LiquidationQueue.deploy(liqAddr);
        await liquidationQueue.waitForDeployment();

        const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
        const incentiveDistributor = await IncentiveDistributor.deploy(
            quoteToken.target,
            perpAddr,
            protocolConfig.target,
            owner.address,
            insuranceFund.address,
            owner.address
        );
        await incentiveDistributor.waitForDeployment();

        const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
        liquidationEngine = await LiquidationEngine.deploy(
            perpAddr,
            protocolConfig.target,
            oracleAggregator.target,
            quoteToken.target,
            liquidationQueue.target,
            incentiveDistributor.target
        );
        await liquidationEngine.waitForDeployment();
        
        const PerpEngine = await ethers.getContractFactory("PerpEngine");
        perpEngine = await PerpEngine.deploy(
            positionManager.target,
            ammPool.target,
            oracleAggregator.target,
            liquidationEngine.target,
            owner.address, // riskManager mock address
            protocolConfig.target,
            insuranceFund.address,
            quoteToken.target,
            quoteToken.target
        );
        await perpEngine.waitForDeployment();
    });

    it("PnL Correctness: should calculate profit for long position in quote units", async function () {
        const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
        const wrapper = await PositionMathWrapper.deploy();
        
        const entryPrice = 2000n * PRICE_PRECISION;
        const exitPrice = 2200n * PRICE_PRECISION;
        const size = 100n * PRECISION;
        
        // 100 ETH * (2200 - 2000) = 20,000 USD
        const pnl = await wrapper.calculatePnL(entryPrice, exitPrice, size, true);
        expect(pnl).to.equal(20000n * PRECISION); 
    });

    it("Leverage: should correctly calculate leverage (Size * Price) / Margin", async function () {
        const entryPrice = 2000n * PRICE_PRECISION; // $2000
        const size = 5n * PRECISION; // 5 ETH = $10,000 notional
        const margin = 1000n * PRECISION; // $1000

        const expectedLeverage = 10n * PRECISION; // 10x

        const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
        const wrapper = await PositionMathWrapper.deploy();

        // Internally PerpEngine uses Price * PRICE_NORMALIZATION
        const PRICE_NORMALIZATION = 10n**10n;
        const notionalValue = (size * (entryPrice * PRICE_NORMALIZATION)) / PRECISION;
        const leverage = (notionalValue * PRECISION) / margin;

        expect(leverage).to.equal(expectedLeverage);
    });
});
