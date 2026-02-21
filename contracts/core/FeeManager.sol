// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FeeManager is Ownable {
    using SafeERC20 for IERC20;

    event FeeDistributed(address indexed token, uint256 amount);

    constructor(address initialOwner) {
        _transferOwnership(initialOwner);
    }

    function distributeFees(address token, address[] calldata recipients, uint256[] calldata shares) external onlyOwner {
        require(recipients.length == shares.length, "Length mismatch");
        uint256 totalBalance = IERC20(token).balanceOf(address(this));

        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 amount = (totalBalance * shares[i]) / 10000;
            if (amount > 0) {
                IERC20(token).safeTransfer(recipients[i], amount);
            }
        }

        emit FeeDistributed(token, totalBalance);
    }
}
