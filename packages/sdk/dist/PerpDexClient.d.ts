/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.0.0
 * Developer-facing interface
 */
import { ethers } from 'ethers';
import { SDKConfig, Position, Market, OpenPositionParams, ClosePositionParams, LiquidationParams, MarketStats, SimulationResult, TransactionOptions, MarketFilter, PositionOpenedEvent, PositionClosedEvent } from './types';
export declare class PerpDexClient {
    private config;
    private provider;
    private signer?;
    private contracts;
    private subgraphClient?;
    constructor(config: SDKConfig);
    /**
     * Connect a new provider/signer
     */
    connect(provider: ethers.Provider | ethers.Signer): void;
    getMarkets(filter?: MarketFilter): Promise<Market[]>;
    getPositions(address?: string): Promise<Position[]>;
    openPosition(params: OpenPositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse>;
    closePosition(params: ClosePositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse>;
    liquidate(params: LiquidationParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse>;
    getMarket(marketId: string): Promise<Market>;
    getPosition(positionId: string): Promise<Position>;
    getMarketStats(marketId: string): Promise<MarketStats>;
    getOraclePrice(marketId: string): Promise<any>;
    simulateOpenPosition(params: OpenPositionParams): Promise<SimulationResult>;
    simulateClosePosition(params: ClosePositionParams): Promise<SimulationResult>;
    estimateGasForTransaction(tx: ethers.TransactionRequest, multiplier?: number): Promise<any>;
    onPositionOpened(callback: (event: PositionOpenedEvent) => void, filter?: {
        user?: string;
        marketId?: string;
    }): () => void;
    onPositionClosed(callback: (event: PositionClosedEvent) => void, filter?: {
        user?: string;
        positionId?: string;
    }): () => void;
    private validateConfig;
    private loadAddresses;
    private initializeContracts;
    private initializeSubgraphClient;
    private getContract;
    private validateOpenPositionParams;
    private validateClosePositionParams;
    private validateLiquidationParams;
    private prepareTransaction;
    private calculateLeverageFromSize;
    private getMarketsFromSubgraph;
    private getMarketsFromContract;
    private getPositionsFromSubgraph;
    private get24hVolume;
    private simulateLiquidation;
    get chainId(): number;
    get signerAddress(): string | undefined;
    get isReadOnly(): boolean;
}
export declare function createPerpDexClient(config: SDKConfig): PerpDexClient;
export default PerpDexClient;
//# sourceMappingURL=PerpDexClient.d.ts.map