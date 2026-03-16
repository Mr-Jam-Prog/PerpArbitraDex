/**
 * PerpArbitraDEX Formatting Utilities
 * Principles:
 * 1. BigInt only (no floating point)
 * 2. Deterministic formatting
 * 3. No recalculation of on-chain values
 * 4. Read-only safe
 */

import { ethers } from 'ethers';
import { formatUnits, parseUnits, BigNumber } from 'ethers/lib/utils';

// ========== CONSTANTS ==========
const PRECISION = 18; // 18 decimal places (ETH standard)
const USD_PRECISION = 6; // USDC decimals
const PRICE_PRECISION = 8; // Oracle price precision

// Minimum and maximum display values
const MIN_DISPLAY_VALUE = parseUnits('0.000001', PRECISION); // 0.000001 ETH
const MAX_DISPLAY_VALUE = parseUnits('1000000000', PRECISION); // 1B ETH

// Formatting options
const FORMAT_OPTIONS = {
  // Price formatting
  PRICE: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  },
  
  // Large numbers (market cap, volume)
  LARGE_NUMBER: {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  },
  
  // Percentage (funding, APY)
  PERCENTAGE: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
    useGrouping: false,
  },
  
  // Health factor (1.00 - 10.00)
  HEALTH_FACTOR: {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  },
  
  // Small values (gas, fees)
  SMALL: {
    minimumFractionDigits: 6,
    maximumFractionDigits: 12,
    useGrouping: false,
  },
};

// ========== ERROR CLASSES ==========
class FormattingError extends Error {
  constructor(message, value) {
    super(message);
    this.name = 'FormattingError';
    this.value = value;
  }
}

class PrecisionError extends Error {
  constructor(message, decimals) {
    super(message);
    this.name = 'PrecisionError';
    this.decimals = decimals;
  }
}

// ========== VALIDATION FUNCTIONS ==========
/**
 * Validate BigNumber input
 * @param {BigNumber|string|number} value - Value to validate
 * @param {string} name - Name for error message
 * @returns {BigNumber} Validated BigNumber
 * @throws {FormattingError} If value is invalid
 */
function validateBigNumber(value, name = 'value') {
  try {
    if (value === undefined || value === null) {
      throw new FormattingError(`${name} is undefined or null`, value);
    }
    
    let bn;
    
    if (ethers.BigNumber.isBigNumber(value)) {
      bn = value;
    } else if (typeof value === 'string' || typeof value === 'number') {
      bn = ethers.BigNumber.from(value);
    } else {
      throw new FormattingError(`Invalid ${name} type: ${typeof value}`, value);
    }
    
    // Check for negative values (if not allowed)
    if (bn.lt(0)) {
      throw new FormattingError(`${name} cannot be negative`, value);
    }
    
    // Check for reasonable bounds
    if (bn.gt(MAX_DISPLAY_VALUE)) {
      throw new FormattingError(`${name} exceeds maximum display value`, value);
    }
    
    return bn;
    
  } catch (error) {
    if (error instanceof FormattingError) {
      throw error;
    }
    throw new FormattingError(`Invalid ${name}: ${error.message}`, value);
  }
}

/**
 * Validate decimals parameter
 * @param {number} decimals - Decimal places
 * @returns {number} Validated decimals
 * @throws {PrecisionError} If decimals invalid
 */
function validateDecimals(decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new PrecisionError(`Invalid decimals: ${decimals}`, decimals);
  }
  return decimals;
}

// ========== CORE FORMATTING FUNCTIONS ==========
/**
 * Format price with 2 decimal places
 * @param {BigNumber} value - Price in smallest unit
 * @param {number} decimals - Token decimals (default: 18)
 * @returns {string} Formatted price
 */
export function formatPrice(value, decimals = PRECISION) {
  try {
    const bn = validateBigNumber(value, 'price');
    validateDecimals(decimals);
    
    // Convert to human readable
    const formatted = formatUnits(bn, decimals);
    const number = parseFloat(formatted);
    
    // Apply price formatting
    return new Intl.NumberFormat('en-US', FORMAT_OPTIONS.PRICE).format(number);
    
  } catch (error) {
    console.error('Price formatting error:', error.message);
    return '—';
  }
}

/**
 * Format PnL with sign and color coding
 * @param {BigNumber} pnl - Profit/Loss in smallest unit
 * @param {number} decimals - Token decimals
 * @returns {object} Formatted PnL with metadata
 */
export function formatPnL(pnl, decimals = PRECISION) {
  try {
    const bn = validateBigNumber(pnl, 'pnl');
    validateDecimals(decimals);
    
    const formatted = formatUnits(bn.abs(), decimals);
    const number = parseFloat(formatted);
    const isPositive = bn.gte(0);
    
    // Format absolute value
    const absFormatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(number);
    
    // Add sign
    const signedFormatted = `${isPositive ? '+' : '−'}${absFormatted}`;
    
    return {
      formatted: signedFormatted,
      raw: bn.toString(),
      isPositive,
      isNegative: bn.lt(0),
      isZero: bn.isZero(),
      absoluteValue: absFormatted,
      colorClass: isPositive ? 'pnl-positive' : 'pnl-negative',
    };
    
  } catch (error) {
    console.error('PnL formatting error:', error.message);
    return {
      formatted: '—',
      raw: '0',
      isPositive: false,
      isNegative: false,
      isZero: true,
      absoluteValue: '0',
      colorClass: 'pnl-neutral',
    };
  }
}

/**
 * Format funding rate with annualization
 * @param {BigNumber} fundingRate - Funding rate per period
 * @param {number} period - Period in seconds
 * @returns {object} Formatted funding rate
 */
export function formatFunding(fundingRate, period = 3600) {
  try {
    const bn = validateBigNumber(fundingRate, 'fundingRate');
    
    // Convert to percentage per period
    const periodPercentage = bn.mul(100).div(ethers.constants.WeiPerEther);
    
    // Annualize (assuming 365 days)
    const secondsPerYear = 365 * 24 * 3600;
    const periodsPerYear = secondsPerYear / period;
    const annualized = periodPercentage.mul(periodsPerYear);
    
    // Format as percentage
    const periodPercent = parseFloat(formatUnits(periodPercentage, PRECISION));
    const annualPercent = parseFloat(formatUnits(annualized, PRECISION));
    
    const periodFormatted = new Intl.NumberFormat('en-US', FORMAT_OPTIONS.PERCENTAGE).format(periodPercent);
    const annualFormatted = new Intl.NumberFormat('en-US', FORMAT_OPTIONS.PERCENTAGE).format(annualPercent);
    
    const isPositive = bn.gte(0);
    
    return {
      period: `${isPositive ? '+' : ''}${periodFormatted}%`,
      annualized: `${isPositive ? '+' : ''}${annualFormatted}%`,
      raw: bn.toString(),
      isPositive,
      isNegative: bn.lt(0),
      colorClass: isPositive ? 'funding-positive' : 'funding-negative',
    };
    
  } catch (error) {
    console.error('Funding rate formatting error:', error.message);
    return {
      period: '—',
      annualized: '—',
      raw: '0',
      isPositive: false,
      isNegative: false,
      colorClass: '',
    };
  }
}

/**
 * Format health factor (1.00 - 10.00 range)
 * @param {BigNumber} healthFactor - Health factor in wei (1e18 = 1.0)
 * @returns {object} Formatted health factor
 */
export function formatHealthFactor(healthFactor) {
  try {
    const bn = validateBigNumber(healthFactor, 'healthFactor');
    
    // Convert to decimal
    const decimal = parseFloat(formatUnits(bn, PRECISION));
    
    // Determine status
    let status, colorClass;
    
    if (decimal >= 2.0) {
      status = 'safe';
      colorClass = 'health-safe';
    } else if (decimal >= 1.5) {
      status = 'warning';
      colorClass = 'health-warning';
    } else if (decimal >= 1.0) {
      status = 'danger';
      colorClass = 'health-danger';
    } else {
      status = 'critical';
      colorClass = 'health-critical';
    }
    
    // Format with 2 decimal places
    const formatted = new Intl.NumberFormat('en-US', FORMAT_OPTIONS.HEALTH_FACTOR).format(decimal);
    
    return {
      formatted,
      raw: bn.toString(),
      decimal,
      status,
      colorClass,
      isSafe: status === 'safe',
      isWarning: status === 'warning',
      isDanger: status === 'danger',
      isCritical: status === 'critical',
    };
    
  } catch (error) {
    console.error('Health factor formatting error:', error.message);
    return {
      formatted: '—',
      raw: '0',
      decimal: 0,
      status: 'critical',
      colorClass: 'health-critical',
      isSafe: false,
      isWarning: false,
      isDanger: false,
      isCritical: true,
    };
  }
}

/**
 * Format percentage (0-100%)
 * @param {BigNumber} value - Percentage in wei (1e18 = 1%)
 * @returns {string} Formatted percentage
 */
export function formatPercentage(value) {
  try {
    const bn = validateBigNumber(value, 'percentage');
    
    // Convert to percentage (1e18 = 1%)
    const percentage = parseFloat(formatUnits(bn, PRECISION - 2));
    
    return new Intl.NumberFormat('en-US', FORMAT_OPTIONS.PERCENTAGE).format(percentage) + '%';
    
  } catch (error) {
    console.error('Percentage formatting error:', error.message);
    return '—';
  }
}

/**
 * Format large number with suffix (K, M, B)
 * @param {BigNumber} value - Number in smallest unit
 * @param {number} decimals - Token decimals
 * @returns {string} Formatted number with suffix
 */
export function formatLargeNumber(value, decimals = PRECISION) {
  try {
    const bn = validateBigNumber(value, 'largeNumber');
    validateDecimals(decimals);
    
    const number = parseFloat(formatUnits(bn, decimals));
    
    if (number === 0) return '0';
    
    const absNumber = Math.abs(number);
    const suffixes = ['', 'K', 'M', 'B', 'T'];
    const suffixIndex = Math.floor(Math.log10(absNumber) / 3);
    
    if (suffixIndex === 0) {
      return new Intl.NumberFormat('en-US', FORMAT_OPTIONS.LARGE_NUMBER).format(number);
    }
    
    const scaled = number / Math.pow(1000, suffixIndex);
    const suffix = suffixes[suffixIndex] || '';
    
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
    }).format(scaled) + suffix;
    
  } catch (error) {
    console.error('Large number formatting error:', error.message);
    return '—';
  }
}

/**
 * Format address (0x1234...5678)
 * @param {string} address - Ethereum address
 * @returns {string} Formatted address
 */
export function formatAddress(address) {
  try {
    if (!address || typeof address !== 'string') {
      return '—';
    }
    
    if (!address.startsWith('0x') || address.length !== 42) {
      return address; // Return as-is if not a valid address
    }
    
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
    
  } catch (error) {
    console.error('Address formatting error:', error.message);
    return '—';
  }
}

/**
 * Format timestamp to relative time
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Relative time string
 */
export function formatTimestamp(timestamp) {
  try {
    if (!timestamp || typeof timestamp !== 'number') {
      return '—';
    }
    
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    
    // For older dates, show actual date
    const date = new Date(timestamp * 1000);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: diff > 31536000 ? 'numeric' : undefined,
    }).format(date);
    
  } catch (error) {
    console.error('Timestamp formatting error:', error.message);
    return '—';
  }
}

/**
 * Format USD value
 * @param {BigNumber} value - Value in USD cents (or token units)
 * @param {boolean} isCents - Whether value is in cents (true) or dollars (false)
 * @returns {string} Formatted USD
 */
export function formatUSD(value, isCents = false) {
  try {
    const bn = validateBigNumber(value, 'usdValue');
    
    const decimals = isCents ? 2 : USD_PRECISION;
    const number = parseFloat(formatUnits(bn, decimals));
    
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number);
    
  } catch (error) {
    console.error('USD formatting error:', error.message);
    return '$—';
  }
}

/**
 * Format leverage (e.g., 5.00x)
 * @param {BigNumber} leverage - Leverage in wei (5e18 = 5x)
 * @returns {string} Formatted leverage
 */
export function formatLeverage(leverage) {
  try {
    const bn = validateBigNumber(leverage, 'leverage');
    
    const decimal = parseFloat(formatUnits(bn, PRECISION));
    
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }).format(decimal) + 'x';
    
  } catch (error) {
    console.error('Leverage formatting error:', error.message);
    return '—';
  }
}

/**
 * Format position size
 * @param {BigNumber} size - Position size in wei
 * @param {string} market - Market symbol (e.g., 'ETH')
 * @returns {string} Formatted position size
 */
export function formatPositionSize(size, market = 'ETH') {
  try {
    const bn = validateBigNumber(size, 'positionSize');
    
    const decimal = parseFloat(formatUnits(bn, PRECISION));
    
    // Use appropriate formatting based on size
    let options;
    if (decimal >= 1000) {
      options = FORMAT_OPTIONS.LARGE_NUMBER;
    } else if (decimal >= 1) {
      options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    } else {
      options = { minimumFractionDigits: 4, maximumFractionDigits: 6 };
    }
    
    const formatted = new Intl.NumberFormat('en-US', options).format(decimal);
    return `${formatted} ${market}`;
    
  } catch (error) {
    console.error('Position size formatting error:', error.message);
    return `— ${market}`;
  }
}

// ========== HELPER FUNCTIONS ==========
/**
 * Truncate decimal places without rounding
 * @param {string} value - Decimal string
 * @param {number} decimals - Number of decimal places to keep
 * @returns {string} Truncated value
 */
export function truncateDecimals(value, decimals) {
  try {
    if (typeof value !== 'string') {
      value = value.toString();
    }
    
    const [integer, fraction = ''] = value.split('.');
    
    if (!fraction || decimals >= fraction.length) {
      return value;
    }
    
    return `${integer}.${fraction.slice(0, decimals)}`;
    
  } catch (error) {
    console.error('Decimal truncation error:', error.message);
    return value;
  }
}

/**
 * Calculate percentage change
 * @param {BigNumber} oldValue - Old value
 * @param {BigNumber} newValue - New value
 * @returns {BigNumber} Percentage change in wei
 */
export function calculatePercentageChange(oldValue, newValue) {
  try {
    const oldBn = validateBigNumber(oldValue, 'oldValue');
    const newBn = validateBigNumber(newValue, 'newValue');
    
    if (oldBn.isZero()) {
      return ethers.constants.Zero;
    }
    
    // Calculate percentage: ((new - old) / old) * 100 * 1e18
    const diff = newBn.sub(oldBn);
    const percentage = diff.mul(ethers.constants.WeiPerEther).div(oldBn).mul(100);
    
    return percentage;
    
  } catch (error) {
    console.error('Percentage calculation error:', error.message);
    return ethers.constants.Zero;
  }
}

/**
 * Format percentage change with color coding
 * @param {BigNumber} change - Percentage change in wei
 * @returns {object} Formatted change
 */
export function formatPercentageChange(change) {
  try {
    const bn = validateBigNumber(change, 'percentageChange');
    
    const decimal = parseFloat(formatUnits(bn, PRECISION));
    const absDecimal = Math.abs(decimal);
    
    let options;
    if (absDecimal >= 100) {
      options = { minimumFractionDigits: 0, maximumFractionDigits: 0 };
    } else if (absDecimal >= 10) {
      options = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    } else {
      options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    }
    
    const formatted = new Intl.NumberFormat('en-US', options).format(absDecimal);
    const signed = `${decimal >= 0 ? '+' : '−'}${formatted}%`;
    
    return {
      formatted: signed,
      raw: bn.toString(),
      decimal,
      isPositive: decimal > 0,
      isNegative: decimal < 0,
      isZero: decimal === 0,
      colorClass: decimal > 0 ? 'pnl-positive' : decimal < 0 ? 'pnl-negative' : 'pnl-neutral',
    };
    
  } catch (error) {
    console.error('Percentage change formatting error:', error.message);
    return {
      formatted: '—',
      raw: '0',
      decimal: 0,
      isPositive: false,
      isNegative: false,
      isZero: true,
      colorClass: 'pnl-neutral',
    };
  }
}

// ========== BATCH FORMATTING ==========
/**
 * Batch format multiple values
 * @param {Array<{type: string, value: any, options: any}>} formats - Array of format requests
 * @returns {Array} Formatted values
 */
export function batchFormat(formats) {
  const formatters = {
    price: formatPrice,
    pnl: formatPnL,
    funding: formatFunding,
    healthFactor: formatHealthFactor,
    percentage: formatPercentage,
    largeNumber: formatLargeNumber,
    address: formatAddress,
    timestamp: formatTimestamp,
    usd: formatUSD,
    leverage: formatLeverage,
    positionSize: formatPositionSize,
    percentageChange: formatPercentageChange,
  };
  
  return formats.map(({ type, value, options = {} }) => {
    try {
      if (!formatters[type]) {
        throw new FormattingError(`Unknown format type: ${type}`, value);
      }
      
      return formatters[type](value, ...Object.values(options));
      
    } catch (error) {
      console.error(`Batch formatting error for type ${type}:`, error.message);
      return null;
    }
  });
}

// ========== EXPORTS ==========
export default {
  // Core formatting
  formatPrice,
  formatPnL,
  formatFunding,
  formatHealthFactor,
  formatPercentage,
  formatLargeNumber,
  formatAddress,
  formatTimestamp,
  formatUSD,
  formatLeverage,
  formatPositionSize,
  
  // Helpers
  truncateDecimals,
  calculatePercentageChange,
  formatPercentageChange,
  batchFormat,
  
  // Constants
  PRECISION,
  USD_PRECISION,
  PRICE_PRECISION,
  
  // Errors
  FormattingError,
  PrecisionError,
  
  // Validation (internal use)
  _validateBigNumber: validateBigNumber,
  _validateDecimals: validateDecimals,
};