const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Oracle Staleness Audit", function () {
    let oracleAggregator, securityModule, sanityChecker;
    let owner, other;
    const FEED_ID = ethers.encodeBytes32String("ETH/USD");

    beforeEach(async function () {
        [owner, securityModule, other] = await ethers.getSigners();

        const MockSanityChecker = await ethers.getContractFactory("MockOracle"); // Reuse MockOracle as a dummy
        sanityChecker = await MockSanityChecker.deploy("Sanity", 18);

        const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
        oracleAggregator = await OracleAggregator.deploy(securityModule.address, sanityChecker.target);

        // Setup a source so feedExists pass
        const MockOracle = await ethers.getContractFactory("MockOracle");
        const mockOracle = await MockOracle.deploy("Source", 8);
        await oracleAggregator.addOracleSource(FEED_ID, {
            oracleAddress: mockOracle.target,
            oracleType: 0, // CHAINLINK
            decimals: 8,
            heartbeat: 3600,
            isActive: true,
            lastUpdate: 0,
            confidence: 0
        });

        await oracleAggregator.configureFeed(FEED_ID, 2, 200, 60, false, 0); // 60s staleness
    });

    it("Protection: push updatePrice rejects old timestamps", async function () {
        const oldTimestamp = (await time.latest()) - 3600; // 1 hour ago
        const price = ethers.parseUnits("2000", 8);

        await expect(
            oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, oldTimestamp, 0
            )
        ).to.be.revertedWith("OracleAggregator: stale price");
    });

    it("Protection: push updatePrice rejects future timestamps", async function () {
        const futureTimestamp = (await time.latest()) + 3600; // 1 hour in future
        const price = ethers.parseUnits("2000", 8);

        await expect(
            oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, futureTimestamp, 0
            )
        ).to.be.revertedWith("OracleAggregator: future timestamp");
    });

    it("Protection: push updatePrice rejects stale timestamps", async function () {
        const staleTimestamp = (await time.latest()) - 120; // 2 mins ago, config is 1 min
        const price = ethers.parseUnits("2000", 8);

        await expect(
            oracleAggregator.connect(securityModule).getFunction("updatePrice(bytes32,uint256,uint256,uint256)")(
                FEED_ID, price, staleTimestamp, 0
            )
        ).to.be.revertedWith("OracleAggregator: stale price");
    });
});
