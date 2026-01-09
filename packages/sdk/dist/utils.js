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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRECISION = exports.LIQUIDATION_FEE = exports.INITIAL_MARGIN = exports.MAINTENANCE_MARGIN = exports.MAX_LEVERAGE = exports.PRICE_ONE = exports.ONE = exports.PRICE_DECIMALS = exports.DECIMALS = void 0;
exports.parsePositionFromChain = parsePositionFromChain;
exports.estimatePnL = estimatePnL;
exports.estimateLiquidationPrice = estimateLiquidationPrice;
exports.validateOracleData = validateOracleData;
exports.estimateGas = estimateGas;
const constants = __importStar(require("./constants"));
const math = __importStar(require("@perpdex/math"));
// Fonctions utilitaires SDK selon le prompt de production
// Helper function for BigInt powers (compatible with ES2020)
function bigIntPow(base, exponent) {
    let result = BigInt(1);
    for (let i = 0; i < exponent; i++) {
        result *= BigInt(base);
    }
    return result;
}
// Constants using the helper function
exports.DECIMALS = constants.DECIMALS.TOKEN;
exports.PRICE_DECIMALS = constants.DECIMALS.PRICE;
exports.ONE = bigIntPow(10, constants.DECIMALS.TOKEN);
exports.PRICE_ONE = bigIntPow(10, constants.DECIMALS.PRICE);
exports.MAX_LEVERAGE = BigInt(100);
exports.MAINTENANCE_MARGIN = BigInt(5);
exports.INITIAL_MARGIN = BigInt(10);
exports.LIQUIDATION_FEE = BigInt(20);
exports.PRECISION = bigIntPow(10, 6);
/**
 * Parse position data from chain response
 */
function parsePositionFromChain(positionData) {
    return {
        id: positionData.id?.toString() || '',
        user: positionData.user || '',
        marketId: positionData.marketId?.toString() || '',
        size: toBigInt(positionData.size),
        collateral: toBigInt(positionData.collateral),
        entryPrice: toBigInt(positionData.entryPrice),
        isLong: positionData.isLong || false,
        leverage: toBigInt(positionData.leverage),
        healthFactor: toBigInt(positionData.healthFactor),
        isLiquidated: positionData.isLiquidated || false,
        isClosed: positionData.isClosed || false,
        createdAt: Number(positionData.createdAt || 0),
        updatedAt: Number(positionData.updatedAt || 0),
    };
}
/**
 * Estimate PnL using math package
 */
function estimatePnL(entryPrice, currentPrice, size, isLong) {
    try {
        // Using math package for calculations
        const pnl = math.calculatePnL(entryPrice, currentPrice, size, isLong);
        const isProfit = pnl > toBigInt(0);
        return { pnl, isProfit };
    }
    catch (error) {
        throw new Error(`Failed to estimate PnL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Estimate liquidation price using math package
 */
function estimateLiquidationPrice(entryPrice, size, collateral, maintenanceMargin, isLong) {
    try {
        // Create PositionParams object as expected by the math package
        const positionParams = {
            size,
            collateral,
            entryPrice,
            isLong,
            fundingAccrued: toBigInt(0), // Default to 0 for estimation
        };
        // Create PositionRiskParams object
        const riskParams = {
            maintenanceMarginBps: maintenanceMargin,
            liquidationThresholdBps: maintenanceMargin + BigInt(50), // Add 0.5% buffer
        };
        // Using math package for calculation
        const result = math.calculateLiquidationPriceSafe(positionParams, riskParams);
        // Return the liquidation price from the result
        return result.liquidationPrice;
    }
    catch (error) {
        throw new Error(`Failed to estimate liquidation price: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Validate oracle data
 */
function validateOracleData(price, timestamp, maxStaleSeconds = constants.ORACLE_CONSTANTS.MAX_STALE_SECONDS) {
    if (price <= toBigInt(0)) {
        return { isValid: false, reason: 'Price must be positive' };
    }
    if (timestamp <= 0) {
        return { isValid: false, reason: 'Invalid timestamp' };
    }
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = currentTime - timestamp;
    if (timeDiff > maxStaleSeconds) {
        return {
            isValid: false,
            reason: `Oracle data is stale (${timeDiff}s > ${maxStaleSeconds}s)`
        };
    }
    return { isValid: true };
}
/**
 * Gas estimation utility
 */
async function estimateGas(provider, tx, multiplier = 1.2) {
    const feeData = await provider.getFeeData();
    let gasLimit;
    try {
        gasLimit = await provider.estimateGas(tx);
    }
    catch {
        gasLimit = toBigInt(500000); // Default value
    }
    const adjustedGasLimit = toBigInt(Math.ceil(Number(gasLimit) * multiplier));
    const gasPrice = feeData.gasPrice || toBigInt(0);
    const maxFeePerGas = feeData.maxFeePerGas;
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    return {
        gasLimit: adjustedGasLimit,
        gasPrice,
        maxFeePerGas,
        maxPriorityFeePerGas,
    };
}
// Helper function to safely convert to BigInt
function toBigInt(value) {
    if (value === undefined || value === null) {
        return BigInt(0);
    }
    try {
        return BigInt(value);
    }
    catch {
        return BigInt(0);
    }
}
