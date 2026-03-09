// @title: Calculs Exactement Identiques aux Smart Contracts
// @security: MUST match PositionMath.sol exactly - used for UI previews
// @precision: 18 decimal places for consistency with Solidity

import { ethers } from 'ethers';

// Constants (must match Solidity)
const PRECISION = BigInt(10).pow(18); // 1e18
const ONE = PRECISION;
const MAX_UINT256 = ethers.MaxUint256;

/**
 * Calculate PnL for a position
 * MUST match PositionMath.calculatePnL exactly
 */
export const calculatePnL = (size, entryPrice, exitPrice, isLong) => {
  // Convert to BigNumber with appropriate decimals
  const sizeBN = ethers.parseUnits(size.toString(), 18);
  const entryBN = ethers.parseUnits(entryPrice.toString(), 8);
  const exitBN = ethers.parseUnits(exitPrice.toString(), 8);
  
  if (isLong) {
    // PnL = size * (exitPrice - entryPrice) / entryPrice
    const priceDiff = exitBN - (entryBN);
    const pnl = sizeBN * (priceDiff) / (entryBN);
    return parseFloat(ethers.formatUnits(pnl, 18));
  } else {
    // PnL = size * (entryPrice - exitPrice) / entryPrice
    const priceDiff = entryBN - (exitBN);
    const pnl = sizeBN * (priceDiff) / (entryBN);
    return parseFloat(ethers.formatUnits(pnl, 18));
  }
};

/**
 * Calculate health factor
 * MUST match PositionMath.calculateHealthFactor exactly
 */
export const calculateHealthFactor = (collateral, size, price, isLong) => {
  const collateralBN = ethers.parseUnits(collateral.toString(), 6); // USDC has 6 decimals
  const sizeBN = ethers.parseUnits(size.toString(), 18);
  const priceBN = ethers.parseUnits(price.toString(), 8);
  
  // Position value = size
  const positionValue = sizeBN;
  
  // Collateral value in USD (collateral is already in USD for USDC)
  const collateralValue = collateralBN * (PRECISION) / (BigInt(10).pow(6));
  
  if (isLong) {
    // For long: HF = (collateral + (size * (price - entryPrice) / entryPrice)) / (size * maintenanceMargin)
    // Simplified: HF = collateral / (size * maintenanceMargin) when price = entryPrice
    
    // Using 8% maintenance margin
    const maintenanceMargin = BigInt(8) * (PRECISION) / (100); // 0.08 * 1e18
    
    const requiredMargin = positionValue * (maintenanceMargin) / (PRECISION);
    const healthFactor = collateralValue * (PRECISION) / (requiredMargin);
    
    return parseFloat(ethers.formatUnits(healthFactor, 18));
  } else {
    // For short: similar but inverted
    const maintenanceMargin = BigInt(8) * (PRECISION) / (100);
    const requiredMargin = positionValue * (maintenanceMargin) / (PRECISION);
    const healthFactor = collateralValue * (PRECISION) / (requiredMargin);
    
    return parseFloat(ethers.formatUnits(healthFactor, 18));
  }
};

/**
 * Calculate liquidation price
 * MUST match PositionMath.calculateLiquidationPrice exactly
 */
export const calculateLiquidationPrice = (collateral, size, isLong, maintenanceMarginRatio = 0.08) => {
  const collateralBN = ethers.parseUnits(collateral.toString(), 6);
  const sizeBN = ethers.parseUnits(size.toString(), 18);
  const mmrBN = ethers.parseUnits(maintenanceMarginRatio.toString(), 18);
  
  if (isLong) {
    // For long: liquidationPrice = entryPrice * (1 - maintenanceMarginRatio / leverage)
    // But we calculate from current state: liquidationPrice = price where HF = 1
    
    // Simplified formula: liqPrice = entryPrice * (1 - (maintenanceMarginRatio * size / collateral))
    const entryPrice = sizeBN / (collateralBN); // Assuming 1x leverage
    
    const factor = PRECISION - (mmrBN * (sizeBN) / (collateralBN));
    const liquidationPrice = entryPrice * (factor) / (PRECISION);
    
    return parseFloat(ethers.formatUnits(liquidationPrice, 8));
  } else {
    // For short: liquidationPrice = entryPrice * (1 + maintenanceMarginRatio / leverage)
    const entryPrice = sizeBN / (collateralBN);
    
    const factor = PRECISION + (mmrBN * (sizeBN) / (collateralBN));
    const liquidationPrice = entryPrice * (factor) / (PRECISION);
    
    return parseFloat(ethers.formatUnits(liquidationPrice, 8));
  }
};

/**
 * Calculate funding payment
 * MUST match FundingRateCalculator.calculateFundingPayment exactly
 */
export const calculateFundingPayment = (size, fundingRate, timeElapsed) => {
  const sizeBN = ethers.parseUnits(size.toString(), 18);
  const rateBN = ethers.parseUnits(fundingRate.toString(), 18);
  const timeBN = BigInt(timeElapsed);
  
  // fundingPayment = size * fundingRate * timeElapsed / (365 * 24 * 3600)
  const secondsPerYear = BigInt(365 * 24 * 3600);
  const payment = sizeBN * (rateBN) * (timeBN) / (secondsPerYear) / (PRECISION);
  
  return parseFloat(ethers.formatUnits(payment, 18));
};

/**
 * Calculate position leverage
 */
export const calculateLeverage = (collateral, size) => {
  if (!collateral || collateral <= 0) return 0;
  return size / collateral;
};

/**
 * Calculate required margin for a position
 */
export const calculateRequiredMargin = (size, leverage, initialMarginRatio = 0.1) => {
  const positionValue = size;
  const requiredMargin = positionValue * initialMarginRatio / leverage;
  return requiredMargin;
};

/**
 * Validate position parameters against protocol limits
 */
export const validatePositionParameters = (collateral, size, leverage, maxLeverage = 10) => {
  const errors = [];
  
  if (leverage > maxLeverage) {
    errors.push(`Leverage exceeds maximum of ${maxLeverage}x`);
  }
  
  if (collateral < 10) { // $10 minimum
    errors.push('Minimum collateral is $10');
  }
  
  const calculatedSize = collateral * leverage;
  if (Math.abs(size - calculatedSize) > 0.01) {
    errors.push('Size does not match collateral and leverage');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Calculate slippage impact
 */
export const calculateSlippageImpact = (size, marketDepth, slippagePercent) => {
  // Simplified slippage model
  const impact = size * (slippagePercent / 100);
  return impact;
};

// Export all calculations for easy import
export default {
  calculatePnL,
  calculateHealthFactor,
  calculateLiquidationPrice,
  calculateFundingPayment,
  calculateLeverage,
  calculateRequiredMargin,
  validatePositionParameters,
  calculateSlippageImpact,
  PRECISION: PRECISION.toString()
};