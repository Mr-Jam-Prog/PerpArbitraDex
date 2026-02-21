// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract MockOracle {
    uint256 private _price;
    bool private _isStale;

    function setPrice(uint256 price) external {
        _price = price;
    }

    function setStale(bool isStale) external {
        _isStale = isStale;
    }

    function getPrice(bytes32 /*feedId*/) external view returns (uint256) {
        return _price;
    }

    function isPriceStale(bytes32 /*feedId*/) external view returns (bool) {
        return _isStale;
    }
}
