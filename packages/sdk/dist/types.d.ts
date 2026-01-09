import { ethers } from 'ethers';
export declare class SDKError extends Error {
    details?: any | undefined;
    constructor(message: string, details?: any | undefined);
}
export declare class ValidationError extends SDKError {
}
export declare class ContractError extends SDKError {
}
export declare class NetworkError extends SDKError {
}
export declare class SimulationError extends SDKError {
}
export interface SDKConfig {
    chainId: number;
    rpcUrl?: string;
    wallet?: ethers.Wallet;
    provider?: ethers.Provider;
    addresses?: Record<string, string>;
    subgraphUrl?: string;
    gasMultiplier?: number;
    maxGasPrice?: bigint;
}
export interface Market {
    id: string;
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    oracle: string;
    isActive: boolean;
    isPaused: boolean;
    maxLeverage: number;
    initialMargin: number;
    maintenanceMargin: number;
    liquidationFee: number;
    openInterest: string;
    longOpenInterest: string;
    shortOpenInterest: string;
    skew: string;
    fundingRate: string;
    lastFundingTime: number;
}
export interface Position {
    id: string;
    user: string;
    marketId: string;
    size: bigint;
    collateral: bigint;
    entryPrice: bigint;
    isLong: boolean;
    leverage: bigint;
    healthFactor: bigint;
    isLiquidated: boolean;
    isClosed: boolean;
    createdAt: number;
    updatedAt: number;
}
export interface OpenPositionParams {
    marketId: string;
    size: bigint;
    collateral: bigint;
    leverage?: number;
    maxSlippageBps?: number;
    referralCode?: string;
}
export interface ClosePositionParams {
    positionId: string;
    size?: bigint;
    maxSlippageBps?: number;
}
export interface ModifyPositionParams {
    positionId: string;
    sizeDelta?: bigint;
    collateralDelta?: bigint;
}
export interface LiquidationParams {
    positionId: string;
    flashLoan?: boolean;
}
export interface MarketFilter {
    isActive?: boolean;
    isPaused?: boolean;
}
export interface PositionFilter {
    user?: string;
    marketId?: string;
    isLiquidated?: boolean;
    isClosed?: boolean;
    minHealthFactor?: number;
    maxHealthFactor?: number;
    skip?: number;
    first?: number;
    orderBy?: string;
    orderDirection?: 'asc' | 'desc';
}
export interface TransactionOptions {
    gasLimit?: bigint;
    gasPrice?: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    nonce?: number;
    value?: bigint;
}
export interface SimulationResult {
    success: boolean;
    gasUsed: bigint;
    returnData: string;
    error?: string;
    pnl?: bigint;
    fee?: bigint;
}
export interface GasEstimate {
    gasLimit: bigint;
    gasPrice: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
    totalCost: bigint;
}
export interface MarketStats {
    marketId: string;
    volume24h: bigint;
    trades24h: number;
    openInterest: string;
    fundingRate: string;
    skew: string;
    markPrice: bigint;
    indexPrice: bigint;
}
export interface ProtocolStats {
    totalValueLocked: bigint;
    openInterest: bigint;
    dailyVolume: bigint;
    dailyTrades: number;
    dailyLiquidations: number;
    protocolFees24h: bigint;
    activeTraders: number;
    activeMarkets: number;
}
export interface PositionOpenedEvent {
    positionId: bigint;
    user: string;
    marketId: bigint;
    size: bigint;
    collateral: bigint;
    entryPrice: bigint;
    blockNumber: number;
    transactionHash: string;
}
export interface PositionClosedEvent {
    positionId: bigint;
    user: string;
    pnl: bigint;
    fee: bigint;
    blockNumber: number;
    transactionHash: string;
}
export interface LiquidationExecutedEvent {
    positionId: bigint;
    liquidator: string;
    size: bigint;
    collateral: bigint;
    fee: bigint;
    blockNumber: number;
    transactionHash: string;
}
export interface OracleUpdatedEvent {
    marketId: string;
    price: bigint;
    timestamp: number;
    blockNumber: number;
    transactionHash: string;
}
export declare const Schemas: {
    readonly Market: {
        readonly parse: (data: any) => any;
    };
    readonly Position: {
        readonly parse: (data: any) => any;
    };
};
//# sourceMappingURL=types.d.ts.map