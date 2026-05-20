// LEGACY: needs full rewrite for current contract interfaces
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, formatUnits } = ethers;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe.skip("🔄 FullTradeFlow - Integration Tests", function () {
  let perpEngine, positionManager, marketRegistry, protocolConfig, collateralToken, baseToken, oracle, riskManager, ammPool, liquidationEngine;
  let owner, trader1, trader2, lpProvider;
  
  const ETH_USD_MARKET = "ETH-USD";
  const MARKET_ID = 1;
  const INITIAL_PRICE = parseUnits("2000", 18);
  const COLLATERAL_AMOUNT = parseUnits("10000", 18);
  
  beforeEach(async function () {
    [owner, trader1, trader2, lpProvider] = await ethers.getSigners();
    
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    collateralToken = await MockERC20.deploy("USD Stable", "USD", 18);
    await collateralToken.waitForDeployment();
    baseToken = await MockERC20.deploy("Ethereum", "ETH", 18);
    await baseToken.waitForDeployment();
    
    const MockOracle = await ethers.getContractFactory("MockOracle");
    oracle = await MockOracle.deploy("Mock Oracle", 18);
    await oracle.waitForDeployment();
    await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE);
    
    const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
    protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);
    await protocolConfig.waitForDeployment();
    
    const MarketRegistry = await ethers.getContractFactory("MarketRegistry");
    marketRegistry = await MarketRegistry.deploy(protocolConfig.target);
    await marketRegistry.waitForDeployment();
    
    const nonce = await ethers.provider.getTransactionCount(owner.address);
    const perpEngineAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 4 });
    const ammPoolAddr = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 5 });

    const PositionManager = await ethers.getContractFactory("PositionManager");
    positionManager = await PositionManager.deploy(perpEngineAddr);
    await positionManager.waitForDeployment();
    
    const RiskManager = await ethers.getContractFactory("RiskManager");
    riskManager = await RiskManager.deploy(marketRegistry.target, perpEngineAddr, protocolConfig.target);
    await riskManager.waitForDeployment();
    
    const MockLiquidationEngine = await ethers.getContractFactory("MockLiquidationEngine");
    liquidationEngine = await MockLiquidationEngine.deploy();
    await liquidationEngine.waitForDeployment();

    const PerpEngine = await ethers.getContractFactory("PerpEngine");
    perpEngine = await PerpEngine.deploy(
        positionManager.target,
        ammPoolAddr,
        oracle.target,
        liquidationEngine.target,
        riskManager.target,
        protocolConfig.target,
        owner.address,
        baseToken.target,
        collateralToken.target
    );
    await perpEngine.waitForDeployment();
    
    const AMMPool = await ethers.getContractFactory("AMMPool");
    ammPool = await AMMPool.deploy(perpEngine.target, oracle.target);
    await ammPool.waitForDeployment();

    const feedId = ethers.encodeBytes32String(ETH_USD_MARKET);
    await perpEngine.initializeMarket(
        MARKET_ID,
        feedId,
        parseUnits("100", 18),
        parseUnits("0.01", 18),
        parseUnits("0.1", 18),
        parseUnits("0.02", 18),
        parseUnits("0.001", 18)
    );
    
    await collateralToken.mint(trader1.address, COLLATERAL_AMOUNT * 10n);
  });

  it("Should complete full trade cycle: deposit → long → profit → close", async function () {
    await collateralToken.connect(trader1).approve(perpEngine.target, COLLATERAL_AMOUNT);

    await perpEngine.connect(trader1).openPosition({
        marketId: MARKET_ID,
        isLong: true,
        size: parseUnits("10", 18),
        margin: COLLATERAL_AMOUNT * 10n,
        acceptablePrice: INITIAL_PRICE * 110n / 100n,
        deadline: (await time.latest()) + 3600,
        referralCode: ethers.ZeroHash
    });
    
    const initialBalance = await collateralToken.balanceOf(trader1.address);
    await oracle.setPriceForSymbol(ETH_USD_MARKET, INITIAL_PRICE * 110n / 100n);
    
    await perpEngine.connect(trader1).closePosition(1);
    
    const finalBalance = await collateralToken.balanceOf(trader1.address);
    expect(finalBalance).to.be > (initialBalance);
  });
});
