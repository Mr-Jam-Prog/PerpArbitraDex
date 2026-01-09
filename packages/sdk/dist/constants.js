"use strict";
/**
 * Protocol constants - Centralized source of truth
 * Version: 1.0.0
 * DO NOT use magic values elsewhere
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVENT_SIGNATURES = exports.ERROR_MESSAGES = exports.PROTOCOL_VERSION = exports.SUBGRAPH_URLS = exports.RPC_URLS = exports.ADDRESSES = exports.LIQUIDATION_CONSTANTS = exports.FUNDING_CONSTANTS = exports.ORACLE_CONSTANTS = exports.MARGIN_CONSTANTS = exports.DECIMALS = exports.CHAIN_IDS = void 0;
// Helper function for BigInt powers
function bigIntPow(base, exponent) {
    let result = BigInt(1);
    for (let i = 0; i < exponent; i++) {
        result *= BigInt(base);
    }
    return result;
}
// Chain IDs
exports.CHAIN_IDS = {
    ARBITRUM_ONE: 42161,
    ARBITRUM_NOVA: 42170,
    ARBITRUM_SEPOLIA: 421614,
    BASE_MAINNET: 8453,
    BASE_SEPOLIA: 84532,
    OPTIMISM: 10,
    OPTIMISM_SEPOLIA: 11155420,
};
// Protocol decimals
exports.DECIMALS = {
    TOKEN: 18,
    PRICE: 8,
    PERCENTAGE: 6,
    LEVERAGE: 2,
};
// Margin parameters
exports.MARGIN_CONSTANTS = {
    MAX_LEVERAGE: 100, // 100x
    INITIAL_MARGIN: 10, // 10%
    MAINTENANCE_MARGIN: 5, // 5%
    LIQUIDATION_FEE: 20, // 2% (20/1000)
    MIN_COLLATERAL: bigIntPow(10, 15), // 0.001 ETH minimum
};
// Oracle parameters
exports.ORACLE_CONSTANTS = {
    MAX_DEVIATION_BPS: 200, // 2%
    MAX_STALE_SECONDS: 120, // 2 minutes
    MIN_PRICE: bigIntPow(10, 6), // $0.000001
    MAX_PRICE: bigIntPow(10, 15), // $1,000,000
    TWAP_PERIOD: 1800, // 30 minutes
};
// Funding parameters
exports.FUNDING_CONSTANTS = {
    INTERVAL_SECONDS: 3600, // 1 hour
    MAX_RATE_BPS: 1000, // 0.1% per hour (10% annual)
    MAX_VELOCITY_BPS: 100, // 0.01% per hour change
    FUNDING_PRECISION: 10 ** 6,
};
// Liquidation parameters
exports.LIQUIDATION_CONSTANTS = {
    HEALTH_FACTOR_THRESHOLD: 1.0, // 1.0 = at liquidation
    HEALTH_FACTOR_WARNING: 1.5, // 1.5 = warning zone
    LIQUIDATION_GAS_BUFFER: 500000, // Gas buffer for liquidation txs
    MAX_LIQUIDATION_DELAY: 300, // 5 minutes max delay
};
// Protocol addresses (empty - populated at runtime)
exports.ADDRESSES = {
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
};
// Network RPC URLs (for fallback)
exports.RPC_URLS = {
    [exports.CHAIN_IDS.ARBITRUM_ONE]: [
        'https://arb1.arbitrum.io/rpc',
        'https://arbitrum-one.publicnode.com',
    ],
    [exports.CHAIN_IDS.ARBITRUM_SEPOLIA]: [
        'https://sepolia-rollup.arbitrum.io/rpc',
    ],
    [exports.CHAIN_IDS.BASE_MAINNET]: [
        'https://mainnet.base.org',
        'https://base.publicnode.com',
    ],
    [exports.CHAIN_IDS.BASE_SEPOLIA]: [
        'https://sepolia.base.org',
    ],
};
// Subgraph URLs
exports.SUBGRAPH_URLS = {
    [exports.CHAIN_IDS.ARBITRUM_ONE]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum',
    [exports.CHAIN_IDS.ARBITRUM_SEPOLIA]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum-sepolia',
    [exports.CHAIN_IDS.BASE_MAINNET]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base',
    [exports.CHAIN_IDS.BASE_SEPOLIA]: 'https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base-sepolia',
};
// Protocol version
exports.PROTOCOL_VERSION = {
    MAJOR: 1,
    MINOR: 0,
    PATCH: 0,
    STRING: '1.0.0',
};
// Error messages
exports.ERROR_MESSAGES = {
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
};
// Event signatures
exports.EVENT_SIGNATURES = {
    POSITION_OPENED: 'PositionOpened(uint256 indexed positionId, address indexed user, uint256 marketId, int256 size, uint256 collateral, uint256 entryPrice)',
    POSITION_CLOSED: 'PositionClosed(uint256 indexed positionId, address indexed user, int256 pnl, uint256 fee)',
    POSITION_MODIFIED: 'PositionModified(uint256 indexed positionId, int256 sizeDelta, uint256 collateralDelta)',
    LIQUIDATION_EXECUTED: 'LiquidationExecuted(uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 collateral, uint256 fee)',
    FUNDING_PAID: 'FundingPaid(uint256 indexed positionId, int256 fundingAmount)',
    ORACLE_UPDATED: 'OracleUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp)',
    MARKET_ADDED: 'MarketAdded(uint256 indexed marketId, string symbol, address oracle)',
    MARKET_PAUSED: 'MarketPaused(uint256 indexed marketId, bool paused)',
};
// Immutable export
exports.default = {
    CHAIN_IDS: exports.CHAIN_IDS,
    DECIMALS: exports.DECIMALS,
    MARGIN_CONSTANTS: exports.MARGIN_CONSTANTS,
    ORACLE_CONSTANTS: exports.ORACLE_CONSTANTS,
    FUNDING_CONSTANTS: exports.FUNDING_CONSTANTS,
    LIQUIDATION_CONSTANTS: exports.LIQUIDATION_CONSTANTS,
    ADDRESSES: exports.ADDRESSES,
    RPC_URLS: exports.RPC_URLS,
    SUBGRAPH_URLS: exports.SUBGRAPH_URLS,
    PROTOCOL_VERSION: exports.PROTOCOL_VERSION,
    ERROR_MESSAGES: exports.ERROR_MESSAGES,
    EVENT_SIGNATURES: exports.EVENT_SIGNATURES,
};
