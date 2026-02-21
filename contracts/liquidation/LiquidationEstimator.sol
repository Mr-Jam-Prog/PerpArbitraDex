// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IPerpEngine} from "../interfaces/IPerpEngine.sol";
import {ILiquidationEngine} from "../interfaces/ILiquidationEngine.sol";

contract LiquidationEstimator {
    IPerpEngine public immutable perpEngine;
    ILiquidationEngine public immutable liquidationEngine;

    constructor(address _perpEngine, address _liquidationEngine) {
        perpEngine = IPerpEngine(_perpEngine);
        liquidationEngine = ILiquidationEngine(_liquidationEngine);
    }

    function estimateLiquidation(uint256 positionId, uint256 currentPrice)
        external
        view
        returns (uint256 reward, uint256 penalty)
    {
        (reward, penalty, ) = perpEngine.previewLiquidation(positionId, currentPrice);
    }
}
