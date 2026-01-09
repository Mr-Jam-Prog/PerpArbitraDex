export declare class SDKError extends Error {
    details?: any | undefined;
    constructor(message: string, details?: any | undefined);
}
export declare class ValidationError extends SDKError {
    constructor(message: string, details?: any);
}
export declare class ContractError extends SDKError {
    constructor(message: string, details?: any);
}
export declare class NetworkError extends SDKError {
    constructor(message: string, details?: any);
}
export declare class SimulationError extends SDKError {
    constructor(message: string, details?: any);
}
//# sourceMappingURL=errors.d.ts.map