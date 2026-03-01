// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface ITWAPOracle {
    function getPrice(bytes32 feedId, uint256 period) external view returns (uint256);
    function getPriceData() external view returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence);
    function update(uint256 price) external returns (bool success);
}
