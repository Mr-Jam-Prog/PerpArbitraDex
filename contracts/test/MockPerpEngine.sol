// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IPositionViewer} from "../interfaces/IPositionViewer.sol";

contract MockPerpEngine is IPerpEngine {
    mapping(uint256 => Position) private _positions;
    mapping(uint256 => PositionView) private _positionViews;
    mapping(uint256 => uint256) private _healthFactors;
    mapping(uint256 => uint256) private _liqPrices;
    mapping(uint256 => int256) private _pnl;
    
    address private _ammPool;

    function setAMMPool(address amm) external {
        _ammPool = amm;
    }

    // Standard setPosition for tests that use the struct
    function setPosition(uint256 positionId, Position calldata pos) external {
        _positions[positionId] = pos;
        _positions[positionId].isActive = true;
    }

    // Legacy setPosition for tests that use flat arguments
    function setPosition(
        uint256 positionId,
        string calldata /*market*/,
        bool isLong,
        uint256 size,
        uint256 entryPrice,
        uint256 margin
    ) external {
        _positions[positionId] = Position({
            trader: msg.sender,
            marketId: 1,
            isLong: isLong,
            size: size,
            margin: margin,
            entryPrice: entryPrice,
            leverage: 0,
            lastFundingAccrued: block.timestamp,
            openTime: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });
    }

    function setPositionView(uint256 positionId, PositionView calldata viewData) external {
        _positionViews[positionId] = viewData;
        _positions[positionId].isActive = true;
        _healthFactors[positionId] = viewData.healthFactor;
        _liqPrices[positionId] = viewData.liquidationPrice;
        _pnl[positionId] = viewData.unrealizedPnl;
        // Copy basic data to _positions too if needed
        _positions[positionId].trader = viewData.trader;
        _positions[positionId].marketId = viewData.marketId;
        _positions[positionId].size = viewData.size;
    }

    function setHealthFactor(uint256 positionId, uint256 hf) external {
        _healthFactors[positionId] = hf;
    }

    // Required by IPerpEngine
    function openPosition(TradeParams calldata) external override returns (uint256) { return 0; }
    function increasePosition(uint256, uint256, uint256) external override {}
    function decreasePosition(uint256, uint256, uint256) external override {}
    function closePosition(uint256) external override {}

    function liquidatePosition(LiquidateParams calldata params) external override returns (uint256) {
        // Actual liquidation logic in mock
        _positions[params.positionId].size = 0;
        _positions[params.positionId].isActive = false;
        if (_positionViews[params.positionId].positionId != 0) {
            _positionViews[params.positionId].size = 0;
        }
        return 0; 
    }

    function accrueFunding(uint256) external override {}
    function batchAccrueFunding(uint256[] calldata) external override {}
    function addMargin(uint256, uint256) external override {}
    function removeMargin(uint256, uint256) external override {}

    function getPositionInternal(uint256 positionId) external view override returns (Position memory) {
        return _positions[positionId];
    }

    // Required by IPositionViewer
    function getPosition(uint256 positionId) public view override returns (PositionView memory) {
        if (_positionViews[positionId].positionId != 0) {
            return _positionViews[positionId];
        }
        Position storage p = _positions[positionId];
        return PositionView({
            positionId: positionId,
            trader: p.trader,
            marketId: p.marketId,
            isLong: p.isLong,
            size: p.size,
            margin: p.margin,
            entryPrice: p.entryPrice,
            leverage: p.leverage,
            liquidationPrice: _liqPrices[positionId],
            healthFactor: _healthFactors[positionId],
            unrealizedPnl: _pnl[positionId],
            fundingAccrued: 0,
            openTime: p.openTime,
            lastUpdated: p.lastUpdated
        });
    }

    function getPositionsByTrader(address, uint256, uint256) external view override returns (PositionView[] memory, uint256) {
        return (new PositionView[](0), 0);
    }
    function getPositionsByMarket(uint256, uint256, uint256) external view override returns (PositionView[] memory, uint256) {
        return (new PositionView[](0), 0);
    }
    function getPositionStats() external view override returns (PositionStats memory) {
        return PositionStats({
            totalPositions: 0,
            totalLongSize: 0,
            totalShortSize: 0,
            totalMargin: 0,
            totalPnl: 0
        });
    }
    function getMarketStats(uint256) external view override returns (PositionStats memory) {
        return PositionStats({
            totalPositions: 0,
            totalLongSize: 0,
            totalShortSize: 0,
            totalMargin: 0,
            totalPnl: 0
        });
    }
    function getHealthFactor(uint256 positionId) public view override returns (uint256) {
        return _healthFactors[positionId];
    }
    function getLiquidationPrice(uint256 positionId) external view override returns (uint256) {
        return _liqPrices[positionId];
    }
    function getUnrealizedPnl(uint256 positionId, uint256) external view override returns (int256) {
        return _pnl[positionId];
    }
    function isPositionLiquidatable(uint256 positionId, uint256) external view override returns (bool) {
        return _healthFactors[positionId] < 1e18 && _healthFactors[positionId] > 0;
    }
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

    // Admin functions
    function updateProtocolFee(uint256) external override {}
    function updateLiquidationPenalty(uint256) external override {}
    function updateFundingParams(uint256, uint256) external override {}
    function initializeMarket(
        uint256,
        bytes32,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256
    ) external override {}

    receive() external payable {}
}
