/**
 * Exact TypeScript mirror of PositionMath.sol
 * DO NOT MODIFY LOGIC - Must match Solidity exactly
 * Version: 1.0.0
 * Solidity: contracts/libraries/PositionMath.sol
 */
export interface PositionParams {
    size: bigint;
    collateral: bigint;
    entryPrice: bigint;
    isLong: boolean;
    fundingAccrued: bigint;
}
export interface PositionRiskParams {
    maintenanceMarginBps: bigint;
    liquidationThresholdBps: bigint;
}
export interface LiquidationResult {
    isLiquidatable: boolean;
    liquidationPrice: bigint;
}
/**
 * @dev Validate price has correct decimals and normalize for internal calculations
 * Mirror of: function validateAndNormalizePrice(uint256 price)
 * @param price Price in external format (must be PRICE_DECIMALS)
 * @return normalizedPrice Price normalized to 18 decimals for calculations
 */
export declare function validateAndNormalizePrice(price: bigint): bigint;
/**
 * @dev Denormalize price from internal format back to external format
 * Mirror of: function denormalizePrice(uint256 normalizedPrice)
 * @param normalizedPrice Price in 18 decimals
 * @return price Price in PRICE_DECIMALS (8 decimals)
 */
export declare function denormalizePrice(normalizedPrice: bigint): bigint;
/**
 * @dev Calculate PnL for a position (size = notional)
 * Mirror of: function calculatePnLWithProfitFlag(uint256 entryPrice, uint256 currentPrice, uint256 size, bool isLong)
 * Mathematical invariant: PnL(long) = -PnL(short) for same parameters
 * @param entryPrice Entry price (8 decimals)
 * @param currentPrice Current price (8 decimals)
 * @param size Notional value (18 decimals)
 * @param isLong True for long, false for short
 * @return pnl PnL (18 decimals, signed)
 * @return absolutePnL Absolute PnL value (18 decimals)
 * @return isProfit True if profit, false if loss
 */
export declare function calculatePnLWithProfitFlag(entryPrice: bigint, currentPrice: bigint, size: bigint, isLong: boolean): [bigint, bigint, boolean];
/**
 * @dev Calculate PnL (optimized version)
 * Mirror of: function calculatePnL(uint256 entryPrice, uint256 currentPrice, uint256 size, bool isLong)
 * Gas-optimized for L2 execution
 */
export declare function calculatePnL(entryPrice: bigint, currentPrice: bigint, size: bigint, isLong: boolean): bigint;
/**
 * @dev Calculate health factor with economic bounds enforcement
 * Mirror of: function calculateHealthFactor(PositionParams memory params, uint256 currentPrice, PositionRiskParams memory riskParams)
 * Health Factor = (collateral + pnl - fundingClamped) / maintenanceMargin
 * @param params Position parameters
 * @param currentPrice Current price (8 decimals)
 * @param riskParams Risk parameters
 * @return healthFactor Health factor (18 decimals, 1e18 = 100% healthy)
 */
export declare function calculateHealthFactor(params: PositionParams, currentPrice: bigint, riskParams: PositionRiskParams): bigint;
/**
 * @dev Calculate liquidation price safely with explicit result
 * Mirror of: function calculateLiquidationPriceSafe(PositionParams memory params, PositionRiskParams memory riskParams)
 * Uses mathematical derivation: collateral + pnl(price) - funding = maintenanceMargin
 * @param params Position parameters
 * @param riskParams Risk parameters
 * @return result Contains liquidation price and liquidatable flag
 */
export declare function calculateLiquidationPriceSafe(params: PositionParams, riskParams: PositionRiskParams): LiquidationResult;
export declare const Constants: {
    readonly PRICE_DECIMALS: 8;
    readonly PRICE_NORMALIZATION: number;
    readonly DECIMALS: number;
    readonly MAX_HEALTH_FACTOR: number;
};
