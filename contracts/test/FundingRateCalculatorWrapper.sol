// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {FundingRateCalculator} from "../libraries/FundingRateCalculator.sol";

contract FundingRateCalculatorWrapper {
    using FundingRateCalculator for FundingRateCalculator.FundingState;

    function calculateFundingRate(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 skewScale,
        uint256 timeElapsed
    ) external pure returns (int256) {
        return FundingRateCalculator.calculateFundingRate(
            longOpenInterest,
            shortOpenInterest,
            skewScale,
            timeElapsed
        );
    }

    function calculateFundingPayment(
        uint256 positionSize,
        int256 fundingRate,
        uint256 timeElapsed,
        bool isLong
    ) external pure returns (int256) {
        return FundingRateCalculator.calculateFundingPayment(
            positionSize,
            fundingRate,
            timeElapsed,
            isLong
        );
    }

    function updateFundingState(
        FundingRateCalculator.FundingState memory state,
        int256 newFundingRate,
        uint256 currentTime
    ) external pure returns (FundingRateCalculator.FundingState memory) {
        return FundingRateCalculator.updateFundingState(
            state,
            newFundingRate,
            currentTime
        );
    }

    function calculateTWAPFundingRate(
        int256[] memory fundingRates,
        uint256[] memory timestamps,
        uint256 startTime,
        uint256 endTime
    ) external pure returns (int256) {
        return FundingRateCalculator.calculateTWAPFundingRate(
            fundingRates,
            timestamps,
            startTime,
            endTime
        );
    }

    function calculatePremium(
        uint256 longOpenInterest,
        uint256 shortOpenInterest,
        uint256 skewScale
    ) external pure returns (int256) {
        return FundingRateCalculator.calculatePremium(
            longOpenInterest,
            shortOpenInterest,
            skewScale
        );
    }

    function calculateMarkPrice(
        uint256 indexPrice,
        int256 fundingRate,
        uint256 timeToNextFunding
    ) external pure returns (uint256) {
        return FundingRateCalculator.calculateMarkPrice(
            indexPrice,
            fundingRate,
            timeToNextFunding
        );
    }
}
