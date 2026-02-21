// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {IPositionManager} from "../interfaces/IPositionManager.sol";
import {IPerpEngine} from "../interfaces/IPerpEngine.sol";

/**
 * @title PositionManager
 * @notice ERC-721 NFT manager for perpetual positions
 * @dev Each position is represented as a unique NFT with metadata
 */
contract PositionManager is 
    ERC721, 
    ERC721Enumerable, 
    ERC721URIStorage, 
    Ownable,
    IPositionManager
{
    using Strings for uint256;

    // ============ CONSTANTS ============
    
    string private constant BASE_URI = "https://api.perpdex.com/positions/";
    string private constant DEFAULT_METADATA = "default";

    // ============ IMMUTABLES ============
    
    address public immutable perpEngine;

    // ============ STATE VARIABLES ============
    
    // Position ID => metadata hash
    mapping(uint256 => bytes32) private _positionMetadata;
    
    // Position ID => custom data
    mapping(uint256 => bytes) private _customData;
    
    // Token ID counter
    uint256 private _nextTokenId = 1;

    // ============ MODIFIERS ============
    
    modifier onlyPerpEngine() {
        require(msg.sender == perpEngine, "PositionManager: only PerpEngine");
        _;
    }

    // ============ CONSTRUCTOR ============
    
    constructor(address perpEngine_) ERC721("PerpDEX Position", "PERP-POS") {
        require(perpEngine_ != address(0), "PositionManager: zero address");
        perpEngine = perpEngine_;
    }

    // ============ POSITION MANAGEMENT ============

    /**
     * @inheritdoc IPositionManager
     */
    function mint(address to, uint256 positionId) external override onlyPerpEngine {
        require(positionId > 0, "PositionManager: invalid position ID");
        require(_nextTokenId == positionId, "PositionManager: ID mismatch");
        
        _safeMint(to, positionId);
        _nextTokenId++;
        
        // Set default metadata
        _setTokenURI(positionId, string(abi.encodePacked(BASE_URI, positionId.toString())));
        _positionMetadata[positionId] = keccak256(abi.encodePacked(DEFAULT_METADATA));
        
        emit PositionMinted(positionId, to, block.timestamp);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function burn(uint256 positionId) external override onlyPerpEngine {
        require(_exists(positionId), "PositionManager: nonexistent token");
        require(ownerOf(positionId) != address(0), "PositionManager: already burned");
        
        address owner = ownerOf(positionId);
        
        // Clear metadata
        delete _positionMetadata[positionId];
        delete _customData[positionId];
        
        _burn(positionId);
        
        emit PositionBurned(positionId, owner, block.timestamp);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setMetadata(uint256 positionId, bytes32 metadataHash) external override onlyOwner {
        require(_exists(positionId), "PositionManager: nonexistent token");
        _positionMetadata[positionId] = metadataHash;
        
        emit MetadataUpdated(positionId, metadataHash);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function setCustomData(uint256 positionId, bytes calldata data) external override {
        require(_exists(positionId), "PositionManager: nonexistent token");
        require(ownerOf(positionId) == msg.sender || msg.sender == owner(), 
            "PositionManager: not owner");
        
        _customData[positionId] = data;
        
        emit CustomDataUpdated(positionId, data);
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionMetadata(uint256 positionId) 
        external 
        view 
        override 
        returns (bytes32 metadataHash) 
    {
        require(_exists(positionId), "PositionManager: nonexistent token");
        return _positionMetadata[positionId];
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getCustomData(uint256 positionId) 
        external 
        view 
        override 
        returns (bytes memory data) 
    {
        require(_exists(positionId), "PositionManager: nonexistent token");
        return _customData[positionId];
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionOwner(uint256 positionId) 
        external 
        view 
        override 
        returns (address owner) 
    {
        require(_exists(positionId), "PositionManager: nonexistent token");
        return ownerOf(positionId);
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionStatus(uint256 positionId) 
        external 
        view 
        override 
        returns (bool isActive, bool exists) 
    {
        exists = _exists(positionId);
        if (exists) {
            // Check with PerpEngine if position is still active
            try IPerpEngine(perpEngine).getPositionInternal(positionId) returns (
                IPerpEngine.Position memory position
            ) {
                isActive = position.isActive;
            } catch {
                isActive = false;
            }
        } else {
            isActive = false;
        }
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionsByOwner(address owner) 
        external 
        view 
        override 
        returns (uint256[] memory positionIds) 
    {
        uint256 balance = balanceOf(owner);
        positionIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            positionIds[i] = tokenOfOwnerByIndex(owner, i);
        }
    }

    /**
     * @inheritdoc IPositionManager
     */
    function getPositionCount() external view override returns (uint256 total, uint256 active) {
        total = totalSupply();
        
        // Count active positions by checking with PerpEngine
        for (uint256 i = 1; i <= total; i++) {
            if (_exists(i)) {
                try IPerpEngine(perpEngine).getPositionInternal(i) returns (
                    IPerpEngine.Position memory position
                ) {
                    if (position.isActive) {
                        active++;
                    }
                } catch {
                    // Position not found in engine
                }
            }
        }
    }

    // ============ TRANSFER CONTROL ============

    /**
     * @notice Override transfer to add position validation
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
        
        // Only allow transfers if position is not active
        if (from != address(0) && to != address(0)) {
            try IPerpEngine(perpEngine).getPositionInternal(tokenId) returns (
                IPerpEngine.Position memory position
            ) {
                require(!position.isActive, "PositionManager: cannot transfer active position");
            } catch {
                // If position doesn't exist in engine, allow transfer
            }
        }
    }

    // ============ ADMIN FUNCTIONS ============

    /**
     * @notice Set base URI for token metadata
     */
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        // Implementation would update BASE_URI constant
        // For simplicity, we emit event
        emit BaseURIUpdated(newBaseURI);
    }

    /**
     * @notice Emergency recover NFT (only for stuck positions)
     */
    function emergencyRecover(uint256 positionId, address to) external onlyOwner {
        require(_exists(positionId), "PositionManager: nonexistent token");
        require(ownerOf(positionId) != to, "PositionManager: same owner");
        
        address currentOwner = ownerOf(positionId);
        _safeTransfer(currentOwner, to, positionId, "");
        
        emit EmergencyRecovered(positionId, currentOwner, to);
    }

    // ============ OVERRIDES ============

    /**
     * @dev See {IERC165-supportsInterface}.
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /**
     * @dev Base URI for computing tokenURI.
     */
    function _baseURI() internal view override returns (string memory) {
        return BASE_URI;
    }

    /**
     * @dev See {ERC721-_burn}.
     */
    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }

    /**
     * @dev See {ERC721-tokenURI}.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (string memory)
    {
        return super.tokenURI(tokenId);
    }
}