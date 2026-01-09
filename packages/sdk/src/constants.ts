/**
 * Protocol constants - Centralized source of truth
 * Version: 1.0.0
 * DO NOT use magic values elsewhere
 */

// Helper function for BigInt powers
function bigIntPow(base: number, exponent: number): bigint {
    let result = BigInt(1);
    for (let i = 0; i < exponent; i++) {
      result *= BigInt(base);
    }
    return result;
  }
  
  // Chain IDs
  export const CHAIN_IDS = {
    ARBITRUM_ONE: 42161,
    ARBITRUM_NOVA: 42170,
    ARBITRUM_SEPOLIA: 421614,
    BASE_MAINNET: 8453,
    BASE_SEPOLIA: 84532,
    OPTIMISM: 10,
    OPTIMISM_SEPOLIA: 11155420,
  } as const;
  
  // Protocol decimals
  export const DECIMALS = {
    TOKEN: 18,
    PRICE: 8,
    PERCENTAGE: 6,
    LEVERAGE: 2,
  } as const;
  
  // Margin parameters
  export const MARGIN_CONSTANTS = {
    MAX_LEVERAGE: 100, // 100x
    INITIAL_MARGIN: 10, // 10%
    MAINTENANCE_MARGIN: 5, // 5%
    LIQUIDATION_FEE: 20, // 2% (20/1000)
    MIN_COLLATERAL: bigIntPow(10, 15), // 0.001 ETH minimum
  } as const;
  
  // Oracle parameters
  export const ORACLE_CONSTANTS = {
    MAX_DEVIATION_BPS: 200, // 2%
    MAX_STALE_SECONDS: 120, // 2 minutes
    MIN_PRICE: bigIntPow(10, 6), // $0.000001
    MAX_PRICE: bigIntPow(10, 15), // $1,000,000
    TWAP_PERIOD: 1800, // 30 minutes
  } as const;
  
  // Funding parameters
  export const FUNDING_CONSTANTS = {
    INTERVAL_SECONDS: 3600, // 1 hour
    MAX_RATE_BPS: 1000, // 0.1% per hour (10% annual)
    MAX_VELOCITY_BPS: 100, // 0.01% per hour change
    FUNDING_PRECISION: 10 ** 6,
  } as const;
  
  // Liquidation parameters
  export const LIQUIDATION_CONSTANTS = {
    HEALTH_FACTOR_THRESHOLD: 1.0, // 1.0 = at liquidation
    HEALTH_FACTOR_WARNING: 1.5, // 1.5 = warning zone
    LIQUIDATION_GAS_BUFFER: 500000, // Gas buffer for liquidation txs
    MAX_LIQUIDATION_DELAY: 300, // 5 minutes max delay
  } as const;
  
  // Protocol addresses (empty - populated at runtime)
  export const ADDRESSES = {
    // Will be populated by network config
    PerpEngine: '',
    PositionManager: '',
    OracleAggregator: '',
    LiquidationEngine: '',
    AMMPool: '',
    RiskManager: '',
    ProtocolConfig: '',
    GovernanceToken: '',
    Treasury: '',
    TimelockController: '',
  } as const;
  
  // Network RPC URLs (for fallback)
  export const RPC_URLS = {
    [CHAIN_IDS.ARBITRUM_ONE]: [
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one.publicnode.com',
    ],
    [CHAIN_IDS.ARBITRUM_SEPOLIA]: [
      'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    [CHAIN_IDS.BASE_MAINNET]: [
      'https://mainnet.base.org',
      'https://base.publicnode.com',
    ],
    [CHAIN_IDS.BASE_SEPOLIA]: [
      'https://sepolia.base.org',
    ],
  } as const;
  
  // Subgraph URLs
  export const SUBGRAPH_URLS = {
    [CHAIN_IDS.ARBITRUM_ONE]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum',
    [CHAIN_IDS.ARBITRUM_SEPOLIA]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum-sepolia',
    [CHAIN_IDS.BASE_MAINNET]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base',
    [CHAIN_IDS.BASE_SEPOLIA]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base-sepolia',
  } as const;
  
  // Protocol version
  export const PROTOCOL_VERSION = {
    MAJOR: 1,
    MINOR: 0,
    PATCH: 0,
    STRING: '1.0.0',
  } as const;
  
  // Error messages
  export const ERROR_MESSAGES = {
    INVALID_ADDRESS: 'Invalid address provided',
    INVALID_AMOUNT: 'Invalid amount provided',
    INSUFFICIENT_COLLATERAL: 'Insufficient collateral',
    EXCEEDS_MAX_LEVERAGE: 'Exceeds maximum leverage',
    ORACLE_INVALID: 'Oracle data invalid',
    POSITION_NOT_FOUND: 'Position not found',
    MARKET_NOT_FOUND: 'Market not found',
    INSUFFICIENT_LIQUIDITY: 'Insufficient liquidity',
    SLIPPAGE_EXCEEDED: 'Slippage exceeded',
    TRANSACTION_REVERTED: 'Transaction reverted',
    NETWORK_NOT_SUPPORTED: 'Network not supported',
    CONTRACT_NOT_DEPLOYED: 'Contract not deployed on this network',
  } as const;
  
  // Event signatures
  export const EVENT_SIGNATURES = {
    POSITION_OPENED: 'PositionOpened(uint256 indexed positionId, address indexed user, uint256 marketId, int256 size, uint256 collateral, uint256 entryPrice)',
    POSITION_CLOSED: 'PositionClosed(uint256 indexed positionId, address indexed user, int256 pnl, uint256 fee)',
    POSITION_MODIFIED: 'PositionModified(uint256 indexed positionId, int256 sizeDelta, uint256 collateralDelta)',
    LIQUIDATION_EXECUTED: 'LiquidationExecuted(uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 collateral, uint256 fee)',
    FUNDING_PAID: 'FundingPaid(uint256 indexed positionId, int256 fundingAmount)',
    ORACLE_UPDATED: 'OracleUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp)',
    MARKET_ADDED: 'MarketAdded(uint256 indexed marketId, string symbol, address oracle)',
    MARKET_PAUSED: 'MarketPaused(uint256 indexed marketId, bool paused)',
  } as const;
  
  // Immutable export
  export default {
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
    EVENT_SIGNATURES,
  } as const;