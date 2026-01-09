// Main SDK entry point - export types first to avoid conflicts
export * from './types';

// Export constants explicitly to avoid conflicts
export {
  CHAIN_IDS,
  DECIMALS,
  MARGIN_CONSTANTS,
  ORACLE_CONSTANTS,
  FUNDING_CONSTANTS,
  LIQUIDATION_CONSTANTS,
  ADDRESSES,
  RPC_URLS,
  SUBGRAPH_URLS,
  PROTOCOL_VERSION,
  ERROR_MESSAGES,
  EVENT_SIGNATURES
} from './constants';

// Export utils with renamed constants to avoid conflicts
export {
  parsePositionFromChain,
  estimatePnL,
  estimateLiquidationPrice,
  validateOracleData,
  estimateGas,
  DECIMALS as UTILS_DECIMALS,
  PRICE_DECIMALS as UTILS_PRICE_DECIMALS,
  ONE as UTILS_ONE,
  PRICE_ONE as UTILS_PRICE_ONE,
  MAX_LEVERAGE as UTILS_MAX_LEVERAGE,
  MAINTENANCE_MARGIN as UTILS_MAINTENANCE_MARGIN,
  INITIAL_MARGIN as UTILS_INITIAL_MARGIN,
  LIQUIDATION_FEE as UTILS_LIQUIDATION_FEE,
  PRECISION as UTILS_PRECISION
} from './utils';

// Export main client and functions
export * from './PerpDexClient';

// Re-export commonly used types for convenience
export type { 
  SDKConfig, 
  Position, 
  Market, 
  OpenPositionParams,
  ClosePositionParams,
  ModifyPositionParams,
  LiquidationParams,
  MarketStats,
  ProtocolStats
} from './types';

export { 
  SDKError,
  ValidationError, 
  ContractError, 
  NetworkError,
  SimulationError
} from './types';