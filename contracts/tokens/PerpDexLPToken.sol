// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PerpDexLPToken
 * @notice LP token for PerpArbitraDEX liquidity pools
 * @dev ERC20 token with controlled minting and burning
 */
contract PerpDexLPToken is ERC20, ERC20Permit, Ownable {
    // ============ IMMUTABLES ============
    address public immutable liquidityPool;
    
    // ============ STATE VARIABLES ============
    bool public transfersEnabled = true;
    
    // ============ EVENTS ============
    event Minted(address indexed to, uint256 amount, string reason);
    event Burned(address indexed from, uint256 amount, string reason);
    event TransfersToggled(bool enabled);
    
    // ============ MODIFIERS ============
    modifier onlyLiquidityPool() {
        require(msg.sender == liquidityPool, "Only liquidity pool");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        string memory name,
        string memory symbol,
        address _liquidityPool,
        address initialOwner
    ) ERC20(name, symbol) ERC20Permit(name) {
        _transferOwnership(initialOwner);
        require(_liquidityPool != address(0), "Invalid liquidity pool");
        require(initialOwner != address(0), "Invalid owner");
        
        liquidityPool = _liquidityPool;
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Mint new LP tokens
     * @param to Address to mint to
     * @param amount Amount to mint
     * @param reason Reason for minting
     */
    function mint(address to, uint256 amount, string calldata reason) 
        external 
        onlyLiquidityPool 
    {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Invalid mint amount");
        
        _mint(to, amount);
        
        emit Minted(to, amount, reason);
    }
    
    /**
     * @notice Burn LP tokens
     * @param from Address to burn from
     * @param amount Amount to burn
     * @param reason Reason for burning
     */
    function burn(address from, uint256 amount, string calldata reason) 
        external 
        onlyLiquidityPool 
    {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Invalid burn amount");
        require(balanceOf(from) >= amount, "Insufficient balance");
        
        _burn(from, amount);
        
        emit Burned(from, amount, reason);
    }
    
    /**
     * @notice Enable or disable transfers
     * @param enabled Whether transfers are enabled
     */
    function setTransfersEnabled(bool enabled) external onlyOwner {
        transfersEnabled = enabled;
        
        emit TransfersToggled(enabled);
    }
    
    // ============ OVERRIDES ============
    
    /**
     * @dev Override transfer to respect transfersEnabled flag
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (from != address(0) && to != address(0)) {
            require(transfersEnabled, "Transfers disabled");
        }
        
        super._beforeTokenTransfer(from, to, amount);
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Check if address can mint
     * @param account Address to check
     * @return canMint True if can mint
     */
    function canMint(address account) external view returns (bool) {
        return account == liquidityPool;
    }
    
    /**
     * @notice Check if address can burn
     * @param account Address to check
     * @return canBurn True if can burn
     */
    function canBurn(address account) external view returns (bool) {
        return account == liquidityPool;
    }
    
    /**
     * @notice Get total mintable supply (no cap)
     * @return maxSupply Maximum supply (0 = unlimited)
     */
    function maxSupply() external pure returns (uint256) {
        return 0; // Unlimited supply
    }
}