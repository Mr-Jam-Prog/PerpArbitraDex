// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IOracleSecurity} from "../interfaces/IOracleSecurity.sol";

contract MockOracleSecurity is IOracleSecurity {
    bool private _shouldFreeze;

    function setShouldFreeze(bool freeze) external {
        _shouldFreeze = freeze;
    }

    function shouldFreeze(bytes32 /*feedId*/) external view override returns (bool) {
        return _shouldFreeze;
    }

    function validatePrice(bytes32 /*feedId*/, uint256 /*price*/) external view override returns (bool) {
        return true;
    }

    receive() external payable {}
}
