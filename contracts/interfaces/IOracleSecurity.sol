// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IOracleSecurity {
    function validatePrice(bytes32 feedId, uint256 price) external view returns (bool);
    function shouldFreeze(bytes32 feedId) external view returns (bool);
}
