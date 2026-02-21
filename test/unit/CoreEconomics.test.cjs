const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("💎 Core Economics - Validation", function () {
  let perpEngine, ammPool, oracleAggregator, liquidationEngine, riskManager, protocolConfig;
  let quoteToken;
  let owner, trader, liquidator, insuranceFund;

  const MARKET_ID = 1n;
  const PRECISION = 10n**18n;
  const PRICE_PRECISION = 10n**8n;
  const INITIAL_PRICE = 2000n * PRICE_PRECISION;

  beforeEach(async function () {
    [owner, trader, liquidator, insuranceFund] = await ethers.getSigners();

    // 1. Deploy Tokens & Mocks
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    quoteToken = await MockERC20.deploy("USD Stable", "USDC");
    await quoteToken.waitForDeployment();

    const MockOracle = await ethers.getContractFactory("MockOracle");
    const mockOracle = await MockOracle.deploy();
    await mockOracle.waitForDeployment();
    await mockOracle.setPrice(INITIAL_PRICE);

    // 2. Deploy Config & Infrastructure
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy(await owner.getAddress(), await owner.getAddress());
    await protocolConfig.waitForDeployment();

    // 3. Deploy AMMPool & Oracles
    const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
    // OracleAggregator(address securityModule, address sanityChecker_)
    oracleAggregator = await OracleAggregator.deploy(await owner.getAddress(), await owner.getAddress());
    await oracleAggregator.waitForDeployment();

    // 4. Deploy PositionManager
    const PositionManager = await ethers.getContractFactory("PositionManager");
    positionManager = await PositionManager.deploy(await owner.getAddress()); // Temporarily owner, will be set to engine
    await positionManager.waitForDeployment();

    // 5. Deploy LiquidationEngine
    const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
    const liquidationQueue = await LiquidationQueue.deploy(await owner.getAddress());
    await liquidationQueue.waitForDeployment();

    const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
    const incentiveDistributor = await IncentiveDistributor.deploy(await owner.getAddress());
    await incentiveDistributor.waitForDeployment();

    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
    liquidationEngine = await LiquidationEngine.deploy(
        await owner.getAddress(), // temp
        await protocolConfig.getAddress(),
        await oracleAggregator.getAddress(),
        await quoteToken.getAddress(),
        await liquidationQueue.getAddress(),
        await incentiveDistributor.getAddress()
    );
    await liquidationEngine.waitForDeployment();

    // 6. Deploy PerpEngine
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy(
        await positionManager.getAddress(),
        await owner.getAddress(), // temp AMM
        await oracleAggregator.getAddress(),
        await liquidationEngine.getAddress(),
        await owner.getAddress(), // temp Risk
        await protocolConfig.getAddress(),
        await insuranceFund.getAddress(),
        await quoteToken.getAddress(), // base token (simplified)
        await quoteToken.getAddress()  // quote token
    );
    await perpEngine.waitForDeployment();

    // 7. Deploy & Set actual AMMPool
    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(await perpEngine.getAddress(), await oracleAggregator.getAddress());
    await ammPool.waitForDeployment();

    // 8. Re-deploy or fix references
    // Since we have immutable fields, we might need a proper deployment sequence or setters.
    // For this validation test, I'll use a modified PerpEngine if needed or just re-deploy.
    // Actually PerpEngine uses immutables. I'll re-deploy PerpEngine with correct addresses.

    perpEngine = await PerpEngine.deploy(
        await positionManager.getAddress(),
        await ammPool.getAddress(),
        await oracleAggregator.getAddress(),
        await liquidationEngine.getAddress(),
        await owner.getAddress(), // Risk
        await protocolConfig.getAddress(),
        await insuranceFund.getAddress(),
        await quoteToken.getAddress(),
        await quoteToken.getAddress()
    );
    await perpEngine.waitForDeployment();

    // Fix PositionManager owner/engine
    // ...
  });

  describe("PnL Accuracy", function () {
    it("Should reflect correct PnL after price move", async function () {
        // Validation logic here
    });
  });
});
