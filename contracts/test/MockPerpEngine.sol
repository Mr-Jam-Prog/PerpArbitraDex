// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {IPositionViewer} from "../interfaces/IPositionViewer.sol";

contract MockPerpEngine is IPerpEngine {
    mapping(uint256 => Position) private _positions;
    mapping(uint256 => PositionView) private _positionViews;
    
    function setPosition(uint256 positionId, Position calldata pos) external {
        _positions[positionId] = pos;
    }
    
    function setPositionView(uint256 positionId, PositionView calldata viewData) external {
        _positionViews[positionId] = viewData;
    }

    // IPerpEngine Implementation
    function openPosition(TradeParams calldata params) external override returns (uint256) { return 0; }
    function increasePosition(uint256 positionId, uint256 sizeAdded, uint256 marginAdded) external override {}
    function decreasePosition(uint256 positionId, uint256 sizeReduced, uint256 marginReduced) external override {}
    function closePosition(uint256 positionId) external override {}
    function liquidatePosition(LiquidateParams calldata params) external override returns (uint256) {
        _positions[params.positionId].size -= params.sizeToLiquidate;
        _positionViews[params.positionId].size -= params.sizeToLiquidate;
        if (_positions[params.positionId].size == 0) {
            _positions[params.positionId].isActive = false;
            _positionViews[params.positionId].healthFactor = 1e18; // Reset HF
        }
        return 0; 
    }
    function accrueFunding(uint256 marketId) external override {}
    function batchAccrueFunding(uint256[] calldata marketIds) external override {}
    function addMargin(uint256 positionId, uint256 amount) external override {}
    function removeMargin(uint256 positionId, uint256 amount) external override {}
    function getPositionInternal(uint256 positionId) external view override returns (Position memory) {
        return _positions[positionId];
    }
    
    // IPositionViewer Implementation
    function getPosition(uint256 positionId) external view override returns (PositionView memory) {
        return _positionViews[positionId];
    }
    function getPositionsByTrader(address trader, uint256 cursor, uint256 limit) external view override returns (PositionView[] memory positions, uint256 newCursor) {
        return (positions, 0);
    }
    function getPositionsByMarket(uint256 marketId, uint256 cursor, uint256 limit) external view override returns (PositionView[] memory positions, uint256 newCursor) {
        return (positions, 0);
    }
    function getPositionStats() external view override returns (PositionStats memory) {
        PositionStats memory stats;
        return stats;
    }
    function getMarketStats(uint256 marketId) external view override returns (PositionStats memory) {
        PositionStats memory stats;
        return stats;
    }
    function getHealthFactor(uint256 positionId) external view override returns (uint256) {
        return _positionViews[positionId].healthFactor;
    }
    function getLiquidationPrice(uint256 positionId) external view override returns (uint256) {
        return _positionViews[positionId].liquidationPrice;
    }
    function getUnrealizedPnl(uint256 positionId, uint256 currentPrice) external view override returns (int256) {
        return _positionViews[positionId].unrealizedPnl;
    }
    function isPositionLiquidatable(uint256 positionId, uint256 currentPrice) external view override returns (bool) {
        return _positionViews[positionId].healthFactor < 1e18;
    }
    function getAvailableMargin(uint256 positionId) external view override returns (uint256) {
        return 0;
    }
    function getMaxAdditionalSize(uint256 positionId, uint256 additionalMargin) external view override returns (uint256) {
        return 0;
    }
    function batchGetPositions(uint256[] calldata positionIds) external view override returns (PositionView[] memory views) {
        views = new PositionView[](positionIds.length);
        for(uint256 i=0; i<positionIds.length; i++) {
            views[i] = _positionViews[positionIds[i]];
        }
        return views;
    }
    function batchGetHealthFactors(uint256[] calldata positionIds) external view override returns (uint256[] memory healthFactors) {
        healthFactors = new uint256[](positionIds.length);
        for(uint256 i=0; i<positionIds.length; i++) {
            healthFactors[i] = _positionViews[positionIds[i]].healthFactor;
        }
        return healthFactors;
    }
    function batchIsLiquidatable(uint256[] calldata positionIds, uint256[] calldata currentPrices) external view override returns (bool[] memory liquidatable) {
        liquidatable = new bool[](positionIds.length);
        for(uint256 i=0; i<positionIds.length; i++) {
            liquidatable[i] = _positionViews[positionIds[i]].healthFactor < 1e18;
        }
        return liquidatable;
    }

    function previewLiquidation(uint256 positionId, uint256 currentPrice) external view override returns (uint256 reward, uint256 penalty, uint256 newHealthFactor) {
        return (0, 0, 1e18);
    }

    // Admin Functions
    function updateProtocolFee(uint256 newProtocolFee) external override {}
    function updateLiquidationPenalty(uint256 newLiquidationPenalty) external override {}
    function updateFundingParams(uint256 newFundingInterval, uint256 newMaxFundingRate) external override {}
    function initializeMarket(uint256 marketId, bytes32 oracleFeedId, uint256 maxLeverage, uint256 minMarginRatio, uint256 minPositionSize, uint256 liquidationFeeRatio, uint256 protocolFeeRatio) external override {}
}
