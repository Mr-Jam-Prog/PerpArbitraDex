// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {AdversarialTests, MockERC20} from "./AdversarialTests.t.sol";

contract DriftTest is AdversarialTests {
    /**
     * @notice Test Point 1: Zero residual debt after liquidation
     */
    function test_zero_residual_debt_after_liquidation() public {
        uint256 margin = 1000e18;
        uint256 size = 45e18; // 45 ETH * 2000 USD/ETH = 90,000 USD. 90x leverage.

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

        uint256 currentPriceNormalized = 2000e8 * 10**10;
        uint256 notional = (size * currentPriceNormalized) / 1e18;
        uint256 fee = (notional * 1e15) / 1e18;
        uint256 expectedMargin = margin - fee;

        assertEq(perpEngine.totalCollateral(), expectedMargin, "Initial total collateral mismatch");

        currentPrice = 1960e8; 
        
        assertTrue(perpEngine.isPositionLiquidatable(posId, currentPrice), "Should be liquidatable");

        vm.prank(address(liquidationEngine));
        perpEngine.liquidatePosition(IPerpEngine.LiquidateParams({
            positionId: posId,
            trader: trader,
            marketId: 1,
            sizeToLiquidate: size,
            minReward: 0
        }));

        IPerpEngine.PositionView memory pos = perpEngine.getPosition(posId);
        assertEq(pos.size, 0, "Position not fully liquidated");
        assertEq(perpEngine.totalCollateral(), 0, "Residual collateral after liquidation");
    }

    function test_metrics_coherence() public {
        uint256 margin1 = 1000e18;
        uint256 size1 = 2e18; // 4000 notional, 4x leverage
        uint256 margin2 = 2000e18;
        uint256 size2 = 1e18; // 2000 notional, 1x leverage

        vm.startPrank(trader);
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size1,
            margin: margin1,
            acceptablePrice: 2001e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));
        
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: false,
            size: size2,
            margin: margin2,
            acceptablePrice: 1999e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));
        vm.stopPrank();

        uint256 priceNorm = 2000e8 * 10**10;
        uint256 fee1 = (size1 * priceNorm / 1e18 * 1e15) / 1e18;
        uint256 fee2 = (size2 * priceNorm / 1e18 * 1e15) / 1e18;
        uint256 expectedTotalCollateral = margin1 + margin2 - fee1 - fee2;

        assertEq(perpEngine.totalCollateral(), expectedTotalCollateral, "Total collateral incoherence");
        assertEq(perpEngine.getTotalOpenInterest(1), size1 + size2, "Total OI incoherence");
    }

    function test_fuzz_insolvent_path_prevention(uint256 priceDropBps) public {
        priceDropBps = bound(priceDropBps, 1, 5000); 
        
        uint256 margin = 1000e18;
        uint256 size = 5e18; // 10,000 USD notional, 10x leverage

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

        currentPrice = 2000e8 * (10000 - priceDropBps) / 10000;
        
        if (perpEngine.getHealthFactor(posId) < 1e18) {
            assertTrue(perpEngine.isPositionLiquidatable(posId, currentPrice), "Unsafe position must be liquidatable");
            
            vm.prank(address(liquidationEngine));
            perpEngine.liquidatePosition(IPerpEngine.LiquidateParams({
                positionId: posId,
                trader: trader,
                marketId: 1,
                sizeToLiquidate: size,
                minReward: 0
            }));
            
            assertEq(perpEngine.totalCollateral(), 0, "Collateral should be cleared after full liquidation");
        }
    }
}
