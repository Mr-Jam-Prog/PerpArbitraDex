// @title: Indicateur visuel de risque avec seuils de liquidation
// @critical: Affichage en temps réel du health factor
// @warning: Alerte proactive avant liquidation

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { formatPercentage } from '../../utils';

export const RiskIndicator = ({ healthFactor, positionsAtRisk, totalPositions }) => {
  const [riskPercentage, setRiskPercentage] = useState(0);
  const [gaugeColor, setGaugeColor] = useState('#10b981');
  const [riskDescription, setRiskDescription] = useState('');

  // Seuils de risque
  const RISK_THRESHOLDS = {
    critical: ethers.parseUnits('1.1', 18), // 1.1 - Liquidation imminente
    warning: ethers.parseUnits('1.5', 18),  // 1.5 - Risque élevé
    moderate: ethers.parseUnits('2.0', 18), // 2.0 - Risque modéré
    safe: ethers.parseUnits('3.0', 18)      // 3.0 - Sûr
  };

  useEffect(() => {
    updateRiskIndicator();
  }, [healthFactor]);

  const updateRiskIndicator = () => {
    if (!healthFactor) {
      setRiskPercentage(0);
      setGaugeColor('#6B7280');
      setRiskDescription('Aucune position active');
      return;
    }

    // Calcul du pourcentage de risque (0-100%)
    let percentage;
    let color;
    let description;

    if (healthFactor < RISK_THRESHOLDS.critical) {
      percentage = 95 + Math.random() * 5; // 95-100%
      color = '#EF4444';
      description = 'CRITIQUE - Liquidation imminente';
    } else if (healthFactor < RISK_THRESHOLDS.warning) {
      percentage = 70 + Number((healthFactor - RISK_THRESHOLDS.critical) * 25n / (RISK_THRESHOLDS.warning - RISK_THRESHOLDS.critical));
      color = '#F59E0B';
      description = 'ATTENTION - Risque élevé de liquidation';
    } else if (healthFactor < RISK_THRESHOLDS.moderate) {
      percentage = 30 + Number((healthFactor - RISK_THRESHOLDS.warning) * 40n / (RISK_THRESHOLDS.moderate - RISK_THRESHOLDS.warning));
      color = '#FBBF24';
      description = 'MODÉRÉ - Surveillez vos positions';
    } else if (healthFactor < RISK_THRESHOLDS.safe) {
      percentage = 10 + Number((healthFactor - RISK_THRESHOLDS.moderate) * 20n / (RISK_THRESHOLDS.safe - RISK_THRESHOLDS.moderate));
      color = '#10B981';
      description = 'SÛR - Niveau de risque acceptable';
    } else {
      percentage = 0 + Number((healthFactor - RISK_THRESHOLDS.safe) * 10n / ethers.parseUnits('5', 18));
      color = '#059669';
      description = 'TRÈS SÛR - Marge de sécurité élevée';
    }

    setRiskPercentage(Math.min(100, Math.max(0, percentage)));
    setGaugeColor(color);
    setRiskDescription(description);
  };

  // Calcul de l'angle pour le SVG
  const getGaugeMetrics = (percentage) => {
    const angle = (percentage / 100) * 180; // Demi-cercle de 0-180°
    const radius = 80;
    const centerX = 100;
    const centerY = 100;
    
    const startAngle = -180;
    const endAngle = -180 + angle;
    
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    
    const x1 = centerX + radius * Math.cos(startRad);
    const y1 = centerY + radius * Math.sin(startRad);
    const x2 = centerX + radius * Math.cos(endRad);
    const y2 = centerY + radius * Math.sin(endRad);
    
    const largeArcFlag = angle > 180 ? 1 : 0;
    
    return {
      path: `M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`,
      textX: centerX,
      textY: centerY + 30
    };
  };

  const gaugeMetrics = getGaugeMetrics(riskPercentage);

  return (
    <div className="risk-indicator">
      <div className="indicator-header">
        <h3>Indicateur de Risque</h3>
        <div className="risk-score">
          <span className="score-label">Score:</span>
          <span className="score-value" style={{ color: gaugeColor }}>
            {(100 - riskPercentage).toFixed(0)}/100
          </span>
        </div>
      </div>

      <div className="gauge-container">
        {/* Jauge SVG */}
        <div className="gauge-wrapper">
          <svg width="200" height="120" viewBox="0 0 200 120">
            {/* Fond de jauge */}
            <path
              d={getGaugeMetrics(100).path}
              fill="#1F2937"
              stroke="#374151"
              strokeWidth="2"
            />
            
            {/* Jauge de risque */}
            <path
              d={gaugeMetrics.path}
              fill={gaugeColor}
              stroke={gaugeColor}
              strokeWidth="2"
              fillOpacity="0.8"
            />
            
            {/* Aiguille */}
            <line
              x1="100"
              y1="100"
              x2={100 + 70 * Math.cos((riskPercentage / 100 * 180 - 180) * Math.PI / 180)}
              y2={100 + 70 * Math.sin((riskPercentage / 100 * 180 - 180) * Math.PI / 180)}
              stroke="#FFFFFF"
              strokeWidth="3"
              strokeLinecap="round"
            />
            
            {/* Centre */}
            <circle cx="100" cy="100" r="8" fill="#FFFFFF" />
            
            {/* Texte Health Factor */}
            <text
              x={gaugeMetrics.textX}
              y={gaugeMetrics.textY}
              textAnchor="middle"
              fill="#FFFFFF"
              fontSize="14"
              fontWeight="bold"
            >
              {healthFactor ? formatPercentage(healthFactor) : '--'}
            </text>
            
            <text
              x={gaugeMetrics.textX}
              y={gaugeMetrics.textY + 20}
              textAnchor="middle"
              fill="#9CA3AF"
              fontSize="12"
            >
              Health Factor
            </text>
          </svg>
        </div>

        {/* Légende et description */}
        <div className="gauge-info">
          <div className="risk-description">
            <div className="description-icon" style={{ backgroundColor: gaugeColor }}>
              {riskPercentage > 90 ? '⚠️' : riskPercentage > 70 ? '🔸' : '✅'}
            </div>
            <div className="description-text">
              <h4>{riskDescription}</h4>
              <p>
                {healthFactor && healthFactor < (RISK_THRESHOLDS.warning)
                  ? 'Ajoutez du collateral ou réduisez votre exposition'
                  : 'Votre portefeuille est bien géré'}
              </p>
            </div>
          </div>

          {/* Seuils de risque */}
          <div className="risk-thresholds">
            <div className="threshold">
              <div className="threshold-marker safe"></div>
              <span>Safe: HF ≥ 3.0</span>
            </div>
            <div className="threshold">
              <div className="threshold-marker moderate"></div>
              <span>Moderate: HF ≥ 2.0</span>
            </div>
            <div className="threshold">
              <div className="threshold-marker warning"></div>
              <span>Warning: HF ≥ 1.5</span>
            </div>
            <div className="threshold">
              <div className="threshold-marker critical"></div>
              <span>Critical: HF {'<'} 1.1</span>
            </div>
          </div>

          {/* Positions à risque */}
          {positionsAtRisk > 0 && (
            <div className="positions-risk-alert">
              <div className="alert-icon">🚨</div>
              <div className="alert-content">
                <strong>{positionsAtRisk} position(s) à risque</strong>
                <small>Health Factor inférieur à 1.5</small>
              </div>
              <button className="alert-action">
                Vérifier
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recommandations */}
      <div className="risk-recommendations">
        <h4>Recommandations</h4>
        <ul>
          {riskPercentage > 70 && (
            <>
              <li>✅ Ajoutez du collateral pour améliorer votre Health Factor</li>
              <li>✅ Réduisez la taille des positions à risque</li>
              <li>✅ Diversifiez votre exposition sur différents marchés</li>
            </>
          )}
          {riskPercentage <= 70 && riskPercentage > 30 && (
            <>
              <li>⚠️ Surveillez régulièrement votre Health Factor</li>
              <li>⚠️ Configurez des alertes de liquidation</li>
              <li>⚠️ Évitez d'ajouter du levier supplémentaire</li>
            </>
          )}
          {riskPercentage <= 30 && (
            <>
              <li>👍 Votre gestion du risque est bonne</li>
              <li>👍 Continuez à diversifier votre portefeuille</li>
              <li>👍 Pensez à prendre des profits sur les positions gagnantes</li>
            </>
          )}
        </ul>
      </div>
    </div>
  );
};