/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.1.0 (Integration Ready)
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
  SimulationResult,
  TransactionOptions,
  ValidationError,
  ContractError,
  NetworkError,
  SimulationError,
  PositionOpenedEvent,
  PositionClosedEvent,
  Schemas,
} from './types';
import * as constants from './constants';
import * as utils from './utils';

// ABIs
import PerpEngineABI from './abi/PerpEngine.json';
import AMMPoolABI from './abi/IAMMPool.json';
import LiquidationEngineABI from './abi/ILiquidationEngine.json';
import PositionManagerABI from './abi/IPositionManager.json';
import OracleAggregatorABI from './abi/IOracleAggregator.json';

export class PerpDexClient {
  private config: SDKConfig;
  private provider: ethers.Provider;
  private signer?: ethers.Signer;
  private contracts: Map<string, ethers.Contract>;

  constructor(config: SDKConfig) {
    this.validateConfig(config);
    
    this.provider = config.provider || new ethers.JsonRpcProvider(config.rpcUrl);
    
    if (config.wallet) {
      this.signer = config.wallet.connect(this.provider);
    } else if (config.provider && 'getSigner' in config.provider) {
      this.signer = (config.provider as any).getSigner();
    }
    
    this.config = {
      ...config,
      provider: this.provider,
      gasMultiplier: config.gasMultiplier || 1.2,
      maxGasPrice: config.maxGasPrice || ethers.parseUnits('100', 'gwei'),
    };
    
    this.contracts = new Map();
    this.initializeContracts();
  }

  // ========== PREVIEW HELPERS (CRITICAL FOR FRONTEND) ==========

  /**
   * Preview PnL in quote units (USD)
   */
  async previewPnL(positionId: string, currentPrice?: bigint): Promise<bigint> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      const price = currentPrice || (await this.getOraclePrice(positionId)).price;
      return await perpEngine.getUnrealizedPnl(positionId, price);
    } catch (error) {
      throw new ContractError('Failed to preview PnL');
    }
  }

  /**
   * Preview accrued funding in quote units
   */
  async previewFunding(positionId: string): Promise<bigint> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      const pos = await perpEngine.getPositionInternal(positionId);
      const ammPool = this.getContract('AMMPool');
      
      const fundingBase = await ammPool.calculateFundingPayment(
        pos.marketId,
        pos.size,
        pos.isLong,
        pos.lastFundingAccrued
      );
      
      // Convert to quote units
      const { price } = await this.getOraclePrice(pos.marketId.toString());
      // Price is 8 decimals, but normalized to 18 internally by engine. 
      // SDK should use normalized price for consistent math.
      const normalizedPrice = price * BigInt(10**10);
      
      return (fundingBase * normalizedPrice) / BigInt(1e18);
    } catch (error) {
      throw new ContractError('Failed to preview funding');
    }
  }

  /**
   * Get liquidation price
   */
  async previewLiquidationPrice(positionId: string): Promise<bigint> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      return await perpEngine.getLiquidationPrice(positionId);
    } catch (error) {
      throw new ContractError('Failed to fetch liquidation price');
    }
  }

  /**
   * Get max withdrawable margin
   */
  async getAvailableMargin(positionId: string): Promise<bigint> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      return await perpEngine.getAvailableMargin(positionId);
    } catch (error) {
      throw new ContractError('Failed to fetch available margin');
    }
  }

  /**
   * Get max size increase allowed
   */
  async getMaxAdditionalSize(positionId: string, additionalMargin: bigint = BigInt(0)): Promise<bigint> {
    try {
      const perpEngine = this.getContract('PerpEngine');
      return await perpEngine.getMaxAdditionalSize(positionId, additionalMargin);
    } catch (error) {
      throw new ContractError('Failed to fetch max additional size');
    }
  }

  // ========== CORE TRADING API ==========

  async openPosition(params: OpenPositionParams, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse> {
    const perpEngine = this.getContract('PerpEngine');
    return await perpEngine.openPosition({
      marketId: params.marketId,
      isLong: params.isLong !== false, // default true
      size: params.size,
      margin: params.collateral,
      acceptablePrice: params.acceptablePrice || 0,
      deadline: params.deadline || Math.floor(Date.now() / 1000) + 3600,
      referralCode: params.referralCode || ethers.ZeroHash,
    }, options);
  }

  async closePosition(positionId: string, options?: TransactionOptions): Promise<ethers.ContractTransactionResponse> {
    const perpEngine = this.getContract('PerpEngine');
    return await perpEngine.closePosition(positionId, options);
  }

  // ========== PRIVATE & UTILS ==========

  private initializeContracts(): void {
    const addresses = this.config.addresses || {};
    if (addresses.PerpEngine) {
      this.contracts.set('PerpEngine', new ethers.Contract(addresses.PerpEngine, PerpEngineABI.abi, this.signer || this.provider));
    }
    if (addresses.AMMPool) {
      this.contracts.set('AMMPool', new ethers.Contract(addresses.AMMPool, AMMPoolABI.abi, this.signer || this.provider));
    }
    if (addresses.LiquidationEngine) {
      this.contracts.set('LiquidationEngine', new ethers.Contract(addresses.LiquidationEngine, LiquidationEngineABI.abi, this.signer || this.provider));
    }
    if (addresses.PositionManager) {
      this.contracts.set('PositionManager', new ethers.Contract(addresses.PositionManager, PositionManagerABI.abi, this.signer || this.provider));
    }
    if (addresses.OracleAggregator) {
      this.contracts.set('OracleAggregator', new ethers.Contract(addresses.OracleAggregator, OracleAggregatorABI.abi, this.signer || this.provider));
    }
  }

  private getContract(name: string): ethers.Contract {
    const contract = this.contracts.get(name);
    if (!contract) throw new ValidationError(`Contract ${name} not initialized`);
    return contract;
  }

  async getOraclePrice(marketId: string): Promise<{ price: bigint, timestamp: number }> {
    const perpEngine = this.getContract('PerpEngine');
    const market = await perpEngine.getMarket(marketId);
    const oracle = this.getContract('OracleAggregator');
    const price = await oracle.getPrice(market.oracleFeedId);
    return { price, timestamp: Number(market.lastPriceUpdate) };
  }

  private validateConfig(config: SDKConfig): void {
    if (!config.chainId) throw new ValidationError('Chain ID required');
  }
}
