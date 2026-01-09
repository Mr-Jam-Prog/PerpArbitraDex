// @title: Dashboard Principal - Vue d'ensemble Portfolio
// @security: Lecture seule, données vérifiées on-chain
// @risk: Health factor monitoring, liquidation alerts

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { usePerpDex, usePositions } from '../../hooks';
import { formatCurrency, formatPercentage, calculateHealthFactor } from '../../utils';
import { RiskIndicator } from './RiskIndicator';
import { PnLChart } from './PnLChart';

export const PortfolioOverview = () => {
  const { account, network } = usePerpDex();
  const { positions, loading, error } = usePositions();
  const [portfolioMetrics, setPortfolioMetrics] = useState(null);
  const [riskLevel, setRiskLevel] = useState('safe');

  useEffect(() => {
    if (positions && positions.length > 0) {
      calculatePortfolioMetrics();
    }
  }, [positions]);

  const calculatePortfolioMetrics = async () => {
    try {
      let totalCollateral = ethers.BigNumber.from(0);
      let totalPositionValue = ethers.BigNumber.from(0);
      let totalPnL = ethers.BigNumber.from(0);
      let minHealthFactor = ethers.BigNumber.from(ethers.constants.MaxUint256);
      let positionsAtRisk = 0;

      for (const position of positions) {
        totalCollateral = totalCollateral.add(position.collateral);
        totalPositionValue = totalPositionValue.add(position.positionValue);
        totalPnL = totalPnL.add(position.unrealizedPnL);

        const hf = calculateHealthFactor(
          position.collateral,
          position.positionValue,
          position.entryPrice,
          position.isLong
        );

        if (hf.lt(minHealthFactor)) {
          minHealthFactor = hf;
        }

        if (hf.lt(ethers.utils.parseUnits('1.5', 18))) {
          positionsAtRisk++;
        }
      }

      // Calcul du levier moyen
      const avgLeverage = totalPositionValue.gt(0)
        ? totalPositionValue.mul(ethers.utils.parseUnits('1', 18)).div(totalCollateral)
        : ethers.BigNumber.from(0);

      // Détermination du niveau de risque
      let newRiskLevel = 'safe';
      if (minHealthFactor.lt(ethers.utils.parseUnits('1.1', 18))) {
        newRiskLevel = 'critical';
      } else if (minHealthFactor.lt(ethers.utils.parseUnits('1.5', 18))) {
        newRiskLevel = 'warning';
      } else if (minHealthFactor.lt(ethers.utils.parseUnits('2', 18))) {
        newRiskLevel = 'moderate';
      }

      setRiskLevel(newRiskLevel);

      setPortfolioMetrics({
        totalCollateral,
        totalPositionValue,
        totalPnL,
        avgLeverage,
        minHealthFactor,
        positionsAtRisk,
        totalPositions: positions.length
      });
    } catch (error) {
      console.error('Error calculating portfolio metrics:', error);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Chargement du portfolio...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-error">
        <div className="error-icon">⚠️</div>
        <p>Erreur lors du chargement du portfolio</p>
        <button onClick={() => window.location.reload()}>Réessayer</button>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="dashboard-connect">
        <div className="connect-icon">🔗</div>
        <h3>Connectez votre wallet</h3>
        <p>Connectez votre wallet pour voir votre portfolio</p>
      </div>
    );
  }

  return (
    <div className="portfolio-overview">
      {/* En-tête avec métriques principales */}
      <div className="portfolio-header">
        <div className="portfolio-title">
          <h1>Portfolio Overview</h1>
          <div className={`risk-badge ${riskLevel}`}>
            {riskLevel === 'critical' ? '🔴 CRITIQUE' : 
             riskLevel === 'warning' ? '🟠 ATTENTION' : 
             riskLevel === 'moderate' ? '🟡 MODÉRÉ' : '🟢 SÛR'}
          </div>
        </div>
        
        <div className="portfolio-stats">
          <div className="stat-card">
            <div className="stat-label">Collateral Total</div>
            <div className="stat-value">
              {portfolioMetrics ? formatCurrency(portfolioMetrics.totalCollateral) : '--'}
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-label">Valeur Positions</div>
            <div className="stat-value">
              {portfolioMetrics ? formatCurrency(portfolioMetrics.totalPositionValue) : '--'}
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-label">PnL Non-Réalisé</div>
            <div className={`stat-value ${
              portfolioMetrics?.totalPnL.gte(0) ? 'positive' : 'negative'
            }`}>
              {portfolioMetrics ? formatCurrency(portfolioMetrics.totalPnL, true) : '--'}
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-label">Leverage Moyen</div>
            <div className="stat-value">
              {portfolioMetrics ? `${formatPercentage(portfolioMetrics.avgLeverage)}x` : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Indicateur de risque */}
      <div className="risk-section">
        <RiskIndicator 
          healthFactor={portfolioMetrics?.minHealthFactor}
          positionsAtRisk={portfolioMetrics?.positionsAtRisk}
          totalPositions={portfolioMetrics?.totalPositions}
        />
      </div>

      {/* Graphique PnL */}
      <div className="chart-section">
        <div className="section-header">
          <h2>Performance Historique</h2>
          <div className="time-selector">
            <button className="active">1J</button>
            <button>7J</button>
            <button>1M</button>
            <button>3M</button>
            <button>1A</button>
          </div>
        </div>
        <PnLChart positions={positions} />
      </div>

      {/* Positions à risque */}
      {portfolioMetrics?.positionsAtRisk > 0 && (
        <div className="risk-alert-section">
          <div className="alert-header">
            <div className="alert-icon">⚠️</div>
            <h3>Positions à Risque</h3>
          </div>
          <p>
            {portfolioMetrics.positionsAtRisk} position(s) nécessitent votre attention. 
            Health factor inférieur à 1.5.
          </p>
          <button className="alert-button">
            Voir les positions à risque
          </button>
        </div>
      )}

      {/* Avertissement si levier élevé */}
      {portfolioMetrics?.avgLeverage.gt(ethers.utils.parseUnits('5', 18)) && (
        <div className="leverage-warning">
          <div className="warning-icon">⚡</div>
          <div className="warning-content">
            <h4>Levier Élevé Détecté</h4>
            <p>
              Votre levier moyen est de {formatPercentage(portfolioMetrics.avgLeverage)}x. 
              Considérez réduire votre exposition.
            </p>
          </div>
        </div>
      )}

      {/* Statut réseau */}
      <div className="network-status">
        <div className="status-indicator connected"></div>
        <span>Connecté à {network.name}</span>
        <span className="block-number">
          Bloc: {network.blockNumber?.toLocaleString() || '--'}
        </span>
      </div>
    </div>
  );
};