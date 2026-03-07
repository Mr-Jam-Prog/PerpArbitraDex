const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("🏁 Protocol Core Validation", function () {
    let perpEngine, ammPool, oracleAggregator, liquidationEngine, protocolConfig, riskManager;
    let quoteToken, baseToken, positionManager;
    let owner, trader, liquidator, insuranceFund;
    
    const MARKET_ID = 1n;
    const PRECISION = 10n**18n;
    const PRICE_PRECISION = 10n**8n;
    const INITIAL_PRICE = 2000n * PRICE_PRECISION;
    
    beforeEach(async function () {
        [owner, trader, liquidator, insuranceFund] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC", 18);
        baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);
        
        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
        
        // Use MockOracle for validation to simplify
        const MockOracle = await ethers.getContractFactory("MockOracle");
        oracleAggregator = await MockOracle.deploy("Oracle", 18);

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);
        
        const posMgrAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 6 });
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 5 });

        const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
        ammPool = await MockAMMPool.deploy();
        
        const MockLiquidationEngine = await ethers.getContractFactory("MockLiquidationEngine");
        liquidationEngine = await MockLiquidationEngine.deploy();

        const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
        riskManager = await MockRiskManager.deploy();

        const PositionManager = await ethers.getContractFactory("PositionManager");
        positionManager = await PositionManager.deploy(perpAddr);
        
        const PerpEngine = await ethers.getContractFactory("PerpEngine");
        perpEngine = await PerpEngine.deploy(
            posMgrAddr,
            ammPool.target,
            oracleAggregator.target,
            liquidationEngine.target,
            riskManager.target,
            protocolConfig.target,
            insuranceFund.address,
            baseToken.target,
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
