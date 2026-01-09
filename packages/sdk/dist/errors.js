"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationError = exports.NetworkError = exports.ContractError = exports.ValidationError = exports.SDKError = void 0;
class SDKError extends Error {
    constructor(message, details) {
        super(message);
        this.details = details;
        this.name = 'SDKError';
    }
}
exports.SDKError = SDKError;
class ValidationError extends SDKError {
    constructor(message, details) {
        super(message, details);
        this.name = 'ValidationError';
    }
}
exports.ValidationError = ValidationError;
class ContractError extends SDKError {
    constructor(message, details) {
        super(message, details);
        this.name = 'ContractError';
    }
}
exports.ContractError = ContractError;
class NetworkError extends SDKError {
    constructor(message, details) {
        super(message, details);
        this.name = 'NetworkError';
    }
}
exports.NetworkError = NetworkError;
class SimulationError extends SDKError {
    constructor(message, details) {
        super(message, details);
        this.name = 'SimulationError';
    }
}
exports.SimulationError = SimulationError;
