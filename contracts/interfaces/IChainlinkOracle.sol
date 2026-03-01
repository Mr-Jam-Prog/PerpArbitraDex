// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IChainlinkOracle {
    function getPriceData() external view returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence);
    function updatePrice() external returns (bool success);
    function isPriceStale() external view returns (bool);
    function decimals() external view returns (uint8);
}
