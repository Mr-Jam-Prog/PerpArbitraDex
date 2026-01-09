"use strict";
/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.0.0
 * Developer-facing interface
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerpDexClient = void 0;
exports.createPerpDexClient = createPerpDexClient;
const ethers_1 = require("ethers");
const types_1 = require("./types");
const constants = __importStar(require("./constants"));
const utils = __importStar(require("./utils"));
class PerpDexClient {
    constructor(config) {
        this.validateConfig(config);
        this.provider = config.provider || new ethers_1.ethers.JsonRpcProvider(config.rpcUrl);
        if (config.wallet) {
            this.signer = config.wallet.connect(this.provider);
        }
        else if (config.provider && 'getSigner' in config.provider) {
            this.signer = config.provider.getSigner();
        }
        const addresses = this.loadAddresses(config.chainId, config.addresses);
        this.config = {
            chainId: config.chainId,
            rpcUrl: config.rpcUrl || '',
            wallet: config.wallet,
            provider: this.provider,
            addresses,
            subgraphUrl: config.subgraphUrl || constants.SUBGRAPH_URLS[config.chainId] || '',
            gasMultiplier: config.gasMultiplier || 1.2,
            maxGasPrice: config.maxGasPrice || ethers_1.ethers.parseUnits('100', 'gwei'),
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
    connect(provider) {
        if ('getAddress' in provider) {
            this.signer = provider;
            this.provider = provider.provider || this.provider;
        }
        else {
            this.provider = provider;
            this.signer = undefined;
        }
        this.initializeContracts();
    }
    async getMarkets(filter) {
        try {
            if (this.subgraphClient) {
                return await this.getMarketsFromSubgraph(filter);
            }
            return await this.getMarketsFromContract();
        }
        catch (error) {
            throw new types_1.NetworkError('Failed to fetch markets');
        }
    }
    async getPositions(address) {
        try {
            const user = address || (this.signer ? await this.signer.getAddress() : undefined);
            if (!user) {
                throw new types_1.ValidationError('User address required');
            }
            if (this.subgraphClient) {
                return await this.getPositionsFromSubgraph({ user });
            }
            const positionManager = this.getContract('PositionManager');
            const positionIds = await positionManager.getPositionIdsByUser(user);
            const positions = [];
            for (const positionId of positionIds) {
                try {
                    const position = await this.getPosition(positionId.toString());
                    positions.push(position);
                }
                catch (error) {
                    console.warn(`Failed to fetch position ${positionId}:`, error);
                }
            }
            return positions;
        }
        catch (error) {
            throw new types_1.NetworkError('Failed to fetch positions');
        }
    }
    async openPosition(params, options) {
        try {
            this.validateOpenPositionParams(params);
            if (!this.signer) {
                throw new types_1.ValidationError('Signer required for opening positions');
            }
            const market = await this.getMarket(params.marketId);
            const leverage = params.leverage || this.calculateLeverageFromSize(params.size, params.collateral, market);
            if (leverage > market.maxLeverage) {
                throw new types_1.ValidationError(`Leverage ${leverage}x exceeds market maximum ${market.maxLeverage}x`);
            }
            const simulation = await this.simulateOpenPosition(params);
            if (!simulation.success) {
                throw new types_1.SimulationError('Open position simulation failed', simulation);
            }
            const gasEstimate = await this.estimateGasForTransaction({
                to: this.config.addresses['PerpEngine'],
                data: '0x',
            });
            const perpEngine = this.getContract('PerpEngine');
            const txParams = await this.prepareTransaction({
                ...options,
                gasLimit: gasEstimate.gasLimit,
            });
            const tx = await perpEngine.openPosition(params.marketId, params.size, params.collateral, params.maxSlippageBps || 50, params.referralCode || '0x', txParams);
            return tx;
        }
        catch (error) {
            if (error instanceof types_1.SDKError) {
                throw error;
            }
            throw new types_1.ContractError('Failed to open position');
        }
    }
    async closePosition(params, options) {
        try {
            this.validateClosePositionParams(params);
            if (!this.signer) {
                throw new types_1.ValidationError('Signer required for closing positions');
            }
            const position = await this.getPosition(params.positionId);
            const signerAddress = await this.signer.getAddress();
            if (position.user.toLowerCase() !== signerAddress.toLowerCase()) {
                throw new types_1.ValidationError('Position does not belong to signer');
            }
            const simulation = await this.simulateClosePosition(params);
            if (!simulation.success) {
                throw new types_1.SimulationError('Close position simulation failed', simulation);
            }
            const gasEstimate = await this.estimateGasForTransaction({
                to: this.config.addresses['PerpEngine'],
                data: '0x',
            });
            const perpEngine = this.getContract('PerpEngine');
            const txParams = await this.prepareTransaction({
                ...options,
                gasLimit: gasEstimate.gasLimit,
            });
            const sizeToClose = params.size || position.size;
            const tx = await perpEngine.closePosition(params.positionId, sizeToClose, params.maxSlippageBps || 50, txParams);
            return tx;
        }
        catch (error) {
            if (error instanceof types_1.SDKError) {
                throw error;
            }
            throw new types_1.ContractError('Failed to close position');
        }
    }
    async liquidate(params, options) {
        try {
            this.validateLiquidationParams(params);
            if (!this.signer) {
                throw new types_1.ValidationError('Signer required for liquidations');
            }
            const position = await this.getPosition(params.positionId);
            if (position.healthFactor >= BigInt(10 ** 6)) {
                throw new types_1.ValidationError('Position is not liquidatable');
            }
            const simulation = await this.simulateLiquidation(params);
            if (!simulation.success) {
                throw new types_1.SimulationError('Liquidation simulation failed', simulation);
            }
            const gasEstimate = await this.estimateGasForTransaction({
                to: this.config.addresses['LiquidationEngine'],
                data: '0x',
            });
            const liquidationEngine = this.getContract('LiquidationEngine');
            const txParams = await this.prepareTransaction({
                ...options,
                gasLimit: gasEstimate.gasLimit,
            });
            const tx = await liquidationEngine.liquidatePosition(params.positionId, params.flashLoan || false, txParams);
            return tx;
        }
        catch (error) {
            if (error instanceof types_1.SDKError) {
                throw error;
            }
            throw new types_1.ContractError('Failed to liquidate position');
        }
    }
    async getMarket(marketId) {
        try {
            const marketRegistry = this.getContract('MarketRegistry');
            const marketData = await marketRegistry.getMarket(marketId);
            return types_1.Schemas.Market.parse({
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
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch market');
        }
    }
    async getPosition(positionId) {
        try {
            const positionManager = this.getContract('PositionManager');
            const positionData = await positionManager.getPosition(positionId);
            return utils.parsePositionFromChain(positionData);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch position');
        }
    }
    async getMarketStats(marketId) {
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
        }
        catch (error) {
            throw new types_1.NetworkError('Failed to fetch market stats');
        }
    }
    async getOraclePrice(marketId) {
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
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch oracle price');
        }
    }
    async simulateOpenPosition(params) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            const signerAddress = this.signer ? await this.signer.getAddress() : ethers_1.ethers.ZeroAddress;
            const result = await perpEngine.openPosition.staticCall(params.marketId, params.size, params.collateral, params.maxSlippageBps || 50, params.referralCode || '0x', {
                from: signerAddress,
            });
            return {
                success: true,
                gasUsed: BigInt(0),
                returnData: result.toString(),
            };
        }
        catch (error) {
            return {
                success: false,
                gasUsed: BigInt(0),
                returnData: '',
                error: error.message || 'Simulation failed',
            };
        }
    }
    async simulateClosePosition(params) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            const signerAddress = this.signer ? await this.signer.getAddress() : ethers_1.ethers.ZeroAddress;
            const position = await this.getPosition(params.positionId);
            const sizeToClose = params.size || position.size;
            const result = await perpEngine.closePosition.staticCall(params.positionId, sizeToClose, params.maxSlippageBps || 50, {
                from: signerAddress,
            });
            return {
                success: true,
                gasUsed: BigInt(0),
                returnData: result.toString(),
            };
        }
        catch (error) {
            return {
                success: false,
                gasUsed: BigInt(0),
                returnData: '',
                error: error.message || 'Simulation failed',
            };
        }
    }
    async estimateGasForTransaction(tx, multiplier) {
        return utils.estimateGas(this.provider, tx, multiplier || this.config.gasMultiplier);
    }
    // ========== EVENT LISTENERS ==========
    onPositionOpened(callback, filter) {
        const perpEngine = this.getContract('PerpEngine');
        const listener = (positionId, user, marketId, size, collateral, entryPrice, event) => {
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
    onPositionClosed(callback, filter) {
        const perpEngine = this.getContract('PerpEngine');
        const listener = (positionId, user, pnl, fee, event) => {
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
    validateConfig(config) {
        if (!config.chainId) {
            throw new types_1.ValidationError('Chain ID is required');
        }
        if (!config.rpcUrl && !config.provider) {
            throw new types_1.ValidationError('Either rpcUrl or provider is required');
        }
    }
    loadAddresses(chainId, customAddresses) {
        return customAddresses || {};
    }
    initializeContracts() {
        // Placeholder for contract initialization
    }
    initializeSubgraphClient() {
        // Placeholder for GraphQL client initialization
    }
    getContract(name) {
        const address = this.config.addresses[name];
        if (!address) {
            throw new types_1.ValidationError(`Contract ${name} not found for chain ${this.config.chainId}`);
        }
        return new ethers_1.ethers.Contract(address, ['function dummy() view returns (uint256)'], this.signer || this.provider);
    }
    validateOpenPositionParams(params) {
        if (!params.marketId) {
            throw new types_1.ValidationError('Market ID is required');
        }
        if (params.size === BigInt(0)) {
            throw new types_1.ValidationError('Position size cannot be zero');
        }
        if (params.collateral <= BigInt(0)) {
            throw new types_1.ValidationError('Collateral must be positive');
        }
        if (params.maxSlippageBps !== undefined && (params.maxSlippageBps < 0 || params.maxSlippageBps > 10000)) {
            throw new types_1.ValidationError('Slippage must be between 0 and 10000 bps');
        }
    }
    validateClosePositionParams(params) {
        if (!params.positionId) {
            throw new types_1.ValidationError('Position ID is required');
        }
        if (params.size !== undefined && params.size === BigInt(0)) {
            throw new types_1.ValidationError('Close size cannot be zero');
        }
        if (params.maxSlippageBps !== undefined && (params.maxSlippageBps < 0 || params.maxSlippageBps > 10000)) {
            throw new types_1.ValidationError('Slippage must be between 0 and 10000 bps');
        }
    }
    validateLiquidationParams(params) {
        if (!params.positionId) {
            throw new types_1.ValidationError('Position ID is required');
        }
    }
    async prepareTransaction(options) {
        const txParams = {};
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
        if (this.config.maxGasPrice > BigInt(0)) {
            const feeData = await this.provider.getFeeData();
            const currentGasPrice = feeData.gasPrice || BigInt(0);
            if (currentGasPrice > this.config.maxGasPrice) {
                throw new types_1.ValidationError(`Gas price ${ethers_1.ethers.formatUnits(currentGasPrice, 'gwei')} gwei exceeds maximum ${ethers_1.ethers.formatUnits(this.config.maxGasPrice, 'gwei')} gwei`);
            }
        }
        return txParams;
    }
    calculateLeverageFromSize(size, collateral, market) {
        if (collateral === BigInt(0)) {
            return 0;
        }
        const sizeAbs = size < BigInt(0) ? BigInt(-1) * size : size;
        const leverage = Number((sizeAbs * BigInt(100)) / collateral);
        return leverage / 100;
    }
    async getMarketsFromSubgraph(filter) {
        return [];
    }
    async getMarketsFromContract() {
        return [];
    }
    async getPositionsFromSubgraph(filter) {
        return [];
    }
    async get24hVolume(marketId) {
        return BigInt(0);
    }
    async simulateLiquidation(params) {
        return { success: true, gasUsed: BigInt(0), returnData: '' };
    }
    get chainId() {
        return this.config.chainId;
    }
    get signerAddress() {
        return this.signer ? this.signer.address : undefined;
    }
    get isReadOnly() {
        return !this.signer;
    }
}
exports.PerpDexClient = PerpDexClient;
function createPerpDexClient(config) {
    return new PerpDexClient(config);
}
exports.default = PerpDexClient;
