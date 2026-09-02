/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.1.0 (MVP Testnet - Checked 2026-08-31)
 */
import { ethers } from 'ethers';
import { SDKConfig, OpenPositionParams, TransactionOptions } from './types';
export declare class PerpDexClient {
    private config;
    private provider;
    private signer?;
    private contracts;
    constructor(config: SDKConfig);
    /**
     * Preview PnL in quote units (USD)
     */
    previewPnL(positionId: string, currentPrice?: bigint): Promise<bigint>;
    /**
     * Preview accrued funding in quote units
     */
    previewFunding(positionId: string): Promise<bigint>;
    /**
     * Get liquidation price
     */
    previewLiquidationPrice(positionId: string): Promise<bigint>;
    /**
     * Get max withdrawable margin
     */
    getAvailableMargin(positionId: string): Promise<bigint>;
    /**
     * Get max size increase allowed
     */
    getMaxAdditionalSize(positionId: string, additionalMargin?: bigint): Promise<bigint>;
    openPosition(params: OpenPositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse>;
    closePosition(positionId: string, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse>;
    private initializeContracts;
    private getContract;
    getOraclePrice(marketId: string): Promise<{
        price: bigint;
        timestamp: number;
    }>;
    private validateConfig;
}
//# sourceMappingURL=PerpDexClient.d.ts.map