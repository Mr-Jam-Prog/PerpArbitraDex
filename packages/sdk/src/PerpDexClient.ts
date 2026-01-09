/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.0.0
 * Developer-facing interface
 */

import { ethers } from 'ethers';
import { 
  SDKConfig, 
  Position, 
  Market, 
  OpenPositionParams, 
  ClosePositionParams,
  ModifyPositionParams,
  LiquidationParams,
  MarketStats,
  ProtocolStats,
  SimulationResult,
  TransactionOptions,
  PositionFilter,
  MarketFilter,
  SDKError,
  ValidationError,
  ContractError,
  NetworkError,
  SimulationError,
  PositionOpenedEvent,
  PositionClosedEvent,
  LiquidationExecutedEvent,
  OracleUpdatedEvent,
  Schemas,
} from './types';
import * as constants from './constants';
import * as utils from './utils';
import * as math from '@perpdex/math';

export class PerpDexClient {
  private config: SDKConfig;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;
  private contracts: Map<string, ethers.Contract>;
  private subgraphClient?: any;

  constructor(config: SDKConfig) {
    this.validateConfig(config);
    
    this.provider = config.provider || new ethers.JsonRpcProvider(config.rpcUrl);
    
    if (config.wallet) {
      this.signer = config.wallet.connect(this.provider);
    } else if (config.provider && 'getSigner' in config.provider) {
      this.signer = (config.provider as any).getSigner();
    }
    
    const addresses = this.loadAddresses(config.chainId, config.addresses);
    
    this.config = {
      chainId: config.chainId,
      rpcUrl: config.rpcUrl || '',
      wallet: config.wallet,
      provider: this.provider,
      addresses,
      subgraphUrl: config.subgraphUrl || constants.SUBGRAPH_URLS[config.chainId as keyof typeof constants.SUBGRAPH_URLS] || '',
      gasMultiplier: config.gasMultiplier || 1.2,
      maxGasPrice: config.maxGasPrice || ethers.parseUnits('100', 'gwei'),
    };
    
    this.contracts = new Map();
    this.initializeContracts();
    
    if (this.config.subgraphUrl) {
      this.initializeSubgraphClient();
    }
  }

  // ========== PUBLIC API ==========

  /**
   * Connect a new provider/signer
   */
  connect(provider: ethers.Provider | ethers.Signer): void {
    if ('getAddress' in provider) {
      this.signer = provider as ethers.Signer;
      this.provider = provider.provider || this.provider;
    } else {
      this.provider = provider;
      this.signer = undefined;
    }
    this.initializeContracts();
  }

  async getMarkets(filter?: MarketFilter): Promise<Market[]> {
    try {
      if (this.subgraphClient) {
        return await this.getMarketsFromSubgraph(filter);
      }
      return await this.getMarketsFromContract();
    } catch (error) {
      throw new NetworkError('Failed to fetch markets');
    }
  }

  async getPositions(address?: string): Promise<Position[]> {
    try {
      const user = address || (this.signer ? await this.signer.getAddress() : undefined);
      
      if (!user) {
        throw new ValidationError('User address required');
      }

      if (this.subgraphClient) {
        return await this.getPositionsFromSubgraph({ user });
      }
      
      const positionManager = this.getContract('PositionManager');
      const positionIds = await positionManager.getPositionIdsByUser(user);
      const positions: Position[] = [];
      
      for (const positionId of positionIds) {
        try {
          const position = await this.getPosition(positionId.toString());
          positions.push(position);
        } catch (error) {
          console.warn(`Failed to fetch position ${positionId}:`, error);
        }
      }
      
      return positions;
    } catch (error) {
      throw new NetworkError('Failed to fetch positions');
    }
  }

  async openPosition(params: OpenPositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse> {
    try {
      this.validateOpenPositionParams(params);
      
      if (!this.signer) {
        throw new ValidationError('Signer required for opening positions');
      }
      
      const market = await this.getMarket(params.marketId);
      const leverage = params.leverage || this.calculateLeverageFromSize(params.size, params.collateral, market);
      
      if (leverage > market.maxLeverage) {
        throw new ValidationError(`Leverage ${leverage}x exceeds market maximum ${market.maxLeverage}x`);
      }
      
      const simulation = await this.simulateOpenPosition(params);
      if (!simulation.success) {
        throw new SimulationError('Open position simulation failed', simulation);
      }
      
      const gasEstimate = await this.estimateGasForTransaction({
        to: this.config.addresses!['PerpEngine'],
        data: '0x',
      });
      
      const perpEngine = this.getContract('PerpEngine');
      const txParams = await this.prepareTransaction({
        ...options,
        gasLimit: gasEstimate.gasLimit,
      });
      
      const tx = await perpEngine.openPosition(
        params.marketId,
        params.size,
        params.collateral,
        params.maxSlippageBps || 50,
        params.referralCode || '0x',
        txParams
      );
      
      return tx;
    } catch (error) {
      if (error instanceof SDKError) {
        throw error;
      }
      throw new ContractError('Failed to open position');
    }
  }

  async closePosition(params: ClosePositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse> {
    try {
      this.validateClosePositionParams(params);
      
      if (!this.signer) {
        throw new ValidationError('Signer required for closing positions');
      }
      
      const position = await this.getPosition(params.positionId);
      const signerAddress = await this.signer.getAddress();
      
      if (position.user.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new ValidationError('Position does not belong to signer');
      }
      
      const simulation = await this.simulateClosePosition(params);
      if (!simulation.success) {
        throw new SimulationError('Close position simulation failed', simulation);
      }
      
      const gasEstimate = await this.estimateGasForTransaction({
        to: this.config.addresses!['PerpEngine'],
        data: '0x',
      });
      
      const perpEngine = this.getContract('PerpEngine');
      const txParams = await this.prepareTransaction({
        ...options,
        gasLimit: gasEstimate.gasLimit,
      });
      
      const sizeToClose = params.size || position.size;
      const tx = await perpEngine.closePosition(
        params.positionId,
        sizeToClose,
        params.maxSlippageBps || 50,
        txParams
      );
      
      return tx;
    } catch (error) {
      if (error instanceof SDKError) {
        throw error;
      }
      throw new ContractError('Failed to close position');
    }
  }

  async liquidate(params: LiquidationParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse> {
    try {
      this.validateLiquidationParams(params);
      
      if (!this.signer) {
        throw new ValidationError('Signer required for liquidations');
      }
      
      const position = await this.getPosition(params.positionId);
      
      if (position.healthFactor >= BigInt(10 ** 6)) {
        throw new ValidationError('Position is not liquidatable');
      }
      
      const simulation = await this.simulateLiquidation(params);
      if (!simulation.success) {
        throw new SimulationError('Liquidation simulation failed', simulation);
      }
      
      const gasEstimate = await this.estimateGasForTransaction({
        to: this.config.addresses!['LiquidationEngine'],
        data: '0x',
      });
      
      const liquidationEngine = this.getContract('LiquidationEngine');
      const txParams = await this.prepareTransaction({
        ...options,
        gasLimit: gasEstimate.gasLimit,
      });
      
      const tx = await liquidationEngine.liquidatePosition(
        params.positionId,
        params.flashLoan || false,
        txParams
      );
      
      return tx;
    } catch (error) {
      if (error instanceof SDKError) {
        throw error;
      }
      throw new ContractError('Failed to liquidate position');
    }
  }

  async getMarket(marketId: string): Promise<Market> {
    try {
      const marketRegistry = this.getContract('MarketRegistry');
      const marketData = await marketRegistry.getMarket(marketId);
      
      return Schemas.Market.parse({
        id: marketId,
        symbol: marketData.symbol,
        baseAsset: marketData.baseAsset,
        quoteAsset: marketData.quoteAsset,
        oracle: marketData.oracle,
        isActive: marketData.isActive,
        isPaused: marketData.isPaused,
        maxLeverage: Number(marketData.maxLeverage),
        initialMargin: Number(marketData.initialMargin),
        maintenanceMargin: Number(marketData.maintenanceMargin),
        liquidationFee: Number(marketData.liquidationFee),
        openInterest: marketData.openInterest.toString(),
        longOpenInterest: marketData.longOpenInterest.toString(),
        shortOpenInterest: marketData.shortOpenInterest.toString(),
        skew: marketData.skew.toString(),
        fundingRate: marketData.fundingRate.toString(),
        lastFundingTime: Number(marketData.lastFundingTime),
      });
    } catch (error) {
      throw new ContractError('Failed to fetch market');
    }
  }

  async getPosition(positionId: string): Promise<Position> {
    try {
      const positionManager = this.getContract('PositionManager');
      const positionData = await positionManager.getPosition(positionId);
      
      return utils.parsePositionFromChain(positionData);
    } catch (error) {
      throw new ContractError('Failed to fetch position');
    }
  }

  async getMarketStats(marketId: string): Promise<MarketStats> {
    try {
      const market = await this.getMarket(marketId);
      const oracleData = await this.getOraclePrice(marketId);
      const volume24h = await this.get24hVolume(marketId);
      
      return {
        marketId,
        volume24h,
        trades24h: 0,
        openInterest: market.openInterest,
        fundingRate: market.fundingRate,
        skew: market.skew,
        markPrice: oracleData.price,
        indexPrice: oracleData.price,
      };
    } catch (error) {
      throw new NetworkError('Failed to fetch market stats');
    }
  }

  async getOraclePrice(marketId: string): Promise<any> {
    try {
      const oracleAggregator = this.getContract('OracleAggregator');
      const priceData = await oracleAggregator.getPrice(marketId);
      
      return {
        marketId,
        price: priceData.price,
        timestamp: Number(priceData.timestamp),
        source: priceData.source,
        deviation: priceData.deviation ? Number(priceData.deviation) : undefined,
        isStale: Date.now() / 1000 - Number(priceData.timestamp) > constants.ORACLE_CONSTANTS.MAX_STALE_SECONDS,
      };
    } catch (error) {
      throw new ContractError('Failed to fetch oracle price');
    }
  }

  async simulateOpenPosition(params: OpenPositionParams): Promise<SimulationResult> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      const signerAddress = this.signer ? await this.signer.getAddress() : ethers.ZeroAddress;
      
      const result = await perpEngine.openPosition.staticCall(
        params.marketId,
        params.size,
        params.collateral,
        params.maxSlippageBps || 50,
        params.referralCode || '0x',
        {
          from: signerAddress,
        }
      );
      
      return {
        success: true,
        gasUsed: BigInt(0),
        returnData: result.toString(),
      };
    } catch (error: any) {
      return {
        success: false,
        gasUsed: BigInt(0),
        returnData: '',
        error: error.message || 'Simulation failed',
      };
    }
  }

  async simulateClosePosition(params: ClosePositionParams): Promise<SimulationResult> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      const signerAddress = this.signer ? await this.signer.getAddress() : ethers.ZeroAddress;
      const position = await this.getPosition(params.positionId);
      const sizeToClose = params.size || position.size;
      
      const result = await perpEngine.closePosition.staticCall(
        params.positionId,
        sizeToClose,
        params.maxSlippageBps || 50,
        {
          from: signerAddress,
        }
      );
      
      return {
        success: true,
        gasUsed: BigInt(0),
        returnData: result.toString(),
      };
    } catch (error: any) {
      return {
        success: false,
        gasUsed: BigInt(0),
        returnData: '',
        error: error.message || 'Simulation failed',
      };
    }
  }

  async estimateGasForTransaction(
    tx: ethers.TransactionRequest,
    multiplier?: number
  ): Promise<any> {
    return utils.estimateGas(this.provider, tx, multiplier || this.config.gasMultiplier!);
  }

  // ========== EVENT LISTENERS ==========

  onPositionOpened(
    callback: (event: PositionOpenedEvent) => void,
    filter?: { user?: string; marketId?: string }
  ): () => void {
    const perpEngine = this.getContract('PerpEngine');
    
    const listener = (
      positionId: bigint,
      user: string,
      marketId: bigint,
      size: bigint,
      collateral: bigint,
      entryPrice: bigint,
      event: ethers.EventLog
    ) => {
      if (filter?.user && user.toLowerCase() !== filter.user.toLowerCase()) {
        return;
      }
      if (filter?.marketId && marketId.toString() !== filter.marketId) {
        return;
      }
      
      callback({
        positionId,
        user,
        marketId,
        size,
        collateral,
        entryPrice,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    };
    
    perpEngine.on('PositionOpened', listener);
    
    return () => {
      perpEngine.off('PositionOpened', listener);
    };
  }

  onPositionClosed(
    callback: (event: PositionClosedEvent) => void,
    filter?: { user?: string; positionId?: string }
  ): () => void {
    const perpEngine = this.getContract('PerpEngine');
    
    const listener = (
      positionId: bigint,
      user: string,
      pnl: bigint,
      fee: bigint,
      event: ethers.EventLog
    ) => {
      if (filter?.user && user.toLowerCase() !== filter.user.toLowerCase()) {
        return;
      }
      if (filter?.positionId && positionId.toString() !== filter.positionId) {
        return;
      }
      
      callback({
        positionId,
        user,
        pnl,
        fee,
        blockNumber: event.blockNumber,
        transactionHash: event.transactionHash,
      });
    };
    
    perpEngine.on('PositionClosed', listener);
    
    return () => {
      perpEngine.off('PositionClosed', listener);
    };
  }

  // ========== PRIVATE METHODS ==========

  private validateConfig(config: SDKConfig): void {
    if (!config.chainId) {
      throw new ValidationError('Chain ID is required');
    }
    
    if (!config.rpcUrl && !config.provider) {
      throw new ValidationError('Either rpcUrl or provider is required');
    }
  }

  private loadAddresses(chainId: number, customAddresses?: Record<string, string>): Record<string, string> {
    return customAddresses || {};
  }

  private initializeContracts(): void {
    // Placeholder for contract initialization
  }

  private initializeSubgraphClient(): void {
    // Placeholder for GraphQL client initialization
  }

  private getContract(name: string): ethers.Contract {
    const address = this.config.addresses![name];
    if (!address) {
      throw new ValidationError(`Contract ${name} not found for chain ${this.config.chainId}`);
    }
    
    return new ethers.Contract(
      address,
      ['function dummy() view returns (uint256)'],
      this.signer || this.provider
    );
  }

  private validateOpenPositionParams(params: OpenPositionParams): void {
    if (!params.marketId) {
      throw new ValidationError('Market ID is required');
    }
    
    if (params.size === BigInt(0)) {
      throw new ValidationError('Position size cannot be zero');
    }
    
    if (params.collateral <= BigInt(0)) {
      throw new ValidationError('Collateral must be positive');
    }
    
    if (params.maxSlippageBps !== undefined && (params.maxSlippageBps < 0 || params.maxSlippageBps > 10000)) {
      throw new ValidationError('Slippage must be between 0 and 10000 bps');
    }
  }

  private validateClosePositionParams(params: ClosePositionParams): void {
    if (!params.positionId) {
      throw new ValidationError('Position ID is required');
    }
    
    if (params.size !== undefined && params.size === BigInt(0)) {
      throw new ValidationError('Close size cannot be zero');
    }
    
    if (params.maxSlippageBps !== undefined && (params.maxSlippageBps < 0 || params.maxSlippageBps > 10000)) {
      throw new ValidationError('Slippage must be between 0 and 10000 bps');
    }
  }

  private validateLiquidationParams(params: LiquidationParams): void {
    if (!params.positionId) {
      throw new ValidationError('Position ID is required');
    }
  }

  private async prepareTransaction(options?: TransactionOptions): Promise<ethers.TransactionRequest> {
    const txParams: ethers.TransactionRequest = {};
    
    if (options?.gasLimit) {
      txParams.gasLimit = options.gasLimit;
    }
    
    if (options?.gasPrice) {
      txParams.gasPrice = options.gasPrice;
    }
    
    if (options?.maxFeePerGas) {
      txParams.maxFeePerGas = options.maxFeePerGas;
    }
    
    if (options?.maxPriorityFeePerGas) {
      txParams.maxPriorityFeePerGas = options.maxPriorityFeePerGas;
    }
    
    if (options?.nonce) {
      txParams.nonce = options.nonce;
    }
    
    if (options?.value) {
      txParams.value = options.value;
    }
    
    if (this.config.maxGasPrice! > BigInt(0)) {
      const feeData = await this.provider.getFeeData();
      const currentGasPrice = feeData.gasPrice || BigInt(0);
      
      if (currentGasPrice > this.config.maxGasPrice!) {
        throw new ValidationError(`Gas price ${ethers.formatUnits(currentGasPrice, 'gwei')} gwei exceeds maximum ${ethers.formatUnits(this.config.maxGasPrice!, 'gwei')} gwei`);
      }
    }
    
    return txParams;
  }

  private calculateLeverageFromSize(size: bigint, collateral: bigint, market: Market): number {
    if (collateral === BigInt(0)) {
      return 0;
    }
    
    const sizeAbs = size < BigInt(0) ? BigInt(-1) * size : size;
    const leverage = Number((sizeAbs * BigInt(100)) / collateral);
    
    return leverage / 100;
  }

  private async getMarketsFromSubgraph(filter?: MarketFilter): Promise<Market[]> {
    return [];
  }

  private async getMarketsFromContract(): Promise<Market[]> {
    return [];
  }

  private async getPositionsFromSubgraph(filter?: PositionFilter): Promise<Position[]> {
    return [];
  }

  private async get24hVolume(marketId: string): Promise<bigint> {
    return BigInt(0);
  }

  private async simulateLiquidation(params: LiquidationParams): Promise<SimulationResult> {
    return { success: true, gasUsed: BigInt(0), returnData: '' };
  }

  get chainId(): number {
    return this.config.chainId;
  }

  get signerAddress(): string | undefined {
    return this.signer ? (this.signer as any).address : undefined;
  }

  get isReadOnly(): boolean {
    return !this.signer;
  }
}

export function createPerpDexClient(config: SDKConfig): PerpDexClient {
  return new PerpDexClient(config);
}

export default PerpDexClient;