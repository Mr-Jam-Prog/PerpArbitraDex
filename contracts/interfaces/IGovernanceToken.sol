// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title IGovernanceToken
 * @notice Interface for governance token with voting power
 * @dev Extends ERC20 with snapshot and delegation capabilities
 */
interface IGovernanceToken is IERC20, IERC20Permit {
    // ============ EVENTS ============

    event DelegateChanged(
        address indexed delegator,
        address indexed fromDelegate,
        address indexed toDelegate
    );

    event DelegateVotesChanged(
        address indexed delegate,
        uint256 previousBalance,
        uint256 newBalance
    );

    event SnapshotCreated(uint256 indexed snapshotId, uint256 timestamp);

    // ============ STATE-CHANGING FUNCTIONS ============

    /**
     * @notice Delegate votes to another address
     * @param delegatee Address to delegate votes to
     */
    function delegate(address delegatee) external;

    /**
     * @notice Delegate votes by signature
     * @param delegator Address delegating votes
     * @param delegatee Address receiving votes
     * @param nonce Delegator's nonce
     * @param expiry Expiry timestamp
     * @param v Signature v component
     * @param r Signature r component
     * @param s Signature s component
     */
    function delegateBySig(
        address delegator,
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @notice Create a new snapshot
     * @return snapshotId New snapshot ID
     */
    function snapshot() external returns (uint256 snapshotId);

    /**
     * @notice Mint new tokens
     * @param to Address to mint to
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external;

    /**
     * @notice Burn tokens
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external;

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Get delegate for an address
     * @param account Address to check
     * @return delegatee Current delegate
     */
    function delegates(address account) external view returns (address delegatee);

    /**
     * @notice Get voting power at a snapshot
     * @param account Address to check
     * @param snapshotId Snapshot ID
     * @return votingPower Voting power at snapshot
     */
    function getVotesAtSnapshot(address account, uint256 snapshotId)
        external
        view
        returns (uint256 votingPower);

    /**
     * @notice Get current voting power
     * @param account Address to check
     * @return votingPower Current voting power
     */
    function getCurrentVotes(address account) external view returns (uint256 votingPower);

    /**
     * @notice Get past voting power
     * @param account Address to check
     * @param blockNumber Block number to check
     * @return votingPower Voting power at block
     */
    function getPastVotes(address account, uint256 blockNumber)
        external
        view
        returns (uint256 votingPower);

    /**
     * @notice Get past total supply
     * @param blockNumber Block number to check
     * @return totalSupply Total supply at block
     */
    function getPastTotalSupply(uint256 blockNumber)
        external
        view
        returns (uint256 totalSupply);

    /**
     * @notice Check if snapshot exists
     * @param snapshotId Snapshot ID
     * @return exists True if snapshot exists
     */
    function snapshotExists(uint256 snapshotId) external view returns (bool exists);

    /**
     * @notice Get latest snapshot ID
     * @return snapshotId Latest snapshot ID
     */
    function getLatestSnapshotId() external view returns (uint256 snapshotId);

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Set snapshotter role
     * @param snapshotter Address with snapshot permission
     * @param enabled Whether enabled
     */
    function setSnapshotter(address snapshotter, bool enabled) external;

    /**
     * @notice Set minter role
     * @param minter Address with mint permission
     * @param enabled Whether enabled
     */
    function setMinter(address minter, bool enabled) external;

    /**
     * @notice Set burner role
     * @param burner Address with burn permission
     * @param enabled Whether enabled
     */
    function setBurner(address burner, bool enabled) external;
}