// @title: Trading Interface Principale - Sécurisée & Risk-Aware
// @security: Oracle validation, liquidation warnings, read-only fallback
// @ux: Real-time PnL preview, risk indicators, position limits

import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { usePerpDex } from '../../hooks/usePerpDex';
import { useOracleData } from '../../hooks/useOracleData';
import { usePositions } from '../../hooks/usePositions';
import MarketSelector from './MarketSelector';
import OrderForm from './OrderForm';
import PositionCard from './PositionCard';
import RiskIndicator from '../dashboard/RiskIndicator';
import { calculatePnL, calculateHealthFactor, calculateLiquidationPrice } from '../../utils/calculations';
import { formatUSD, formatPercentage, formatLeverage } from '../../utils/formatting';
import { CONTRACT_ADDRESSES, ABI } from '../../utils/contracts';
import { toast } from 'react-toastify';
import './TradingInterface.css';

const TradingInterface = () => {
  const {
    account,
    chainId,
    signer,
    provider,
    isReadOnly,
    connectWallet,
    switchNetwork
  } = usePerpDex();
  
  const { markets, selectedMarket, setSelectedMarket, oracleStatus } = useOracleData();
  const { positions, refreshPositions, openPosition, closePosition } = usePositions();
  
  const [orderType, setOrderType] = useState('market'); // 'market' | 'limit' | 'stop'
  const [side, setSide] = useState('long'); // 'long' | 'short'
  const [size, setSize] = useState('');
  const [collateral, setCollateral] = useState('');
  const [leverage, setLeverage] = useState(3);
  const [slippage, setSlippage] = useState(0.5); // 0.5%
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  
  // Risk parameters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [acceptRisk, setAcceptRisk] = useState(false);
  
  // Constants
  const MAX_LEVERAGE = 10;
  const MIN_COLLATERAL = 10; // $10
  const MAX_SLIPPAGE = 5; // 5%
  
  // Validation: Oracle must be healthy
  const isOracleValid = oracleStatus?.isValid && !oracleStatus?.isStale;
  
  // Calculate preview data
  useEffect(() => {
    if (!selectedMarket || !size || !collateral || !oracleStatus?.price) return;
    
    try {
      const price = parseFloat(oracleStatus.price);
      const sizeValue = parseFloat(size);
      const collateralValue = parseFloat(collateral);
      const leverageValue = parseFloat(leverage);
      
      // Validate leverage
      if (leverageValue > MAX_LEVERAGE) {
        setPreviewData({ error: `Leverage cannot exceed ${MAX_LEVERAGE}x` });
        return;
      }
      
      // Validate collateral
      if (collateralValue < MIN_COLLATERAL) {
        setPreviewData({ error: `Minimum collateral is $${MIN_COLLATERAL}` });
        return;
      }
      
      // Calculate position value
      const positionValue = collateralValue * leverageValue;
      
      // Calculate fees (0.1% taker fee)
      const fees = positionValue * 0.001;
      
      // Calculate liquidation price
      const liqPrice = calculateLiquidationPrice(
        collateralValue,
        positionValue,
        side === 'long',
        0.08 // 8% maintenance margin
      );
      
      // Calculate distance to liquidation
      const distanceToLiq = side === 'long' 
        ? ((price - liqPrice) / price) * 100
        : ((liqPrice - price) / price) * 100;
      
      // Health factor (simplified)
      const healthFactor = calculateHealthFactor(
        collateralValue,
        positionValue,
        price,
        side === 'long'
      );
      
      setPreviewData({
        positionValue: formatUSD(positionValue),
        fees: formatUSD(fees),
        liquidationPrice: formatUSD(liqPrice),
        distanceToLiquidation: formatPercentage(distanceToLiq),
        healthFactor: healthFactor.toFixed(2),
        maxSlippage: formatPercentage(slippage),
        isValid: distanceToLiq > 5 && healthFactor > 1.1 // 5% buffer
      });
      
    } catch (error) {
      console.error('Error calculating preview:', error);
      setPreviewData({ error: 'Error calculating position preview' });
    }
  }, [selectedMarket, size, collateral, leverage, side, oracleStatus, slippage]);
  
  // Handle trade submission
  const handleSubmitTrade = useCallback(async () => {
    if (!account || !signer || !selectedMarket || !previewData?.isValid) {
      toast.error('Cannot submit trade: missing requirements');
      return;
    }
    
    if (!acceptRisk && leverage >= 5) {
      toast.error('Please accept high leverage risk');
      return;
    }
    
    if (!isOracleValid) {
      toast.error('Oracle is not valid. Trading disabled.');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Prepare transaction
      const perpEngine = new ethers.Contract(
        CONTRACT_ADDRESSES[chainId].PerpEngine,
        ABI.PerpEngine,
        signer
      );
      
      const collateralInWei = ethers.utils.parseUnits(collateral, 6); // USDC has 6 decimals
      const sizeInWei = ethers.utils.parseUnits(size, 18);
      
      // Estimate gas first
      const gasLimit = await perpEngine.estimateGas.openPosition(
        selectedMarket.id,
        collateralInWei,
        sizeInWei,
        side === 'long',
        {
          value: collateralInWei
        }
      );
      
      // Add 20% buffer
      const gasLimitWithBuffer = gasLimit.mul(120).div(100);
      
      // Submit transaction
      const tx = await perpEngine.openPosition(
        selectedMarket.id,
        collateralInWei,
        sizeInWei,
        side === 'long',
        {
          gasLimit: gasLimitWithBuffer
        }
      );
      
      toast.info('Transaction submitted. Waiting for confirmation...');
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        toast.success('Position opened successfully!');
        
        // Refresh positions
        await refreshPositions();
        
        // Reset form
        setSize('');
        setCollateral('');
        setLeverage(3);
        setAcceptRisk(false);
      } else {
        throw new Error('Transaction failed');
      }
      
    } catch (error) {
      console.error('Trade submission error:', error);
      
      // User-friendly error messages
      let errorMessage = 'Transaction failed';
      if (error.message.includes('insufficient funds')) {
        errorMessage = 'Insufficient funds';
      } else if (error.message.includes('execution reverted')) {
        errorMessage = 'Transaction reverted. Check parameters.';
      } else if (error.message.includes('user rejected')) {
        errorMessage = 'Transaction rejected by user';
      } else if (error.message.includes('gas')) {
        errorMessage = 'Gas estimation failed. Try adjusting slippage.';
      }
      
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  }, [account, signer, selectedMarket, previewData, acceptRisk, isOracleValid, 
      collateral, size, side, leverage, chainId, refreshPositions]);
  
  // Handle market selection
  const handleMarketSelect = (market) => {
    if (!market.isActive) {
      toast.warning(`${market.name} is currently unavailable`);
      return;
    }
    
    if (market.oracleStatus !== 'healthy') {
      toast.warning(`${market.name} oracle is not healthy. Trading disabled.`);
    }
    
    setSelectedMarket(market);
  };
  
  // Render connection required state
  if (!account) {
    return (
      <div className="trading-interface disconnected">
        <div className="disconnected-message">
          <h2>Connect Wallet to Trade</h2>
          <p>Connect your wallet to start trading perpetual contracts</p>
          <button 
            className="btn-connect"
            onClick={connectWallet}
          >
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }
  
  // Render wrong network state
  if (chainId !== parseInt(process.env.NEXT_PUBLIC_CHAIN_ID)) {
    return (
      <div className="trading-interface wrong-network">
        <div className="network-message">
          <h2>Wrong Network</h2>
          <p>Please switch to {process.env.NEXT_PUBLIC_NETWORK_NAME}</p>
          <button 
            className="btn-switch"
            onClick={() => switchNetwork(process.env.NEXT_PUBLIC_CHAIN_ID)}
          >
            Switch Network
          </button>
        </div>
      </div>
    );
  }
  
  // Render read-only mode
  if (isReadOnly) {
    return (
      <div className="trading-interface read-only">
        <div className="read-only-message">
          <h2>Read-Only Mode</h2>
          <p>Wallet connection issue. Displaying positions in read-only mode.</p>
        </div>
        <div className="positions-container">
          {positions.map(position => (
            <PositionCard key={position.id} position={position} isReadOnly />
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className="trading-interface">
      <div className="trading-layout">
        {/* Left Column: Market Selection & Order Form */}
        <div className="trading-left">
          <div className="market-selector-container">
            <MarketSelector 
              markets={markets}
              selectedMarket={selectedMarket}
              onSelect={handleMarketSelect}
            />
            
            {selectedMarket && (
              <div className="market-info">
                <div className="info-row">
                  <span>Index Price:</span>
                  <span className={oracleStatus?.isStale ? 'stale' : ''}>
                    {formatUSD(oracleStatus?.price || 0)}
                    {oracleStatus?.isStale && ' (Stale)'}
                  </span>
                </div>
                <div className="info-row">
                  <span>24h Volume:</span>
                  <span>{formatUSD(selectedMarket.volume24h)}</span>
                </div>
                <div className="info-row">
                  <span>Open Interest:</span>
                  <span>{formatUSD(selectedMarket.openInterest)}</span>
                </div>
                <div className="info-row">
                  <span>Funding Rate:</span>
                  <span className={selectedMarket.fundingRate >= 0 ? 'positive' : 'negative'}>
                    {formatPercentage(selectedMarket.fundingRate)}
                  </span>
                </div>
              </div>
            )}
          </div>
          
          <div className="order-form-container">
            <OrderForm
              orderType={orderType}
              side={side}
              size={size}
              collateral={collateral}
              leverage={leverage}
              slippage={slippage}
              onOrderTypeChange={setOrderType}
              onSideChange={setSide}
              onSizeChange={setSize}
              onCollateralChange={setCollateral}
              onLeverageChange={setLeverage}
              onSlippageChange={setSlippage}
              maxLeverage={MAX_LEVERAGE}
              maxSlippage={MAX_SLIPPAGE}
              isOracleValid={isOracleValid}
            />
            
            {/* Advanced Settings */}
            <div className="advanced-settings">
              <button 
                className="btn-toggle-advanced"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? '▲' : '▼'} Advanced Settings
              </button>
              
              {showAdvanced && (
                <div className="advanced-options">
                  <div className="option">
                    <label>
                      <input 
                        type="checkbox" 
                        checked={acceptRisk}
                        onChange={(e) => setAcceptRisk(e.target.checked)}
                      />
                      <span className="label-text">
                        I understand that leverage trading involves high risk
                      </span>
                    </label>
                  </div>
                  
                  <div className="option">
                    <label>
                      <input type="checkbox" />
                      <span className="label-text">
                        Enable price alerts for this position
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
            
            {/* Preview & Submit */}
            {previewData && (
              <div className={`trade-preview ${previewData.isValid ? 'valid' : 'invalid'}`}>
                <h3>Trade Preview</h3>
                
                {previewData.error ? (
                  <div className="preview-error">{previewData.error}</div>
                ) : (
                  <>
                    <div className="preview-row">
                      <span>Position Value:</span>
                      <span>{previewData.positionValue}</span>
                    </div>
                    <div className="preview-row">
                      <span>Estimated Fees:</span>
                      <span>{previewData.fees}</span>
                    </div>
                    <div className="preview-row">
                      <span>Liquidation Price:</span>
                      <span className="warning">{previewData.liquidationPrice}</span>
                    </div>
                    <div className="preview-row">
                      <span>Distance to Liquidation:</span>
                      <span className={parseFloat(previewData.distanceToLiquidation) < 10 ? 'danger' : ''}>
                        {previewData.distanceToLiquidation}
                      </span>
                    </div>
                    <div className="preview-row">
                      <span>Health Factor:</span>
                      <span>{previewData.healthFactor}</span>
                    </div>
                    
                    {leverage >= 5 && !acceptRisk && (
                      <div className="preview-warning">
                        ⚠️ High leverage detected. Please accept risk.
                      </div>
                    )}
                  </>
                )}
                
                <button
                  className={`btn-submit ${previewData.isValid && acceptRisk && isOracleValid ? '' : 'disabled'}`}
                  onClick={handleSubmitTrade}
                  disabled={!previewData.isValid || !acceptRisk || !isOracleValid || isSubmitting}
                >
                  {isSubmitting ? 'Processing...' : `Open ${side.toUpperCase()} Position`}
                </button>
                
                {!isOracleValid && (
                  <div className="oracle-warning">
                    ⚠️ Oracle is not valid. Trading disabled.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Right Column: Positions & Risk */}
        <div className="trading-right">
          <div className="risk-indicator-container">
            <RiskIndicator 
              positions={positions}
              selectedMarket={selectedMarket}
            />
          </div>
          
          <div className="positions-container">
            <h3>Your Positions</h3>
            {positions.length === 0 ? (
              <div className="no-positions">
                No open positions
              </div>
            ) : (
              positions.map(position => (
                <PositionCard 
                  key={position.id} 
                  position={position}
                  onClose={() => closePosition(position.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
      
      {/* Footer: System Status */}
      <div className="system-status">
        <div className="status-item">
          <span className="status-label">Oracle Status:</span>
          <span className={`status-value ${oracleStatus?.isValid ? 'healthy' : 'unhealthy'}`}>
            {oracleStatus?.isValid ? 'Healthy' : 'Unhealthy'}
          </span>
        </div>
        <div className="status-item">
          <span className="status-label">Protocol Status:</span>
          <span className="status-value healthy">Operational</span>
        </div>
        <div className="status-item">
          <span className="status-label">Gas Price:</span>
          <span className="status-value">
            {provider?.gasPrice ? `${ethers.utils.formatUnits(provider.gasPrice, 'gwei')} Gwei` : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default TradingInterface;