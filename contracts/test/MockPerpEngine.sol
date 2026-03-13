// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";

contract MockPerpEngine is IPerpEngine {
    function openPosition(TradeParams calldata) external override returns (uint256) { return 0; }
    function increasePosition(uint256, uint256, uint256) external override {}
    function decreasePosition(uint256, uint256, uint256) external override {}
    function closePosition(uint256) external override {}
    function liquidatePosition(LiquidateParams calldata params) external override returns (uint256) {
        delete _positions[params.positionId];
        delete _posViews[params.positionId];
        delete _hfs[params.positionId];
        return 0;
    }
    function accrueFunding(uint256) external override {}
    function batchAccrueFunding(uint256[] calldata) external override {}
    function addMargin(uint256, uint256) external override {}
    function removeMargin(uint256, uint256) external override {}
    function getPositionInternal(uint256 id) external view override returns (Position memory) {
        return _positions[id];
    }
    function updateProtocolFee(uint256) external override {}
    function updateLiquidationPenalty(uint256) external override {}
    function updateFundingParams(uint256, uint256) external override {}
    function initializeMarket(uint256, bytes32, uint256, uint256, uint256, uint256, uint256) external override {}
    function initializeMarketWithSkew(uint256, bytes32, uint256, uint256, uint256, uint256, uint256, uint256) external override {}

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
    function getMarketOracleFeed(uint256) external view override returns (bytes32) {
        return bytes32(uint256(1));
    }

    mapping(uint256 => PositionView) private _posViews;
    mapping(uint256 => Position) private _positions;
    mapping(uint256 => uint256) private _hfs;

    function setPositionView(uint256 id, PositionView calldata v) external {
        _posViews[id] = v;
        _positions[id].trader = v.trader;
        _positions[id].marketId = v.marketId;
        _positions[id].size = v.size;
        _positions[id].isActive = v.size > 0;
    }

    function setPositionInternal(uint256 id, Position calldata p) external {
        _positions[id] = p;
    }
    function setHealthFactor(uint256 id, uint256 hf) external {
        _hfs[id] = hf;
    }
    function getPosition(uint256 id) external view override returns (PositionView memory) {
        return _posViews[id];
    }
    function getHealthFactor(uint256 id) external view override returns (uint256) {
        return _hfs[id] > 0 ? _hfs[id] : _posViews[id].healthFactor;
    }
    function getPositionStatus(uint256 id) external view override returns (bool, bool, uint256) {
        uint256 hf = _hfs[id] > 0 ? _hfs[id] : _posViews[id].healthFactor;
        return (true, hf < 1e18, hf);
    }
}
