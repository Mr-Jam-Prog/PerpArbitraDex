// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC1967} from "@openzeppelin/contracts/interfaces/IERC1967.sol";

/**
 * @title TransparentUpgradeableProxy
 * @notice Transparent proxy pattern implementation
 * @dev Separates admin and implementation roles to prevent selector clashes
 */
contract TransparentUpgradeableProxy {
    // ============ STORAGE SLOTS ============
    // Storage position of the address of the current implementation
    bytes32 private constant IMPLEMENTATION_SLOT = 
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;
    
    // Storage position of the address of the proxy admin
    bytes32 private constant ADMIN_SLOT = 
        0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    
    // ============ EVENTS ============
    event Upgraded(address indexed implementation);
    event AdminChanged(address previousAdmin, address newAdmin);
    
    // ============ MODIFIERS ============
    /**
     * @dev Throws if called by any account other than the admin.
     */
    modifier ifAdmin() {
        if (msg.sender == _admin()) {
            _;
        } else {
            _fallback();
        }
    }
    
    // ============ CONSTRUCTOR ============
    constructor(address _logic, address admin_, bytes memory _data) payable {
        assert(IMPLEMENTATION_SLOT == bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1));
        assert(ADMIN_SLOT == bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1));
        
        _setImplementation(_logic);
        _setAdmin(admin_);
        
        if (_data.length > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = _logic.delegatecall(_data);
            require(success, "Initialization failed");
        }
    }
    
    // ============ FALLBACK ============
    /**
     * @dev Fallback function that delegates calls to the implementation.
     * Will run if no other function in the contract matches the call data.
     */
    fallback() external payable virtual {
        _fallback();
    }
    
    /**
     * @dev Receive function that delegates calls to the implementation.
     */
    receive() external payable virtual {
        _fallback();
    }
    
    // ============ ADMIN FUNCTIONS ============
    /**
     * @dev Returns the current admin.
     */
    function admin() external ifAdmin returns (address admin_) {
        admin_ = _admin();
    }
    
    /**
     * @dev Returns the current implementation.
     */
    function implementation() external ifAdmin returns (address implementation_) {
        implementation_ = _implementation();
    }
    
    /**
     * @dev Changes the admin of the proxy.
     */
    function changeAdmin(address newAdmin) external virtual ifAdmin {
        require(newAdmin != address(0), "TransparentUpgradeableProxy: new admin is zero address");
        emit AdminChanged(_admin(), newAdmin);
        _setAdmin(newAdmin);
    }
    
    /**
     * @dev Upgrades the implementation of the proxy.
     */
    function upgradeTo(address newImplementation) external virtual ifAdmin {
        _upgradeTo(newImplementation);
    }
    
    /**
     * @dev Upgrades the implementation of the proxy and calls a function on it.
     */
    function upgradeToAndCall(
        address newImplementation,
        bytes memory data
    ) external payable virtual ifAdmin {
        _upgradeTo(newImplementation);
        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = newImplementation.delegatecall(data);
        require(success, "TransparentUpgradeableProxy: call failed");
    }
    
    // ============ INTERNAL FUNCTIONS ============
    /**
     * @dev Delegates the current call to the implementation.
     */
    function _fallback() internal virtual {
        _delegate(_implementation());
    }
    
    /**
     * @dev Delegates execution to an implementation contract.
     */
    function _delegate(address implementation_) internal virtual {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Copy msg.data. We take full control of memory in this inline assembly
            // block because it will not return to Solidity code. We overwrite the
            // Solidity scratch pad at memory position 0.
            calldatacopy(0, 0, calldatasize())
            
            // Call the implementation.
            // out and outsize are 0 because we don't know the size yet.
            let result := delegatecall(gas(), implementation_, 0, calldatasize(), 0, 0)
            
            // Copy the returned data.
            returndatacopy(0, 0, returndatasize())
            
            switch result
            // delegatecall returns 0 on error.
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
    
    /**
     * @dev Returns the current implementation address.
     */
    function _implementation() internal view virtual returns (address impl) {
        bytes32 slot = IMPLEMENTATION_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            impl := sload(slot)
        }
    }
    
    /**
     * @dev Stores a new address in the EIP1967 implementation slot.
     */
    function _setImplementation(address newImplementation) private {
        require(
            Address.isContract(newImplementation),
            "TransparentUpgradeableProxy: new implementation is not a contract"
        );
        
        bytes32 slot = IMPLEMENTATION_SLOT;
        
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, newImplementation)
        }
    }
    
    /**
     * @dev Perform implementation upgrade
     */
    function _upgradeTo(address newImplementation) internal {
        _setImplementation(newImplementation);
        emit Upgraded(newImplementation);
    }
    
    /**
     * @dev Returns the current admin.
     */
    function _admin() internal view virtual returns (address adm) {
        bytes32 slot = ADMIN_SLOT;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            adm := sload(slot)
        }
    }
    
    /**
     * @dev Stores a new address in the EIP1967 admin slot.
     */
    function _setAdmin(address newAdmin) private {
        bytes32 slot = ADMIN_SLOT;
        
        // solhint-disable-next-line no-inline-assembly
        assembly {
            sstore(slot, newAdmin)
        }
    }
}

// Helper library for address operations
library Address {
    /**
     * @dev Returns true if `account` is a contract.
     */
    function isContract(address account) internal view returns (bool) {
        // This method relies on extcodesize/address.code.length, which returns 0
        // for contracts in construction, since the code is only stored at the end
        // of the constructor execution.
        
        return account.code.length > 0;
    }
}