// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

// LayerZero interfaces (simplified for example)
interface ILayerZeroEndpoint {
    function send(
        uint16 dstChainId,
        bytes calldata destination,
        bytes calldata payload,
        address payable refundAddress,
        address zroPaymentAddress,
        bytes calldata adapterParams
    ) external payable;
    
    function estimateFees(
        uint16 dstChainId,
        address userApplication,
        bytes calldata payload,
        bool payInZRO,
        bytes calldata adapterParams
    ) external view returns (uint256 nativeFee, uint256 zroFee);
}

/**
 * @title CrossChainMessenger
 * @notice Cross-chain messaging for multi-chain protocol deployment
 * @dev Uses LayerZero for cross-chain communication with replay protection
 */
contract CrossChainMessenger is AccessControl, ReentrancyGuard {
    // ============ ROLES ============
    bytes32 public constant MESSENGER_ROLE = keccak256("MESSENGER_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    
    // ============ IMMUTABLES ============
    ILayerZeroEndpoint public immutable lzEndpoint;
    address public immutable perpEngine;
    
    // ============ STATE VARIABLES ============
    mapping(uint16 => bytes) public trustedRemoteLookup;
    mapping(uint256 => bool) public executedMessages;
    mapping(uint16 => uint256) public lastMessageNonce;
    
    uint256 public gasBuffer = 100_000;
    uint256 public messageExpiry = 1 hours;
    
    // Message type constants
    uint8 public constant MSG_TYPE_POSITION_UPDATE = 1;
    uint8 public constant MSG_TYPE_GOVERNANCE = 2;
    uint8 public constant MSG_TYPE_ORACLE = 3;
    uint8 public constant MSG_TYPE_EMERGENCY = 4;
    
    // ============ STRUCTS ============
    struct CrossChainMessage {
        uint8 msgType;
        uint256 messageId;
        uint16 srcChainId;
        uint16 dstChainId;
        uint256 nonce;
        address sender;
        bytes payload;
        uint256 timestamp;
    }
    
    // ============ EVENTS ============
    event MessageSent(
        uint256 indexed messageId,
        uint8 msgType,
        uint16 srcChainId,
        uint16 dstChainId,
        uint256 nonce,
        address sender,
        bytes payload,
        uint256 timestamp
    );
    
    event MessageReceived(
        uint256 indexed messageId,
        uint8 msgType,
        uint16 srcChainId,
        uint16 dstChainId,
        uint256 nonce,
        address sender,
        bytes payload,
        uint256 timestamp
    );
    
    event MessageFailed(
        uint256 indexed messageId,
        uint16 srcChainId,
        uint16 dstChainId,
        uint256 nonce,
        bytes reason
    );
    
    event TrustedRemoteSet(uint16 chainId, bytes remoteAddress);
    event GasBufferUpdated(uint256 oldBuffer, uint256 newBuffer);
    event MessageExpiryUpdated(uint256 oldExpiry, uint256 newExpiry);
    
    // ============ MODIFIERS ============
    modifier onlyMessenger() {
        require(hasRole(MESSENGER_ROLE, msg.sender), "Only messenger");
        _;
    }
    
    modifier onlyGovernor() {
        require(hasRole(GOVERNOR_ROLE, msg.sender), "Only governor");
        _;
    }
    
    // ============ CONSTRUCTOR ============
    constructor(
        address _lzEndpoint,
        address _perpEngine,
        address initialGovernor
    ) {
        require(_lzEndpoint != address(0), "Invalid endpoint");
        require(_perpEngine != address(0), "Invalid PerpEngine");
        require(initialGovernor != address(0), "Invalid governor");
        
        lzEndpoint = ILayerZeroEndpoint(_lzEndpoint);
        perpEngine = _perpEngine;
        
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(GOVERNOR_ROLE, initialGovernor);
        _setupRole(MESSENGER_ROLE, _perpEngine);
    }
    
    // ============ EXTERNAL FUNCTIONS ============
    
    /**
     * @notice Send cross-chain message
     * @param dstChainId Destination chain ID
     * @param msgType Message type
     * @param payload Message payload
     * @param refundAddress Address for refunds
     * @param zroPaymentAddress ZRO payment address
     * @param adapterParams LayerZero adapter parameters
     */
    function sendMessage(
        uint16 dstChainId,
        uint8 msgType,
        bytes calldata payload,
        address payable refundAddress,
        address zroPaymentAddress,
        bytes calldata adapterParams
    ) external payable onlyMessenger nonReentrant returns (uint256 messageId) {
        require(msgType > 0 && msgType <= 4, "Invalid message type");
        require(trustedRemoteLookup[dstChainId].length > 0, "Chain not trusted");
        
        // Increment nonce
        lastMessageNonce[dstChainId]++;
        uint256 nonce = lastMessageNonce[dstChainId];
        
        // Generate message ID
        messageId = _generateMessageId(
            msgType,
            block.chainid,
            dstChainId,
            nonce,
            msg.sender,
            payload
        );
        
        // Create message
        CrossChainMessage memory message = CrossChainMessage({
            msgType: msgType,
            messageId: messageId,
            srcChainId: uint16(block.chainid),
            dstChainId: dstChainId,
            nonce: nonce,
            sender: msg.sender,
            payload: payload,
            timestamp: block.timestamp
        });
        
        // Encode message
        bytes memory encodedMessage = abi.encode(message);
        
        // Estimate gas
        uint256 nativeFee = _estimateFee(dstChainId, encodedMessage, adapterParams);
        require(msg.value >= nativeFee, "Insufficient fee");
        
        // Send via LayerZero
        lzEndpoint.send{value: msg.value}(
            dstChainId,
            trustedRemoteLookup[dstChainId],
            encodedMessage,
            refundAddress,
            zroPaymentAddress,
            adapterParams
        );
        
        emit MessageSent(
            messageId,
            msgType,
            uint16(block.chainid),
            dstChainId,
            nonce,
            msg.sender,
            payload,
            block.timestamp
        );
        
        return messageId;
    }
    
    /**
     * @notice Receive cross-chain message (called by LayerZero)
     * @param srcChainId Source chain ID
     * @param srcAddress Source address
     * @param nonce Message nonce
     * @param payload Message payload
     */
    function lzReceive(
        uint16 srcChainId,
        bytes calldata srcAddress,
        uint64 nonce,
        bytes calldata payload
    ) external nonReentrant {
        require(msg.sender == address(lzEndpoint), "Invalid endpoint");
        require(
            keccak256(srcAddress) == keccak256(trustedRemoteLookup[srcChainId]),
            "Invalid source"
        );
        
        // Decode message
        CrossChainMessage memory message = abi.decode(payload, (CrossChainMessage));
        
        // Validate message
        _validateMessage(message, srcChainId, nonce);
        
        // Mark as executed
        executedMessages[message.messageId] = true;
        
        // Process message based on type
        _processMessage(message);
        
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    /**
     * @notice Retry failed message
     * @param srcChainId Source chain ID
     * @param srcAddress Source address
     * @param nonce Message nonce
     * @param payload Message payload
     */
    function retryMessage(
        uint16 srcChainId,
        bytes calldata srcAddress,
        uint64 nonce,
        bytes calldata payload
    ) external onlyMessenger nonReentrant {
        // Decode message
        CrossChainMessage memory message = abi.decode(payload, (CrossChainMessage));
        
        // Check if already executed
        if (executedMessages[message.messageId]) {
            return;
        }
        
        // Validate message
        _validateMessage(message, srcChainId, nonce);
        
        // Mark as executed
        executedMessages[message.messageId] = true;
        
        // Process message
        _processMessage(message);
        
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    // ============ VIEW FUNCTIONS ============
    
    /**
     * @notice Estimate fee for sending message
     * @param dstChainId Destination chain ID
     * @param payload Message payload
     * @param adapterParams LayerZero adapter parameters
     * @return nativeFee Native token fee
     * @return zroFee ZRO token fee
     */
    function estimateFee(
        uint16 dstChainId,
        bytes calldata payload,
        bytes calldata adapterParams
    ) external view returns (uint256 nativeFee, uint256 zroFee) {
        require(trustedRemoteLookup[dstChainId].length > 0, "Chain not trusted");
        
        CrossChainMessage memory message = CrossChainMessage({
            msgType: MSG_TYPE_POSITION_UPDATE,
            messageId: 0,
            srcChainId: uint16(block.chainid),
            dstChainId: dstChainId,
            nonce: lastMessageNonce[dstChainId] + 1,
            sender: msg.sender,
            payload: payload,
            timestamp: block.timestamp
        });
        
        bytes memory encodedMessage = abi.encode(message);
        
        return _estimateFee(dstChainId, encodedMessage, adapterParams);
    }
    
    /**
     * @notice Check if message has been executed
     * @param messageId Message ID
     * @return executed True if executed
     */
    function isMessageExecuted(uint256 messageId) external view returns (bool) {
        return executedMessages[messageId];
    }
    
    /**
     * @notice Get next nonce for destination chain
     * @param dstChainId Destination chain ID
     * @return nonce Next nonce
     */
    function getNextNonce(uint16 dstChainId) external view returns (uint256) {
        return lastMessageNonce[dstChainId] + 1;
    }
    
    // ============ ADMIN FUNCTIONS ============
    
    /**
     * @notice Set trusted remote address
     * @param chainId Chain ID
     * @param remoteAddress Remote address bytes
     */
    function setTrustedRemote(uint16 chainId, bytes calldata remoteAddress) 
        external 
        onlyGovernor 
    {
        trustedRemoteLookup[chainId] = remoteAddress;
        
        emit TrustedRemoteSet(chainId, remoteAddress);
    }
    
    /**
     * @notice Update gas buffer
     * @param newGasBuffer New gas buffer
     */
    function updateGasBuffer(uint256 newGasBuffer) external onlyGovernor {
        require(newGasBuffer <= 1_000_000, "Gas buffer too high");
        
        emit GasBufferUpdated(gasBuffer, newGasBuffer);
        gasBuffer = newGasBuffer;
    }
    
    /**
     * @notice Update message expiry
     * @param newExpiry New expiry in seconds
     */
    function updateMessageExpiry(uint256 newExpiry) external onlyGovernor {
        require(newExpiry <= 24 hours, "Expiry too long");
        
        emit MessageExpiryUpdated(messageExpiry, newExpiry);
        messageExpiry = newExpiry;
    }
    
    /**
     * @notice Force execute message (emergency only)
     * @param message Message to execute
     */
    function forceExecuteMessage(CrossChainMessage calldata message) external onlyGovernor {
        require(!executedMessages[message.messageId], "Already executed");
        
        // Skip validation for emergency execution
        executedMessages[message.messageId] = true;
        
        _processMessage(message);
        
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    // ============ INTERNAL FUNCTIONS ============
    
    /**
     * @dev Validate incoming message
     */
    function _validateMessage(
        CrossChainMessage memory message,
        uint16 srcChainId,
        uint64 nonce
    ) internal view {
        require(message.srcChainId == srcChainId, "Invalid source chain");
        require(message.dstChainId == uint16(block.chainid), "Invalid destination");
        require(!executedMessages[message.messageId], "Already executed");
        require(block.timestamp <= message.timestamp + messageExpiry, "Message expired");
        
        // Verify message ID
        uint256 expectedId = _generateMessageId(
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload
        );
        require(message.messageId == expectedId, "Invalid message ID");
    }
    
    /**
     * @dev Process message based on type
     */
    function _processMessage(CrossChainMessage memory message) internal {
        if (message.msgType == MSG_TYPE_POSITION_UPDATE) {
            _processPositionUpdate(message);
        } else if (message.msgType == MSG_TYPE_GOVERNANCE) {
            _processGovernanceMessage(message);
        } else if (message.msgType == MSG_TYPE_ORACLE) {
            _processOracleUpdate(message);
        } else if (message.msgType == MSG_TYPE_EMERGENCY) {
            _processEmergencyMessage(message);
        } else {
            revert("Unknown message type");
        }
    }
    
    /**
     * @dev Process position update
     */
    function _processPositionUpdate(CrossChainMessage memory message) internal {
        // Decode position update data
        (address trader, uint256 positionId, uint256 size, int256 pnl) = 
            abi.decode(message.payload, (address, uint256, uint256, int256));
        
        // In production, would update position manager
        // For now, just emit event
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    /**
     * @dev Process governance message
     */
    function _processGovernanceMessage(CrossChainMessage memory message) internal {
        // Decode governance data
        (uint256 proposalId, address target, bytes memory data) = 
            abi.decode(message.payload, (uint256, address, bytes));
        
        // In production, would execute governance proposal
        // For now, just emit event
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    /**
     * @dev Process oracle update
     */
    function _processOracleUpdate(CrossChainMessage memory message) internal {
        // Decode oracle data
        (bytes32 feedId, uint256 price, uint256 timestamp) = 
            abi.decode(message.payload, (bytes32, uint256, uint256));
        
        // In production, would update oracle aggregator
        // For now, just emit event
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    /**
     * @dev Process emergency message
     */
    function _processEmergencyMessage(CrossChainMessage memory message) internal {
        // Decode emergency data
        (string memory action, bytes memory data) = 
            abi.decode(message.payload, (string, bytes));
        
        // In production, would handle emergency action
        // For now, just emit event
        emit MessageReceived(
            message.messageId,
            message.msgType,
            message.srcChainId,
            message.dstChainId,
            message.nonce,
            message.sender,
            message.payload,
            block.timestamp
        );
    }
    
    /**
     * @dev Generate message ID
     */
    function _generateMessageId(
        uint8 msgType,
        uint16 srcChainId,
        uint16 dstChainId,
        uint256 nonce,
        address sender,
        bytes memory payload
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(
            msgType,
            srcChainId,
            dstChainId,
            nonce,
            sender,
            payload
        )));
    }
    
    /**
     * @dev Estimate fee for message
     */
    function _estimateFee(
        uint16 dstChainId,
        bytes memory payload,
        bytes memory adapterParams
    ) internal view returns (uint256 nativeFee, uint256 zroFee) {
        (nativeFee, zroFee) = lzEndpoint.estimateFees(
            dstChainId,
            address(this),
            payload,
            false,
            adapterParams
        );
        
        // Add gas buffer
        nativeFee += (nativeFee * gasBuffer) / 1_000_000;
    }
}