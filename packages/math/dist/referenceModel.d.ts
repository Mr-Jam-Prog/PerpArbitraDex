/**
 * Reference Executable Math Model for Perpetual DEX Protocol
 * Formally defined according to docs/ECONOMIC_SPEC.md
 */
export declare const WAD: bigint;
export declare const ORACLE_PRICE_DECIMALS = 8n;
export declare const ORACLE_NORM_FACTOR: bigint;
export interface ProtocolParams {
    maxLeverageBps: bigint;
    initialMarginBps: bigint;
    maintenanceMarginBps: bigint;
    liquidationPenaltyBps: bigint;
    liquidatorRewardShareBps: bigint;
    protocolFeeBps: bigint;
    quoteDecimals: number;
}
export interface PositionState {
    sizeWad: bigint;
    entryPriceWad: bigint;
    marginWad: bigint;
    isLong: boolean;
    entryFundingIndexWad: bigint;
}
export interface MarketState {
    indexPriceWad: bigint;
    cumulativeFundingIndexWad: bigint;
    skewWad: bigint;
    skewScaleWad: bigint;
}
/**
 * Floor division: floor(a * b / c)
 */
export declare function mulDivFloor(a: bigint, b: bigint, c: bigint): bigint;
/**
 * Ceil division: ceil(a * b / c)
 */
export declare function mulDivCeil(a: bigint, b: bigint, c: bigint): bigint;
/**
 * Absolute value for BigInt
 */
export declare function abs(a: bigint): bigint;
/**
 * Converts external oracle price (8 decimals) to internal WAD price (18 decimals)
 */
export declare function normalizeOraclePrice(rawPrice8Decimals: bigint): bigint;
/**
 * Converts 18-decimal quote WAD amount to native ERC20 quote token units (floor rounding)
 */
export declare function wadToNativeQuote(wadAmount: bigint, quoteDecimals: number): bigint;
/**
 * Converts 18-decimal quote WAD amount to native ERC20 quote token units (ceil rounding)
 */
export declare function wadToNativeQuoteCeil(wadAmount: bigint, quoteDecimals: number): bigint;
/**
 * Converts native ERC20 quote token units to 18-decimal quote WAD amount
 */
export declare function nativeQuoteToWad(nativeAmount: bigint, quoteDecimals: number): bigint;
/**
 * Calculate Notional Value in Quote WAD
 * notionalQuoteWad = sizeWad * priceWad / 1e18
 */
export declare function calculateNotionalQuoteWad(sizeWad: bigint, priceWad: bigint): bigint;
/**
 * Calculate Mark Price given Index Price and Skew
 * MarkPrice = IndexPrice * (1 + Skew / SkewScale)
 */
export declare function calculateMarkPriceWad(indexPriceWad: bigint, skewWad: bigint, skewScaleWad: bigint): bigint;
/**
 * Calculate PnL in Quote WAD
 * Long:  PnL = sizeWad * (currentPriceWad - entryPriceWad) / 1e18
 * Short: PnL = sizeWad * (entryPriceWad - currentPriceWad) / 1e18
 */
export declare function calculateUnrealizedPnlWad(sizeWad: bigint, entryPriceWad: bigint, currentPriceWad: bigint, isLong: boolean): bigint;
/**
 * Calculate Cumulative Funding Payment in Quote WAD
 * FundingPayment = sizeWad * (cumFundingCurr - cumFundingEntry) / 1e18 * (isLong ? +1 : -1)
 * Positive value = Trader owes / pays funding
 * Negative value = Trader receives funding
 */
export declare function calculateFundingPaymentWad(sizeWad: bigint, entryFundingIndexWad: bigint, currentFundingIndexWad: bigint, isLong: boolean): bigint;
/**
 * Calculate Equity in Quote WAD
 * equityWad = marginWad + unrealizedPnlWad - fundingPaymentWad
 */
export declare function calculateEquityWad(marginWad: bigint, unrealizedPnlWad: bigint, fundingPaymentWad: bigint): bigint;
/**
 * Calculate Maintenance Margin Requirement in Quote WAD (Ceil rounding to preserve solvency)
 */
export declare function calculateMaintenanceMarginWad(sizeWad: bigint, currentPriceWad: bigint, maintenanceMarginBps: bigint): bigint;
/**
 * Calculate Health Factor in WAD (1e18 = 1.0 = Liquidation Threshold)
 * HealthFactor = floor(equityWad * 1e18 / maintenanceMarginWad)
 * Returns 0 if equity <= 0
 */
export declare function calculateHealthFactorWad(equityWad: bigint, maintenanceMarginWad: bigint): bigint;
/**
 * Calculate Liquidation Price in WAD
 */
export declare function calculateLiquidationPriceWad(position: PositionState, currentFundingIndexWad: bigint, maintenanceMarginBps: bigint): {
    hasValidLiquidationPrice: boolean;
    liquidationPriceWad: bigint;
};
export interface TradeResult {
    updatedPosition: PositionState;
    protocolFeeWad: bigint;
    traderPayoutWad: bigint;
    realizedPnlWad: bigint;
}
export interface LiquidationExecutionResult {
    liquidatedSizeWad: bigint;
    liquidatorRewardWad: bigint;
    insuranceFundAddWad: bigint;
    badDebtWad: bigint;
    traderRemainingEquityWad: bigint;
}
/**
 * Simulate Position Increase / Opening
 */
export declare function openOrIncreasePosition(position: PositionState | null, addedSizeWad: bigint, addedMarginWad: bigint, execPriceWad: bigint, isLong: boolean, currentFundingIndexWad: bigint, params: ProtocolParams): TradeResult;
/**
 * Simulate Partial Decrease or Full Close of Position
 */
export declare function decreaseOrClosePosition(position: PositionState, closedSizeWad: bigint, execPriceWad: bigint, currentFundingIndexWad: bigint, params: ProtocolParams): TradeResult;
/**
 * Execute Liquidation according to Solvency Rules (Prompt 07B Full Liquidation)
 */
export declare function executeLiquidation(position: PositionState, currentPriceWad: bigint, currentFundingIndexWad: bigint, params: ProtocolParams): LiquidationExecutionResult;
