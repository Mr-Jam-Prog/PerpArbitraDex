// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPositionViewer} from "./IPositionViewer.sol";

interface IPerpEngineViewer {
    function getPosition(address engine, uint256 positionId)
        external
        view
        returns (IPositionViewer.PositionView memory);

    function getHealthFactor(address engine, uint256 positionId)
        external
        view
        returns (uint256 healthFactor);

    function getLiquidationPrice(address engine, uint256 positionId)
        external
        view
        returns (uint256 liquidationPrice);

    function getUnrealizedPnl(address engine, uint256 positionId, uint256 currentPrice)
        external
        view
        returns (int256 pnl);

    function isPositionLiquidatable(address engine, uint256 positionId, uint256 currentPrice)
        external
        view
        returns (bool liquidatable);

    function getAvailableMargin(address engine, uint256 positionId)
        external
        view
        returns (uint256 availableMargin);

    function getPositionsByMarket(address engine, uint256 marketId, uint256 cursor, uint256 limit)
        external
        view
        returns (IPositionViewer.PositionView[] memory positions, uint256 newCursor);

    function batchGetPositions(address engine, uint256[] calldata positionIds)
        external
        view
        returns (IPositionViewer.PositionView[] memory views);

    function batchGetHealthFactors(address engine, uint256[] calldata positionIds)
        external
        view
        returns (uint256[] memory healthFactors);

    function batchIsLiquidatable(address engine, uint256[] calldata positionIds, uint256[] calldata currentPrices)
        external
        view
        returns (bool[] memory liquidatable);

    function getBalanceSheet(address engine)
        external
        view
        returns (
            uint256 totalTraderCollateral,
            uint256 totalLpAssets,
            uint256 lockedLiquidity,
            uint256 availableLiquidity,
            uint256 insuranceFundBalance,
            uint256 protocolFeeBalance,
            uint256 totalOpenInterestBase,
            uint256 vaultQuoteBalance
        );

    function getMaxAdditionalSize(address engine, uint256 positionId, uint256 additionalMargin)
        external
        view
        returns (uint256 maxAdditionalSize);
}
