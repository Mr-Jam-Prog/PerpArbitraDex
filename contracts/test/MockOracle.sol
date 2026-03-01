// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract MockOracle {
    uint256 private _price;
    uint256 private _timestamp;
    uint256 private _confidence;
    bool private _valid = true;

    function setPrice(uint256 price) external {
        _price = price;
        _timestamp = block.timestamp;
    }

    function setFullPriceData(uint256 price, uint256 timestamp, uint256 confidence, bool valid) external {
        _price = price;
        _timestamp = timestamp;
        _confidence = confidence;
        _valid = valid;
    }

    function getPrice(bytes32 /*feedId*/) external view returns (uint256) {
        return _price;
    }

    function isPriceStale(bytes32 /*feedId*/) external view returns (bool) {
        return block.timestamp - _timestamp > 1 hours;
    }

    function getPriceData() external view returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence) {
        return (_valid, _price, _timestamp, _confidence);
    }
}
