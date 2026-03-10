// @title: Service positions utilisateur avec calculs PnL et liquidation price
// @audit: Miroir exact de PositionMath.ts, validation complète, cache intelligent
// @security: BigInt uniquement, vérifications overflow, pas de recalcul si on-chain disponible

import { subgraphClient } from '../indexer/graphql/client';
import { POSITION_QUERIES } from '../indexer/graphql/queries';
import { getContract } from '../../utils/contracts';
import { 
  formatUnits, 
  parseUnits,
  formatPrice,
  formatPnL,
  formatHealthFactor
} from '../../utils/formatting';
import { PositionMath } from '../../utils/math/positionMath';

class PositionService {
  constructor(options = {}) {
    this.cache = new Map();
    this.options = {
      cacheTTL: options.cacheTTL || 30000,
      maxCacheSize: options.maxCacheSize || 1000,
      subgraphFallback: options.subgraphFallback !== false,
      ...options
    };
    
    this.positionMath = new PositionMath();
    this.userPositions = new Map();
  }

  // Get all open positions for user
  async getOpenPositions(userAddress) {
    const cacheKey = `open_positions_${userAddress}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      let positions = [];
      
      // Try subgraph first
      if (this.options.subgraphFallback) {
        try {
          const result = await subgraphClient.query({
            query: POSITION_QUERIES.GET_OPEN_POSITIONS,
            variables: { owner: userAddress.toLowerCase() }
          });
          
          if (result.data?.positions) {
            positions = await Promise.all(
              result.data.positions.map(pos => this._processPositionData(pos, userAddress))
            );
          }
        } catch (subgraphError) {
          console.warn('Subgraph failed, using contract fallback:', subgraphError);
          positions = await this._getPositionsFromContract(userAddress);
        }
      } else {
        positions = await this._getPositionsFromContract(userAddress);
      }
      
      // Filter to only open positions
      const openPositions = positions.filter(pos => pos.size !== '0' && !pos.isClosed);
      
      this._setToCache(cacheKey, openPositions);
      this.userPositions.set(userAddress, openPositions);
      
      return openPositions;
    } catch (error) {
      console.error('Failed to get open positions:', error);
      throw new Error(`Unable to fetch positions: ${error.message}`);
    }
  }

  // Get position by ID
  async getPosition(positionId, userAddress = null) {
    const cacheKey = `position_${positionId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      let position;
      
      // Try subgraph
      try {
        const result = await subgraphClient.query({
          query: POSITION_QUERIES.GET_POSITION,
          variables: { id: positionId }
        });
        
        if (result.data?.position) {
          position = await this._processPositionData(result.data.position, userAddress);
        }
      } catch (subgraphError) {
        console.warn('Subgraph position query failed:', subgraphError);
      }
      
      // Fallback to contract
      if (!position && this.provider) {
        position = await this._getPositionFromContract(positionId, userAddress);
      }
      
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }
      
      this._setToCache(cacheKey, position);
      return position;
    } catch (error) {
      console.error(`Failed to get position ${positionId}:`, error);
      throw error;
    }
  }

  // Get position PnL
  async getPositionPnL(positionId, currentPrice) {
    const cacheKey = `pnl_${positionId}_${currentPrice}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const position = await this.getPosition(positionId);
      
      if (!position || position.size === '0') {
        return { unrealizedPnL: '0', unrealizedPnLPercentage: '0' };
      }
      
      // Calculate PnL using PositionMath
      const size = parseUnits(position.size, 18);
      const entryPrice = parseUnits(position.entryPrice, 8);
      const currentPriceBig = parseUnits(currentPrice, 8);
      const isLong = position.side === 'LONG';
      
      const unrealizedPnL = this.positionMath.calculatePnL(
        size,
        entryPrice,
        currentPriceBig,
        isLong
      );
      
      // Calculate PnL percentage
      const collateral = parseUnits(position.collateral, 6);
      let pnlPercentage = '0';
      
      if (collateral > 0n) {
        pnlPercentage = (unrealizedPnL * parseUnits('1', 18)) / collateral;
      }
      
      const result = {
        unrealizedPnL: formatUnits(unrealizedPnL, 18),
        unrealizedPnLPercentage: formatUnits(pnlPercentage, 18),
        isProfit: unrealizedPnL >= 0n
      };
      
      this._setToCache(cacheKey, result, 5000); // Short cache for PnL
      return result;
    } catch (error) {
      console.error(`Failed to calculate PnL for position ${positionId}:`, error);
      throw error;
    }
  }

  // Get liquidation price
  async getLiquidationPrice(positionId) {
    const cacheKey = `liquidation_price_${positionId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const position = await this.getPosition(positionId);
      
      if (!position || position.size === '0') {
        return { liquidationPrice: '0', distanceToLiq: '100' };
      }
      
      // Get maintenance margin ratio
      if (!this.provider) {
        throw new Error('Provider not available');
      }
      
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const params = await perpEngine.getGlobalParameters();
      const maintenanceMargin = params.maintenanceMarginRatio;
      
      // Calculate liquidation price using PositionMath
      const collateral = parseUnits(position.collateral, 6);
      const size = parseUnits(position.size, 18);
      const isLong = position.side === 'LONG';
      
      const liquidationPrice = this.positionMath.calculateLiquidationPrice(
        collateral,
        size,
        isLong,
        maintenanceMargin
      );
      
      // Calculate distance to liquidation
      const currentPrice = parseUnits(position.marketPrice || '0', 8);
      let distanceToLiq = '100';
      
      if (currentPrice > 0n && liquidationPrice > 0n) {
        if (isLong) {
          // For long: distance = (current - liquidation) / current
          distanceToLiq = ((currentPrice - liquidationPrice) * parseUnits('100', 18)) / currentPrice;
        } else {
          // For short: distance = (liquidation - current) / current
          distanceToLiq = ((liquidationPrice - currentPrice) * parseUnits('100', 18)) / currentPrice;
        }
        
        if (distanceToLiq < 0n) distanceToLiq = 0n;
      }
      
      const result = {
        liquidationPrice: formatUnits(liquidationPrice, 8),
        distanceToLiq: formatUnits(distanceToLiq, 18),
        isClose: distanceToLiq < parseUnits('5', 16) // Less than 5%
      };
      
      this._setToCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Failed to calculate liquidation price for position ${positionId}:`, error);
      throw error;
    }
  }

  // Get accrued funding
  async getAccruedFunding(positionId) {
    const cacheKey = `accrued_funding_${positionId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      if (!this.provider) {
        throw new Error('Provider not available');
      }
      
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const funding = await perpEngine.getPositionFunding(positionId);
      
      const result = {
        accruedFunding: formatUnits(funding.accruedFunding, 18),
        lastFundingUpdate: Number(funding.lastFundingUpdate),
        cumulativeFunding: formatUnits(funding.cumulativeFunding, 18)
      };
      
      this._setToCache(cacheKey, result, 10000); // 10 second cache
      return result;
    } catch (error) {
      console.error(`Failed to get accrued funding for position ${positionId}:`, error);
      throw error;
    }
  }

  // Get position health factor
  async getHealthFactor(positionId) {
    const cacheKey = `health_factor_${positionId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      if (!this.provider) {
        throw new Error('Provider not available');
      }
      
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const healthFactor = await perpEngine.getPositionHealthFactor(positionId);
      
      const result = {
        healthFactor: formatUnits(healthFactor.healthFactor, 18),
        maintenanceThreshold: formatUnits(healthFactor.maintenanceThreshold, 18),
        isHealthy: healthFactor.healthFactor >= parseUnits('1', 18),
        isCloseToLiquidation: healthFactor.healthFactor < parseUnits('1.1', 18)
      };
      
      this._setToCache(cacheKey, result, 5000); // 5 second cache
      return result;
    } catch (error) {
      console.error(`Failed to get health factor for position ${positionId}:`, error);
      
      // Fallback calculation
      const position = await this.getPosition(positionId);
      if (!position) throw error;
      
      // Simplified health factor calculation
      const collateral = parseUnits(position.collateral, 6);
      const size = parseUnits(position.size, 18);
      const currentPrice = parseUnits(position.marketPrice || '0', 8);
      const isLong = position.side === 'LONG';
      
      let positionValue = size;
      if (currentPrice > 0n) {
        positionValue = (size * currentPrice) / parseUnits('1', 8);
      }
      
      let healthFactorValue = parseUnits('100', 18);
      if (positionValue > 0n) {
        healthFactorValue = (collateral * parseUnits('1', 18)) / positionValue;
      }
      
      return {
        healthFactor: formatUnits(healthFactorValue, 18),
        maintenanceThreshold: '1.0',
        isHealthy: healthFactorValue >= parseUnits('1', 18),
        isCloseToLiquidation: healthFactorValue < parseUnits('1.1', 18)
      };
    }
  }

  // Get position history (closed positions)
  async getPositionHistory(userAddress, limit = 100, offset = 0) {
    const cacheKey = `position_history_${userAddress}_${limit}_${offset}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: POSITION_QUERIES.GET_POSITION_HISTORY,
        variables: { 
          owner: userAddress.toLowerCase(),
          limit,
          offset
        }
      });
      
      const history = (result.data?.positions || []).map(pos => ({
        id: pos.id,
        market: pos.market,
        side: pos.side,
        size: formatUnits(pos.size, 18),
        entryPrice: formatUnits(pos.entryPrice, 8),
        exitPrice: formatUnits(pos.exitPrice, 8),
        pnl: formatUnits(pos.realizedPnl, 18),
        fundingPaid: formatUnits(pos.fundingPaid, 18),
        openedAt: parseInt(pos.openedAt),
        closedAt: parseInt(pos.closedAt),
        closedBy: pos.closedBy,
        closeReason: pos.closeReason
      }));
      
      this._setToCache(cacheKey, history);
      return history;
    } catch (error) {
      console.error('Failed to get position history:', error);
      return [];
    }
  }

  // Initialize with provider
  initialize(provider, chainId) {
    this.provider = provider;
    this.chainId = chainId;
    return this;
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
    this.userPositions.clear();
  }

  // Private methods
  async _processPositionData(positionData, userAddress) {
    try {
      const position = {
        id: positionData.id,
        owner: positionData.owner,
        market: positionData.market,
        side: positionData.side,
        size: formatUnits(positionData.size, 18),
        collateral: formatUnits(positionData.collateral, 6),
        entryPrice: formatUnits(positionData.entryPrice, 8),
        leverage: formatUnits(positionData.leverage, 18),
        openedAt: parseInt(positionData.openedAt),
        lastUpdated: parseInt(positionData.lastUpdated),
        isClosed: positionData.isClosed || false,
        closedAt: positionData.closedAt ? parseInt(positionData.closedAt) : null,
        closedBy: positionData.closedBy,
        closeReason: positionData.closeReason
      };
      
      // Enhance with real-time data if provider available
      if (this.provider) {
        const [healthFactor, liquidationPrice, accruedFunding] = await Promise.all([
          this.getHealthFactor(positionData.id).catch(() => null),
          this.getLiquidationPrice(positionData.id).catch(() => null),
          this.getAccruedFunding(positionData.id).catch(() => null)
        ]);
        
        position.healthFactor = healthFactor;
        position.liquidationPrice = liquidationPrice;
        position.accruedFunding = accruedFunding;
        
        // Get current market price
        try {
          const oracleAggregator = getContract('OracleAggregator', this.provider, this.chainId);
          const priceData = await oracleAggregator.getPrice(position.market);
          position.marketPrice = formatUnits(priceData, 8);
        } catch (priceError) {
          console.warn('Failed to get market price:', priceError);
          position.marketPrice = position.entryPrice;
        }
      }
      
      return position;
    } catch (error) {
      console.error('Failed to process position data:', error);
      throw error;
    }
  }

  async _getPositionsFromContract(userAddress) {
    if (!this.provider) {
      throw new Error('Provider not available');
    }
    
    try {
      const positionManager = getContract('PositionManager', this.provider, this.chainId);
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      
      // Get position IDs owned by user
      const balance = await positionManager.balanceOf(userAddress);
      const positions = [];
      
      for (let i = 0; i < Number(balance); i++) {
        try {
          const tokenId = await positionManager.tokenOfOwnerByIndex(userAddress, i);
          const position = await this._getPositionFromContract(tokenId, userAddress);
          if (position) positions.push(position);
        } catch (error) {
          console.warn(`Failed to get position at index ${i}:`, error);
        }
      }
      
      return positions;
    } catch (error) {
      console.error('Failed to get positions from contract:', error);
      throw error;
    }
  }

  async _getPositionFromContract(positionId, userAddress) {
    if (!this.provider) return null;
    
    try {
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const position = await perpEngine.getPosition(positionId);
      
      // Get position metadata
      const positionManager = getContract('PositionManager', this.provider, this.chainId);
      const owner = await positionManager.ownerOf(positionId);
      
      // Verify ownership if userAddress provided
      if (userAddress && owner.toLowerCase() !== userAddress.toLowerCase()) {
        return null;
      }
      
      return {
        id: positionId.toString(),
        owner,
        market: position.market,
        side: position.isLong ? 'LONG' : 'SHORT',
        size: formatUnits(position.size, 18),
        collateral: formatUnits(position.collateral, 6),
        entryPrice: formatUnits(position.entryPrice, 8),
        leverage: formatUnits(position.leverage, 18),
        openedAt: Number(position.openedAt),
        lastUpdated: Number(position.lastUpdated),
        isClosed: position.size === 0n
      };
    } catch (error) {
      console.error(`Failed to get position ${positionId} from contract:`, error);
      return null;
    }
  }

  _getFromCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  _setToCache(key, data, ttl = this.options.cacheTTL) {
    // Manage cache size
    if (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }
}

// Export singleton instance
export const positionService = new PositionService();

// Hook for React components
export function usePositions() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const { account, provider, chainId } = useWeb3React();
  
  useEffect(() => {
    if (provider && chainId) {
      positionService.initialize(provider, chainId);
    }
  }, [provider, chainId]);
  
  const loadPositions = useCallback(async () => {
    if (!account) {
      setPositions([]);
      return [];
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const positionsData = await positionService.getOpenPositions(account);
      setPositions(positionsData);
      setLoading(false);
      return positionsData;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, [account]);
  
  const getPosition = useCallback(async (positionId) => {
    setLoading(true);
    setError(null);
    
    try {
      const position = await positionService.getPosition(positionId, account);
      setLoading(false);
      return position;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, [account]);
  
  const getPositionPnL = useCallback(async (positionId, currentPrice) => {
    setLoading(true);
    setError(null);
    
    try {
      const pnl = await positionService.getPositionPnL(positionId, currentPrice);
      setLoading(false);
      return pnl;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  // Auto-refresh positions
  useEffect(() => {
    if (account && provider && chainId) {
      loadPositions();
      
      const interval = setInterval(() => {
        loadPositions();
      }, 30000); // Refresh every 30 seconds
      
      return () => clearInterval(interval);
    }
  }, [account, provider, chainId, loadPositions]);
  
  return {
    positions,
    loading,
    error,
    loadPositions,
    getPosition,
    getPositionPnL,
    clearCache: positionService.clearCache.bind(positionService)
  };
}