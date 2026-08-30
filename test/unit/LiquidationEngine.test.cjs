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

    await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
    const perpSignerInitial = await ethers.getImpersonatedSigner(perpEngine.target);
    await liquidationEngine.connect(perpSignerInitial).setMarketFeedId(MARKET_ID, FEED_ID);
    
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle1 = await MockOracle.deploy("Oracle1", 8);
    oracle2 = await MockOracle.deploy("Oracle2", 8);
    await oracle1.getFunction("setPrice")(INITIAL_PRICE);
    await oracle2.getFunction("setPrice")(INITIAL_PRICE);
    
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
    await quoteToken.mint(incentiveDistributor.target, ethers.parseUnits("1000000", 18));
    await quoteToken.mint(liquidationEngine.target, ethers.parseUnits("1000000", 18));
  });
  
  describe("⚡ Liquidation Execution", function () {
    it("Should execute liquidation successfully", async function () {
      const positionId = 1n;
      const size = ethers.parseUnits("5", 18);
      
      const now = await time.latest();

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
        openTime: now,
        lastUpdated: now
      });

      await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
      const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
      
      await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.8", 18));
      
      await time.increase(2000);
      await oracle1.getFunction("setPrice")(INITIAL_PRICE);
      await oracle2.getFunction("setPrice")(INITIAL_PRICE);
      await oracleAggregator.updatePrice(FEED_ID);

      const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
      await expect(tx).to.emit(liquidationEngine, "LiquidationExecuted");
      
      expect(await liquidationEngine.isPositionLiquidated(positionId)).to.be.true;
    });

    it("Should revert if position is not in queue", async function () {
        const positionId = 2n;
        // Make sure it's valid but not in queue
        await perpEngine.setHealthFactor(positionId, ethers.parseUnits("0.5", 18));

        await expect(
            liquidationEngine.executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Not in queue");
    });

    it("Should revert if grace period not passed", async function () {
        const positionId = 3n;
        const now = await time.latest();
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
            openTime: now,
            lastUpdated: now
        });

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        
        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.5", 18));
        
        await expect(
            liquidationEngine.executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Grace period not passed");
    });

    it("Should attribute reward to external liquidator in executeBatchLiquidation and processQueue", async function () {
        const positionId1 = 10n;
        const positionId2 = 11n;
        const size = ethers.parseUnits("5", 18);
        const now = await time.latest();

        await perpEngine.setPositionView(positionId1, {
            positionId: positionId1,
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
            openTime: now,
            lastUpdated: now
        });

        await perpEngine.setPositionView(positionId2, {
            positionId: positionId2,
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
            openTime: now,
            lastUpdated: now
        });

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);

        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId1, ethers.parseUnits("0.8", 18));
        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId2, ethers.parseUnits("0.8", 18));

        await time.increase(2000);
        await oracle1.getFunction("setPrice")(INITIAL_PRICE);
        await oracle2.getFunction("setPrice")(INITIAL_PRICE);
        await oracleAggregator.updatePrice(FEED_ID);

        const initialBalance = await quoteToken.balanceOf(liquidator1.address);
        const tx = await liquidationEngine.connect(liquidator1).executeBatchLiquidation([positionId1], [0n]);
        const finalBalance = await quoteToken.balanceOf(liquidator1.address);

        expect(finalBalance).to.be.gt(initialBalance);
        expect(await quoteToken.balanceOf(liquidationEngine.target)).to.not.equal(finalBalance);

        // Process Queue test
        const initialBalance2 = await quoteToken.balanceOf(liquidator1.address);
        await liquidationEngine.connect(liquidator1).processQueue(1);
        const finalBalance2 = await quoteToken.balanceOf(liquidator1.address);
        expect(finalBalance2).to.be.gt(initialBalance2);
    });

    it("Should prevent liquidation of position that recovered health (healthFactor >= 1e18)", async function () {
        const positionId = 20n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE * 80n / 100n,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.8", 18));

        await time.increase(2000);
        await oracle1.getFunction("setPrice")(INITIAL_PRICE);
        await oracle2.getFunction("setPrice")(INITIAL_PRICE);
        await oracleAggregator.updatePrice(FEED_ID);

        // Position health recovers to 1.2
        await perpEngine.setHealthFactor(positionId, ethers.parseUnits("1.2", 18));

        await expect(
            liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Position not liquidatable");
    });

    it("Should explicitly revert flashLiquidate as disabled", async function () {
        await expect(
            liquidationEngine.flashLiquidate(1n, 100n, 0n)
        ).to.be.revertedWith("Flash liquidation disabled");
    });

    it("Should correctly calculate penalty and reward in quote token units when price != 1", async function () {
        const positionId = 30n;
        const now = await time.latest();
        const customPrice = ethers.parseUnits("2000", 8); // $2000 per unit

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18), // 5 ETH position = $10,000 notionnel
            margin: COLLATERAL_AMOUNT,
            entryPrice: customPrice,
            leverage: 10n**19n,
            liquidationPrice: customPrice * 80n / 100n,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.8", 18));

        await time.increase(2000);

        // Preview liquidation
        const [reward, penalty] = await liquidationEngine.previewLiquidation(positionId, customPrice);

        // Penalty 5% on 5 ETH * $2000 = $10,000 notionnel.
        // Liquidation ratio for health factor 0.8 to 0.95 = (1 - 0.8) / (1 - 0.95) = 0.2 / 0.05 = 4 -> capped at 100%.
        // 100% of $10,000 = $10,000 notionnel. Penalty @ 5% = $500 = 500e18 quote tokens.
        expect(penalty).to.equal(ethers.parseUnits("500", 18));
    });
  });
});
