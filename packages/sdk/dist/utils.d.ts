import { ethers } from 'ethers';
export declare const DECIMALS: 18;
export declare const PRICE_DECIMALS: 8;
export declare const ONE: bigint;
export declare const PRICE_ONE: bigint;
export declare const MAX_LEVERAGE: bigint;
export declare const MAINTENANCE_MARGIN: bigint;
export declare const INITIAL_MARGIN: bigint;
export declare const LIQUIDATION_FEE: bigint;
export declare const PRECISION: bigint;
/**
 * Parse position data from chain response
 */
export declare function parsePositionFromChain(positionData: any): any;
/**
 * Estimate PnL using math package
 */
export declare function estimatePnL(entryPrice: bigint, currentPrice: bigint, size: bigint, isLong: boolean): {
    pnl: bigint;
    isProfit: boolean;
};
/**
 * Estimate liquidation price using math package
 */
export declare function estimateLiquidationPrice(entryPrice: bigint, size: bigint, collateral: bigint, maintenanceMargin: bigint, isLong: boolean): bigint;
/**
 * Validate oracle data
 */
export declare function validateOracleData(price: bigint, timestamp: number, maxStaleSeconds?: number): {
    isValid: boolean;
    reason?: string;
};
/**
 * Gas estimation utility
 */
export declare function estimateGas(provider: ethers.Provider, tx: ethers.TransactionRequest, multiplier?: number): Promise<any>;
//# sourceMappingURL=utils.d.ts.map