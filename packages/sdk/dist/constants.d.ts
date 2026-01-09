/**
 * Protocol constants - Centralized source of truth
 * Version: 1.0.0
 * DO NOT use magic values elsewhere
 */
export declare const CHAIN_IDS: {
    readonly ARBITRUM_ONE: 42161;
    readonly ARBITRUM_NOVA: 42170;
    readonly ARBITRUM_SEPOLIA: 421614;
    readonly BASE_MAINNET: 8453;
    readonly BASE_SEPOLIA: 84532;
    readonly OPTIMISM: 10;
    readonly OPTIMISM_SEPOLIA: 11155420;
};
export declare const DECIMALS: {
    readonly TOKEN: 18;
    readonly PRICE: 8;
    readonly PERCENTAGE: 6;
    readonly LEVERAGE: 2;
};
export declare const MARGIN_CONSTANTS: {
    readonly MAX_LEVERAGE: 100;
    readonly INITIAL_MARGIN: 10;
    readonly MAINTENANCE_MARGIN: 5;
    readonly LIQUIDATION_FEE: 20;
    readonly MIN_COLLATERAL: bigint;
};
export declare const ORACLE_CONSTANTS: {
    readonly MAX_DEVIATION_BPS: 200;
    readonly MAX_STALE_SECONDS: 120;
    readonly MIN_PRICE: bigint;
    readonly MAX_PRICE: bigint;
    readonly TWAP_PERIOD: 1800;
};
export declare const FUNDING_CONSTANTS: {
    readonly INTERVAL_SECONDS: 3600;
    readonly MAX_RATE_BPS: 1000;
    readonly MAX_VELOCITY_BPS: 100;
    readonly FUNDING_PRECISION: number;
};
export declare const LIQUIDATION_CONSTANTS: {
    readonly HEALTH_FACTOR_THRESHOLD: 1;
    readonly HEALTH_FACTOR_WARNING: 1.5;
    readonly LIQUIDATION_GAS_BUFFER: 500000;
    readonly MAX_LIQUIDATION_DELAY: 300;
};
export declare const ADDRESSES: {
    readonly PerpEngine: "";
    readonly PositionManager: "";
    readonly OracleAggregator: "";
    readonly LiquidationEngine: "";
    readonly AMMPool: "";
    readonly RiskManager: "";
    readonly ProtocolConfig: "";
    readonly GovernanceToken: "";
    readonly Treasury: "";
    readonly TimelockController: "";
};
export declare const RPC_URLS: {
    readonly 42161: readonly ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one.publicnode.com"];
    readonly 421614: readonly ["https://sepolia-rollup.arbitrum.io/rpc"];
    readonly 8453: readonly ["https://mainnet.base.org", "https://base.publicnode.com"];
    readonly 84532: readonly ["https://sepolia.base.org"];
};
export declare const SUBGRAPH_URLS: {
    readonly 42161: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum";
    readonly 421614: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum-sepolia";
    readonly 8453: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base";
    readonly 84532: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base-sepolia";
};
export declare const PROTOCOL_VERSION: {
    readonly MAJOR: 1;
    readonly MINOR: 0;
    readonly PATCH: 0;
    readonly STRING: "1.0.0";
};
export declare const ERROR_MESSAGES: {
    readonly INVALID_ADDRESS: "Invalid address provided";
    readonly INVALID_AMOUNT: "Invalid amount provided";
    readonly INSUFFICIENT_COLLATERAL: "Insufficient collateral";
    readonly EXCEEDS_MAX_LEVERAGE: "Exceeds maximum leverage";
    readonly ORACLE_INVALID: "Oracle data invalid";
    readonly POSITION_NOT_FOUND: "Position not found";
    readonly MARKET_NOT_FOUND: "Market not found";
    readonly INSUFFICIENT_LIQUIDITY: "Insufficient liquidity";
    readonly SLIPPAGE_EXCEEDED: "Slippage exceeded";
    readonly TRANSACTION_REVERTED: "Transaction reverted";
    readonly NETWORK_NOT_SUPPORTED: "Network not supported";
    readonly CONTRACT_NOT_DEPLOYED: "Contract not deployed on this network";
};
export declare const EVENT_SIGNATURES: {
    readonly POSITION_OPENED: "PositionOpened(uint256 indexed positionId, address indexed user, uint256 marketId, int256 size, uint256 collateral, uint256 entryPrice)";
    readonly POSITION_CLOSED: "PositionClosed(uint256 indexed positionId, address indexed user, int256 pnl, uint256 fee)";
    readonly POSITION_MODIFIED: "PositionModified(uint256 indexed positionId, int256 sizeDelta, uint256 collateralDelta)";
    readonly LIQUIDATION_EXECUTED: "LiquidationExecuted(uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 collateral, uint256 fee)";
    readonly FUNDING_PAID: "FundingPaid(uint256 indexed positionId, int256 fundingAmount)";
    readonly ORACLE_UPDATED: "OracleUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp)";
    readonly MARKET_ADDED: "MarketAdded(uint256 indexed marketId, string symbol, address oracle)";
    readonly MARKET_PAUSED: "MarketPaused(uint256 indexed marketId, bool paused)";
};
declare const _default: {
    readonly CHAIN_IDS: {
        readonly ARBITRUM_ONE: 42161;
        readonly ARBITRUM_NOVA: 42170;
        readonly ARBITRUM_SEPOLIA: 421614;
        readonly BASE_MAINNET: 8453;
        readonly BASE_SEPOLIA: 84532;
        readonly OPTIMISM: 10;
        readonly OPTIMISM_SEPOLIA: 11155420;
    };
    readonly DECIMALS: {
        readonly TOKEN: 18;
        readonly PRICE: 8;
        readonly PERCENTAGE: 6;
        readonly LEVERAGE: 2;
    };
    readonly MARGIN_CONSTANTS: {
        readonly MAX_LEVERAGE: 100;
        readonly INITIAL_MARGIN: 10;
        readonly MAINTENANCE_MARGIN: 5;
        readonly LIQUIDATION_FEE: 20;
        readonly MIN_COLLATERAL: bigint;
    };
    readonly ORACLE_CONSTANTS: {
        readonly MAX_DEVIATION_BPS: 200;
        readonly MAX_STALE_SECONDS: 120;
        readonly MIN_PRICE: bigint;
        readonly MAX_PRICE: bigint;
        readonly TWAP_PERIOD: 1800;
    };
    readonly FUNDING_CONSTANTS: {
        readonly INTERVAL_SECONDS: 3600;
        readonly MAX_RATE_BPS: 1000;
        readonly MAX_VELOCITY_BPS: 100;
        readonly FUNDING_PRECISION: number;
    };
    readonly LIQUIDATION_CONSTANTS: {
        readonly HEALTH_FACTOR_THRESHOLD: 1;
        readonly HEALTH_FACTOR_WARNING: 1.5;
        readonly LIQUIDATION_GAS_BUFFER: 500000;
        readonly MAX_LIQUIDATION_DELAY: 300;
    };
    readonly ADDRESSES: {
        readonly PerpEngine: "";
        readonly PositionManager: "";
        readonly OracleAggregator: "";
        readonly LiquidationEngine: "";
        readonly AMMPool: "";
        readonly RiskManager: "";
        readonly ProtocolConfig: "";
        readonly GovernanceToken: "";
        readonly Treasury: "";
        readonly TimelockController: "";
    };
    readonly RPC_URLS: {
        readonly 42161: readonly ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one.publicnode.com"];
        readonly 421614: readonly ["https://sepolia-rollup.arbitrum.io/rpc"];
        readonly 8453: readonly ["https://mainnet.base.org", "https://base.publicnode.com"];
        readonly 84532: readonly ["https://sepolia.base.org"];
    };
    readonly SUBGRAPH_URLS: {
        readonly 42161: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum";
        readonly 421614: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/arbitrum-sepolia";
        readonly 8453: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base";
        readonly 84532: "https://api.thegraph.com/subgraphs/name/perp-arbitra-dex/base-sepolia";
    };
    readonly PROTOCOL_VERSION: {
        readonly MAJOR: 1;
        readonly MINOR: 0;
        readonly PATCH: 0;
        readonly STRING: "1.0.0";
    };
    readonly ERROR_MESSAGES: {
        readonly INVALID_ADDRESS: "Invalid address provided";
        readonly INVALID_AMOUNT: "Invalid amount provided";
        readonly INSUFFICIENT_COLLATERAL: "Insufficient collateral";
        readonly EXCEEDS_MAX_LEVERAGE: "Exceeds maximum leverage";
        readonly ORACLE_INVALID: "Oracle data invalid";
        readonly POSITION_NOT_FOUND: "Position not found";
        readonly MARKET_NOT_FOUND: "Market not found";
        readonly INSUFFICIENT_LIQUIDITY: "Insufficient liquidity";
        readonly SLIPPAGE_EXCEEDED: "Slippage exceeded";
        readonly TRANSACTION_REVERTED: "Transaction reverted";
        readonly NETWORK_NOT_SUPPORTED: "Network not supported";
        readonly CONTRACT_NOT_DEPLOYED: "Contract not deployed on this network";
    };
    readonly EVENT_SIGNATURES: {
        readonly POSITION_OPENED: "PositionOpened(uint256 indexed positionId, address indexed user, uint256 marketId, int256 size, uint256 collateral, uint256 entryPrice)";
        readonly POSITION_CLOSED: "PositionClosed(uint256 indexed positionId, address indexed user, int256 pnl, uint256 fee)";
        readonly POSITION_MODIFIED: "PositionModified(uint256 indexed positionId, int256 sizeDelta, uint256 collateralDelta)";
        readonly LIQUIDATION_EXECUTED: "LiquidationExecuted(uint256 indexed positionId, address indexed liquidator, uint256 size, uint256 collateral, uint256 fee)";
        readonly FUNDING_PAID: "FundingPaid(uint256 indexed positionId, int256 fundingAmount)";
        readonly ORACLE_UPDATED: "OracleUpdated(uint256 indexed marketId, uint256 price, uint256 timestamp)";
        readonly MARKET_ADDED: "MarketAdded(uint256 indexed marketId, string symbol, address oracle)";
        readonly MARKET_PAUSED: "MarketPaused(uint256 indexed marketId, bool paused)";
    };
};
export default _default;
//# sourceMappingURL=constants.d.ts.map