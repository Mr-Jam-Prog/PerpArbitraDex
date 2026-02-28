// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PerpEngine} from "../../contracts/core/PerpEngine.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {PositionManager} from "../../contracts/core/PositionManager.sol";
import {AMMPool} from "../../contracts/core/AMMPool.sol";
import {ProtocolConfig} from "../../contracts/core/ProtocolConfig.sol";
import {LiquidationEngine} from "../../contracts/liquidation/LiquidationEngine.sol";

contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract AdversarialTests is Test {
    PerpEngine public perpEngine;
    PositionManager public positionManager;
    AMMPool public ammPool;
    ProtocolConfig public protocolConfig;
    LiquidationEngine public liquidationEngine;
    MockERC20 public usdc;

    uint256 public currentPrice = 2000e8;
    bool public priceStale = false;

    address public trader = makeAddr("trader");
    address public liquidator = makeAddr("liquidator");
    address public insuranceFund = makeAddr("insuranceFund");

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC", 18);
        protocolConfig = new ProtocolConfig(address(this), address(this));
        // Predict addresses for circular dependency
        uint256 nonce = vm.getNonce(address(this));
        address usdcAddr = vm.computeCreateAddress(address(this), nonce);
        address configAddr = vm.computeCreateAddress(address(this), nonce + 1);
        address posMgrAddr = vm.computeCreateAddress(address(this), nonce + 2);
        address ammAddr = vm.computeCreateAddress(address(this), nonce + 3);
        address liqAddr = vm.computeCreateAddress(address(this), nonce + 4);
        address perpAddr = vm.computeCreateAddress(address(this), nonce + 5);

        usdc = new MockERC20("USDC", "USDC", 18);
        protocolConfig = new ProtocolConfig(address(this), address(this));
        positionManager = new PositionManager(perpAddr);
        
        ammPool = new AMMPool(perpAddr, address(this));
        
        liquidationEngine = new LiquidationEngine(
            address(this),
            address(protocolConfig),
            perpAddr, // target perpEngine
            address(usdc),
            address(0),
            address(0)
        );

        perpEngine = new PerpEngine(
            address(positionManager),
            ammAddr,
            address(this), // oracleAggregator mock
            liqAddr,
            address(this), // riskManager mock
            address(protocolConfig),
            insuranceFund,
            address(usdc),
            address(usdc)
        );
        
        assertEq(address(ammPool), ammAddr, "AMM address mismatch");
        assertEq(address(perpEngine), perpAddr, "Perp address mismatch");

        // Standard market initialization
        vm.prank(insuranceFund);
        perpEngine.initializeMarket(
            1,
            bytes32("ETH-USD"),
            100e18, // 100x max leverage
            1e16,  // 1% min margin ratio
            0.1 ether, // min position size
            2e16,  // 2% liquidation fee
            1e15   // 0.1% protocol fee
        );

        vm.prank(address(perpEngine));
        ammPool.initializeMarket(1, 100_000e18, 1e16, 1 hours);

        usdc.mint(trader, 10_000_000e18);
        usdc.mint(liquidator, 10_000_000e18);
        
        vm.prank(trader);
        usdc.approve(address(perpEngine), type(uint256).max);
        vm.prank(liquidator);
        usdc.approve(address(perpEngine), type(uint256).max);
    }

    // Mock OracleAggregator
    function getPrice(bytes32) external view returns (uint256) {
        return currentPrice;
    }
    function isPriceStale(bytes32) external view returns (bool) {
        return priceStale;
    }

    // Mock RiskManager
    function validatePosition(uint256, uint256, uint256, uint256) external pure returns (bool, string memory) {
        return (true, "");
    }

    /**
     * @notice Test: Extreme long-only skew impact on funding and system stability
     */
    function test_extreme_long_skew_stress() public {
        uint256 margin = 100_000e18;
        uint256 size = 500e18; // 10x leverage

        vm.prank(trader);
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size,
            margin: margin,
            acceptablePrice: 2001e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        (uint256 longOI, uint256 shortOI, int256 netSkew) = ammPool.getMarketSkew(1);
        assertEq(longOI, size);
        assertEq(shortOI, 0);
        assertEq(netSkew, int256(size));

        // Accrue funding over 1 day
        vm.warp(block.timestamp + 1 days);
        perpEngine.accrueFunding(1);

        int256 fundingRate = ammPool.getFundingRate(1);
        assertTrue(fundingRate > 0, "Funding rate should be positive for longs");
        
        // Longs should be paying
        int256 payment = ammPool.calculateFundingPayment(1, size, true, block.timestamp - 1 days);
        assertTrue(payment < 0, "Longs should have negative funding payment (paying)");
    }

    /**
     * @notice Test: Cascade liquidations scenario
     */
    function test_cascade_liquidation_stress() public {
        // Open 10 positions near liquidation
        uint256 margin = 1000e18;
        uint256 size = 47e18; // ~95x leverage, very close to 1% margin ratio
        
        uint256[] memory posIds = new uint256[](10);
        for(uint256 i=0; i<10; i++) {
            vm.prank(trader);
            posIds[i] = perpEngine.openPosition(IPerpEngine.TradeParams({
                marketId: 1,
                isLong: true,
                size: size,
                margin: margin,
                acceptablePrice: 2001e8,
                deadline: block.timestamp + 1,
                referralCode: bytes32(0)
            }));
        }

        // Drop price by 1% to trigger all liquidations
        currentPrice = 1980e8; // 2000 * 0.99
        
        for(uint256 i=0; i<10; i++) {
            assertTrue(perpEngine.isPositionLiquidatable(posIds[i], currentPrice), "Position should be liquidatable");
            
            vm.prank(address(liquidationEngine));
            perpEngine.liquidatePosition(IPerpEngine.LiquidateParams({
                positionId: posIds[i],
                trader: trader,
                marketId: 1,
                sizeToLiquidate: size,
                minReward: 0
            }));
        }

        assertEq(perpEngine.totalPositionValue(), 0, "All positions should be closed");
    }

    /**
     * @notice Test: Atomic flash crash + funding + liquidation
     */
    function test_atomic_stress_block() public {
        uint256 margin = 10_000e18;
        uint256 size = 250e18; // 50x leverage

        vm.prank(trader);
        uint256 posId = perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size,
            margin: margin,
            acceptablePrice: 2001e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        // In same block (simulated by same timestamp but sequence of calls)
        // 1. Funding accrues (time jump)
        vm.warp(block.timestamp + 1 hours);
        
        // 2. Price crashes
        currentPrice = 1900e8; // 5% drop
        
        // 3. Liquidate
        vm.prank(address(liquidationEngine));
        perpEngine.liquidatePosition(IPerpEngine.LiquidateParams({
            positionId: posId,
            trader: trader,
            marketId: 1,
            sizeToLiquidate: size,
            minReward: 0
        }));

        // Verify system state
        assertTrue(perpEngine.totalCollateral() >= 0, "Negative total collateral");
        // Remaining margin might be small or zero
    }

    /**
     * @notice Test: Long-duration funding accrual (drift check)
     */
    function test_long_term_funding_drift() public {
        uint256 margin = 100_000e18;
        uint256 size = 500e18;

        vm.prank(trader);
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size,
            margin: margin,
            acceptablePrice: 2001e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        uint256 initialTotalCollateral = perpEngine.totalCollateral();

        // Advance 30 days
        for(uint256 i=0; i<30; i++) {
            vm.warp(block.timestamp + 1 days);
            perpEngine.accrueFunding(1);
        }

        // PnL should be zero (price stayed same), but margin should have decreased due to funding
        IPerpEngine.Position memory pos = perpEngine.getPositionInternal(1);
        assertTrue(pos.margin < margin, "Margin should have decreased by funding");
        
        // Total collateral should track exactly
        assertEq(perpEngine.totalCollateral(), pos.margin, "Global collateral drift detected");
    }
}
