const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time, helpers } = require("@nomicfoundation/hardhat-network-helpers");

describe("📈 High-Throughput Liquidation Stress Test", function () {
  let pe, pm, le, lq, oracle, collateralToken;
  let owner, liquidator, traders;

  const NUM_POSITIONS = 100;
  const BATCH_SIZE = 50;
  const INITIAL_PRICE = ethers.parseUnits("2000", 8);
  const COLLATERAL_AMOUNT = ethers.parseUnits("1000", 18);
  const LEVERAGE = 5n; // 5x

  before(async function () {
    this.timeout(600000);
    [owner, liquidator, ...traders] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateralToken = await MockERC20.deploy("USDC", "USDC", 18);

    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle = await MockOracle.deploy("ETH-USD", 8);
    await oracle.setPriceForSymbol("ETH-USD", INITIAL_PRICE);

    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    const protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);

    const MockAMMPool = await ethers.getContractFactory("MockAMMPool");
    const ammPool = await MockAMMPool.deploy();

    const MockRiskManager = await ethers.getContractFactory("MockRiskManager");
    const riskManager = await MockRiskManager.deploy();

    const PositionManager = await ethers.getContractFactory("PositionManager");
    const LiquidationQueue = await ethers.getContractFactory("LiquidationQueue");
    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    const IncentiveDistributor = await ethers.getContractFactory("IncentiveDistributor");
    const LiquidationEngine = await ethers.getContractFactory("LiquidationEngine");

    const deployerAddress = owner.address;
    const currentNonce = await owner.getNonce();

    const pmAddr = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce });
    const lqAddr = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 1 });
    const peAddr = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 2 });
    const idAddr = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 3 });
    const leAddr = ethers.getCreateAddress({ from: deployerAddress, nonce: currentNonce + 4 });

    pm = await PositionManager.deploy(peAddr);
    lq = await LiquidationQueue.deploy(leAddr);

    pe = await PerpEngine.deploy(
        pmAddr,
        ammPool.target,
        oracle.target,
        leAddr,
        riskManager.target,
        protocolConfig.target,
        owner.address,
        collateralToken.target,
        collateralToken.target
    );

    const id = await IncentiveDistributor.deploy(
        collateralToken.target,
        peAddr,
        protocolConfig.target,
        owner.address,
        owner.address,
        owner.address
    );

    le = await LiquidationEngine.deploy(
        peAddr,
        protocolConfig.target,
        oracle.target,
        collateralToken.target,
        lqAddr,
        id.target
    );

    await pe.setGovernance(owner.address);
    await id.setLiquidationEngine(le.target);

    await collateralToken.mint(le.target, ethers.parseUnits("10000000", 18));
    await collateralToken.mint(id.target, ethers.parseUnits("10000000", 18));

    await pe.initializeMarket(
      1,
      ethers.encodeBytes32String("ETH-USD"),
      100n * 10n**18n,
      2n * 10n**16n,
      10n**14n,
      5n * 10n**16n,
      10n**15n
    );

    for (let i = 0; i < 10; i++) {
        await collateralToken.mint(traders[i].address, COLLATERAL_AMOUNT * BigInt(NUM_POSITIONS));
        await collateralToken.connect(traders[i]).approve(pe.target, ethers.MaxUint256);
    }
  });

  it(`Should create, crash price, and batch liquidate ${NUM_POSITIONS} positions`, async function () {
    this.timeout(600000);

    console.log(`🚀 Creating ${NUM_POSITIONS} positions...`);
    const normalizedPrice = INITIAL_PRICE * (10n**10n);
    const size = (LEVERAGE * COLLATERAL_AMOUNT * (10n**18n)) / normalizedPrice;

    for (let i = 0; i < NUM_POSITIONS; i++) {
      const trader = traders[i % 10];
      await pe.connect(trader).openPosition({
        marketId: 1,
        isLong: true,
        size: size,
        margin: COLLATERAL_AMOUNT,
        acceptablePrice: INITIAL_PRICE * 110n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
      });
    }

    const totalOpenInterest = await pe.getTotalOpenInterest(1);
    console.log(`✅ Total OI: ${ethers.formatUnits(totalOpenInterest, 18)} ETH`);

    const crashPrice = INITIAL_PRICE * 70n / 100n;
    await oracle.setPriceForSymbol("ETH-USD", crashPrice);
    console.log(`📉 Price crashed to ${ethers.formatUnits(crashPrice, 8)}`);

    console.log("📥 Queuing positions (impersonating PerpEngine)...");

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [pe.target],
    });

    await owner.sendTransaction({
        to: pe.target,
        value: ethers.parseEther("1")
    });

    const impersonatedSigner = await ethers.getSigner(pe.target);

    for (let i = 1; i <= NUM_POSITIONS; i++) {
        const hf = await pe.getHealthFactor(i);
        if (hf < ethers.parseUnits("1", 18)) {
            await le.connect(impersonatedSigner).queueLiquidation(i, hf);
        }
    }

    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [pe.target],
    });

    const qLen = await le.getQueueLength();
    console.log(`📋 Initial Queue Length: ${qLen}`);

    await time.increase(600);
    console.log("⏰ Time advanced 10 minutes");

    console.log("⚡ Starting high-throughput batch liquidations...");
    const startTime = Date.now();
    let totalLiquidated = 0;

    while (totalLiquidated < Number(qLen)) {
        await oracle.setPriceForSymbol("ETH-USD", crashPrice);

        try {
            const tx = await le.connect(liquidator).processLiquidations(BATCH_SIZE);
            const receipt = await tx.wait();

            const events = receipt.logs.filter(log => {
                try {
                    const parsed = pe.interface.parseLog(log);
                    return parsed && parsed.name === 'PositionLiquidated';
                } catch { return false; }
            });

            totalLiquidated += events.length;
            console.log(`   ✅ Processed ${totalLiquidated}/${qLen} | Batch Gas: ${receipt.gasUsed.toLocaleString()}`);

            if (events.length === 0) break;
        } catch (e) {
            console.error(`❌ Batch failed: ${e.message}`);
            break;
        }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`\n📊 Throughput Results:`);
    console.log(`   Total Liquidated: ${totalLiquidated}`);
    console.log(`   Total Time: ${duration.toFixed(2)}s`);
    console.log(`   Liquidation Rate: ${(totalLiquidated / duration).toFixed(2)} pos/s`);

    const finalOI = await pe.getTotalOpenInterest(1);
    console.log(`📉 Final OI: ${ethers.formatUnits(finalOI, 18)} ETH`);
    expect(totalLiquidated).to.be.at.least(Number(qLen) * 0.9);
  });
});
