"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Schemas = exports.SimulationError = exports.NetworkError = exports.ContractError = exports.ValidationError = exports.SDKError = void 0;
// ============ ERROR CLASSES ============
class SDKError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'SDKError';
    }
}
exports.SDKError = SDKError;
class ValidationError extends SDKError {
}
exports.ValidationError = ValidationError;
class ContractError extends SDKError {
}
exports.ContractError = ContractError;
class NetworkError extends SDKError {
}
exports.NetworkError = NetworkError;
class SimulationError extends SDKError {
}
exports.SimulationError = SimulationError;
// ============ SCHEMAS ============
exports.Schemas = {
    Market: {
        parse: (data) => data,
    },
    Position: {
        parse: (data) => data,
    },
};
