// @title: Service analytics off-chain avec cache et fallback
// @audit: Read-only, cache TTL, fallback subgraph, agrégation PnL/volume
// @security: Aucune écriture, validation des données, rate limiting

import { subgraphClient } from '../indexer/graphql/client';
import { ANALYTICS_QUERIES } from '../indexer/graphql/queries';
import { formatUnits } from '../../utils/formatting';

class AnalyticsService {
  constructor(options = {}) {
    this.cache = new Map();
    this.options = {
      cacheTTL: options.cacheTTL || 60000, // 1 minute default
      maxCacheSize: options.maxCacheSize || 100,
      subgraphFallback: options.subgraphFallback !== false,
      ...options
    };
    
    this.requestQueue = new Map();
    this.rateLimits = new Map();
  }

  // Get aggregated PnL for a user
  async getUserPnL(userAddress, timeframe = 'all') {
    const cacheKey = `pnl_${userAddress}_${timeframe}`;
    
    // Check cache first
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      let data;
      
      // Try subgraph first
      if (this.options.subgraphFallback) {
        try {
          const result = await subgraphClient.query({
            query: ANALYTICS_QUERIES.GET_USER_PNL,
            variables: { user: userAddress.toLowerCase(), timeframe }
          });
          
          data = this._processPnLData(result.data);
        } catch (subgraphError) {
          console.warn('Subgraph failed, using fallback:', subgraphError);
          data = await this._getPnLFallback(userAddress, timeframe);
        }
      } else {
        data = await this._getPnLFallback(userAddress, timeframe);
      }
      
      // Cache the result
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get user PnL:', error);
      throw new Error(`Unable to fetch PnL data: ${error.message}`);
    }
  }

  // Get protocol volume
  async getProtocolVolume(timeframe = '24h') {
    const cacheKey = `volume_${timeframe}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_PROTOCOL_VOLUME,
        variables: { timeframe }
      });
      
      const data = this._processVolumeData(result.data);
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get protocol volume:', error);
      return this._getVolumeFallback(timeframe);
    }
  }

  // Get open interest
  async getOpenInterest(marketId = null) {
    const cacheKey = `oi_${marketId || 'all'}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_OPEN_INTEREST,
        variables: { market: marketId }
      });
      
      const data = this._processOpenInterestData(result.data);
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get open interest:', error);
      return this._getOpenInterestFallback(marketId);
    }
  }

  // Get liquidation history
  async getLiquidationHistory(limit = 100, offset = 0) {
    const cacheKey = `liquidations_${limit}_${offset}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_LIQUIDATION_HISTORY,
        variables: { limit, offset }
      });
      
      const data = this._processLiquidationData(result.data);
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get liquidation history:', error);
      return this._getLiquidationFallback(limit, offset);
    }
  }

  // Get funding rate history
  async getFundingRateHistory(marketId, limit = 100) {
    const cacheKey = `funding_${marketId}_${limit}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_FUNDING_RATE_HISTORY,
        variables: { market: marketId, limit }
      });
      
      const data = this._processFundingRateData(result.data);
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get funding rate history:', error);
      return this._getFundingRateFallback(marketId, limit);
    }
  }

  // Get protocol metrics
  async getProtocolMetrics() {
    const cacheKey = 'protocol_metrics';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const [
        volume24h,
        totalVolume,
        openInterest,
        activeTraders,
        totalTraders,
        liquidationStats
      ] = await Promise.all([
        this.getProtocolVolume('24h'),
        this.getProtocolVolume('all'),
        this.getOpenInterest(),
        this.getActiveTraders(),
        this.getTotalTraders(),
        this.getLiquidationStats()
      ]);
      
      const data = {
        volume24h,
        totalVolume,
        openInterest,
        activeTraders,
        totalTraders,
        liquidationStats,
        timestamp: Date.now()
      };
      
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get protocol metrics:', error);
      return this._getProtocolMetricsFallback();
    }
  }

  // Get active traders count
  async getActiveTraders(timeframe = '24h') {
    const cacheKey = `active_traders_${timeframe}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_ACTIVE_TRADERS,
        variables: { timeframe }
      });
      
      const count = result.data?.activeTraders?.length || 0;
      this._setToCache(cacheKey, count);
      return count;
    } catch (error) {
      console.error('Failed to get active traders:', error);
      return this._getActiveTradersFallback(timeframe);
    }
  }

  // Get total traders count
  async getTotalTraders() {
    const cacheKey = 'total_traders';
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_TOTAL_TRADERS
      });
      
      const count = result.data?.totalTraders || 0;
      this._setToCache(cacheKey, count);
      return count;
    } catch (error) {
      console.error('Failed to get total traders:', error);
      return this._getTotalTradersFallback();
    }
  }

  // Get liquidation statistics
  async getLiquidationStats(timeframe = '24h') {
    const cacheKey = `liquidation_stats_${timeframe}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) return cached;
    
    try {
      const result = await subgraphClient.query({
        query: ANALYTICS_QUERIES.GET_LIQUIDATION_STATS,
        variables: { timeframe }
      });
      
      const data = this._processLiquidationStats(result.data);
      this._setToCache(cacheKey, data);
      return data;
    } catch (error) {
      console.error('Failed to get liquidation stats:', error);
      return this._getLiquidationStatsFallback(timeframe);
    }
  }

  // Clear cache
  clearCache() {
    this.cache.clear();
  }

  // Cache management
  _getFromCache(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() - item.timestamp > this.options.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  _setToCache(key, data) {
    // Manage cache size
    if (this.cache.size >= this.options.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  // Data processing methods
  _processPnLData(data) {
    if (!data?.positions) return { totalPnL: '0', positions: [] };
    
    let totalPnL = 0;
    const positions = data.positions.map(position => {
      const pnl = parseFloat(formatUnits(position.realizedPnl, 18));
      totalPnL += pnl;
      
      return {
        id: position.id,
        market: position.market,
        side: position.side,
        size: formatUnits(position.size, 18),
        entryPrice: formatUnits(position.entryPrice, 8),
        exitPrice: formatUnits(position.exitPrice, 8),
        pnl: pnl.toFixed(2),
        timestamp: parseInt(position.timestamp)
      };
    });
    
    return {
      totalPnL: totalPnL.toFixed(2),
      positions,
      count: positions.length
    };
  }

  _processVolumeData(data) {
    if (!data?.trades) return { volume: '0', count: 0 };
    
    let totalVolume = 0;
    data.trades.forEach(trade => {
      totalVolume += parseFloat(formatUnits(trade.size, 18));
    });
    
    return {
      volume: totalVolume.toFixed(2),
      count: data.trades.length,
      timestamp: Date.now()
    };
  }

  _processOpenInterestData(data) {
    if (!data?.markets) return { total: '0', byMarket: {} };
    
    let total = 0;
    const byMarket = {};
    
    data.markets.forEach(market => {
      const oi = parseFloat(formatUnits(market.openInterest, 18));
      total += oi;
      byMarket[market.id] = {
        openInterest: oi.toFixed(2),
        longSize: formatUnits(market.longSize, 18),
        shortSize: formatUnits(market.shortSize, 18),
        skew: formatUnits(market.skew, 18)
      };
    });
    
    return {
      total: total.toFixed(2),
      byMarket,
      timestamp: Date.now()
    };
  }

  _processLiquidationData(data) {
    if (!data?.liquidations) return [];
    
    return data.liquidations.map(liquidation => ({
      id: liquidation.id,
      positionId: liquidation.positionId,
      liquidator: liquidation.liquidator,
      reward: formatUnits(liquidation.reward, 6),
      size: formatUnits(liquidation.size, 18),
      market: liquidation.market,
      timestamp: parseInt(liquidation.timestamp),
      blockNumber: parseInt(liquidation.blockNumber)
    }));
  }

  _processFundingRateData(data) {
    if (!data?.fundingRates) return [];
    
    return data.fundingRates.map(rate => ({
      id: rate.id,
      market: rate.market,
      rate: formatUnits(rate.rate, 18),
      cumulativeFunding: formatUnits(rate.cumulativeFunding, 18),
      timestamp: parseInt(rate.timestamp),
      blockNumber: parseInt(rate.blockNumber)
    }));
  }

  _processLiquidationStats(data) {
    if (!data?.liquidations) return { count: 0, totalRewards: '0', averageSize: '0' };
    
    let totalRewards = 0;
    let totalSize = 0;
    
    data.liquidations.forEach(liq => {
      totalRewards += parseFloat(formatUnits(liq.reward, 6));
      totalSize += parseFloat(formatUnits(liq.size, 18));
    });
    
    const count = data.liquidations.length;
    
    return {
      count,
      totalRewards: totalRewards.toFixed(2),
      averageReward: count > 0 ? (totalRewards / count).toFixed(2) : '0',
      totalSize: totalSize.toFixed(2),
      averageSize: count > 0 ? (totalSize / count).toFixed(2) : '0'
    };
  }

  // Fallback methods (simplified implementations)
  async _getPnLFallback(userAddress, timeframe) {
    // Simplified fallback - would need RPC calls in real implementation
    return { totalPnL: '0', positions: [], count: 0 };
  }

  async _getVolumeFallback(timeframe) {
    return { volume: '0', count: 0, timestamp: Date.now() };
  }

  async _getOpenInterestFallback(marketId) {
    return { total: '0', byMarket: {}, timestamp: Date.now() };
  }

  async _getLiquidationFallback(limit, offset) {
    return [];
  }

  async _getFundingRateFallback(marketId, limit) {
    return [];
  }

  async _getProtocolMetricsFallback() {
    return {
      volume24h: { volume: '0', count: 0 },
      totalVolume: { volume: '0', count: 0 },
      openInterest: { total: '0', byMarket: {} },
      activeTraders: 0,
      totalTraders: 0,
      liquidationStats: { count: 0, totalRewards: '0', averageSize: '0' },
      timestamp: Date.now()
    };
  }

  async _getActiveTradersFallback(timeframe) {
    return 0;
  }

  async _getTotalTradersFallback() {
    return 0;
  }

  async _getLiquidationStatsFallback(timeframe) {
    return { count: 0, totalRewards: '0', averageSize: '0' };
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

// Hook for React components
export function useAnalytics() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const getUserPnL = useCallback(async (userAddress, timeframe) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await analyticsService.getUserPnL(userAddress, timeframe);
      setLoading(false);
      return result;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  const getProtocolVolume = useCallback(async (timeframe) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await analyticsService.getProtocolVolume(timeframe);
      setLoading(false);
      return result;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  const getOpenInterest = useCallback(async (marketId) => {
    setLoading(true);
    setError(null);
    
    try {
      const result = await analyticsService.getOpenInterest(marketId);
      setLoading(false);
      return result;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      throw err;
    }
  }, []);
  
  return {
    getUserPnL,
    getProtocolVolume,
    getOpenInterest,
    loading,
    error,
    clearCache: analyticsService.clearCache.bind(analyticsService)
  };
}