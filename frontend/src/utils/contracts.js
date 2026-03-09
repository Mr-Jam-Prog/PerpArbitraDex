/**
 * PerpArbitraDEX Contracts Registry
 * Features:
 * 1. Checksum addresses validation
 * 2. ChainId guarding
 * 3. ABI versioning
 * 4. Fallback to read-only providers
 */

import { ethers } from 'ethers';
import { isAddress, getAddress } from '@ethersproject/address';

// ========== NETWORK CONFIGURATION ==========
const NETWORKS = {
  // Mainnets
  ARBITRUM_MAINNET: {
    chainId: 42161,
    name: 'Arbitrum One',
    explorer: 'https://arbiscan.io',
    rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL,
  },
  BASE_MAINNET: {
    chainId: 8453,
    name: 'Base',
    explorer: 'https://basescan.org',
    rpcUrl: process.env.NEXT_PUBLIC_BASE_RPC_URL,
  },
  OPTIMISM_MAINNET: {
    chainId: 10,
    name: 'Optimism',
    explorer: 'https://optimistic.etherscan.io',
    rpcUrl: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL,
  },
  
  // Testnets
  ARBITRUM_TESTNET: {
    chainId: 421613,
    name: 'Arbitrum Goerli',
    explorer: 'https://goerli.arbiscan.io',
    rpcUrl: process.env.NEXT_PUBLIC_ARBITRUM_TESTNET_RPC_URL,
  },
  BASE_TESTNET: {
    chainId: 84531,
    name: 'Base Goerli',
    explorer: 'https://goerli.basescan.org',
    rpcUrl: process.env.NEXT_PUBLIC_BASE_TESTNET_RPC_URL,
  },
  OPTIMISM_TESTNET: {
    chainId: 420,
    name: 'Optimism Goerli',
    explorer: 'https://goerli-optimistic.etherscan.io',
    rpcUrl: process.env.NEXT_PUBLIC_OPTIMISM_TESTNET_RPC_URL,
  },
};

// ========== CONTRACT VERSIONING ==========
const CONTRACT_VERSIONS = {
  V1_0_0: '1.0.0',
  V1_1_0: '1.1.0',
  V1_2_0: '1.2.0',
};

// ========== ABI DEFINITIONS ==========
// Core contracts
const PERP_ENGINE_ABI = [
  // Position management
  'function openPosition(string market, uint256 collateral, uint256 size, bool isLong) external returns (uint256)',
  'function closePosition(uint256 positionId) external',
  'function getPosition(uint256 positionId) external view returns (uint256, uint256, uint256, bool, uint256, uint256)',
  'function getPositionHealthFactor(uint256 positionId) external view returns (uint256, uint256)',
  'function getPositionFunding(uint256 positionId) external view returns (int256, int256)',
  'function totalCollateral() external view returns (uint256)',
  'function totalPositionValue() external view returns (uint256)',
  
  // Events
  'event PositionOpened(uint256 indexed positionId, address indexed trader, string market, uint256 collateral, uint256 size, bool isLong)',
  'event PositionClosed(uint256 indexed positionId, address indexed trader, uint256 pnl)',
];

const AMM_POOL_ABI = [
  // Liquidity
  'function addLiquidity(uint256 amount) external',
  'function removeLiquidity(uint256 shares) external',
  'function totalLiquidity() external view returns (uint256)',
  'function getLpBalance(address lp) external view returns (uint256)',
  'function getFundingRate(string market) external view returns (int256)',
  
  // Events
  'event LiquidityAdded(address indexed lp, uint256 amount, uint256 shares)',
  'event LiquidityRemoved(address indexed lp, uint256 amount, uint256 shares)',
];

const ORACLE_AGGREGATOR_ABI = [
  // Price feeds
  'function getPrice(string market) external view returns (uint256)',
  'function getPriceWithTimestamp(string market) external view returns (uint256, uint256)',
  'function isPriceStale(string market) external view returns (bool)',
  'function getOracleDeviations(string market) external view returns (uint256[])',
];

const LIQUIDATION_ENGINE_ABI = [
  // Liquidations
  'function liquidatePosition(uint256 positionId) external',
  'function isLiquidatable(uint256 positionId) external view returns (bool)',
  'function getLiquidationReward(uint256 positionId) external view returns (uint256)',
  
  // Events
  'event PositionLiquidated(uint256 indexed positionId, address indexed liquidator, uint256 reward)',
];

const PROTOCOL_CONFIG_ABI = [
  // Parameters
  'function getGlobalParameters() external view returns (uint256, uint256, uint256, uint256, uint256, uint256)',
  'function getMarketParameters(string market) external view returns (uint256, uint256, uint256, uint256, uint256)',
  'function version() external view returns (uint256)',
];

// Governance
const PERP_DEX_TOKEN_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
  'function transfer(address, uint256) external returns (bool)',
  'function approve(address, uint256) external returns (bool)',
];

const VOTING_ESCROW_ABI = [
  'function createLock(uint256 amount, uint256 unlockTime) external',
  'function increaseAmount(uint256 amount) external',
  'function increaseUnlockTime(uint256 unlockTime) external',
  'function balanceOf(address) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
];

// ========== CONTRACT ADDRESSES ==========
// Production addresses (checksummed)
const CONTRACT_ADDRESSES = {
  [NETWORKS.ARBITRUM_MAINNET.chainId]: {
    // Core
    PerpEngine: getAddress('0x0000000000000000000000000000000000000000'), // TODO: Replace with actual
    AMMPool: getAddress('0x0000000000000000000000000000000000000000'),
    OracleAggregator: getAddress('0x0000000000000000000000000000000000000000'),
    LiquidationEngine: getAddress('0x0000000000000000000000000000000000000000'),
    ProtocolConfig: getAddress('0x0000000000000000000000000000000000000000'),
    
    // Governance
    PerpDexToken: getAddress('0x0000000000000000000000000000000000000000'),
    VotingEscrow: getAddress('0x0000000000000000000000000000000000000000'),
    Governor: getAddress('0x0000000000000000000000000000000000000000'),
    Timelock: getAddress('0x0000000000000000000000000000000000000000'),
    
    // Tokens
    USDC: getAddress('0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'),
    WETH: getAddress('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
  },
  
  [NETWORKS.BASE_MAINNET.chainId]: {
    // TODO: Add Base addresses
  },
  
  // Testnet addresses
  [NETWORKS.ARBITRUM_TESTNET.chainId]: {
    PerpEngine: getAddress('0x0000000000000000000000000000000000000000'),
    AMMPool: getAddress('0x0000000000000000000000000000000000000000'),
    // ... other contracts
  },
};

// ========== CONTRACT REGISTRY ==========
const CONTRACT_REGISTRY = {
  // Core
  PerpEngine: {
    abi: PERP_ENGINE_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  AMMPool: {
    abi: AMM_POOL_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  OracleAggregator: {
    abi: ORACLE_AGGREGATOR_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  LiquidationEngine: {
    abi: LIQUIDATION_ENGINE_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  ProtocolConfig: {
    abi: PROTOCOL_CONFIG_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  
  // Governance
  PerpDexToken: {
    abi: PERP_DEX_TOKEN_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
  VotingEscrow: {
    abi: VOTING_ESCROW_ABI,
    version: CONTRACT_VERSIONS.V1_0_0,
  },
};

// ========== ERROR CLASSES ==========
class ContractError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

class NetworkError extends Error {
  constructor(message, chainId) {
    super(message);
    this.name = 'NetworkError';
    this.chainId = chainId;
  }
}

class AddressError extends Error {
  constructor(message, address) {
    super(message);
    this.name = 'AddressError';
    this.address = address;
  }
}

// ========== HELPER FUNCTIONS ==========
/**
 * Validate and checksum an address
 * @param {string} address - Ethereum address
 * @returns {string} Checksummed address
 * @throws {AddressError} If address is invalid
 */
function validateAddress(address) {
  if (!isAddress(address)) {
    throw new AddressError(`Invalid address: ${address}`, address);
  }
  
  try {
    return getAddress(address);
  } catch (error) {
    throw new AddressError(`Failed to checksum address: ${address}`, address);
  }
}

/**
 * Get network configuration for chainId
 * @param {number} chainId - Ethereum chain ID
 * @returns {object} Network configuration
 * @throws {NetworkError} If network not supported
 */
function getNetworkConfig(chainId) {
  const network = Object.values(NETWORKS).find(n => n.chainId === chainId);
  
  if (!network) {
    throw new NetworkError(`Unsupported network: ${chainId}`, chainId);
  }
  
  return network;
}

/**
 * Get contract address for chainId
 * @param {string} contractName - Contract name
 * @param {number} chainId - Ethereum chain ID
 * @returns {string} Contract address
 * @throws {ContractError} If contract not found
 */
function getContractAddress(contractName, chainId) {
  const addresses = CONTRACT_ADDRESSES[chainId];
  
  if (!addresses) {
    throw new ContractError(
      `No addresses found for chainId: ${chainId}`,
      'NO_ADDRESSES'
    );
  }
  
  const address = addresses[contractName];
  
  if (!address || address === ethers.ZeroAddress) {
    throw new ContractError(
      `Contract ${contractName} not found on chainId: ${chainId}`,
      'CONTRACT_NOT_FOUND'
    );
  }
  
  return validateAddress(address);
}

/**
 * Get contract ABI and version
 * @param {string} contractName - Contract name
 * @returns {object} Contract ABI and version
 * @throws {ContractError} If ABI not found
 */
function getContractAbi(contractName) {
  const contract = CONTRACT_REGISTRY[contractName];
  
  if (!contract) {
    throw new ContractError(
      `ABI not found for contract: ${contractName}`,
      'ABI_NOT_FOUND'
    );
  }
  
  return {
    abi: contract.abi,
    version: contract.version,
  };
}

/**
 * Create a contract instance
 * @param {string} contractName - Contract name
 * @param {ethers.providers.Provider | ethers.Signer} providerOrSigner - Provider or Signer
 * @param {number} chainId - Ethereum chain ID
 * @returns {ethers.Contract} Contract instance
 * @throws {ContractError | NetworkError | AddressError} If any validation fails
 */
export function getContract(contractName, providerOrSigner, chainId) {
  try {
    // Validate inputs
    if (!providerOrSigner) {
      throw new ContractError(
        'Provider or Signer is required',
        'NO_PROVIDER'
      );
    }
    
    if (!chainId) {
      throw new NetworkError('Chain ID is required', null);
    }
    
    // Get network configuration
    const network = getNetworkConfig(chainId);
    
    // Get contract address
    const address = getContractAddress(contractName, chainId);
    
    // Get contract ABI
    const { abi, version } = getContractAbi(contractName);
    
    // Create contract instance
    const contract = new ethers.Contract(address, abi, providerOrSigner);
    
    // Add metadata
    contract._metadata = {
      name: contractName,
      address,
      chainId,
      network: network.name,
      version,
    };
    
    return contract;
    
  } catch (error) {
    // Enhance error with context
    if (error.name === 'ContractError' || 
        error.name === 'NetworkError' || 
        error.name === 'AddressError') {
      throw error;
    }
    
    throw new ContractError(
      `Failed to get contract ${contractName}: ${error.message}`,
      'CONTRACT_INIT_FAILED'
    );
  }
}

/**
 * Get read-only contract instance
 * @param {string} contractName - Contract name
 * @param {number} chainId - Ethereum chain ID
 * @returns {ethers.Contract} Read-only contract instance
 */
export function getReadOnlyContract(contractName, chainId) {
  try {
    const network = getNetworkConfig(chainId);
    
    // Use environment RPC URL or fallback to public RPC
    const rpcUrl = network.rpcUrl || getPublicRpcUrl(chainId);
    
    if (!rpcUrl) {
      throw new NetworkError(
        `No RPC URL available for network: ${network.name}`,
        chainId
      );
    }
    
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl, chainId);
    
    return getContract(contractName, provider, chainId);
    
  } catch (error) {
    // Fallback to any available RPC
    const fallbackProvider = createFallbackProvider(chainId);
    return getContract(contractName, fallbackProvider, chainId);
  }
}

/**
 * Create fallback provider for read-only operations
 * @param {number} chainId - Ethereum chain ID
 * @returns {ethers.providers.FallbackProvider} Fallback provider
 */
function createFallbackProvider(chainId) {
  const network = getNetworkConfig(chainId);
  
  // Public RPC endpoints (fallback only)
  const publicRpcs = {
    42161: [  // Arbitrum
      'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}',
    ],
    8453: [   // Base
      'https://mainnet.base.org',
      'https://base-mainnet.infura.io/v3/${INFURA_KEY}',
    ],
    10: [     // Optimism
      'https://mainnet.optimism.io',
      'https://optimism-mainnet.infura.io/v3/${INFURA_KEY}',
    ],
  };
  
  const endpoints = publicRpcs[chainId] || [];
  
  if (endpoints.length === 0) {
    throw new NetworkError(
      `No fallback RPC available for network: ${network.name}`,
      chainId
    );
  }
  
  const providers = endpoints.map(url => {
    try {
      return new ethers.providers.JsonRpcProvider(
        url.replace('${INFURA_KEY}', process.env.NEXT_PUBLIC_INFURA_KEY || ''),
        chainId
      );
    } catch (error) {
      console.warn(`Failed to create provider for ${url}:`, error.message);
      return null;
    }
  }).filter(Boolean);
  
  if (providers.length === 0) {
    throw new NetworkError(
      `All fallback RPCs failed for network: ${network.name}`,
      chainId
    );
  }
  
  return new ethers.providers.FallbackProvider(providers);
}

/**
 * Get public RPC URL for chainId
 * @param {number} chainId - Ethereum chain ID
 * @returns {string} Public RPC URL
 */
function getPublicRpcUrl(chainId) {
  const publicRpcs = {
    42161: 'https://arb1.arbitrum.io/rpc',
    8453: 'https://mainnet.base.org',
    10: 'https://mainnet.optimism.io',
    421613: 'https://goerli-rollup.arbitrum.io/rpc',
    84531: 'https://goerli.base.org',
    420: 'https://goerli.optimism.io',
  };
  
  return publicRpcs[chainId];
}

/**
 * Batch contract calls
 * @param {Array<{contract: string, method: string, args: Array}>} calls - Array of calls
 * @param {ethers.providers.Provider} provider - Provider
 * @param {number} chainId - Chain ID
 * @returns {Promise<Array>} Results
 */
export async function batchContractCalls(calls, provider, chainId) {
  const multicallAddress = getMulticallAddress(chainId);
  
  if (!multicallAddress) {
    // Fallback to sequential calls
    const results = [];
    for (const call of calls) {
      try {
        const contract = getContract(call.contract, provider, chainId);
        const result = await contract[call.method](...call.args);
        results.push(result);
      } catch (error) {
        results.push(null);
      }
    }
    return results;
  }
  
  // Use multicall for batch calls
  const Multicall = [
    'function aggregate(tuple(address target, bytes callData)[] calls) external view returns (uint256 blockNumber, bytes[] returnData)',
  ];
  
  const multicall = new ethers.Contract(multicallAddress, Multicall, provider);
  
  const multicallCalls = await Promise.all(
    calls.map(async (call) => {
      const contract = getContract(call.contract, provider, chainId);
      const iface = new ethers.Interface(CONTRACT_REGISTRY[call.contract].abi);
      const callData = iface.encodeFunctionData(call.method, call.args);
      
      return {
        target: contract.address,
        callData,
      };
    })
  );
  
  try {
    const [blockNumber, returnData] = await multicall.aggregate(multicallCalls);
    
    return returnData.map((data, index) => {
      if (data === '0x') return null;
      
      try {
        const call = calls[index];
        const iface = new ethers.Interface(CONTRACT_REGISTRY[call.contract].abi);
        return iface.decodeFunctionResult(call.method, data);
      } catch (error) {
        console.warn(`Failed to decode result for call ${index}:`, error.message);
        return null;
      }
    });
    
  } catch (error) {
    console.error('Multicall failed, falling back to sequential calls:', error.message);
    return batchContractCalls(calls, provider, chainId); // Recursive fallback
  }
}

/**
 * Get multicall address for chain
 * @param {number} chainId - Chain ID
 * @returns {string} Multicall address
 */
function getMulticallAddress(chainId) {
  const addresses = {
    42161: '0x842eC2c7D803033Edf55E478F461FC547Bc54EB2', // Arbitrum Multicall3
    8453: '0xca11bde05977b3631167028862be2a173976ca11', // Base Multicall3
    10: '0xca11bde05977b3631167028862be2a173976ca11',   // Optimism Multicall3
    421613: '0x842eC2c7D803033Edf55E478F461FC547Bc54EB2', // Arbitrum Testnet
    84531: '0xca11bde05977b3631167028862be2a173976ca11', // Base Testnet
    420: '0xca11bde05977b3631167028862be2a173976ca11',   // Optimism Testnet
  };
  
  return addresses[chainId];
}

/**
 * Subscribe to contract events
 * @param {string} contractName - Contract name
 * @param {ethers.providers.Provider} provider - Provider
 * @param {number} chainId - Chain ID
 * @param {string} eventName - Event name
 * @param {Function} callback - Callback function
 * @returns {Promise<ethers.Contract>} Contract with listener
 */
export async function subscribeToEvent(contractName, provider, chainId, eventName, callback) {
  const contract = getContract(contractName, provider, chainId);
  
  contract.on(eventName, (...args) => {
    try {
      callback(...args);
    } catch (error) {
      console.error(`Error in event callback for ${contractName}.${eventName}:`, error);
    }
  });
  
  return contract;
}

/**
 * Unsubscribe from all contract events
 * @param {ethers.Contract} contract - Contract instance
 */
export function unsubscribeFromEvents(contract) {
  if (contract && contract.removeAllListeners) {
    contract.removeAllListeners();
  }
}

// ========== EXPORTS ==========
export default {
  // Networks
  NETWORKS,
  
  // Functions
  getContract,
  getReadOnlyContract,
  batchContractCalls,
  subscribeToEvent,
  unsubscribeFromEvents,
  
  // Validation
  validateAddress,
  getNetworkConfig,
  getContractAddress,
  getContractAbi,
  
  // Error classes
  ContractError,
  NetworkError,
  AddressError,
};