"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ABIs = void 0;
const PerpEngine_json_1 = __importDefault(require("./PerpEngine.json"));
const IAMMPool_json_1 = __importDefault(require("./IAMMPool.json"));
const ILiquidationEngine_json_1 = __importDefault(require("./ILiquidationEngine.json"));
const IPositionManager_json_1 = __importDefault(require("./IPositionManager.json"));
const IOracleAggregator_json_1 = __importDefault(require("./IOracleAggregator.json"));
const MarketRegistry_json_1 = __importDefault(require("./MarketRegistry.json"));
const ProtocolConfig_json_1 = __importDefault(require("./ProtocolConfig.json"));
exports.ABIs = {
    PerpEngine: PerpEngine_json_1.default,
    AMMPool: IAMMPool_json_1.default,
    LiquidationEngine: ILiquidationEngine_json_1.default,
    PositionManager: IPositionManager_json_1.default,
    OracleAggregator: IOracleAggregator_json_1.default,
    MarketRegistry: MarketRegistry_json_1.default,
    ProtocolConfig: ProtocolConfig_json_1.default,
};
exports.default = exports.ABIs;
