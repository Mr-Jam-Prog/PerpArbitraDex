import { ethers } from 'ethers';
import * as constants from './constants';
import * as math from '@perpdex/math';

// Fonctions utilitaires SDK selon le prompt de production

// Helper function for BigInt powers (compatible with ES2020)
function bigIntPow(base: number, exponent: number): bigint {
  let result = BigInt(1);
  for (let i = 0; i < exponent; i++) {
    result *= BigInt(base);
  }
  return result;
}

// Constants using the helper function
export const DECIMALS = constants.DECIMALS.TOKEN;
export const PRICE_DECIMALS = constants.DECIMALS.PRICE;
export const ONE = bigIntPow(10, constants.DECIMALS.TOKEN);
export const PRICE_ONE = bigIntPow(10, constants.DECIMALS.PRICE);
export const MAX_LEVERAGE = BigInt(100);
export const MAINTENANCE_MARGIN = BigInt(5);
export const INITIAL_MARGIN = BigInt(10);
export const LIQUIDATION_FEE = BigInt(20);
export const PRECISION = bigIntPow(10, 6);

/**
 * Parse position data from chain response
 */
export function parsePositionFromChain(positionData: any): any {
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
export function estimatePnL(
  entryPrice: bigint,
  currentPrice: bigint,
  size: bigint,
  isLong: boolean
): { pnl: bigint; isProfit: boolean } {
  try {
    // Using math package for calculations
    const pnl = math.calculatePnL(entryPrice, currentPrice, size, isLong);
    const isProfit = pnl > toBigInt(0);
    
    return { pnl, isProfit };
  } catch (error) {
    throw new Error(`Failed to estimate PnL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Estimate liquidation price using math package
 */
export function estimateLiquidationPrice(
  entryPrice: bigint,
  size: bigint,
  collateral: bigint,
  maintenanceMargin: bigint,
  isLong: boolean
): bigint {
  try {
    // Create PositionParams object as expected by the math package
    const positionParams: math.PositionParams = {
      size,
      collateral,
      entryPrice,
      isLong,
      fundingAccrued: toBigInt(0), // Default to 0 for estimation
    };
    
    // Create PositionRiskParams object
    const riskParams: math.PositionRiskParams = {
      maintenanceMarginBps: maintenanceMargin,
      liquidationThresholdBps: maintenanceMargin + BigInt(50), // Add 0.5% buffer
    };
    
    // Using math package for calculation
    const result = math.calculateLiquidationPriceSafe(positionParams, riskParams);
    
    // Return the liquidation price from the result
    return result.liquidationPrice;
  } catch (error) {
    throw new Error(`Failed to estimate liquidation price: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Validate oracle data
 */
export function validateOracleData(
  price: bigint,
  timestamp: number,
  maxStaleSeconds: number = constants.ORACLE_CONSTANTS.MAX_STALE_SECONDS
): { isValid: boolean; reason?: string } {
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
export async function estimateGas(
  provider: ethers.Provider,
  tx: ethers.TransactionRequest,
  multiplier: number = 1.2
): Promise<any> {
  const feeData = await provider.getFeeData();
  
  let gasLimit: bigint;
  try {
    gasLimit = await provider.estimateGas(tx);
  } catch {
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
function toBigInt(value: any): bigint {
  if (value === undefined || value === null) {
    return BigInt(0);
  }
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}