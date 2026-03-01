const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("⚡ LiquidationEngine - Unit Tests", function () {
  let liquidationEngine;
  let liquidationQueue;
  let incentiveDistributor;
  let perpEngine;
  let oracleAggregator;
  let configRegistry;
  let quoteToken;
  let oracleSecurity;
  let sanityChecker;
  let owner, liquidator1, user, treasury, insurance, staking;
  let oracle1, oracle2;
  
  const MARKET_ID = 1n;
  const FEED_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const INITIAL_PRICE = ethers.parseUnits("2000", 8);
  const COLLATERAL_AMOUNT = ethers.parseUnits("1000", 18);
  
  beforeEach(async function () {
    [owner, liquidator1, user, treasury, insurance, staking] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    quoteToken = await MockERC20.deploy("USD Stable", "USD", 18);
    await quoteToken.waitForDeployment();
    
    const MockPerpEngine = await ethers.getContractFactory("MockPerpEngine");
    perpEngine = await MockPerpEngine.deploy();
    await perpEngine.waitForDeployment();
    
    const MockConfigRegistry = await ethers.getContractFactory("MockConfigRegistry");
    configRegistry = await MockConfigRegistry.deploy();
    await configRegistry.waitForDeployment();
    
    const OracleSanityChecker = await ethers.getContractFactory("OracleSanityChecker");
    sanityChecker = await OracleSanityChecker.deploy(
        ethers.parseUnits("1", 8),
        ethers.parseUnits("1000000", 8),
        500n
    );
    await sanityChecker.waitForDeployment();

    const OracleAggregator = await ethers.getContractFactory("contracts/oracles/OracleAggregator.sol:OracleAggregator");
    oracleAggregator = await OracleAggregator.deploy(owner.address, sanityChecker.target); 
    await oracleAggregator.waitForDeployment();

    const OracleSecurity = await ethers.getContractFactory("OracleSecurity");
    oracleSecurity = await OracleSecurity.deploy(owner.address, oracleAggregator.target, sanityChecker.target);
    await oracleSecurity.waitForDeployment();

    await oracleAggregator.setSecurityModule(oracleSecurity.target);

    const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
    incentiveDistributor = await IncentiveDistributor.deploy(
        quoteToken.target,
        perpEngine.target,
        configRegistry.target,
        treasury.address,
        insurance.address,
        staking.address
    );
    await incentiveDistributor.waitForDeployment();

    const deployerAddr = owner.address;
    const nonce = await ethers.provider.getTransactionCount(deployerAddr);
    const engineAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 1 });

    const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
    liquidationQueue = await LiquidationQueue.deploy(engineAddr);
    await liquidationQueue.waitForDeployment();

    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
    liquidationEngine = await LiquidationEngine.deploy(
      perpEngine.target,
      configRegistry.target,
      oracleAggregator.target,
      quoteToken.target,
      liquidationQueue.target,
      incentiveDistributor.target
    );
    await liquidationEngine.waitForDeployment();

    await incentiveDistributor.setLiquidationEngine(liquidationEngine.target);
    
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle1 = await MockOracle.deploy();
    oracle2 = await MockOracle.deploy();
    await oracle1.setPrice(INITIAL_PRICE);
    await oracle2.setPrice(INITIAL_PRICE);
    
    await oracleAggregator.addOracleSource(FEED_ID, {
        oracleAddress: oracle1.target,
        oracleType: 0,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.addOracleSource(FEED_ID, {
        oracleAddress: oracle2.target,
        oracleType: 0,
        decimals: 8,
        heartbeat: 3600,
        isActive: true,
        lastUpdate: 0,
        confidence: 0
    });
    await oracleAggregator.updatePrice(FEED_ID);

    await quoteToken.mint(liquidationEngine.target, ethers.parseUnits("10000", 18));
    await quoteToken.mint(incentiveDistributor.target, ethers.parseUnits("10000", 18));
    // Mint some to distributor for payout
    await quoteToken.mint(incentiveDistributor.target, ethers.parseUnits("1000000", 18));
    // Actually reward comes from LiquidationEngine to liquidator, and then penalty to distributor
    await quoteToken.mint(liquidationEngine.target, ethers.parseUnits("1000000", 18));
  });
  
  describe("⚡ Liquidation Execution", function () {
    it("Should execute liquidation successfully", async function () {
      const positionId = 1n;
      const size = ethers.parseUnits("5", 18);
      
      await perpEngine.setPosition(positionId, {
        trader: user.address,
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: COLLATERAL_AMOUNT,
        entryPrice: INITIAL_PRICE,
        leverage: 5n * 10n**18n,
        lastFundingAccrued: await time.latest(),
        openTime: await time.latest(),
        lastUpdated: await time.latest(),
        isActive: true
      });

      await perpEngine.setPositionView(positionId, {
        positionId: positionId,
        trader: user.address,
        marketId: MARKET_ID,
        isLong: true,
        size: size,
        margin: COLLATERAL_AMOUNT,
        entryPrice: INITIAL_PRICE,
        leverage: 10n**19n,
        liquidationPrice: INITIAL_PRICE * 80n / 100n,
        healthFactor: ethers.parseUnits("0.8", 18),
        unrealizedPnl: 0n,
        fundingAccrued: 0n,
        openTime: await time.latest(),
        lastUpdated: await time.latest()
      });

      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
      const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      
      await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.8", 18));
      
      await time.increase(2000);
      await oracle1.setPrice(INITIAL_PRICE);
      await oracle2.setPrice(INITIAL_PRICE);
      await oracleAggregator.updatePrice(FEED_ID);

      const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
      await expect(tx).to.emit(liquidationEngine, "LiquidationExecuted");
      
      expect(await liquidationEngine.isPositionLiquidated(positionId)).to.be.true;
    });

    it("Should revert if position is not in queue", async function () {
        const positionId = 2n;
        await expect(
            liquidationEngine.executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Not in queue");
    });

    it("Should revert if grace period not passed", async function () {
        const positionId = 3n;
        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**18n,
            liquidationPrice: 0n,
            healthFactor: ethers.parseUnits("0.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: await time.latest(),
            lastUpdated: await time.latest()
        });

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        
        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.5", 18));
        
        await expect(
            liquidationEngine.executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Grace period not passed");
    });
  });
});
