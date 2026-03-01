// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IPythOracle {
    function getPrice(bytes32 feedId) external view returns (uint256);
    function getPriceData() external view returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence);
    function updatePrice(bytes[] calldata updateData, uint256 updateFee) external payable returns (bool success);
}
