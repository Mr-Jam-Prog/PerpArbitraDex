"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationError = exports.NetworkError = exports.ContractError = exports.ValidationError = exports.SDKError = exports.UTILS_PRECISION = exports.UTILS_LIQUIDATION_FEE = exports.UTILS_INITIAL_MARGIN = exports.UTILS_MAINTENANCE_MARGIN = exports.UTILS_MAX_LEVERAGE = exports.UTILS_PRICE_ONE = exports.UTILS_ONE = exports.UTILS_PRICE_DECIMALS = exports.UTILS_DECIMALS = exports.estimateGas = exports.validateOracleData = exports.estimateLiquidationPrice = exports.estimatePnL = exports.parsePositionFromChain = exports.EVENT_SIGNATURES = exports.ERROR_MESSAGES = exports.PROTOCOL_VERSION = exports.SUBGRAPH_URLS = exports.RPC_URLS = exports.ADDRESSES = exports.LIQUIDATION_CONSTANTS = exports.FUNDING_CONSTANTS = exports.ORACLE_CONSTANTS = exports.MARGIN_CONSTANTS = exports.DECIMALS = exports.CHAIN_IDS = void 0;
// Main SDK entry point - export types first to avoid conflicts
__exportStar(require("./types"), exports);
// Export constants explicitly to avoid conflicts
var constants_1 = require("./constants");
Object.defineProperty(exports, "CHAIN_IDS", { enumerable: true, get: function () { return constants_1.CHAIN_IDS; } });
Object.defineProperty(exports, "DECIMALS", { enumerable: true, get: function () { return constants_1.DECIMALS; } });
Object.defineProperty(exports, "MARGIN_CONSTANTS", { enumerable: true, get: function () { return constants_1.MARGIN_CONSTANTS; } });
Object.defineProperty(exports, "ORACLE_CONSTANTS", { enumerable: true, get: function () { return constants_1.ORACLE_CONSTANTS; } });
Object.defineProperty(exports, "FUNDING_CONSTANTS", { enumerable: true, get: function () { return constants_1.FUNDING_CONSTANTS; } });
Object.defineProperty(exports, "LIQUIDATION_CONSTANTS", { enumerable: true, get: function () { return constants_1.LIQUIDATION_CONSTANTS; } });
Object.defineProperty(exports, "ADDRESSES", { enumerable: true, get: function () { return constants_1.ADDRESSES; } });
Object.defineProperty(exports, "RPC_URLS", { enumerable: true, get: function () { return constants_1.RPC_URLS; } });
Object.defineProperty(exports, "SUBGRAPH_URLS", { enumerable: true, get: function () { return constants_1.SUBGRAPH_URLS; } });
Object.defineProperty(exports, "PROTOCOL_VERSION", { enumerable: true, get: function () { return constants_1.PROTOCOL_VERSION; } });
Object.defineProperty(exports, "ERROR_MESSAGES", { enumerable: true, get: function () { return constants_1.ERROR_MESSAGES; } });
Object.defineProperty(exports, "EVENT_SIGNATURES", { enumerable: true, get: function () { return constants_1.EVENT_SIGNATURES; } });
// Export utils with renamed constants to avoid conflicts
var utils_1 = require("./utils");
Object.defineProperty(exports, "parsePositionFromChain", { enumerable: true, get: function () { return utils_1.parsePositionFromChain; } });
Object.defineProperty(exports, "estimatePnL", { enumerable: true, get: function () { return utils_1.estimatePnL; } });
Object.defineProperty(exports, "estimateLiquidationPrice", { enumerable: true, get: function () { return utils_1.estimateLiquidationPrice; } });
Object.defineProperty(exports, "validateOracleData", { enumerable: true, get: function () { return utils_1.validateOracleData; } });
Object.defineProperty(exports, "estimateGas", { enumerable: true, get: function () { return utils_1.estimateGas; } });
Object.defineProperty(exports, "UTILS_DECIMALS", { enumerable: true, get: function () { return utils_1.DECIMALS; } });
Object.defineProperty(exports, "UTILS_PRICE_DECIMALS", { enumerable: true, get: function () { return utils_1.PRICE_DECIMALS; } });
Object.defineProperty(exports, "UTILS_ONE", { enumerable: true, get: function () { return utils_1.ONE; } });
Object.defineProperty(exports, "UTILS_PRICE_ONE", { enumerable: true, get: function () { return utils_1.PRICE_ONE; } });
Object.defineProperty(exports, "UTILS_MAX_LEVERAGE", { enumerable: true, get: function () { return utils_1.MAX_LEVERAGE; } });
Object.defineProperty(exports, "UTILS_MAINTENANCE_MARGIN", { enumerable: true, get: function () { return utils_1.MAINTENANCE_MARGIN; } });
Object.defineProperty(exports, "UTILS_INITIAL_MARGIN", { enumerable: true, get: function () { return utils_1.INITIAL_MARGIN; } });
Object.defineProperty(exports, "UTILS_LIQUIDATION_FEE", { enumerable: true, get: function () { return utils_1.LIQUIDATION_FEE; } });
Object.defineProperty(exports, "UTILS_PRECISION", { enumerable: true, get: function () { return utils_1.PRECISION; } });
// Export main client and functions
__exportStar(require("./PerpDexClient"), exports);
var types_1 = require("./types");
Object.defineProperty(exports, "SDKError", { enumerable: true, get: function () { return types_1.SDKError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return types_1.ValidationError; } });
Object.defineProperty(exports, "ContractError", { enumerable: true, get: function () { return types_1.ContractError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return types_1.NetworkError; } });
Object.defineProperty(exports, "SimulationError", { enumerable: true, get: function () { return types_1.SimulationError; } });
