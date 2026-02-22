// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {AdversarialTests, MockERC20} from "./AdversarialTests.t.sol";

contract DriftTest is AdversarialTests {
    /**
     * @notice Test Point 1: Zero residual debt after liquidation
     * Ensures that when a position is liquidated, no "phantom" margin remains in global accounting
     */
    function test_zero_residual_debt_after_liquidation() public {
        uint256 margin = 1000e18;
        uint256 size = 90_000e18; // 90x leverage, near 1% margin ratio

        vm.prank(trader);
        uint256 posId = perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size,
            margin: margin,
            acceptablePrice: 2001e18,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        // Account for 0.1% protocol fee
        uint256 fee = (size * 1e15) / 1e18;
        uint256 expectedMargin = margin - fee;

        // Total collateral should be 910
        assertEq(perpEngine.totalCollateral(), expectedMargin, "Initial total collateral mismatch");

        // Price crashes 2%, making the position underwater
        currentPrice = 1960e18;

        assertTrue(perpEngine.isPositionLiquidatable(posId, currentPrice), "Should be liquidatable");

        vm.prank(address(liquidationEngine));
        perpEngine.liquidatePosition(IPerpEngine.LiquidateParams({
            positionId: posId,
            trader: trader,
            marketId: 1,
            sizeToLiquidate: size,
            minReward: 0
        }));

        // After liquidation of an underwater position:
        // 1. Position should be closed
        IPerpEngine.PositionView memory pos = perpEngine.getPosition(posId);
        assertEq(pos.size, 0, "Position not fully liquidated");

        // 2. Total collateral should be 0 (no residual debt or phantom margin)
        assertEq(perpEngine.totalCollateral(), 0, "Residual collateral after liquidation");
    }

    /**
     * @notice Test Point 2: Coherence of totalCollateral and totalOpenInterest
     * Ensures global metrics accurately reflect the sum of individual positions
     */
    function test_metrics_coherence() public {
        uint256 margin1 = 1000e18;
        uint256 size1 = 5000e18;
        uint256 margin2 = 2000e18;
        uint256 size2 = 3000e18;

        vm.startPrank(trader);
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size1,
            margin: margin1,
            acceptablePrice: 2001e18,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: false,
            size: size2,
            margin: margin2,
            acceptablePrice: 1999e18,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));
        vm.stopPrank();

        uint256 fee1 = (size1 * 1e15) / 1e18;
        uint256 fee2 = (size2 * 1e15) / 1e18;
        uint256 expectedTotalCollateral = margin1 + margin2 - fee1 - fee2;

        // Check Coherence 1: totalCollateral == sum of margins
        assertEq(perpEngine.totalCollateral(), expectedTotalCollateral, "Total collateral incoherence");

        // Check Coherence 2: getTotalOpenInterest == sum of absolute sizes
        assertEq(perpEngine.getTotalOpenInterest(1), size1 + size2, "Total OI incoherence");

        // Check Coherence 3: Market skew
        (uint256 longOI, uint256 shortOI, int256 netSkew) = ammPool.getMarketSkew(1);
        assertEq(longOI, size1, "Long OI mismatch");
        assertEq(shortOI, size2, "Short OI mismatch");
        assertEq(netSkew, int256(size1) - int256(size2), "Net skew mismatch");
    }

    /**
     * @notice Test Point 3: Insolvent path prevention
     * Fuzzes price movements and liquidations to ensure equity < 0 positions are ALWAYS liquidatable
     * and never blocked from being closed.
     */
    function test_fuzz_insolvent_path_prevention(uint256 priceDropBps) public {
        priceDropBps = bound(priceDropBps, 1, 5000); // 0.01% to 50%

        uint256 margin = 1000e18;
        uint256 size = 10_000e18; // 10x leverage

        vm.prank(trader);
        uint256 posId = perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: size,
            margin: margin,
            acceptablePrice: 2001e18,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        // Drop price
        currentPrice = 2000e18 * (10000 - priceDropBps) / 10000;

        if (perpEngine.getHealthFactor(posId) < 1e18) {
            assertTrue(perpEngine.isPositionLiquidatable(posId, currentPrice), "Unsafe position must be liquidatable");

            // Execute liquidation
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
