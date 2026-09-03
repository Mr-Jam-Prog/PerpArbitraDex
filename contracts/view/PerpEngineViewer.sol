// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IPositionViewer} from "../interfaces/IPositionViewer.sol";
import {IPerpEngineViewer} from "../interfaces/IPerpEngineViewer.sol";
import {IAMMPool} from "../interfaces/IAMMPool.sol";
import {IOracleAggregator} from "../interfaces/IOracleAggregator.sol";
import {ILiquidityVault} from "../interfaces/ILiquidityVault.sol";
import {IRiskManager} from "../interfaces/IRiskManager.sol";
import {FundingRateCalculator} from "../libraries/FundingRateCalculator.sol";
import {PositionMath} from "../libraries/PositionMath.sol";
import {SafeDecimalMath} from "../libraries/SafeDecimalMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title PerpEngineViewer
 * @notice Stateless read-only viewer for PerpEngine calculations
 * @dev Performs pure/view calculations reading underlying state directly from PerpEngine contract.
 */
contract PerpEngineViewer is IPerpEngineViewer {
    using SafeDecimalMath for uint256;

    uint256 private constant PRECISION = 1e18;
    uint256 private constant PRICE_NORMALIZATION = 10**10;
    uint256 private constant MAX_LEVERAGE = 100 * PRECISION;
    uint256 private constant LIQUIDATION_THRESHOLD = PRECISION;

    function getPosition(address engine, uint256 positionId)
        external
        view
        override
        returns (IPositionViewer.PositionView memory)
    {
        return _getPosition(engine, positionId);
    }

    function getHealthFactor(address engine, uint256 positionId)
        external
        view
        override
        returns (uint256 healthFactor)
    {
        return _getHealthFactor(engine, positionId);
    }

    function getLiquidationPrice(address engine, uint256 positionId)
        external
        view
        override
        returns (uint256 liquidationPrice)
    {
        return _getLiquidationPrice(engine, positionId);
    }

    function getUnrealizedPnl(address engine, uint256 positionId, uint256 currentPrice)
        external
        view
        override
        returns (int256 pnl)
    {
        return _getUnrealizedPnl(engine, positionId, currentPrice);
    }

    function isPositionLiquidatable(address engine, uint256 positionId, uint256 currentPrice)
        external
        view
        override
        returns (bool liquidatable)
    {
        return _isPositionLiquidatable(engine, positionId, currentPrice);
    }

    function getAvailableMargin(address engine, uint256 positionId)
        external
        view
        override
        returns (uint256 availableMargin)
    {
        return _getAvailableMargin(engine, positionId);
    }

    function getPositionsByMarket(address engine, uint256 marketId, uint256 cursor, uint256 limit)
        external
        view
        override
        returns (IPositionViewer.PositionView[] memory positions, uint256 newCursor)
    {
        if (limit == 0) {
            return (new IPositionViewer.PositionView[](0), cursor);
        }

        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.PositionStats memory stats = pe.getPositionStats();
        uint256 totalAllocated = stats.totalPositions;
        uint256 startId = cursor == 0 ? 1 : cursor;

        if (startId > totalAllocated) {
            return (new IPositionViewer.PositionView[](0), 0);
        }

        uint256 endExclusive;
        unchecked {
            endExclusive = startId + limit;
        }
        uint256 maxExclusive = totalAllocated + 1;
        if (endExclusive > maxExclusive || endExclusive < startId) {
            endExclusive = maxExclusive;
        }

        uint256 scannedCount = endExclusive - startId;
        IPositionViewer.PositionView[] memory buffer = new IPositionViewer.PositionView[](scannedCount);
        uint256 matchCount = 0;

        for (uint256 id = startId; id < endExclusive; id++) {
            IPerpEngine.Position memory pos = pe.getPositionInternal(id);
            if (pos.isActive && pos.marketId == marketId) {
                buffer[matchCount] = _getPosition(engine, id);
                matchCount++;
            }
        }

        positions = new IPositionViewer.PositionView[](matchCount);
        for (uint256 i = 0; i < matchCount; i++) {
            positions[i] = buffer[i];
        }

        newCursor = endExclusive >= maxExclusive ? 0 : endExclusive;
    }

    function batchGetPositions(address engine, uint256[] calldata positionIds)
        external
        view
        override
        returns (IPositionViewer.PositionView[] memory views)
    {
        views = new IPositionViewer.PositionView[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            views[i] = _getPosition(engine, positionIds[i]);
        }
    }

    function batchGetHealthFactors(address engine, uint256[] calldata positionIds)
        external
        view
        override
        returns (uint256[] memory healthFactors)
    {
        healthFactors = new uint256[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            healthFactors[i] = _getHealthFactor(engine, positionIds[i]);
        }
    }

    function batchIsLiquidatable(address engine, uint256[] calldata positionIds, uint256[] calldata currentPrices)
        external
        view
        override
        returns (bool[] memory liquidatable)
    {
        liquidatable = new bool[](positionIds.length);
        for (uint256 i = 0; i < positionIds.length; i++) {
            liquidatable[i] = _isPositionLiquidatable(engine, positionIds[i], currentPrices[i]);
        }
    }

    function getBalanceSheet(address engine)
        external
        view
        override
        returns (
            uint256 totalTraderCollateral,
            uint256 totalLpAssets,
            uint256 lockedLiquidity,
            uint256 availableLiquidity,
            uint256 insuranceFundBalance,
            uint256 protocolFeeBalance,
            uint256 totalOpenInterestBase,
            uint256 vaultQuoteBalance
        )
    {
        IPerpEngine pe = IPerpEngine(engine);
        address vault = pe.liquidityVault();
        ILiquidityVault lv = ILiquidityVault(vault);
        uint8 vaultDec = lv.decimals();

        totalTraderCollateral = pe.totalCollateral();
        totalLpAssets = _fromVaultUnits(lv.totalLpAssets(), vaultDec);
        lockedLiquidity = _fromVaultUnits(lv.lockedLiquidity(), vaultDec);
        availableLiquidity = _fromVaultUnits(lv.availableLiquidity(), vaultDec);
        insuranceFundBalance = _fromVaultUnits(lv.insuranceFundBalance(), vaultDec);
        protocolFeeBalance = _fromVaultUnits(lv.protocolFeeBalance(), vaultDec);
        totalOpenInterestBase = pe.totalPositionSize();
        vaultQuoteBalance = _fromVaultUnits(IERC20(pe.quoteToken()).balanceOf(vault), vaultDec);
    }

    function getPositionsByTrader(address engine, address trader, uint256 cursor, uint256 limit)
        external
        view
        returns (IPositionViewer.PositionView[] memory positions, uint256 newCursor)
    {
        uint256[] memory ids = IPerpEngine(engine).getTraderPositions(trader);
        uint256 total = ids.length;
        if (cursor >= total) return (positions, total);

        uint256 end = cursor + limit;
        if (end > total) end = total;
        uint256 count = end - cursor;

        positions = new IPositionViewer.PositionView[](count);
        for (uint256 i = 0; i < count; i++) {
            positions[i] = _getPosition(engine, ids[cursor + i]);
        }
        return (positions, end);
    }

    function getMaxAdditionalSize(address engine, uint256 positionId, uint256 additionalMargin)
        external
        view
        returns (uint256 maxAdditionalSize)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        if (!position.isActive) return 0;

        (uint256 currentPrice, bool priceValid) = _getMarketPrice(engine, position.marketId);
        if (!priceValid) return 0;

        uint8 vaultDec = ILiquidityVault(pe.liquidityVault()).decimals();
        (uint256 previewMargin, uint256 unpaidFundingDebt) = _previewPostFundingMargin(engine, position, vaultDec);
        if (unpaidFundingDebt > 0) return 0;

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);
        uint256 effectiveMaxLeverage = market.maxLeverage < MAX_LEVERAGE ? market.maxLeverage : MAX_LEVERAGE;

        uint256 nativeMarginDeposit = _toVaultUnits(additionalMargin, vaultDec);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeMarginDeposit, vaultDec);

        uint256 grossNewMargin = previewMargin + effectiveMarginAdded;
        uint256 theoreticalMaxNotional = grossNewMargin.mulDiv(effectiveMaxLeverage, PRECISION);
        uint256 currentNotional = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);

        if (theoreticalMaxNotional <= currentNotional) return 0;

        uint256 maxAdditionalNotional = theoreticalMaxNotional - currentNotional;
        uint256 upperBoundSize = maxAdditionalNotional.mulDiv(PRECISION, currentPrice * PRICE_NORMALIZATION);

        if (upperBoundSize == 0) return 0;

        uint256 low = 0;
        uint256 high = upperBoundSize;
        uint256 best = 0;

        while (low <= high) {
            uint256 mid = low + (high - low) / 2;
            if (_canIncreasePosition(engine, position, mid, additionalMargin, currentPrice, previewMargin, vaultDec)) {
                best = mid;
                low = mid + 1;
            } else {
                if (mid == 0) break;
                high = mid - 1;
            }
        }

        return best;
    }

    // ============ INTERNAL HELPERS ============

    function _getPosition(address engine, uint256 positionId)
        internal
        view
        returns (IPositionViewer.PositionView memory viewData)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        if (!position.isActive) return viewData;

        (uint256 currentPrice, ) = _getMarketPrice(engine, position.marketId);

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);

        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: market.minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });

        PositionMath.LiquidationResult memory liqResult = PositionMath.calculateLiquidationPriceSafe(posParams, riskParams);
        uint256 healthFactor = PositionMath.calculateHealthFactor(posParams, currentPrice, riskParams);
        int256 pnl = PositionMath.calculatePnL(position.entryPrice, currentPrice, position.size, position.isLong) - fundingPayment;

        return IPositionViewer.PositionView({
            positionId: positionId,
            trader: position.trader,
            marketId: position.marketId,
            isLong: position.isLong,
            size: position.size,
            margin: position.margin,
            entryPrice: position.entryPrice,
            leverage: position.leverage,
            liquidationPrice: liqResult.liquidationPrice,
            healthFactor: healthFactor,
            unrealizedPnl: pnl,
            fundingAccrued: uint256(fundingPayment > 0 ? fundingPayment : int256(0)),
            openTime: position.openTime,
            lastUpdated: position.lastUpdated
        });
    }

    function _getHealthFactor(address engine, uint256 positionId)
        internal
        view
        returns (uint256 healthFactor)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        require(position.isActive, "PerpEngine: position inactive");

        (uint256 currentPrice, bool priceValid) = _getMarketPrice(engine, position.marketId);
        require(priceValid, "PerpEngine: invalid price");

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);

        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: market.minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });

        healthFactor = PositionMath.calculateHealthFactor(posParams, currentPrice, riskParams);
    }

    function _getLiquidationPrice(address engine, uint256 positionId)
        internal
        view
        returns (uint256 liquidationPrice)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        require(position.isActive, "PerpEngine: position inactive");

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);

        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: market.minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });

        PositionMath.LiquidationResult memory result = PositionMath.calculateLiquidationPriceSafe(posParams, riskParams);
        liquidationPrice = result.liquidationPrice;
    }

    function _getUnrealizedPnl(address engine, uint256 positionId, uint256 currentPrice)
        internal
        view
        returns (int256 pnl)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        require(position.isActive, "PerpEngine: position inactive");

        pnl = PositionMath.calculatePnL(
            position.entryPrice,
            currentPrice,
            position.size,
            position.isLong
        );

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        pnl -= fundingPayment;
    }

    function _isPositionLiquidatable(address engine, uint256 positionId, uint256 currentPrice)
        internal
        view
        returns (bool liquidatable)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        if (!position.isActive) return false;

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);

        PositionMath.PositionParams memory posParams = PositionMath.PositionParams({
            size: position.size,
            collateral: position.margin,
            entryPrice: position.entryPrice,
            isLong: position.isLong,
            fundingAccrued: fundingPayment
        });
        PositionMath.PositionRiskParams memory riskParams = PositionMath.PositionRiskParams({
            maintenanceMarginBps: market.minMarginRatio / (PRECISION / 10000),
            liquidationThresholdBps: 10000
        });

        liquidatable = PositionMath.isPositionLiquidatable(posParams, currentPrice, riskParams);
    }

    function _getAvailableMargin(address engine, uint256 positionId)
        internal
        view
        returns (uint256 availableMargin)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Position memory position = pe.getPositionInternal(positionId);
        if (!position.isActive) return 0;

        (uint256 currentPrice, ) = _getMarketPrice(engine, position.marketId);

        int256 fundingPayment = IAMMPool(pe.ammPool()).calculateFundingPayment(
            position.marketId,
            position.size,
            position.isLong,
            position.lastFundingIndex
        );

        int256 pnl = PositionMath.calculatePnL(position.entryPrice, currentPrice, position.size, position.isLong);
        int256 equity = int256(position.margin) + pnl - fundingPayment;

        if (equity <= 0) return 0;

        IPerpEngine.Market memory market = pe.getMarket(position.marketId);
        uint256 maintenanceNotional = position.size.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 maintenanceMargin = Math.mulDiv(maintenanceNotional, market.minMarginRatio, PRECISION, Math.Rounding.Up);

        if (uint256(equity) <= maintenanceMargin) return 0;

        return uint256(equity) - maintenanceMargin;
    }

    function _previewPostFundingMargin(
        address engine,
        IPerpEngine.Position memory position,
        uint8 vaultDec
    ) internal view returns (uint256 postFundingMargin, uint256 unpaidFundingDebt) {
        postFundingMargin = position.margin;
        if (position.size == 0) return (postFundingMargin, 0);

        IPerpEngine pe = IPerpEngine(engine);
        (int256 previewCumIndex, ) = IAMMPool(pe.ammPool()).previewCumulativeFundingIndex(position.marketId);
        if (position.lastFundingIndex == previewCumIndex) return (postFundingMargin, 0);

        int256 fundingPayment = FundingRateCalculator.calculateFundingPayment(
            position.size,
            position.lastFundingIndex,
            previewCumIndex,
            position.isLong
        );

        if (fundingPayment == 0) return (postFundingMargin, 0);

        if (fundingPayment > 0) {
            uint256 debtWad = uint256(fundingPayment);
            uint256 nativeDebt = _toVaultUnitsCeil(debtWad, vaultDec);
            uint256 chargedDebtWad = _fromVaultUnits(nativeDebt, vaultDec);

            if (postFundingMargin >= chargedDebtWad) {
                postFundingMargin -= chargedDebtWad;
                unpaidFundingDebt = 0;
            } else {
                uint256 nativeMarginAvailable = _toVaultUnits(postFundingMargin, vaultDec);
                uint256 marginForfeitedWad = _fromVaultUnits(nativeMarginAvailable, vaultDec);

                unpaidFundingDebt = debtWad > marginForfeitedWad ? debtWad - marginForfeitedWad : 0;
                postFundingMargin -= marginForfeitedWad;
            }
        } else {
            uint256 creditWad = uint256(-fundingPayment);
            uint256 nativeCredit = _toVaultUnits(creditWad, vaultDec);
            uint256 creditedWad = _fromVaultUnits(nativeCredit, vaultDec);

            postFundingMargin += creditedWad;
            unpaidFundingDebt = 0;
        }
    }

    function _canIncreasePosition(
        address engine,
        IPerpEngine.Position memory position,
        uint256 candidateSize,
        uint256 additionalMargin,
        uint256 currentPrice,
        uint256 previewPostFundingMargin,
        uint8 vaultDec
    ) internal view returns (bool) {
        if (candidateSize == 0) return true;

        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Market memory market = pe.getMarket(position.marketId);

        uint256 nativeMarginDeposit = _toVaultUnits(additionalMargin, vaultDec);
        uint256 effectiveMarginAdded = _fromVaultUnits(nativeMarginDeposit, vaultDec);

        uint256 addedNotional = candidateSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 nominalFeeWad = Math.mulDiv(addedNotional, market.protocolFeeRatio, PRECISION, Math.Rounding.Up);

        uint256 chargedFeeWad = 0;
        if (nominalFeeWad > 0) {
            chargedFeeWad = _fromVaultUnits(_toVaultUnitsCeil(nominalFeeWad, vaultDec), vaultDec);
        }

        uint256 grossNewMargin = previewPostFundingMargin + effectiveMarginAdded;
        if (grossNewMargin < chargedFeeWad) return false;
        uint256 finalNewMargin = grossNewMargin - chargedFeeWad;
        if (finalNewMargin == 0) return false;

        uint256 newSize = position.size + candidateSize;
        uint256 newNotionalValue = newSize.mulDiv(currentPrice * PRICE_NORMALIZATION, PRECISION);
        uint256 newLeverage = newNotionalValue.mulDiv(PRECISION, finalNewMargin);

        uint256 effectiveMaxLeverage = market.maxLeverage < MAX_LEVERAGE ? market.maxLeverage : MAX_LEVERAGE;
        if (newLeverage > effectiveMaxLeverage) return false;

        uint256 minMarginRequired = Math.mulDiv(newNotionalValue, market.minMarginRatio, PRECISION, Math.Rounding.Up);
        if (finalNewMargin < minMarginRequired) return false;

        (bool riskOk, ) = IRiskManager(pe.riskManager()).validatePosition(
            position.marketId,
            newSize,
            finalNewMargin,
            newLeverage
        );
        return riskOk;
    }

    function _getMarketPrice(address engine, uint256 marketId)
        internal
        view
        returns (uint256 price, bool valid)
    {
        IPerpEngine pe = IPerpEngine(engine);
        IPerpEngine.Market memory market = pe.getMarket(marketId);
        require(market.isActive, "PerpEngine: market inactive");

        bytes32 feedId = market.oracleFeedId;
        price = IOracleAggregator(pe.oracleAggregator()).getPrice(feedId);

        valid = price > 0 && !IOracleAggregator(pe.oracleAggregator()).isPriceStale(feedId);
    }

    function _toVaultUnits(uint256 wadAmount, uint8 vaultDec) internal pure returns (uint256) {
        if (wadAmount == 0) return 0;
        if (vaultDec == 18) {
            return wadAmount;
        } else if (vaultDec < 18) {
            return wadAmount / (10 ** (18 - vaultDec));
        } else {
            return wadAmount * (10 ** (vaultDec - 18));
        }
    }

    function _toVaultUnitsCeil(uint256 wadAmount, uint8 vaultDec) internal pure returns (uint256) {
        if (wadAmount == 0) return 0;
        if (vaultDec == 18) {
            return wadAmount;
        } else if (vaultDec < 18) {
            uint256 divisor = 10 ** (18 - vaultDec);
            return Math.ceilDiv(wadAmount, divisor);
        } else {
            return wadAmount * (10 ** (vaultDec - 18));
        }
    }

    function _fromVaultUnits(uint256 vaultAmount, uint8 vaultDec) internal pure returns (uint256) {
        if (vaultAmount == 0) return 0;
        if (vaultDec == 18) {
            return vaultAmount;
        } else if (vaultDec < 18) {
            return vaultAmount * (10 ** (18 - vaultDec));
        } else {
            return vaultAmount / (10 ** (vaultDec - 18));
        }
    }
}
