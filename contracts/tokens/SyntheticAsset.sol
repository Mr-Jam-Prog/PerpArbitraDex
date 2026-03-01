// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SyntheticAsset
 * @notice Synthetic token representing market exposure
 * @dev Non-transferable ERC20 token minted/burned by PerpEngine
 */
contract SyntheticAsset is ERC20, Ownable {
    // ============ IMMUTABLES ============
    address public immutable perpEngine;
    uint256 public immutable marketId;
    
    // ============ STATE VARIABLES ============
    bool public transfersEnabled = false; // Synthetic tokens typically non-transferable
    
    // ============ EVENTS ============
    event SyntheticMinted(address indexed to, uint256 amount, uint256 price);
    event SyntheticBurned(address indexed from, uint256 amount, uint256 price);
    event TransfersToggled(bool enabled);
    
    // ============ MODIFIERS ============
    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "Only PerpEngine");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        string memory name,
        string memory symbol,
        address _perpEngine,
        uint256 _marketId,
        address initialOwner
    ) ERC20(name, symbol) {
        _transferOwnership(initialOwner);
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(initialOwner != address(0), "Invalid owner");
        
        perpEngine = _perpEngine;
        marketId = _marketId;
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Mint synthetic tokens
     * @param to Address to mint to
     * @param amount Amount to mint
     * @param price Current market price
     */
    function mint(address to, uint256 amount, uint256 price) 
        external 
        onlyPerpEngine 
    {
        require(to != address(0), "Cannot mint to zero address");
        require(amount > 0, "Invalid mint amount");
        require(price > 0, "Invalid price");
        
        _mint(to, amount);
        
        emit SyntheticMinted(to, amount, price);
    }
    
    /**
     * @notice Burn synthetic tokens
     * @param from Address to burn from
     * @param amount Amount to burn
     * @param price Current market price
     */
    function burn(address from, uint256 amount, uint256 price) 
        external 
        onlyPerpEngine 
    {
        require(from != address(0), "Cannot burn from zero address");
        require(amount > 0, "Invalid burn amount");
        require(balanceOf(from) >= amount, "Insufficient balance");
        require(price > 0, "Invalid price");
        
        _burn(from, amount);
        
        emit SyntheticBurned(from, amount, price);
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
        return account == perpEngine;
    }
    
    /**
     * @notice Check if address can burn
     * @param account Address to check
     * @return canBurn True if can burn
     */
    function canBurn(address account) external view returns (bool) {
        return account == perpEngine;
    }
    
    /**
     * @notice Get total exposure
     * @return longExposure Total long positions
     * @return shortExposure Total short positions
     */
    function getExposure() external view returns (uint256 longExposure, uint256 shortExposure) {
        // In production, would track long/short separately
        // For this example, total supply represents net exposure
        return (totalSupply(), 0);
    }
    
    /**
     * @notice Check if token represents long or short position
     * @return isLong True if long position token
     */
    function isLong() external pure returns (bool) {
        // This would be configured per token
        return true;
    }
}