if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, parseEther } = ethers;
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

        // Deploy Mock Tokens
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("USD Stable", "USDC");
        await quoteToken.waitForDeployment();

        // Deploy Infrastructure
        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
        await protocolConfig.waitForDeployment();

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(owner.address, owner.address);
        await oracleAggregator.waitForDeployment();

        // Predicted addresses for circular dependencies
        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);

        // Nonce prediction in Hardhat
        const posMgrAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });
        const ammAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });
        const liqAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 4 });
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 5 });

        const PositionManager = await ethers.getContractFactory("PositionManager");
        const positionManager = await PositionManager.deploy(perpAddr);
        await positionManager.waitForDeployment();

        const AMMPool = await ethers.getContractFactory("AMMPool");
        ammPool = await AMMPool.deploy(perpAddr, owner.address);
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
            owner.address, // riskManager mock
            protocolConfig.target,
            insuranceFund.address,
            quoteToken.target,
            quoteToken.target
        );
        await perpEngine.waitForDeployment();
    });

    it("1. PnL Correctness: should calculate profit for long position", async function () {
        const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
        const wrapper = await PositionMathWrapper.deploy();

        const entryPrice = 2000n * PRICE_PRECISION;
        const exitPrice = 2200n * PRICE_PRECISION;
        const size = 100n * PRECISION;

        const pnl = await wrapper.calculatePnL(entryPrice, exitPrice, size, true);
        expect(pnl).to.equal(10n * PRECISION);
    });

    it("2. PnL Correctness: should calculate loss for short position", async function () {
        const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
        const wrapper = await PositionMathWrapper.deploy();

        const entryPrice = 2000n * PRICE_PRECISION;
        const exitPrice = 2200n * PRICE_PRECISION;
        const size = 100n * PRECISION;

        const pnl = await wrapper.calculatePnL(entryPrice, exitPrice, size, false);
        expect(pnl).to.equal(-10n * PRECISION);
    });
});
