// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {AdversarialTests} from "./AdversarialTests.t.sol";

contract EdgeCasesTest is AdversarialTests {
    function test_flash_crash() public {
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

        currentPrice = 1000e8; // 50% crash

        assertTrue(perpEngine.isPositionLiquidatable(posId, currentPrice), "Should be liquidatable after crash");
    }

    function test_max_leverage_position() public {
        uint256 margin = 1000e18;
        uint256 size = 50e18; // 100,000 USD notional, 100x leverage

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

        assertEq(perpEngine.totalCollateral() > 0, true);
    }

    function test_many_vs_one_position() public {
        uint256 totalMargin = 10000e18;
        uint256 totalSize = 50e18; // 100,000 USD notional, 10x leverage

        // One large position
        vm.prank(trader);
        perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: true,
            size: totalSize,
            margin: totalMargin,
            acceptablePrice: 2001e8,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        }));

        uint256 collateralOne = perpEngine.totalCollateral();

        // Reset (re-deploying via setUp is easiest in this context if we want clean state)
        setUp();

        // 10 small positions
        uint256 smallMargin = totalMargin / 10;
        uint256 smallSize = totalSize / 10;

        for(uint256 i=0; i<10; i++) {
            vm.prank(trader);
            perpEngine.openPosition(IPerpEngine.TradeParams({
                marketId: 1,
                isLong: true,
                size: smallSize,
                margin: smallMargin,
                acceptablePrice: 2001e8,
                deadline: block.timestamp + 1,
                referralCode: bytes32(0)
            }));
        }

        uint256 collateralMany = perpEngine.totalCollateral();

        // Collateral should be identical (within rounding)
        assertApproxEqAbs(collateralOne, collateralMany, 1e10, "Total collateral mismatch between batch and single");
    }
}
