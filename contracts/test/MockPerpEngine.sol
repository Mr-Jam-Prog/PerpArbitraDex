// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";

contract MockPerpEngine is IPerpEngine {
    function openPosition(TradeParams calldata) external override returns (uint256) { return 0; }
    function increasePosition(uint256, uint256, uint256) external override {}
    function decreasePosition(uint256, uint256, uint256) external override {}
    function closePosition(uint256) external override {}
    function liquidatePosition(LiquidateParams calldata) external override returns (uint256) { return 0; }
    function accrueFunding(uint256) external override {}
    function batchAccrueFunding(uint256[] calldata) external override {}
    function addMargin(uint256, uint256) external override {}
    function removeMargin(uint256, uint256) external override {}
    function getPositionInternal(uint256) external view override returns (Position memory) {
        Position memory p;
        return p;
    }
    function updateProtocolFee(uint256) external override {}
    function updateLiquidationPenalty(uint256) external override {}
    function updateFundingParams(uint256, uint256) external override {}
    function initializeMarket(uint256, bytes32, uint256, uint256, uint256, uint256, uint256) external override {}
    function initializeMarketWithSkew(uint256, bytes32, uint256, uint256, uint256, uint256, uint256, uint256) external override {}

    function getPosition(uint256) external view override returns (PositionView memory) {
        PositionView memory p;
        return p;
    }
    function getPositionsByTrader(address, uint256, uint256) external view override returns (PositionView[] memory, uint256) {
        return (new PositionView[](0), 0);
    }
    function getPositionsByMarket(uint256, uint256, uint256) external view override returns (PositionView[] memory, uint256) {
        return (new PositionView[](0), 0);
    }
    function getPositionStats() external view override returns (PositionStats memory) {
        PositionStats memory s;
        return s;
    }
    function getMarketStats(uint256) external view override returns (PositionStats memory) {
        PositionStats memory s;
        return s;
    }
    function getHealthFactor(uint256) external view override returns (uint256) { return 0; }
    function getLiquidationPrice(uint256) external view override returns (uint256) { return 0; }
    function getUnrealizedPnl(uint256, uint256) external view override returns (int256) { return 0; }
    function isPositionLiquidatable(uint256, uint256) external view override returns (bool) { return false; }
    function getAvailableMargin(uint256) external view override returns (uint256) { return 0; }
    function getMaxAdditionalSize(uint256, uint256) external view override returns (uint256) { return 0; }
    function batchGetPositions(uint256[] calldata) external view override returns (PositionView[] memory) {
        return new PositionView[](0);
    }
    function batchGetHealthFactors(uint256[] calldata) external view override returns (uint256[] memory) {
        return new uint256[](0);
    }
    function batchIsLiquidatable(uint256[] calldata, uint256[] calldata) external view override returns (bool[] memory) {
        return new bool[](0);
    }
    function previewLiquidation(uint256, uint256) external view override returns (uint256, uint256, uint256) {
        return (0, 0, 0);
    }
    function getTotalOpenInterest(uint256) external view override returns (uint256) {
        return 0;
    }
}
