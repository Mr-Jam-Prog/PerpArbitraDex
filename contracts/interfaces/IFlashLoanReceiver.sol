// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IFlashLoanReceiver
 * @notice Interface for Aave-compatible flash loan receivers
 * @dev Follows Aave V3 flash loan interface
 */
interface IFlashLoanReceiver {
    /**
     * @notice Execute flash loan operation
     * @param assets Array of assets to flash loan
     * @param amounts Array of amounts to flash loan
     * @param premiums Array of premiums to repay
     * @param initiator Address initiating the flash loan
     * @param params Additional parameters encoded
     * @return success True if operation successful
     */
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool success);

    /**
     * @notice Get maximum flash loan amount for an asset
     * @param asset Asset address
     * @return maxAmount Maximum flash loan amount
     */
    function getMaxFlashLoan(address asset) external view returns (uint256 maxAmount);

    /**
     * @notice Get flash loan fee for an asset
     * @param asset Asset address
     * @return fee Fee in basis points
     */
    function getFlashLoanFee(address asset) external view returns (uint256 fee);
}