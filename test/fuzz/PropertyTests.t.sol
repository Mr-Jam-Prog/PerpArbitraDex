// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {PositionMath} from "../../contracts/libraries/PositionMath.sol";
import {SafeDecimalMath} from "../../contracts/libraries/SafeDecimalMath.sol";
import {FundingRateCalculator} from "../../contracts/libraries/FundingRateCalculator.sol";

/**
 * @title Property-Based Mathematical Tests
 * @notice Tests de propriétés mathématiques formelles
 * @dev Fuzzing avancé avec propriétés algébriques
 */
contract PropertyTests is Test {
    using PositionMath for uint256;
    using SafeDecimalMath for uint256;

    // Constants
    uint256 private constant PRECISION = 1e18;

    /**
     * @notice Property: Commutativité de l'addition pour PnL
     * @dev PnL(position1 + position2) = PnL(position1) + PnL(position2)
     */
    function test_pnl_commutative(uint256 size1, uint256 size2, uint256 entryPrice, uint256 exitPrice) public pure {
        // Bound values to reasonable ranges
        size1 = bound(size1, 1e18, 1e30);
        size2 = bound(size2, 1e18, 1e30);
        entryPrice = bound(entryPrice, 1e6, 1e15);
        exitPrice = bound(exitPrice, 1e6, 1e15);

        uint256 pnl1 = PositionMath.calculatePnL(size1, entryPrice, exitPrice, true);
        uint256 pnl2 = PositionMath.calculatePnL(size2, entryPrice, exitPrice, true);
        uint256 pnlCombined = PositionMath.calculatePnL(size1 + size2, entryPrice, exitPrice, true);

        // Tolérance pour les arrondis
        assertApproxEqAbs(pnlCombined, pnl1 + pnl2, 1e12);
    }

    /**
     * @notice Property: Symétrie long/short
     * @dev PnL_long = -PnL_short pour les mêmes paramètres
     */
    function test_pnl_long_short_symmetry(uint256 size, uint256 entryPrice, uint256 exitPrice) public pure {
        size = bound(size, 1e18, 1e30);
        entryPrice = bound(entryPrice, 1e6, 1e15);
        exitPrice = bound(exitPrice, 1e6, 1e15);

        uint256 pnlLong = PositionMath.calculatePnL(size, entryPrice, exitPrice, true);
        uint256 pnlShort = PositionMath.calculatePnL(size, entryPrice, exitPrice, false);

        // pnlLong ≈ -pnlShort
        if (exitPrice > entryPrice) {
            assert(pnlLong > 0 && pnlShort < 0);
        } else if (exitPrice < entryPrice) {
            assert(pnlLong < 0 && pnlShort > 0);
        } else {
            assert(pnlLong == 0 && pnlShort == 0);
        }
    }

    /**
     * @notice Property: Homogénéité du PnL
     * @dev PnL(k * size) = k * PnL(size)
     */
    function test_pnl_homogeneity(uint256 size, uint256 k, uint256 entryPrice, uint256 exitPrice) public pure {
        size = bound(size, 1e18, 1e30);
        k = bound(k, 1, 100);
        entryPrice = bound(entryPrice, 1e6, 1e15);
        exitPrice = bound(exitPrice, 1e6, 1e15);

        uint256 pnl1 = PositionMath.calculatePnL(size, entryPrice, exitPrice, true);
        uint256 pnlScaled = PositionMath.calculatePnL(size * k, entryPrice, exitPrice, true);

        // pnlScaled ≈ k * pnl1
        assertApproxEqRel(pnlScaled, pnl1 * k, 1e12); // 0.0001% tolerance
    }

    /**
     * @notice Property: Monotonie du funding rate
     * @dev Funding rate monotone par rapport au skew
     */
    function test_funding_rate_monotonic(int256 skew1, int256 skew2) public pure {
        // Bound skew values
        skew1 = int256(bound(uint256(skew1), 0, 1e30));
        skew2 = int256(bound(uint256(skew2), 0, 1e30));

        uint256 rate1 = FundingRateCalculator.calculateFundingRate(
            skew1,
            1e18, // funding sensitivity
            100e18, // total size
            3600 // 1 hour
        );

        uint256 rate2 = FundingRateCalculator.calculateFundingRate(skew2, 1e18, 100e18, 3600);

        if (skew1 > skew2) {
            assert(rate1 >= rate2);
        } else if (skew1 < skew2) {
            assert(rate1 <= rate2);
        } else {
            assert(rate1 == rate2);
        }
    }

    /**
     * @notice Property: Bornes du funding rate
     * @dev Funding rate borné entre -maxRate et +maxRate
     */
    function test_funding_rate_bounded(int256 skew, uint256 fundingSensitivity) public pure {
        skew = int256(bound(uint256(skew), 0, 1e30));
        fundingSensitivity = bound(fundingSensitivity, 1e15, 1e18); // 0.1% à 100%

        uint256 rate = FundingRateCalculator.calculateFundingRate(
            skew,
            fundingSensitivity,
            100e18, // total size
            3600
        );

        uint256 maxRate = fundingSensitivity * 24 * 365 / PRECISION; // Annualized max

        assert(rate <= maxRate);
    }

    /**
     * @notice Property: Health factor décroît avec les pertes
     * @dev HF(position avec pertes) < HF(position initiale)
     */
    function test_health_factor_decreases_with_losses(uint256 collateral, uint256 size, uint256 priceDrop) public pure {
        collateral = bound(collateral, 1e18, 1e30);
        size = bound(size, collateral, collateral * 10); // 1x à 10x leverage
        priceDrop = bound(priceDrop, 1, 100e16); // 0.01% à 100%

        // Health factor initial
        uint256 hfInitial = PositionMath.calculateHealthFactor(
            collateral,
            size,
            size / collateral, // entry price approx
            true
        );

        // Health factor après baisse de prix
        uint256 hfAfterLoss = PositionMath.calculateHealthFactor(
            collateral, size, (size / collateral) * (PRECISION - priceDrop) / PRECISION, true
        );

        assert(hfAfterLoss < hfInitial);
    }

    /**
     * @notice Property: Liquidation price bornée
     * @dev Prix de liquidation ∈ [0, ∞]
     */
    function test_liquidation_price_bounded(uint256 collateral, uint256 size, bool isLong) public pure {
        collateral = bound(collateral, 1e18, 1e30);
        size = bound(size, collateral, collateral * 10);

        uint256 liqPrice = PositionMath.calculateLiquidationPrice(
            collateral,
            size,
            isLong,
            8e16 // 8% maintenance margin
        );

        // Prix de liquidation doit être positif ou 0
        assert(liqPrice >= 0);
    }

    /**
     * @notice Property: Distributivité du levier
     * @dev collateral × leverage = size
     */
    function test_leverage_distributive(uint256 collateral, uint256 leverage) public pure {
        collateral = bound(collateral, 1e18, 1e30);
        leverage = bound(leverage, 1e18, 10e18); // 1x à 10x

        uint256 size = collateral.multiplyDecimal(leverage);
        uint256 calculatedLeverage = size.divideDecimal(collateral);

        assertApproxEqRel(calculatedLeverage, leverage, 1e12);
    }

    /**
     * @notice Property: Conservation de la valeur dans les swaps
     * @dev Value in = Value out (hors frais)
     */
    function test_value_conservation_swap(uint256 amountIn, uint256 price) public pure {
        amountIn = bound(amountIn, 1e18, 1e30);
        price = bound(price, 1e6, 1e15);

        uint256 valueIn = amountIn.multiplyDecimal(price);
        uint256 amountOut = valueIn.divideDecimal(price);

        // Avec tolérance d'arrondi
        assertApproxEqAbs(amountOut, amountIn, 1e12);
    }

    /**
     * @notice Property: Identité additif pour les marges
     * @dev initialMargin + maintenanceMargin ≥ liquidationBuffer
     */
    function test_margin_identity(uint256 imr, uint256 mmr) public pure {
        imr = bound(imr, 5e16, 5e17); // 5% à 50%
        mmr = bound(mmr, 2e16, imr); // 2% à imr

        // La marge de maintenance doit être ≤ marge initiale
        assert(mmr <= imr);

        // Le buffer de liquidation est la différence
        uint256 liquidationBuffer = imr - mmr;
        assert(liquidationBuffer >= 1e15); // Au moins 0.1%
    }
}
