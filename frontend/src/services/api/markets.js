// @title: Service marchés avec status oracle et funding rates
// @audit: Read-only, multi-chain support, real-time updates
// @security: Validation des caps & limits, vérification oracle

import { subgraphClient } from '../indexer/graphql/client';
import { MARKET_QUERIES } from '../indexer/graphql/queries';
import { getContract } from '../../utils/contracts';
import { formatUnits, parseUnits } from '../../utils/formatting';

class MarketService {
  constructor(options = {}) {
    this.cache = new Map();
    this.options = {
      cacheTTL: options.cacheTTL || 30000, // 30 seconds for market data
      refreshInterval: options.refreshInterval || 15000,
      ...options
    };
    
    this.markets = new Map();
    this.listeners = new Set();
    this.refreshInterval = null;
  }

  // Initialize with provider
  initialize(provider, chainId) {
    this.provider = provider;
    this.chainId = chainId;
    
    // Start periodic refresh
    this.startAutoRefresh();
    
    return this;
  }

  // Get all markets
  async getAllMarkets() {
    const cacheKey = 'all_markets';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      // Try subgraph first
      const result = await subgraphClient.query({
        query: MARKET_QUERIES.GET_ALL_MARKETS
      });
      
      let markets = [];
      
      if (result.data?.markets) {
        markets = result.data.markets.map(market => ({
          id: market.id,
          name: market.name,
          baseToken: market.baseToken,
          quoteToken: market.quoteToken,
          maxPositionSize: formatUnits(market.maxPositionSize, 18),
          minPositionSize: formatUnits(market.minPositionSize, 18),
          tickSize: formatUnits(market.tickSize, 18),
          isActive: market.isActive,
          createdAt: parseInt(market.createdAt)
        }));
      }
      
      // Enhance with real-time data from contracts
      if (this.provider) {
        markets = await Promise.all(
          markets.map(market => this._enhanceMarketData(market))
        );
      }
      
      this._setToCache(cacheKey, markets);
      this.markets = new Map(markets.map(m => [m.id, m]));
      
      // Notify listeners
      this._notifyListeners('marketsUpdated', markets);
      
      return markets;
    } catch (error) {
      console.error('Failed to get markets:', error);
      
      // Fallback to contract data
      if (this.provider) {
        return this._getMarketsFromContract();
      }
      
      throw new Error(`Unable to fetch markets: ${error.message}`);
    }
  }

  // Get single market
  async getMarket(marketId) {
    const cacheKey = `market_${marketId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      let market;
      
      // Try subgraph
      try {
        const result = await subgraphClient.query({
          query: MARKET_QUERIES.GET_MARKET,
          variables: { id: marketId }
        });
        
        if (result.data?.market) {
          market = {
            id: result.data.market.id,
            name: result.data.market.name,
            baseToken: result.data.market.baseToken,
            quoteToken: result.data.market.quoteToken,
            maxPositionSize: formatUnits(result.data.market.maxPositionSize, 18),
            minPositionSize: formatUnits(result.data.market.minPositionSize, 18),
            tickSize: formatUnits(result.data.market.tickSize, 18),
            isActive: result.data.market.isActive,
            createdAt: parseInt(result.data.market.createdAt)
          };
        }
      } catch (subgraphError) {
        console.warn('Subgraph market query failed:', subgraphError);
        market = null;
      }
      
      // If no market from subgraph or provider available, enhance
      if (!market && this.provider) {
        market = await this._getMarketFromContract(marketId);
      } else if (market && this.provider) {
        market = await this._enhanceMarketData(market);
      }
      
      if (!market) {
        throw new Error(`Market ${marketId} not found`);
      }
      
      this._setToCache(cacheKey, market);
      return market;
    } catch (error) {
      console.error(`Failed to get market ${marketId}:`, error);
      throw error;
    }
  }

  // Get current funding rate
  async getFundingRate(marketId) {
    const cacheKey = `funding_rate_${marketId}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    if (!this.provider) {
      throw new Error('Provider not available');
    }
    
    try {
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const fundingRate = await perpEngine.getFundingRate(marketId);
      
      const rate = {
        current: formatUnits(fundingRate, 18),
        annualized: this._annualizeFundingRate(fundingRate),
        timestamp: Date.now()
      };
      
      this._setToCache(cacheKey, rate, 10000); // 10 second cache for funding rates
      return rate;
    } catch (error) {
      console.error(`Failed to get funding rate for ${marketId}:`, error);
      throw error;
    }
  }

  // Get market caps and limits
  async getMarketLimits(marketId) {
    if (!this.provider) {
      throw new Error('Provider not available');
    }
    
    try {
      const perpEngine = getContract('PerpEngine', this.provider, this.chainId);
      const marketRegistry = getContract('MarketRegistry', this.provider, this.chainId);
      
      const [marketData, globalParams] = await Promise.all([
        perpEngine.getMarketData(marketId),
        perpEngine.getGlobalParameters()
      ]);
      
      const marketConfig = await marketRegistry.getMarket(marketId);
      
      return {
        maxPositionSize: formatUnits(marketConfig.maxPositionSize, 18),
        minPositionSize: formatUnits(marketConfig.minPositionSize, 18),
        maxLeverage: formatUnits(globalParams.maxLeverage, 18),
        openInterest: formatUnits(marketData.longSize.add(marketData.shortSize), 18),
        longOpenInterest: formatUnits(marketData.longSize, 18),
        shortOpenInterest: formatUnits(marketData.shortSize, 18),
        skew: formatUnits(marketData.longSize.sub(marketData.shortSize), 18)
      };
    } catch (error) {
      console.error(`Failed to get market limits for ${marketId}:`, error);
      throw error;
    }
  }

  // Get oracle status for market
  async getOracleStatus(marketId) {
    if (!this.provider) {
      throw new Error('Provider not available');
    }
    
    try {
      const oracleAggregator = getContract('OracleAggregator', this.provider, this.chainId);
      
      const [priceData, sources] = await Promise.all([
        oracleAggregator.getPriceWithDetails(marketId),
        oracleAggregator.getOracleSources(marketId)
      ]);
      
      const currentTime = Math.floor(Date.now() / 1000);
      const isStale = (currentTime - priceData.timestamp.toNumber()) > 3600;
      
      return {
        price: formatUnits(priceData.price, 8),
        timestamp: priceData.timestamp.toNumber(),
        isStale,
        sourceCount: priceData.sourceCount.toNumber(),
        sources: sources,
        lastUpdate: new Date(priceData.timestamp.toNumber() * 1000).toISOString()
      };
    } catch (error) {
      console.error(`Failed to get oracle status for ${marketId}:`, error);
      throw error;
    }
  }

  // Get market statistics
  async getMarketStats(marketId, timeframe = '24h') {
    const cacheKey = `market_stats_${marketId}_${timeframe}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: MARKET_QUERIES.GET_MARKET_STATS,
        variables: { market: marketId, timeframe }
      });
      
      const stats = this._processMarketStats(result.data);
      this._setToCache(cacheKey, stats);
      return stats;
    } catch (error) {
      console.error(`Failed to get market stats for ${marketId}:`, error);
      return this._getMarketStatsFallback(marketId, timeframe);
    }
  }

  // Subscribe to market updates
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // Start auto-refresh
  startAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      try {
        await this.getAllMarkets();
      } catch (error) {
        console.error('Auto-refresh failed:', error);
      }
    }, this.options.refreshInterval);
  }

  // Stop auto-refresh
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
  }

  // Private methods
  async _enhanceMarketData(market) {
    if (!this.provider) return market;
    
    try {
      const [fundingRate, limits, oracleStatus] = await Promise.all([
        this.getFundingRate(market.id).catch(() => null),
        this.getMarketLimits(market.id).catch(() => null),
        this.getOracleStatus(market.id).catch(() => null)
      ]);
      
      return {
        ...market,
        fundingRate: fundingRate?.current || '0',
        annualizedFundingRate: fundingRate?.annualized || '0',
        ...limits,
        oracleStatus,
        lastUpdated: Date.now()
      };
    } catch (error) {
      console.error(`Failed to enhance market data for ${market.id}:`, error);
      return market;
    }
  }

  async _getMarketsFromContract() {
    if (!this.provider) {
      throw new Error('Provider not available');
    }
    
    try {
      const marketRegistry = getContract('MarketRegistry', this.provider, this.chainId);
      const marketCount = await marketRegistry.getMarketCount();
      
      const markets = [];
      for (let i = 0; i < marketCount.toNumber(); i++) {
        const marketId = await marketRegistry.getMarketIdByIndex(i);
        const market = await this._getMarketFromContract(marketId);
        if (market) markets.push(market);
      }
      
      return markets;
    } catch (error) {
      console.error('Failed to get markets from contract:', error);
      throw error;
    }
  }

  async _getMarketFromContract(marketId) {
    if (!this.provider) return null;
    
    try {
      const marketRegistry = getContract('MarketRegistry', this.provider, this.chainId);
      const market = await marketRegistry.getMarket(marketId);
      
      return {
        id: marketId,
        name: market.name,
        baseToken: market.baseToken,
        quoteToken: market.quoteToken,
        maxPositionSize: formatUnits(market.maxPositionSize, 18),
        minPositionSize: formatUnits(market.minPositionSize, 18),
        tickSize: formatUnits(market.tickSize, 18),
        isActive: market.isActive,
        oracleSources: market.oracleSources || []
      };
    } catch (error) {
      console.error(`Failed to get market ${marketId} from contract:`, error);
      return null;
    }
  }

  _annualizeFundingRate(fundingRate) {
    // fundingRate is per second, annualize = rate * seconds in year
    const annualized = parseUnits(fundingRate.toString(), 18) * 31536000n;
    return formatUnits(annualized, 18);
  }

  _processMarketStats(data) {
    if (!data?.market) return null;
    
    const market = data.market;
    
    return {
      volume24h: formatUnits(market.dailyVolume || '0', 18),
      trades24h: market.dailyTrades || 0,
      openInterest: formatUnits(market.openInterest || '0', 18),
      fundingRate: formatUnits(market.currentFundingRate || '0', 18),
      longPositions: market.longPositions || 0,
      shortPositions: market.shortPositions || 0,
      liquidations24h: market.dailyLiquidations || 0,
      timestamp: Date.now()
    };
  }

  _getMarketStatsFallback(marketId, timeframe) {
    // Simplified fallback
    return {
      volume24h: '0',
      trades24h: 0,
      openInterest: '0',
      fundingRate: '0',
      longPositions: 0,
      shortPositions: 0,
      liquidations24h: 0,
      timestamp: Date.now()
    };
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
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  _notifyListeners(event, data) {
    this.listeners.forEach(listener => {
      try {
        listener(event, data);
      } catch (error) {
        console.error('Market listener error:', error);
      }
    });
  }
}

// Export singleton instance
export const marketService = new MarketService();

// Hook for React components
export function useMarkets() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const { provider, chainId } = useWeb3React();
  
  useEffect(() => {
    if (provider && chainId) {
      marketService.initialize(provider, chainId);
    }
  }, [provider, chainId]);
  
  const loadMarkets = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const marketsData = await marketService.getAllMarkets();
      setMarkets(marketsData);
      setLoading(false);
      return marketsData;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  const getMarket = useCallback(async (marketId) => {
    setLoading(true);
    setError(null);
    
    try {
      const market = await marketService.getMarket(marketId);
      setLoading(false);
      return market;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  // Auto-refresh on mount
  useEffect(() => {
    if (provider && chainId) {
      loadMarkets();
      marketService.startAutoRefresh();
    }
    
    return () => {
      marketService.stopAutoRefresh();
    };
  }, [provider, chainId, loadMarkets]);
  
  return {
    markets,
    loading,
    error,
    loadMarkets,
    getMarket,
    clearCache: marketService.clearCache.bind(marketService)
  };
}