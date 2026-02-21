// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IRWAOracleAdapter {
    function getPrice(bytes32 feedId) external view returns (uint256);
    function getPriceData(bytes32 feedId) external view returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence);
    function updatePrice(bytes32 feedId, uint256 price, uint256 timestamp) external returns (bool success);
}
