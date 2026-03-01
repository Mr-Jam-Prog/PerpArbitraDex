// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IOracleSanityChecker {
    function validatePrice(bytes32 feedId, uint256 price, uint256 minPrice, uint256 maxPrice) external view returns (bool);
    function validatePriceWithReference(bytes32 feedId, uint256 price, uint256 referencePrice, uint256 maxDeviationBps) external view returns (bool);
    function checkPrice(bytes32 feedId, uint256 price) external view returns (bool);
    function checkPriceDeviation(bytes32 feedId, uint256 price, uint256 referencePrice) external view returns (bool);
    function checkPriceVolatility(bytes32 feedId, uint256 price) external view returns (bool);
}
