export class SDKError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'SDKError';
  }
}

export class ValidationError extends SDKError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'ValidationError';
  }
}

export class ContractError extends SDKError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'ContractError';
  }
}

export class NetworkError extends SDKError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'NetworkError';
  }
}

export class SimulationError extends SDKError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'SimulationError';
  }
}
