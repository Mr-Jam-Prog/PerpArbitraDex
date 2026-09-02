"use strict";
/**
 * Main SDK client for PerpArbitraDEX
 * Version: 1.2.0 (MVP Testnet - Checked 2026-09-02)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerpDexClient = void 0;
const ethers_1 = require("ethers");
const types_1 = require("./types");
// ABIs
const PerpEngine_json_1 = __importDefault(require("./abi/PerpEngine.json"));
const IAMMPool_json_1 = __importDefault(require("./abi/IAMMPool.json"));
const ILiquidationEngine_json_1 = __importDefault(require("./abi/ILiquidationEngine.json"));
const IPositionManager_json_1 = __importDefault(require("./abi/IPositionManager.json"));
const IOracleAggregator_json_1 = __importDefault(require("./abi/IOracleAggregator.json"));
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
        this.config = {
            ...config,
            provider: this.provider,
            gasMultiplier: config.gasMultiplier || 1.2,
            maxGasPrice: config.maxGasPrice || ethers_1.ethers.parseUnits('100', 'gwei'),
        };
        this.contracts = new Map();
        this.initializeContracts();
    }
    // ========== PREVIEW HELPERS (CRITICAL FOR FRONTEND) ==========
    /**
     * Preview PnL in quote units (USD)
     */
    async previewPnL(positionId, currentPrice) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            const price = currentPrice || (await this.getOraclePrice(positionId)).price;
            return await perpEngine.getUnrealizedPnl(positionId, price);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to preview PnL');
        }
    }
    /**
     * Preview accrued funding in quote units
     */
    async previewFunding(positionId) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            const pos = await perpEngine.getPositionInternal(positionId);
            const ammPool = this.getContract('AMMPool');
            const fundingBase = await ammPool.calculateFundingPayment(pos.marketId, pos.size, pos.isLong, pos.lastFundingAccrued);
            // Convert to quote units
            const { price } = await this.getOraclePrice(pos.marketId.toString());
            // Price is 8 decimals, but normalized to 18 internally by engine.
            // SDK should use normalized price for consistent math.
            const normalizedPrice = price * BigInt(10 ** 10);
            return (fundingBase * normalizedPrice) / BigInt(1e18);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to preview funding');
        }
    }
    /**
     * Get liquidation price
     */
    async previewLiquidationPrice(positionId) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            return await perpEngine.getLiquidationPrice(positionId);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch liquidation price');
        }
    }
    /**
     * Get max withdrawable margin
     */
    async getAvailableMargin(positionId) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            return await perpEngine.getAvailableMargin(positionId);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch available margin');
        }
    }
    /**
     * Get max size increase allowed
     */
    async getMaxAdditionalSize(positionId, additionalMargin = BigInt(0)) {
        try {
            const perpEngine = this.getContract('PerpEngine');
            return await perpEngine.getMaxAdditionalSize(positionId, additionalMargin);
        }
        catch (error) {
            throw new types_1.ContractError('Failed to fetch max additional size');
        }
    }
    // ========== CORE TRADING API ==========
    async openPosition(params, options) {
        const perpEngine = this.getContract('PerpEngine');
        return await perpEngine.openPosition({
            marketId: params.marketId,
            isLong: params.isLong !== false, // default true
            size: params.size,
            margin: params.collateral,
            acceptablePrice: params.acceptablePrice || 0,
            deadline: params.deadline || Math.floor(Date.now() / 1000) + 3600,
            referralCode: params.referralCode || ethers_1.ethers.ZeroHash,
        }, options);
    }
    async closePosition(positionId, options) {
        const perpEngine = this.getContract('PerpEngine');
        return await perpEngine.closePosition(positionId, options);
    }
    // ========== PRIVATE & UTILS ==========
    initializeContracts() {
        const addresses = this.config.addresses || {};
        if (addresses.PerpEngine) {
            this.contracts.set('PerpEngine', new ethers_1.ethers.Contract(addresses.PerpEngine, PerpEngine_json_1.default.abi, this.signer || this.provider));
        }
        if (addresses.AMMPool) {
            this.contracts.set('AMMPool', new ethers_1.ethers.Contract(addresses.AMMPool, IAMMPool_json_1.default.abi, this.signer || this.provider));
        }
        if (addresses.LiquidationEngine) {
            this.contracts.set('LiquidationEngine', new ethers_1.ethers.Contract(addresses.LiquidationEngine, ILiquidationEngine_json_1.default.abi, this.signer || this.provider));
        }
        if (addresses.PositionManager) {
            this.contracts.set('PositionManager', new ethers_1.ethers.Contract(addresses.PositionManager, IPositionManager_json_1.default.abi, this.signer || this.provider));
        }
        if (addresses.OracleAggregator) {
            this.contracts.set('OracleAggregator', new ethers_1.ethers.Contract(addresses.OracleAggregator, IOracleAggregator_json_1.default.abi, this.signer || this.provider));
        }
    }
    getContract(name) {
        const contract = this.contracts.get(name);
        if (!contract)
            throw new types_1.ValidationError(`Contract ${name} not initialized`);
        return contract;
    }
    async getOraclePrice(marketId) {
        const perpEngine = this.getContract('PerpEngine');
        const market = await perpEngine.getMarket(marketId);
        const oracle = this.getContract('OracleAggregator');
        const price = await oracle.getPrice(market.oracleFeedId);
        return { price, timestamp: Number(market.lastPriceUpdate) };
    }
    validateConfig(config) {
        if (!config.chainId)
            throw new types_1.ValidationError('Chain ID required');
    }
}
exports.PerpDexClient = PerpDexClient;
