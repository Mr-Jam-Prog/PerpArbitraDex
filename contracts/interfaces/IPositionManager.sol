// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
interface IPositionManager {
    event PositionMinted(uint256 indexed positionId, address indexed owner, uint256 timestamp);
    event PositionBurned(uint256 indexed positionId, address indexed owner, uint256 timestamp);
    event MetadataUpdated(uint256 indexed positionId, bytes32 metadataHash);
    event CustomDataUpdated(uint256 indexed positionId, bytes data);
    event BaseURIUpdated(string newBaseURI);
    event EmergencyRecovered(uint256 indexed positionId, address from, address to);

    function mint(address to, uint256 positionId) external;
    function burn(uint256 positionId) external;
    function setMetadata(uint256 positionId, bytes32 metadataHash) external;
    function setCustomData(uint256 positionId, bytes calldata data) external;
    function getPositionMetadata(uint256 positionId) external view returns (bytes32);
    function getCustomData(uint256 positionId) external view returns (bytes memory);
    function getPositionOwner(uint256 positionId) external view returns (address);
    function getPositionStatus(uint256 positionId) external view returns (bool isActive, bool exists);
    function getPositionsByOwner(address owner) external view returns (uint256[] memory);
    function getPositionCount() external view returns (uint256 total, uint256 active);
}
