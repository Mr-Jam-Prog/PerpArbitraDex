// @title: Sélecteur Marché avec Monitoring Oracle en Temps Réel
// @security: Disable trading on oracle issues, show staleness warnings
// @ux: Real-time status, volume, open interest, funding rates

import React, { useState, useEffect } from 'react';
import { useOracleData } from '../../hooks/useOracleData';
import { formatUSD, formatPercentage } from '../../utils/formatting';
import './MarketSelector.css';

const MarketSelector = ({ markets, selectedMarket, onSelect }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('volume'); // 'volume', 'oi', 'change'
  const [filterBy, setFilterBy] = useState('all'); // 'all', 'crypto', 'forex', 'commodities'
  
  // Filter and sort markets
  const filteredMarkets = markets
    .filter(market => {
      // Search filter
      const matchesSearch = market.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           market.id.toLowerCase().includes(searchTerm.toLowerCase());
      
      // Type filter
      const matchesType = filterBy === 'all' || market.category === filterBy;
      
      return matchesSearch && matchesType;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'volume':
          return b.volume24h - a.volume24h;
        case 'oi':
          return b.openInterest - a.openInterest;
        case 'change':
          return Math.abs(b.priceChange24h) - Math.abs(a.priceChange24h);
        default:
          return 0;
      }
    });
  
  // Market categories
  const categories = [
    { id: 'all', label: 'All Markets' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'forex', label: 'Forex' },
    { id: 'commodities', label: 'Commodities' }
  ];
  
  // Get oracle status badge
  const getOracleStatusBadge = (market) => {
    if (!market.oracleStatus) return null;
    
    const status = market.oracleStatus;
    
    if (status.isStale) {
      return (
        <span className="status-badge stale" title="Oracle data is stale">
          ⚠️ Stale
        </span>
      );
    }
    
    if (!status.isValid) {
      return (
        <span className="status-badge invalid" title="Oracle data is invalid">
          ❌ Invalid
        </span>
      );
    }
    
    if (status.deviation > 0.02) { // 2% deviation
      return (
        <span className="status-badge warning" title="High oracle deviation">
          ⚠️ High Dev
        </span>
      );
    }
    
    return (
      <span className="status-badge healthy" title="Oracle is healthy">
        ✅ Healthy
      </span>
    );
  };
  
  // Handle market selection
  const handleMarketClick = (market) => {
    if (!market.isActive) {
      return;
    }
    
    if (market.oracleStatus?.isValid === false) {
      alert(`Cannot select ${market.name}: Oracle data is invalid`);
      return;
    }
    
    onSelect(market);
  };
  
  return (
    <div className="market-selector">
      {/* Header with filters */}
      <div className="selector-header">
        <h3>Markets</h3>
        
        <div className="filters">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search markets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
          
          <div className="filter-buttons">
            {categories.map(category => (
              <button
                key={category.id}
                className={`filter-btn ${filterBy === category.id ? 'active' : ''}`}
                onClick={() => setFilterBy(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
          
          <div className="sort-options">
            <span>Sort by:</span>
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="sort-select"
            >
              <option value="volume">Volume</option>
              <option value="oi">Open Interest</option>
              <option value="change">24h Change</option>
            </select>
          </div>
        </div>
      </div>
      
      {/* Markets List */}
      <div className="markets-list">
        {filteredMarkets.length === 0 ? (
          <div className="no-markets">
            No markets found
          </div>
        ) : (
          filteredMarkets.map(market => (
            <div
              key={market.id}
              className={`market-item ${selectedMarket?.id === market.id ? 'selected' : ''} ${!market.isActive ? 'inactive' : ''}`}
              onClick={() => handleMarketClick(market)}
            >
              <div className="market-info">
                <div className="market-header">
                  <span className="market-name">{market.name}</span>
                  <span className="market-symbol">{market.symbol}</span>
                  {getOracleStatusBadge(market)}
                </div>
                
                <div className="market-price">
                  <span className="price">
                    {formatUSD(market.price)}
                  </span>
                  <span className={`price-change ${market.priceChange24h >= 0 ? 'positive' : 'negative'}`}>
                    {market.priceChange24h >= 0 ? '↗' : '↘'} {formatPercentage(Math.abs(market.priceChange24h))}
                  </span>
                </div>
              </div>
              
              <div className="market-stats">
                <div className="stat">
                  <span className="stat-label">24h Volume</span>
                  <span className="stat-value">{formatUSD(market.volume24h)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Open Interest</span>
                  <span className="stat-value">{formatUSD(market.openInterest)}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Funding Rate</span>
                  <span className={`stat-value ${market.fundingRate >= 0 ? 'positive' : 'negative'}`}>
                    {formatPercentage(market.fundingRate)}
                  </span>
                </div>
              </div>
              
              {/* Inactive overlay */}
              {!market.isActive && (
                <div className="inactive-overlay">
                  <span>MARKET UNAVAILABLE</span>
                </div>
              )}
              
              {/* Oracle warning overlay */}
              {market.isActive && market.oracleStatus?.isValid === false && (
                <div className="oracle-warning-overlay">
                  <span>ORACLE ISSUE - TRADING DISABLED</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
      
      {/* Footer with system status */}
      <div className="selector-footer">
        <div className="system-status">
          <div className="status-item">
            <span className="status-label">Total Markets:</span>
            <span className="status-value">{markets.length}</span>
          </div>
          <div className="status-item">
            <span className="status-label">Active Markets:</span>
            <span className="status-value">
              {markets.filter(m => m.isActive).length}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Healthy Oracles:</span>
            <span className="status-value">
              {markets.filter(m => m.oracleStatus?.isValid).length}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketSelector;