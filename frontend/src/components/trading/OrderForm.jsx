// @title: Formulaire d'Ordre avec Validation Stricte
// @security: Leverage limits, slippage validation, oracle checks
// @ux: Real-time validation, warnings, tooltips

import React, { useState, useEffect } from 'react';
import { formatUSD, formatPercentage } from '../../utils/formatting';
import './OrderForm.css';

const OrderForm = ({
  orderType,
  side,
  size,
  collateral,
  leverage,
  slippage,
  onOrderTypeChange,
  onSideChange,
  onSizeChange,
  onCollateralChange,
  onLeverageChange,
  onSlippageChange,
  maxLeverage,
  maxSlippage,
  isOracleValid
}) => {
  const [errors, setErrors] = useState({});
  const [warnings, setWarnings] = useState({});
  
  // Available order types
  const ORDER_TYPES = [
    { value: 'market', label: 'Market', description: 'Execute at current market price' },
    { value: 'limit', label: 'Limit', description: 'Execute at specified price or better' },
    { value: 'stop', label: 'Stop Loss', description: 'Trigger order at specified price' }
  ];
  
  // Validation effects
  useEffect(() => {
    const newErrors = {};
    const newWarnings = {};
    
    // Size validation
    if (size) {
      const sizeValue = parseFloat(size);
      if (sizeValue <= 0) {
        newErrors.size = 'Size must be greater than 0';
      } else if (sizeValue > 1000000) {
        newWarnings.size = 'Large position size may have high slippage';
      }
    }
    
    // Collateral validation
    if (collateral) {
      const collateralValue = parseFloat(collateral);
      if (collateralValue < 10) {
        newErrors.collateral = 'Minimum collateral is $10';
      }
    }
    
    // Leverage validation
    if (leverage) {
      const leverageValue = parseFloat(leverage);
      if (leverageValue < 1) {
        newErrors.leverage = 'Minimum leverage is 1x';
      } else if (leverageValue > maxLeverage) {
        newErrors.leverage = `Maximum leverage is ${maxLeverage}x`;
      } else if (leverageValue >= 5) {
        newWarnings.leverage = 'High leverage increases liquidation risk';
      }
    }
    
    // Slippage validation
    if (slippage) {
      const slippageValue = parseFloat(slippage);
      if (slippageValue < 0.1) {
        newWarnings.slippage = 'Low slippage may cause failed transactions';
      } else if (slippageValue > maxSlippage) {
        newErrors.slippage = `Maximum slippage is ${maxSlippage}%`;
      }
    }
    
    setErrors(newErrors);
    setWarnings(newWarnings);
  }, [size, collateral, leverage, slippage, maxLeverage, maxSlippage]);
  
  // Calculate position value
  const calculatePositionValue = () => {
    if (!collateral || !leverage) return 0;
    return parseFloat(collateral) * parseFloat(leverage);
  };
  
  // Handle leverage slider
  const handleLeverageSlider = (value) => {
    const leverageValue = parseFloat(value);
    onLeverageChange(leverageValue);
    
    // Auto-calculate size based on collateral
    if (collateral && !size) {
      const calculatedSize = parseFloat(collateral) * leverageValue;
      onSizeChange(calculatedSize.toFixed(2));
    }
  };
  
  // Handle collateral change with auto-size
  const handleCollateralChange = (value) => {
    onCollateralChange(value);
    
    // Auto-update size if leverage is set
    if (leverage && value && !size) {
      const calculatedSize = parseFloat(value) * parseFloat(leverage);
      onSizeChange(calculatedSize.toFixed(2));
    }
  };
  
  return (
    <div className="order-form">
      {/* Order Type Selection */}
      <div className="form-section">
        <label className="section-label">Order Type</label>
        <div className="order-type-buttons">
          {ORDER_TYPES.map(type => (
            <button
              key={type.value}
              className={`order-type-btn ${orderType === type.value ? 'active' : ''}`}
              onClick={() => onOrderTypeChange(type.value)}
              title={type.description}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>
      
      {/* Side Selection */}
      <div className="form-section">
        <label className="section-label">Side</label>
        <div className="side-buttons">
          <button
            className={`side-btn long ${side === 'long' ? 'active' : ''}`}
            onClick={() => onSideChange('long')}
          >
            Long
          </button>
          <button
            className={`side-btn short ${side === 'short' ? 'active' : ''}`}
            onClick={() => onSideChange('short')}
          >
            Short
          </button>
        </div>
      </div>
      
      {/* Collateral Input */}
      <div className="form-section">
        <label className="section-label">
          Collateral (USD)
          <span className="hint">Minimum: $10</span>
        </label>
        <div className="input-with-unit">
          <input
            type="number"
            value={collateral}
            onChange={(e) => handleCollateralChange(e.target.value)}
            placeholder="0.00"
            min="10"
            step="0.01"
            className={errors.collateral ? 'error' : ''}
            disabled={!isOracleValid}
          />
          <span className="unit">USD</span>
        </div>
        {errors.collateral && (
          <div className="error-message">{errors.collateral}</div>
        )}
      </div>
      
      {/* Leverage Slider */}
      <div className="form-section">
        <label className="section-label">
          Leverage
          <span className="hint">{leverage}x</span>
        </label>
        <div className="leverage-control">
          <input
            type="range"
            min="1"
            max={maxLeverage}
            step="0.1"
            value={leverage}
            onChange={(e) => handleLeverageSlider(e.target.value)}
            className="leverage-slider"
            disabled={!isOracleValid}
          />
          <div className="leverage-ticks">
            <span>1x</span>
            <span>3x</span>
            <span>5x</span>
            <span>7x</span>
            <span>10x</span>
          </div>
        </div>
        {errors.leverage && (
          <div className="error-message">{errors.leverage}</div>
        )}
        {warnings.leverage && (
          <div className="warning-message">{warnings.leverage}</div>
        )}
      </div>
      
      {/* Position Size */}
      <div className="form-section">
        <label className="section-label">
          Position Size (USD)
          <span className="hint">Auto-calculated</span>
        </label>
        <div className="input-with-unit">
          <input
            type="number"
            value={size}
            onChange={(e) => onSizeChange(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            className={errors.size ? 'error' : ''}
            disabled={!isOracleValid}
          />
          <span className="unit">USD</span>
        </div>
        <div className="position-value">
          ≈ {formatUSD(calculatePositionValue())}
        </div>
        {errors.size && (
          <div className="error-message">{errors.size}</div>
        )}
        {warnings.size && (
          <div className="warning-message">{warnings.size}</div>
        )}
      </div>
      
      {/* Slippage Tolerance (only for market orders) */}
      {orderType === 'market' && (
        <div className="form-section">
          <label className="section-label">
            Slippage Tolerance
            <span className="hint">Max: {maxSlippage}%</span>
          </label>
          <div className="slippage-control">
            <div className="slippage-presets">
              {[0.1, 0.5, 1.0].map(preset => (
                <button
                  key={preset}
                  className={`slippage-btn ${slippage === preset ? 'active' : ''}`}
                  onClick={() => onSlippageChange(preset)}
                  disabled={!isOracleValid}
                >
                  {preset}%
                </button>
              ))}
            </div>
            <div className="custom-slippage">
              <input
                type="number"
                value={slippage}
                onChange={(e) => onSlippageChange(e.target.value)}
                min="0.1"
                max={maxSlippage}
                step="0.1"
                className={errors.slippage ? 'error' : ''}
                disabled={!isOracleValid}
              />
              <span className="unit">%</span>
            </div>
          </div>
          {errors.slippage && (
            <div className="error-message">{errors.slippage}</div>
          )}
          {warnings.slippage && (
            <div className="warning-message">{warnings.slippage}</div>
          )}
        </div>
      )}
      
      {/* Limit Price (for limit orders) */}
      {orderType === 'limit' && (
        <div className="form-section">
          <label className="section-label">Limit Price (USD)</label>
          <div className="input-with-unit">
            <input
              type="number"
              placeholder="Enter limit price"
              min="0"
              step="0.01"
              disabled={!isOracleValid}
            />
            <span className="unit">USD</span>
          </div>
        </div>
      )}
      
      {/* Stop Price (for stop orders) */}
      {orderType === 'stop' && (
        <div className="form-section">
          <label className="section-label">Stop Price (USD)</label>
          <div className="input-with-unit">
            <input
              type="number"
              placeholder="Enter stop price"
              min="0"
              step="0.01"
              disabled={!isOracleValid}
            />
            <span className="unit">USD</span>
          </div>
        </div>
      )}
      
      {/* Risk Disclaimer */}
      <div className="risk-disclaimer">
        <div className="disclaimer-icon">⚠️</div>
        <div className="disclaimer-text">
          Trading perpetual contracts involves significant risk of loss.
          {leverage >= 5 && ' High leverage increases liquidation risk.'}
          {!isOracleValid && ' Oracle issues may affect execution.'}
        </div>
      </div>
    </div>
  );
};

export default OrderForm;