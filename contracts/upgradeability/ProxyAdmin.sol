// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface ITransparentUpgradeableProxy {
    function upgradeTo(address newImplementation) external;
    function upgradeToAndCall(address newImplementation, bytes memory data) external payable;
    function changeAdmin(address newAdmin) external;
    function admin() external returns (address);
    function implementation() external returns (address);
}

/**
 * @title ProxyAdmin
 * @notice Administrative contract for managing proxy upgrades
 * @dev Owned by governance timelock, manages multiple proxies
 */
contract ProxyAdmin is Ownable {
    // ============ EVENTS ============
    event ProxyUpgraded(address indexed proxy, address indexed implementation);
    event ProxyAdminChanged(address indexed proxy, address indexed newAdmin);
    event ProxyOwnershipTransferred(address indexed proxy, address indexed newOwner);
    
    // ============ CONSTRUCTOR ============
    constructor(address initialOwner) Ownable(initialOwner) {
        require(initialOwner != address(0), "Invalid owner");
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Get proxy implementation
     * @param proxy Proxy address
     * @return implementation Current implementation address
     */
    function getProxyImplementation(ITransparentUpgradeableProxy proxy) 
        external 
        view 
        returns (address) 
    {
        // We need to run via static call
        (bool success, bytes memory returndata) = address(proxy).staticcall(
            abi.encodeWithSignature("implementation()")
        );
        require(success, "Static call failed");
        return abi.decode(returndata, (address));
    }
    
    /**
     * @notice Get proxy admin
     * @param proxy Proxy address
     * @return admin Current admin address
     */
    function getProxyAdmin(ITransparentUpgradeableProxy proxy) 
        external 
        view 
        returns (address) 
    {
        (bool success, bytes memory returndata) = address(proxy).staticcall(
            abi.encodeWithSignature("admin()")
        );
        require(success, "Static call failed");
        return abi.decode(returndata, (address));
    }
    
    /**
     * @notice Change proxy admin
     * @param proxy Proxy address
     * @param newAdmin New admin address
     */
    function changeProxyAdmin(
        ITransparentUpgradeableProxy proxy, 
        address newAdmin
    ) external onlyOwner {
        proxy.changeAdmin(newAdmin);
        emit ProxyAdminChanged(address(proxy), newAdmin);
    }
    
    /**
     * @notice Upgrade proxy implementation
     * @param proxy Proxy address
     * @param implementation New implementation address
     */
    function upgrade(
        ITransparentUpgradeableProxy proxy, 
        address implementation
    ) external onlyOwner {
        proxy.upgradeTo(implementation);
        emit ProxyUpgraded(address(proxy), implementation);
    }
    
    /**
     * @notice Upgrade proxy and call
     * @param proxy Proxy address
     * @param implementation New implementation address
     * @param data Call data for initialization
     */
    function upgradeAndCall(
        ITransparentUpgradeableProxy proxy,
        address implementation,
        bytes memory data
    ) external payable onlyOwner {
        proxy.upgradeToAndCall{value: msg.value}(implementation, data);
        emit ProxyUpgraded(address(proxy), implementation);
    }
    
    /**
     * @notice Transfer proxy ownership
     * @param proxy Proxy address
     * @param newOwner New owner address
     */
    function transferProxyOwnership(
        ITransparentUpgradeableProxy proxy,
        address newOwner
    ) external onlyOwner {
        require(newOwner != address(0), "Invalid new owner");
        
        // Change proxy admin to new owner
        proxy.changeAdmin(newOwner);
        
        emit ProxyAdminChanged(address(proxy), newOwner);
        emit ProxyOwnershipTransferred(address(proxy), newOwner);
    }
    
    /**
     * @notice Batch upgrade proxies
     * @param proxies Array of proxy addresses
     * @param implementations Array of new implementation addresses
     */
    function batchUpgrade(
        ITransparentUpgradeableProxy[] calldata proxies,
        address[] calldata implementations
    ) external onlyOwner {
        require(proxies.length == implementations.length, "Array length mismatch");
        require(proxies.length > 0, "Empty arrays");
        require(proxies.length <= 10, "Too many proxies"); // Gas limit
        
        for (uint256 i = 0; i < proxies.length; i++) {
            proxies[i].upgradeTo(implementations[i]);
            emit ProxyUpgraded(address(proxies[i]), implementations[i]);
        }
    }
    
    /**
     * @notice Batch change proxy admins
     * @param proxies Array of proxy addresses
     * @param newAdmins Array of new admin addresses
     */
    function batchChangeAdmin(
        ITransparentUpgradeableProxy[] calldata proxies,
        address[] calldata newAdmins
    ) external onlyOwner {
        require(proxies.length == newAdmins.length, "Array length mismatch");
        require(proxies.length > 0, "Empty arrays");
        require(proxies.length <= 10, "Too many proxies");
        
        for (uint256 i = 0; i < proxies.length; i++) {
            proxies[i].changeAdmin(newAdmins[i]);
            emit ProxyAdminChanged(address(proxies[i]), newAdmins[i]);
        }
    }
    
    // ============ EMERGENCY FUNCTIONS ============
    
    /**
     * @notice Emergency recover ETH
     * @param amount Amount to recover
     */
    function emergencyRecoverETH(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient balance");
        
        (bool success, ) = owner().call{value: amount}("");
        require(success, "ETH transfer failed");
    }
    
    /**
     * @notice Emergency recover tokens
     * @param token Token address
     * @param amount Amount to recover
     */
    function emergencyRecoverToken(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "Invalid token");
        
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", owner(), amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "Token transfer failed");
    }
}