// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract MockAavePool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external {
        // Simple mock: call executeOperation on receiver
        uint256[] memory premiums = new uint256[](assets.length);
        for (uint256 i = 0; i < assets.length; i++) {
            premiums[i] = (amounts[i] * 9) / 10000; // 0.09% fee
        }

        (bool success, ) = receiverAddress.call(
            abi.encodeWithSignature(
                "executeOperation(address[],uint256[],uint256[],address,bytes)",
                assets,
                amounts,
                premiums,
                msg.sender,
                params
            )
        );
        require(success, "Flash loan execution failed");
    }

    function FLASHLOAN_PREMIUM_TOTAL() external pure returns (uint256) {
        return 9;
    }
}
