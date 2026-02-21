// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IMarketRegistry {
    struct Market {
        bool isActive;
        string symbol;
        bytes32 oracleFeedId;
        address baseToken;
        address quoteToken;
        uint256 maxLeverage;
        uint256 minMarginRatio;
        uint256 liquidationFeeRatio;
        uint256 protocolFeeRatio;
        uint256 maxPositionSize;
        uint256 maxOpenInterest;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 version;
    }
    struct MarketUpdate {
        uint256 marketId;
        Market oldConfig;
        Market newConfig;
        uint256 timestamp;
        address updatedBy;
    }
    function addMarket(string calldata symbol, bytes32 oracleFeedId, address baseToken, address quoteToken, uint256 maxLeverage, uint256 minMarginRatio, uint256 liquidationFeeRatio, uint256 protocolFeeRatio, uint256 maxPositionSize, uint256 maxOpenInterest) external returns (uint256 marketId);
    function updateMarket(uint256 marketId, uint256 maxLeverage, uint256 minMarginRatio, uint256 liquidationFeeRatio, uint256 protocolFeeRatio, uint256 maxPositionSize, uint256 maxOpenInterest) external;
    function setMarketStatus(uint256 marketId, bool isActive) external;
    function updateOracleFeed(uint256 marketId, bytes32 newFeedId) external;
    function getMarket(uint256 marketId) external view returns (Market memory);
    function getMarketBySymbol(string calldata symbol) external view returns (uint256 marketId, Market memory market);
    function getMarketStatus(uint256 marketId) external view returns (bool isActive, uint256 version);
    function validateMarket(uint256 marketId, uint256 positionSize) external view returns (bool valid, string memory reason);
    function getAllMarkets() external view returns (uint256[] memory);
    function getActiveMarkets() external view returns (uint256[] memory);
    function getMarketHistory(uint256 marketId, uint256 limit) external view returns (MarketUpdate[] memory history);
    function isMarketActive(uint256 marketId) external view returns (bool);
}
