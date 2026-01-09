// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/**
 * @title IERC20Extended
 * @notice Extended ERC20 interface with metadata and permit
 * @dev Combines standard interfaces for convenience
 */
interface IERC20Extended is IERC20, IERC20Metadata {
    // No additional functions - just combines existing interfaces
    // This serves as a convenience interface for contracts needing both
}