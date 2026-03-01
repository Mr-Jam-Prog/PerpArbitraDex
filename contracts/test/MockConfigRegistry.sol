// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IConfigRegistry} from "../interfaces/IConfigRegistry.sol";

contract MockConfigRegistry is IConfigRegistry {
    MarketConfig private _marketConfig;
    ProtocolConfig private _protocolConfig;
    RiskConfig private _riskConfig;

    function setMarketConfig(MarketConfig calldata config) external { _marketConfig = config; }
    function setProtocolConfig(ProtocolConfig calldata config) external { _protocolConfig = config; }
    function setRiskConfig(RiskConfig calldata config) external { _riskConfig = config; }

    function getMarketConfig(uint256 /*marketId*/) external view override returns (MarketConfig memory) { return _marketConfig; }
    function getProtocolConfig() external view override returns (ProtocolConfig memory) { return _protocolConfig; }
    function getRiskConfig() external view override returns (RiskConfig memory) { return _riskConfig; }
    function getConfigGuardian() external view override returns (address) { return address(0); }
    function isMarketActive(uint256 /*marketId*/) external view override returns (bool) { return true; }
    function validateMarketParameters(uint256 /*marketId*/, uint256 /*size*/, uint256 /*leverage*/) external view override returns (bool) { return true; }
    function getMaxPositionSize(uint256 /*marketId*/) external view override returns (uint256) { return _marketConfig.maxPositionSize; }
    function getMinMargin(uint256 /*marketId*/, uint256 /*size*/) external view override returns (uint256) { return 0; }
    
    function updateMarketConfig(uint256 marketId, MarketConfig calldata newConfig) external override {}
    function updateProtocolConfig(ProtocolConfig calldata newConfig) external override {}
    function updateRiskConfig(RiskConfig calldata newConfig) external override {}
    function updateConfigGuardian(address newGuardian) external override {}
    function emergencyDisableMarket(uint256 marketId) external override {}
    function emergencyEnableMarket(uint256 marketId) external override {}
    function scheduleConfigUpdate(bytes32 configHash, uint256 eta) external override {}
    function executeConfigUpdate(bytes32 configHash) external override {}
    function cancelConfigUpdate(bytes32 configHash) external override {}
}
