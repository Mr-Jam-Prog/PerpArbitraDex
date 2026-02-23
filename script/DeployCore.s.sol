// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PerpEngine} from "../contracts/core/PerpEngine.sol";
import {PositionManager} from "../contracts/core/PositionManager.sol";
import {AMMPool} from "../contracts/core/AMMPool.sol";
import {MarketRegistry} from "../contracts/core/MarketRegistry.sol";
import {ProtocolConfig} from "../contracts/core/ProtocolConfig.sol";
import {RiskManager} from "../contracts/core/RiskManager.sol";
import {LiquidationEngine} from "../contracts/liquidation/LiquidationEngine.sol";
import {LiquidationQueue} from "../contracts/liquidation/LiquidationQueue.sol";
import {IncentiveDistributor} from "../contracts/liquidation/IncentiveDistributor.sol";
import {OracleAggregator} from "../contracts/oracles/OracleAggregator.sol";
import {OracleSecurity} from "../contracts/oracles/OracleSecurity.sol";
import {OracleSanityChecker} from "../contracts/oracles/OracleSanityChecker.sol";
import {MockERC20} from "../contracts/test/MockERC20.sol";

contract DeployCore is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Infrastructure - Tokens
        MockERC20 quoteToken = new MockERC20("USD Stable", "USDC");
        MockERC20 baseToken = new MockERC20("Protocol Base", "PERP");

        // 2. Address Prediction
        uint256 nonce = vm.getNonce(deployer);
        address[] memory addrs = new address[](12);
        for(uint8 i=0; i<12; i++) {
            addrs[i] = vm.computeCreateAddress(deployer, nonce + i);
        }

        // 3. Deployment
        ProtocolConfig config = new ProtocolConfig(deployer, deployer);
        MarketRegistry registry = new MarketRegistry(addrs[0]);
        OracleSanityChecker sanityChecker = new OracleSanityChecker(1, 1e30, 500);
        OracleAggregator aggregator = new OracleAggregator(addrs[4], addrs[2]);
        OracleSecurity security = new OracleSecurity(deployer, addrs[3], addrs[2]);
        PositionManager posMgr = new PositionManager(addrs[11]);
        AMMPool amm = new AMMPool(addrs[11], addrs[3]);
        LiquidationQueue liqQueue = new LiquidationQueue(addrs[9]);

        IncentiveDistributor incentive = new IncentiveDistributor(
            address(quoteToken),
            addrs[11],
            addrs[0],
            deployer,
            deployer,
            deployer
        );

        LiquidationEngine liqEngine = new LiquidationEngine(
            addrs[11],
            addrs[0],
            addrs[3],
            address(quoteToken),
            addrs[7],
            addrs[8]
        );

        RiskManager riskMgr = new RiskManager(addrs[1], addrs[11], addrs[0]);

        PerpEngine perp = new PerpEngine(
            addrs[5],
            addrs[6],
            addrs[3],
            addrs[9],
            addrs[10],
            addrs[0],
            deployer,
            address(baseToken),
            address(quoteToken)
        );

        // 4. Initial Configuration
        perp.setGovernance(deployer);

        // ETH-USD
        perp.initializeMarket(1, bytes32("ETH-USD"), 10e18, 2e16, 0.1 ether, 5e16, 1e15);
        // BTC-USD
        perp.initializeMarket(2, bytes32("BTC-USD"), 10e18, 2e16, 0.01 ether, 5e16, 1e15);

        // Configure AMM (Low OI Cap)
        amm.initializeMarket(1, 100_000e18, 1e16, 1 hours);
        amm.initializeMarket(2, 100_000e18, 1e16, 1 hours);

        vm.stopBroadcast();

        console.log("PerpEngine deployed at:", address(perp));
        console.log("AMMPool deployed at:", address(amm));
        console.log("OracleAggregator deployed at:", address(aggregator));
        console.log("ProtocolConfig deployed at:", address(config));
        console.log("QuoteToken deployed at:", address(quoteToken));
    }
}
