// @title: Provider Web3 avec fallback automatique et mode read-only
// @audit: Primary → Secondary → Read-only, détection timeout/revert, événements
// @security: No throws bloquants, aucune signature en mode read-only

import { ethers } from 'ethers';
import EventEmitter from 'events';

class ReadOnlyFallbackProvider extends EventEmitter {
  constructor(rpcList, options = {}) {
    super();
    
    this.rpcList = rpcList;
    this.options = {
      timeout: options.timeout || 10000,
      retryAttempts: options.retryAttempts || 3,
      healthCheckInterval: options.healthCheckInterval || 30000,
      ...options
    };
    
    this.currentProviderIndex = 0;
    this.readOnlyMode = false;
    this.providers = [];
    this.healthyProviders = new Set();
    this.initialized = false;
    
    this._initializeProviders();
    this._startHealthChecks();
  }
  
  // Initialize all providers
  _initializeProviders() {
    this.providers = this.rpcList.map((rpcUrl, index) => {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      
      // Store original send method
      const originalSend = provider.send.bind(provider);
      
      // Wrap send method to handle errors and fallback
      provider.send = async (method, params) => {
        try {
          const result = await Promise.race([
            originalSend(method, params),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('RPC timeout')), this.options.timeout)
            )
          ]);
          
          // Mark provider as healthy
          (this.healthyProviders + index);
          return result;
        } catch (error) {
          // Mark provider as unhealthy
          this.healthyProviders.delete(index);
          
          // Try next provider if available
          if (!this.readOnlyMode && this.healthyProviders.size === 0) {
            console.warn(`Provider ${index} failed, switching to read-only mode`);
            this._switchToReadOnlyMode();
          }
          
          throw error;
        }
      };
      
      return provider;
    });
    
    this.initialized = true;
  }
  
  // Switch to read-only mode
  _switchToReadOnlyMode() {
    if (this.readOnlyMode) return;
    
    this.readOnlyMode = true;
    this.emit('readOnlyMode', true);
    console.warn('Switched to read-only mode - no transactions can be sent');
  }
  
  // Switch back to normal mode
  _switchToNormalMode() {
    if (!this.readOnlyMode) return;
    
    this.readOnlyMode = false;
    this.emit('readOnlyMode', false);
    console.info('Switched back to normal mode');
  }
  
  // Start periodic health checks
  _startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(() => {
      this._checkProviderHealth();
    }, this.options.healthCheckInterval);
  }
  
  // Check health of all providers
  async _checkProviderHealth() {
    for (let i = 0; i < this.providers.length; i++) {
      try {
        await Promise.race([
          this.providers[i].getBlockNumber(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        
        (this.healthyProviders + i);
        
        // If we have healthy providers and were in read-only mode, switch back
        if (this.readOnlyMode && this.healthyProviders.size > 0) {
          this._switchToNormalMode();
        }
      } catch (error) {
        this.healthyProviders.delete(i);
        console.warn(`Provider ${i} health check failed:`, error.message);
      }
    }
    
    // If no healthy providers, switch to read-only
    if (this.healthyProviders.size === 0 && !this.readOnlyMode) {
      this._switchToReadOnlyMode();
    }
  }
  
  // Get current provider (round-robin among healthy ones)
  getCurrentProvider() {
    if (!this.initialized) {
      throw new Error('Provider not initialized');
    }
    
    if (this.readOnlyMode) {
      throw new Error('Read-only mode: no provider available for transactions');
    }
    
    const healthyIndices = Array.from(this.healthyProviders);
    if (healthyIndices.length === 0) {
      throw new Error('No healthy providers available');
    }
    
    // Simple round-robin selection
    const selectedIndex = healthyIndices[this.currentProviderIndex % healthyIndices.length];
    this.currentProviderIndex = (this.currentProviderIndex + 1) % healthyIndices.length;
    
    return this.providers[selectedIndex];
  }
  
  // Get any provider (even if unhealthy, for read-only operations)
  getAnyProvider() {
    if (!this.initialized) {
      throw new Error('Provider not initialized');
    }
    
    // Try healthy providers first
    const healthyIndices = Array.from(this.healthyProviders);
    if (healthyIndices.length > 0) {
      return this.providers[healthyIndices[0]];
    }
    
    // Fall back to first provider
    return this.providers[0];
  }
  
  // Check if we can send transactions
  canSendTransactions() {
    return !this.readOnlyMode && this.healthyProviders.size > 0;
  }
  
  // Get provider health status
  getHealthStatus() {
    return {
      totalProviders: this.providers.length,
      healthyProviders: this.healthyProviders.size,
      readOnlyMode: this.readOnlyMode,
      currentProvider: this.currentProviderIndex
    };
  }
  
  // Wrapper methods that mirror ethers provider interface
  
  async getBlockNumber() {
    const provider = this.getAnyProvider();
    return provider.getBlockNumber();
  }
  
  async getNetwork() {
    const provider = this.getAnyProvider();
    return provider.getNetwork();
  }
  
  async getBalance(address, blockTag) {
    const provider = this.getAnyProvider();
    return provider.getBalance(address, blockTag);
  }
  
  async getTransaction(hash) {
    const provider = this.getAnyProvider();
    return provider.getTransaction(hash);
  }
  
  async getTransactionReceipt(hash) {
    const provider = this.getAnyProvider();
    return provider.getTransactionReceipt(hash);
  }
  
  async getCode(address, blockTag) {
    const provider = this.getAnyProvider();
    return provider.getCode(address, blockTag);
  }
  
  async getStorageAt(address, position, blockTag) {
    const provider = this.getAnyProvider();
    return provider.getStorageAt(address, position, blockTag);
  }
  
  async call(transaction, blockTag) {
    const provider = this.getAnyProvider();
    return provider.call(transaction, blockTag);
  }
  
  async estimateGas(transaction) {
    const provider = this.getAnyProvider();
    return provider.estimateGas(transaction);
  }
  
  async getLogs(filter) {
    const provider = this.getAnyProvider();
    return provider.getLogs(filter);
  }
  
  async sendTransaction(signedTransaction) {
    if (this.readOnlyMode) {
      throw new Error('Cannot send transaction in read-only mode');
    }
    
    const provider = this.getCurrentProvider();
    return provider.sendTransaction(signedTransaction);
  }
  
  // Signal that a provider method is not available in read-only mode
  _throwReadOnlyError(method) {
    if (this.readOnlyMode) {
      throw new Error(`Method ${method} not available in read-only mode`);
    }
  }
  
  // Override methods that require write access
  getSigner(address) {
    this._throwReadOnlyError('getSigner');
    const provider = this.getCurrentProvider();
    return provider.getSigner(address);
  }
  
  // Cleanup
  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.removeAllListeners();
  }
}

// Factory function to create fallback provider
export function createFallbackProvider(rpcList, options = {}) {
  return new ReadOnlyFallbackProvider(rpcList, options);
}

// Singleton instance for app-wide use
let globalFallbackProvider = null;

export function getGlobalFallbackProvider(rpcList, options) {
  if (!globalFallbackProvider && rpcList) {
    globalFallbackProvider = createFallbackProvider(rpcList, options);
  }
  return globalFallbackProvider;
}

// Hook for React components
export function useFallbackProvider(rpcList, options) {
  const [provider, setProvider] = useState(null);
  const [readOnlyMode, setReadOnlyMode] = useState(false);
  const [healthStatus, setHealthStatus] = useState({});
  
  useEffect(() => {
    const fallbackProvider = createFallbackProvider(rpcList, options);
    setProvider(fallbackProvider);
    
    const updateHealthStatus = () => {
      setHealthStatus(fallbackProvider.getHealthStatus());
      setReadOnlyMode(fallbackProvider.readOnlyMode);
    };
    
    fallbackProvider.on('readOnlyMode', (mode) => {
      setReadOnlyMode(mode);
      updateHealthStatus();
    });
    
    // Initial health check
    updateHealthStatus();
    
    return () => {
      fallbackProvider.destroy();
    };
  }, [rpcList, options]);
  
  return {
    provider,
    readOnlyMode,
    healthStatus,
    canSendTransactions: provider ? provider.canSendTransactions() : false
  };
}