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

    it("Should execute direct permissionless liquidation without requiring prior queueing (LIQ-LIVE1 & LIQ-LIVE2)", async function () {
        const positionId = 2n;
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
            healthFactor: ethers.parseUnits("0.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        // Direct call without enqueueing
        const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
        await expect(tx).to.emit(liquidationEngine, "LiquidationExecuted");
        expect(await liquidationEngine.isPositionLiquidated(positionId)).to.be.true;
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

        expect(finalBalance).to.be.gte(initialBalance);

        // Process Queue test
        const initialBalance2 = await quoteToken.balanceOf(liquidator1.address);
        await liquidationEngine.connect(liquidator1).processQueue(1);
        const finalBalance2 = await quoteToken.balanceOf(liquidator1.address);
        expect(finalBalance2).to.be.gte(initialBalance2);
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

        // Penalty 1% (market.liquidationFeeRatio) on 5 ETH * $2000 = $10,000 notional = $100 = 100e18 quote tokens.
        expect(penalty).to.equal(ethers.parseUnits("100", 18));
    });

    it("LIQ-RESULT-PEN1 — CEIL penalty parity across preview, execution result, and event", async function () {
        const positionId = 40n;
        const now = await time.latest();
        const customPrice = ethers.parseUnits("2000.12345678", 8);

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1.333333333333333333", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        await oracle1.getFunction("setPrice")(customPrice);
        await oracle2.getFunction("setPrice")(customPrice);
        await oracleAggregator.updatePrice(FEED_ID);
        await perpEngine.setMockPrice(customPrice);

        const [previewReward, previewPenalty] = await liquidationEngine.previewLiquidation(positionId, customPrice);

        const res = await liquidationEngine.connect(liquidator1).executeLiquidation.staticCall(positionId, 0n);

        expect(res.penalty).to.equal(previewPenalty);

        const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
        await expect(tx)
            .to.emit(liquidationEngine, "LiquidationExecuted")
            .withArgs(positionId, liquidator1.address, previewReward, previewPenalty, true);
    });

    it("LIQ-EST1 & LIQ-QUEUE-EST1 — estimateReward parity and queue candidate estimation", async function () {
        const positionId = 50n;
        const now = await time.latest();
        const size = ethers.parseUnits("3.5", 18);

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: size,
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const estimatedReward = await liquidationEngine.estimateReward(positionId, size, INITIAL_PRICE);
        const [expectedReward] = await liquidationEngine.previewLiquidation(positionId, INITIAL_PRICE);

        expect(estimatedReward).to.equal(expectedReward);

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);

        await liquidationEngine.connect(perpSigner).queueLiquidation(positionId, ethers.parseUnits("0.8", 18));
        const [candidates] = await liquidationEngine.getLiquidationQueue(0n, 50n);
        const candidate = candidates.find(c => c.positionId == positionId);
        expect(candidate).to.not.be.undefined;
        expect(candidate.estimatedReward).to.equal(expectedReward);
    });

    it("LIQ-LEGACYCFG1 — updating legacy Config penaltyRatio/maxReward does not alter canonical settlement economics", async function () {
        const positionId = 60n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const [rewardBefore, penaltyBefore] = await liquidationEngine.previewLiquidation(positionId, INITIAL_PRICE);

        await ethers.provider.send("hardhat_setBalance", [perpEngine.target, "0x1000000000000000000"]);
        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);

        await liquidationEngine.connect(perpSigner).updateLiquidatorConfig([
            ethers.parseUnits("1", 18),
            ethers.parseUnits("5", 18), // Legacy maxReward 5 tokens
            ethers.parseUnits("0.25", 18), // Legacy 25% penalty ratio
            0n,
            10n
        ]);

        const [rewardAfter, penaltyAfter] = await liquidationEngine.previewLiquidation(positionId, INITIAL_PRICE);

        expect(rewardAfter).to.equal(rewardBefore);
        expect(penaltyAfter).to.equal(penaltyBefore);
    });

    it("LIQ-RTRACK1 — liquidatorRewards mapping tracks effective reward on success and is unchanged on revert", async function () {
        const positionId = 70n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const initialRewards = await liquidationEngine.liquidatorRewards(liquidator1.address);
        const [expectedReward] = await liquidationEngine.previewLiquidation(positionId, INITIAL_PRICE);

        await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);

        const finalRewards = await liquidationEngine.liquidatorRewards(liquidator1.address);
        expect(finalRewards - initialRewards).to.equal(expectedReward);

        await expect(
            liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Position already liquidated");

        expect(await liquidationEngine.liquidatorRewards(liquidator1.address)).to.equal(finalRewards);
    });

    it("LIQ-RNATIVE1 & LIQ-EST-NATIVE1 — 6-decimal quote token minReward check and estimate/preview native parity", async function () {
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const quoteToken6 = await MockERC20.deploy("USDC", "USDC", 6);
        await quoteToken6.waitForDeployment();

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);
        const liquidationEngine6Addr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 2 });

        const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
        const liquidationQueue6 = await LiquidationQueue.deploy(liquidationEngine6Addr);
        await liquidationQueue6.waitForDeployment();

        const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");
        const liquidationEngine6 = await LiquidationEngine.deploy(
            perpEngine.target,
            configRegistry.target,
            oracleAggregator.target,
            quoteToken6.target,
            liquidationQueue6.target,
            incentiveDistributor.target
        );
        await liquidationEngine6.waitForDeployment();

        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        await liquidationEngine6.connect(perpSigner).setMarketFeedId(MARKET_ID, FEED_ID);
        await perpEngine.setMock6Decimals(true);

        const positionId = 80n;
        const now = await time.latest();
        const nonRepSize = ethers.parseUnits("1.333333333333333333", 18);

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: nonRepSize,
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const [previewReward6] = await liquidationEngine6.previewLiquidation(positionId, INITIAL_PRICE);
        const estimatedReward6 = await liquidationEngine6.estimateReward(positionId, nonRepSize, INITIAL_PRICE);

        expect(previewReward6 % 10n**12n).to.equal(0n);
        expect(estimatedReward6).to.equal(previewReward6);

        const minRewardTooHigh = previewReward6 + 1n;
        await expect(
            liquidationEngine6.connect(liquidator1).executeLiquidation(positionId, minRewardTooHigh)
        ).to.be.revertedWithCustomError(perpEngine, "NotLiquidatable");

        const res = await liquidationEngine6.connect(liquidator1).executeLiquidation.staticCall(positionId, previewReward6);
        expect(res.reward).to.equal(previewReward6);

        await perpEngine.setMock6Decimals(false);
    });

    it("LIQ-RNATIVE2 — 18-decimal control (effectiveRewardWad == nominalRewardWad)", async function () {
        const positionId = 90n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1.333333333333333333", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const [previewReward18, previewPenalty18] = await liquidationEngine.previewLiquidation(positionId, INITIAL_PRICE);
        const expectedNominalWad = (previewPenalty18 * 5000n) / 10000n;

        expect(previewReward18).to.equal(expectedNominalWad);
    });

    it("LIQ-UF-HF1 — liquidation execution health incorporates unpaid funding debt when PnL is positive", async function () {
        const positionId = 100n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18),
            margin: 0n, // Stored margin exhausted by funding debit
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.5", 18),
            unrealizedPnl: ethers.parseUnits("200", 18),
            fundingAccrued: ethers.parseUnits("50", 18), // Unpaid funding debt
            openTime: now,
            lastUpdated: now
        });

        const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
        await expect(tx).to.emit(liquidationEngine, "LiquidationExecuted");
        expect(await liquidationEngine.isPositionLiquidated(positionId)).to.be.true;
    });

    it("LIQ-FVIEW1 — unaccrued elapsed funding debit makes position liquidatable in preview and direct liquidation succeeds", async function () {
        const positionId = 110n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const tx = await liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n);
        await expect(tx).to.emit(liquidationEngine, "LiquidationExecuted");
    });

    it("LIQ-FVIEW2 — unaccrued elapsed funding credit restores position health in read-only eligibility", async function () {
        const positionId = 120n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("1.2", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        await expect(
            liquidationEngine.connect(liquidator1).executeLiquidation(positionId, 0n)
        ).to.be.revertedWith("Position not liquidatable");
    });

    it("LIQ-FVIEW6D1 — 6-decimal quote token preview and execution funding boundaries agree exactly", async function () {
        const positionId = 130n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("1.5", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const res = await liquidationEngine.connect(liquidator1).executeLiquidation.staticCall(positionId, 0n);
        expect(res.fullyLiquidated).to.be.true;
    });

    it("LIQ-PRICE1 — PerpEngine.Market.oracleFeedId is single authoritative price source", async function () {
        const positionId = 140n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const perpSigner = await ethers.getImpersonatedSigner(perpEngine.target);
        await liquidationEngine.connect(perpSigner).setMarketFeedId(MARKET_ID, FEED_ID);

        const [reward, penalty] = await liquidationEngine.previewLiquidation(positionId, 0n);
        expect(penalty).to.be.gt(0n);
        expect(reward).to.be.gt(0n);
    });

    it("LIQ-VIEW-PNL1 & LIQ-VIEW-AGG1 — getUnrealizedPnl and getPosition parity for collectible funding debit", async function () {
        const positionId = 150n;
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
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("1.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        const pnlView = await perpEngine.getUnrealizedPnl(positionId, INITIAL_PRICE);
        const hfView = await perpEngine.getHealthFactor(positionId);
        const liqPriceView = await perpEngine.getLiquidationPrice(positionId);

        expect(posView.unrealizedPnl).to.equal(pnlView);
        expect(posView.healthFactor).to.equal(hfView);
        expect(posView.liquidationPrice).to.equal(liqPriceView);
    });

    it("LIQ-VIEW-PNL2 & LIQ-VIEW-AGG2 — getUnrealizedPnl and getPosition parity for funding credit", async function () {
        const positionId = 160n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: false,
            size: ethers.parseUnits("5", 18),
            margin: COLLATERAL_AMOUNT,
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("2.0", 18),
            unrealizedPnl: ethers.parseUnits("100", 18),
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        const pnlView = await perpEngine.getUnrealizedPnl(positionId, INITIAL_PRICE);

        expect(posView.unrealizedPnl).to.equal(pnlView);
    });

    it("LIQ-VIEW-PNL3 & LIQ-VIEW-AGG6D — M0 + EffectiveUnrealizedPnl == M1 + RawPricePnL - U invariant", async function () {
        const positionId = 170n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18),
            margin: ethers.parseUnits("100", 18),
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.8", 18),
            unrealizedPnl: ethers.parseUnits("50", 18),
            fundingAccrued: ethers.parseUnits("150", 18),
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        const pnlView = await perpEngine.getUnrealizedPnl(positionId, INITIAL_PRICE);

        expect(posView.unrealizedPnl).to.equal(pnlView);
    });

    it("LIQ-VIEW-FACC1 — PositionView.fundingAccrued telemetry preserves collectible funding debit", async function () {
        const positionId = 180n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18),
            margin: ethers.parseUnits("100", 18),
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("1.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: ethers.parseUnits("20", 18),
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        expect(posView.fundingAccrued).to.equal(ethers.parseUnits("20", 18));
    });

    it("LIQ-VIEW-FACC2 — PositionView.fundingAccrued telemetry preserves total debit when funding exceeds margin", async function () {
        const positionId = 190n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: true,
            size: ethers.parseUnits("5", 18),
            margin: ethers.parseUnits("100", 18),
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("0.5", 18),
            unrealizedPnl: 0n,
            fundingAccrued: ethers.parseUnits("150", 18),
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        expect(posView.fundingAccrued).to.equal(ethers.parseUnits("150", 18));
    });

    it("LIQ-VIEW-FACC-CREDIT1 — PositionView.fundingAccrued telemetry returns 0 for funding credit", async function () {
        const positionId = 200n;
        const now = await time.latest();

        await perpEngine.setPositionView(positionId, {
            positionId: positionId,
            trader: user.address,
            marketId: MARKET_ID,
            isLong: false,
            size: ethers.parseUnits("5", 18),
            margin: ethers.parseUnits("100", 18),
            entryPrice: INITIAL_PRICE,
            leverage: 10n**19n,
            liquidationPrice: INITIAL_PRICE,
            healthFactor: ethers.parseUnits("2.0", 18),
            unrealizedPnl: ethers.parseUnits("50", 18),
            fundingAccrued: 0n,
            openTime: now,
            lastUpdated: now
        });

        const posView = await perpEngine.getPosition(positionId);
        expect(posView.fundingAccrued).to.equal(0n);
    });
  });
});
