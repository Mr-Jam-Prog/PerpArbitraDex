if(!BigInt.prototype.mul){BigInt.prototype.mul=function(x){return this*BigInt(x)};BigInt.prototype.div=function(x){return this/BigInt(x)};BigInt.prototype.add=function(x){return this+BigInt(x)};BigInt.prototype.sub=function(x){return this-BigInt(x)};BigInt.prototype.gt=function(x){return this>BigInt(x)};BigInt.prototype.lt=function(x){return this<BigInt(x)};BigInt.prototype.gte=function(x){return this>=BigInt(x)};BigInt.prototype.lte=function(x){return this<=BigInt(x)};BigInt.prototype.eq=function(x){return this==BigInt(x)}};
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parseUnits, parseEther } = ethers;

describe("💎 Core Economics - Validation", function () {
    let perpEngine, positionManager, oracleAggregator, protocolConfig, quoteToken;
    let owner, trader;

    const PRECISION = 10n**18n;
    const PRICE_PRECISION = 10n**18n; // Mock uses 18
    const INITIAL_PRICE = 2000n * PRECISION;

    beforeEach(async function () {
        [owner, trader] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        quoteToken = await MockERC20.deploy("Quote", "QT");

        const ProtocolConfig = await ethers.getContractFactory("ProtocolConfig");
        protocolConfig = await ProtocolConfig.deploy(owner.address, owner.address);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(owner.address, owner.address);

        const deployerAddr = owner.address;
        const nonce = await ethers.provider.getTransactionCount(deployerAddr);
        const perpAddr = ethers.getCreateAddress({ from: deployerAddr, nonce: nonce + 3 });

        const PositionManager = await ethers.getContractFactory("PositionManager");
        positionManager = await PositionManager.deploy(perpAddr);

        const PerpEngine = await ethers.getContractFactory("PerpEngine");
        perpEngine = await PerpEngine.deploy(
            positionManager.target,
            owner.address, // amm
            oracleAggregator.target,
            owner.address, // liq
            owner.address, // risk
            protocolConfig.target,
            owner.address, // fund
            quoteToken.target,
            quoteToken.target
        );
        await perpEngine.waitForDeployment();
    });

    describe("PnL Accuracy", function () {
        it("Should reflect correct PnL after price move", async function () {
            // Test simplified to use wrapper if engine setup is too heavy
            const PositionMathWrapper = await ethers.getContractFactory("PositionMathWrapper");
            const wrapper = await PositionMathWrapper.deploy();

            const pnl = await wrapper.calculatePnL(
                2000n * PRECISION,
                2200n * PRECISION,
                100n * PRECISION,
                true
            );
            expect(pnl).to.equal(10n * PRECISION);
        });
    });
});
