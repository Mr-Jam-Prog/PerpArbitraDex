// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {ERC20Snapshot} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PerpDexToken
 * @notice Native governance token for PerpArbitraDEX
 * @dev ERC20 with voting, snapshots, and permit functionality
 */
contract PerpDexToken is ERC20, ERC20Permit, ERC20Votes, ERC20Snapshot, Ownable {
    // ============ IMMUTABLES ============
    uint256 public immutable MAX_SUPPLY;
    address public immutable emissionController;

    // ============ STATE VARIABLES ============
    mapping(address => bool) public minters;
    mapping(address => bool) public snapshoters;
    uint256 public totalMinted;

    // ============ EVENTS ============
    event MinterAdded(address indexed minter);
    event MinterRemoved(address indexed minter);
    event SnapshoterAdded(address indexed snapshotter);
    event SnapshoterRemoved(address indexed snapshotter);
    event Minted(address indexed to, uint256 amount, string reason);

    // ============ MODIFIERS ============
    modifier onlyMinter() {
        require(minters[msg.sender], "Only minter");
        _;
    }

    modifier onlySnapshoter() {
        require(snapshoters[msg.sender], "Only snapshoter");
        _;
    }

    // ============ CONSTRUCTOR ============
    constructor(
        string memory name,
        string memory symbol,
        uint256 maxSupply,
        address initialOwner,
        address _emissionController
    ) ERC20(name, symbol) ERC20Permit(name) {
        require(maxSupply > 0, "Invalid max supply");
        require(_emissionController != address(0), "Invalid emission controller");
        
        MAX_SUPPLY = maxSupply;
        emissionController = _emissionController;
        
        // Initial setup
        minters[_emissionController] = true;
        snapshoters[initialOwner] = true;
        
        emit MinterAdded(_emissionController);
        emit SnapshoterAdded(initialOwner);

        _transferOwnership(initialOwner);
    }

    // ============ MINTING FUNCTIONS ============

    /**
     * @notice Mint new tokens
     * @param to Address to mint to
     * @param amount Amount to mint
     * @param reason Reason for minting
     */
    function mint(address to, uint256 amount, string calldata reason) 
        external 
        onlyMinter 
    {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Invalid mint amount");
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        
        _mint(to, amount);
        totalMinted += amount;
        
        emit Minted(to, amount, reason);
    }

    /**
     * @notice Burn tokens
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external {
        require(
            msg.sender == from || allowance(from, msg.sender) >= amount,
            "Insufficient allowance"
        );
        
        _burn(from, amount);
    }

    // ============ SNAPSHOT FUNCTIONS ============

    /**
     * @notice Create a new snapshot
     * @return snapshotId The new snapshot ID
     */
    function snapshot() external onlySnapshoter returns (uint256) {
        return _snapshot();
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Add or remove minter
     * @param minter Address to update
     * @param enabled Whether enabled
     */
    function setMinter(address minter, bool enabled) external onlyOwner {
        require(minter != address(0), "Invalid minter");
        
        minters[minter] = enabled;
        
        if (enabled) {
            emit MinterAdded(minter);
        } else {
            emit MinterRemoved(minter);
        }
    }

    /**
     * @notice Add or remove snapshoter
     * @param snapshotter Address to update
     * @param enabled Whether enabled
     */
    function setSnapshoter(address snapshotter, bool enabled) external onlyOwner {
        require(snapshotter != address(0), "Invalid snapshotter");
        
        snapshoters[snapshotter] = enabled;
        
        if (enabled) {
            emit SnapshoterAdded(snapshotter);
        } else {
            emit SnapshoterRemoved(snapshotter);
        }
    }

    // ============ OVERRIDES ============

    function _beforeTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Snapshot)
    {
        super._beforeTokenTransfer(from, to, amount);
    }

    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount)
        internal
        override(ERC20, ERC20Votes)
    {
        super._burn(account, amount);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if address can mint
     * @param account Address to check
     * @return canMint True if can mint
     */
    function canMint(address account) external view returns (bool) {
        return minters[account];
    }

    /**
     * @notice Check if address can create snapshots
     * @param account Address to check
     * @return canSnapshot True if can snapshot
     */
    function canSnapshot(address account) external view returns (bool) {
        return snapshoters[account];
    }

    /**
     * @notice Get remaining mintable supply
     * @return remaining Remaining mintable tokens
     */
    function getRemainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}
