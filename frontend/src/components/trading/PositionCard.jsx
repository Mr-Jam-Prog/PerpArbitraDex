// @title: Carte Position avec Affichage Risque en Temps Réel
// @security: PnL exact from PositionMath, liquidation warnings
// @ux: Color-coded risk, countdown to funding, one-click close

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { usePerpDex } from '../../hooks/usePerpDex';
import { calculatePnL, calculateHealthFactor, calculateLiquidationPrice } from '../../utils/calculations';
import { formatUSD, formatPercentage, formatTimestamp } from '../../utils/formatting';
import { CONTRACT_ADDRESSES, ABI } from '../../utils/contracts';
import { toast } from 'react-toastify';
import './PositionCard.css';

const PositionCard = ({ position, onClose, isReadOnly = false }) => {
  const { signer, chainId, provider } = usePerpDex();
  
  const [currentPrice, setCurrentPrice] = useState(0);
  const [isClosing, setIsClosing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  // Destructure position data
  const {
    id,
    market,
    size,
    collateral,
    entryPrice,
    isLong,
    createdAt,
    lastFundingTime,
    healthFactor: initialHealthFactor
  } = position;
  
  // Fetch current price periodically
  useEffect(() => {
    if (!market || !provider) return;
    
    const fetchPrice = async () => {
      try {
        // In production, this would come from oracle hook
        const oracleContract = new ethers.Contract(
          CONTRACT_ADDRESSES[chainId].OracleAggregator,
          ABI.OracleAggregator,
          provider
        );
        
        const price = await oracleContract.getPrice(market.id);
        setCurrentPrice(parseFloat(ethers.formatUnits(price, 8)));
      } catch (error) {
        console.error('Error fetching price:', error);
      }
    };
    
    fetchPrice();
    const interval = setInterval(fetchPrice, 10000); // Update every 10 seconds
    
    return () => clearInterval(interval);
  }, [market, provider, chainId]);
  
  // Calculate real-time values
  const pnl = calculatePnL(size, entryPrice, currentPrice, isLong);
  const pnlPercentage = (pnl / collateral) * 100;
  const healthFactor = calculateHealthFactor(collateral, size, currentPrice, isLong);
  const liquidationPrice = calculateLiquidationPrice(collateral, size, isLong, 0.08);
  
  // Risk assessment
  const getRiskLevel = () => {
    if (healthFactor < 1.05) return 'critical';
    if (healthFactor < 1.2) return 'high';
    if (healthFactor < 1.5) return 'medium';
    return 'low';
  };
  
  const riskLevel = getRiskLevel();
  
  // Calculate time to next funding
  const getTimeToFunding = () => {
    const now = Math.floor(Date.now() / 1000);
    const nextFunding = lastFundingTime + 3600; // Funding every hour
    return nextFunding - now;
  };
  
  const timeToFunding = getTimeToFunding();
  
  // Handle position close
  const handleClosePosition = async () => {
    if (isReadOnly) {
      toast.error('Read-only mode: Cannot close positions');
      return;
    }
    
    if (!signer) {
      toast.error('Wallet not connected');
      return;
    }
    
    setIsClosing(true);
    
    try {
      const perpEngine = new ethers.Contract(
        CONTRACT_ADDRESSES[chainId].PerpEngine,
        ABI.PerpEngine,
        signer
      );
      
      // Estimate gas
      const gasLimit = await perpEngine.estimateGas.closePosition(id);
      const gasLimitWithBuffer = gasLimit * (120) / (100);
      
      // Execute close
      const tx = await perpEngine.closePosition(id, {
        gasLimit: gasLimitWithBuffer
      });
      
      toast.info('Closing position...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        toast.success('Position closed successfully');
        if (onClose) onClose(id);
      } else {
        throw new Error('Transaction failed');
      }
      
    } catch (error) {
      console.error('Error closing position:', error);
      
      let errorMessage = 'Failed to close position';
      if (error.message.includes('execution reverted')) {
        errorMessage = 'Position cannot be closed (may be in liquidation)';
      } else if (error.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user';
      }
      
      toast.error(errorMessage);
    } finally {
      setIsClosing(false);
    }
  };
  
  // Handle add collateral
  const handleAddCollateral = async () => {
    // Implementation for adding collateral
    toast.info('Add collateral feature coming soon');
  };
  
  // Handle partial close
  const handlePartialClose = async () => {
    // Implementation for partial close
    toast.info('Partial close feature coming soon');
  };
  
  return (
    <div className={`position-card ${riskLevel}`}>
      <div className="position-header" onClick={() => setShowDetails(!showDetails)}>
        <div className="position-title">
          <span className="market">{market.name}</span>
          <span className={`direction ${isLong ? 'long' : 'short'}`}>
            {isLong ? 'LONG' : 'SHORT'}
          </span>
        </div>
        
        <div className="position-pnl">
          <span className={`pnl-value ${pnl >= 0 ? 'positive' : 'negative'}`}>
            {pnl >= 0 ? '+' : ''}{formatUSD(pnl)}
          </span>
          <span className={`pnl-percentage ${pnlPercentage >= 0 ? 'positive' : 'negative'}`}>
            ({pnlPercentage >= 0 ? '+' : ''}{formatPercentage(pnlPercentage)})
          </span>
        </div>
        
        <div className="position-toggle">
          {showDetails ? '▲' : '▼'}
        </div>
      </div>
      
      <div className="position-summary">
        <div className="summary-row">
          <span>Size:</span>
          <span className="value">{formatUSD(size)}</span>
        </div>
        <div className="summary-row">
          <span>Collateral:</span>
          <span className="value">{formatUSD(collateral)}</span>
        </div>
        <div className="summary-row">
          <span>Health Factor:</span>
          <span className={`value health-factor ${riskLevel}`}>
            {healthFactor.toFixed(2)}
            {riskLevel === 'critical' && ' ⚠️'}
          </span>
        </div>
      </div>
      
      {showDetails && (
        <div className="position-details">
          <div className="details-grid">
            <div className="detail-item">
              <span className="label">Entry Price:</span>
              <span className="value">{formatUSD(entryPrice)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Current Price:</span>
              <span className="value">{formatUSD(currentPrice)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Liq. Price:</span>
              <span className="value warning">{formatUSD(liquidationPrice)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Distance to Liq.:</span>
              <span className="value">
                {isLong 
                  ? formatPercentage(((currentPrice - liquidationPrice) / currentPrice) * 100)
                  : formatPercentage(((liquidationPrice - currentPrice) / currentPrice) * 100)
                }
              </span>
            </div>
            <div className="detail-item">
              <span className="label">Created:</span>
              <span className="value">{formatTimestamp(createdAt)}</span>
            </div>
            <div className="detail-item">
              <span className="label">Next Funding:</span>
              <span className="value">
                {timeToFunding > 0 
                  ? `${Math.floor(timeToFunding / 60)}m ${timeToFunding % 60}s`
                  : 'Due'
                }
              </span>
            </div>
          </div>
          
          {/* Risk Warnings */}
          {riskLevel === 'critical' && (
            <div className="risk-warning critical">
              ⚠️ CRITICAL: Position at high risk of liquidation
            </div>
          )}
          
          {riskLevel === 'high' && (
            <div className="risk-warning high">
              ⚠️ HIGH: Consider adding collateral or reducing size
            </div>
          )}
          
          {/* Action Buttons */}
          <div className="position-actions">
            <button
              className="btn-action btn-close"
              onClick={handleClosePosition}
              disabled={isClosing || isReadOnly}
            >
              {isClosing ? 'Closing...' : 'Close Position'}
            </button>
            
            {riskLevel === 'critical' && (
              <button
                className="btn-action btn-add-collateral"
                onClick={handleAddCollateral}
                disabled={isReadOnly}
              >
                Add Collateral
              </button>
            )}
            
            <button
              className="btn-action btn-partial"
              onClick={handlePartialClose}
              disabled={isReadOnly}
            >
              Partial Close
            </button>
          </div>
        </div>
      )}
      
      {/* Liquidation Progress Bar */}
      <div className="liquidation-progress">
        <div 
          className="progress-bar"
          style={{
            width: `${Math.max(0, Math.min(100, (1 / healthFactor) * 100))}%`,
            backgroundColor: riskLevel === 'critical' ? '#dc2626' : 
                           riskLevel === 'high' ? '#ea580c' : 
                           riskLevel === 'medium' ? '#d97706' : '#16a34a'
          }}
        />
        <div className="progress-labels">
          <span>Safe</span>
          <span>Liquidation</span>
        </div>
      </div>
    </div>
  );
};

export default PositionCard;