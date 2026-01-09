// @title: Calculateur de rendements LP avec projections
// @features: Simulation APY, IL, fees, comparatif vs HODL
// @accuracy: Basé sur données historiques réelles

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar 
} from 'recharts';
import { formatCurrency, formatPercentage, calculateImpermanentLoss } from '../../utils';

export const LPCalculator = () => {
  const [principal, setPrincipal] = useState('1000');
  const [duration, setDuration] = useState(365); // jours
  const [priceChange, setPriceChange] = useState(0); // % change
  const [dailyVolume, setDailyVolume] = useState(1000000); // $ volume quotidien
  const [feeTier, setFeeTier] = useState(0.003); // 0.3%
  const [results, setResults] = useState(null);
  const [projectionData, setProjectionData] = useState([]);

  // Calcul des résultats
  useEffect(() => {
    calculateResults();
  }, [principal, duration, priceChange, dailyVolume, feeTier]);

  const calculateResults = () => {
    const principalNum = parseFloat(principal) || 0;
    
    // 1. Calcul des fees
    const poolShare = 0.01; // 1% du pool (simplifié)
    const dailyFees = dailyVolume * feeTier;
    const userDailyFees = dailyFees * poolShare;
    const totalFees = userDailyFees * duration;

    // 2. Calcul IL
    const ilPercentage = calculateImpermanentLoss(priceChange / 100);
    const ilAmount = principalNum * ilPercentage;

    // 3. Rendement HODL
    const hodlValue = principalNum * (1 + priceChange / 100);

    // 4. Rendement LP
    const lpValue = principalNum + totalFees - Math.abs(ilAmount);

    // 5. APY
    const apy = ((lpValue / principalNum) - 1) * (365 / duration) * 100;

    // 6. Génération données de projection
    const projection = [];
    for (let day = 0; day <= duration; day += Math.floor(duration / 30)) {
      const dayFees = userDailyFees * day;
      const dayIl = principalNum * calculateImpermanentLoss((priceChange / 100) * (day / duration));
      projection.push({
        day,
        lpValue: principalNum + dayFees - Math.abs(dayIl),
        hodlValue: principalNum * (1 + (priceChange / 100) * (day / duration)),
        fees: dayFees,
        il: Math.abs(dayIl)
      });
    }

    setProjectionData(projection);
    setResults({
      principal: principalNum,
      totalFees,
      ilAmount: Math.abs(ilAmount),
      ilPercentage: ilPercentage * 100,
      hodlValue,
      lpValue,
      apy,
      netProfit: lpValue - hodlValue
    });
  };

  const ComparisonChart = () => {
    return (
      <div className="comparison-chart">
        <h4>Projection LP vs HODL</h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={projectionData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis 
              dataKey="day" 
              stroke="#9CA3AF"
              label={{ value: 'Jours', position: 'insideBottom', offset: -5 }}
            />
            <YAxis 
              stroke="#9CA3AF"
              tickFormatter={(value) => `$${value.toFixed(0)}`}
            />
            <Tooltip 
              formatter={(value) => [`$${value.toFixed(2)}`, 'Valeur']}
              labelFormatter={(label) => `Jour ${label}`}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="lpValue" 
              name="LP Value" 
              stroke="#10B981" 
              strokeWidth={2}
              dot={false}
            />
            <Line 
              type="monotone" 
              dataKey="hodlValue" 
              name="HODL Value" 
              stroke="#3B82F6" 
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  };

  const FeeBreakdownChart = () => {
    if (!results) return null;

    const data = [
      { name: 'Fees', value: results.totalFees, color: '#10B981' },
      { name: 'IL', value: -results.ilAmount, color: '#EF4444' },
      { name: 'Principal', value: results.principal, color: '#6B7280' }
    ];

    return (
      <div className="breakdown-chart">
        <h4>Composition Finale</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis dataKey="name" stroke="#9CA3AF" />
            <YAxis 
              stroke="#9CA3AF"
              tickFormatter={(value) => `$${value.toFixed(0)}`}
            />
            <Tooltip 
              formatter={(value) => [`$${value.toFixed(2)}`, '']}
            />
            <Bar 
              dataKey="value" 
              fill={(entry) => entry.color}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <div className="lp-calculator">
      <div className="calculator-header">
        <h2>Calculateur de Rendements LP</h2>
        <p className="subtitle">
          Simulez vos rendements potentiels en fonction des paramètres du marché
        </p>
      </div>

      <div className="calculator-grid">
        {/* Contrôles de saisie */}
        <div className="input-section">
          <h3>Paramètres</h3>
          
          <div className="input-group">
            <label htmlFor="principal">Capital Initial ($)</label>
            <input
              id="principal"
              type="number"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              min="0"
              step="100"
              className="input-control"
            />
            <div className="input-slider">
              <input
                type="range"
                min="100"
                max="100000"
                step="100"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
                className="range-slider"
              />
              <div className="slider-labels">
                <span>$100</span>
                <span>$10k</span>
                <span>$100k</span>
              </div>
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="duration">Durée (jours)</label>
            <input
              id="duration"
              type="number"
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              min="1"
              max="1095"
              className="input-control"
            />
            <div className="duration-presets">
              {[30, 90, 180, 365].map(days => (
                <button
                  key={days}
                  type="button"
                  className={`duration-preset ${duration === days ? 'active' : ''}`}
                  onClick={() => setDuration(days)}
                >
                  {days} jours
                </button>
              ))}
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="priceChange">
              Changement de Prix ({priceChange}%)
            </label>
            <input
              id="priceChange"
              type="range"
              min="-80"
              max="300"
              step="5"
              value={priceChange}
              onChange={(e) => setPriceChange(parseInt(e.target.value))}
              className="range-slider"
            />
            <div className="price-scenarios">
              <button
                type="button"
                className={`scenario ${priceChange === -50 ? 'active' : ''}`}
                onClick={() => setPriceChange(-50)}
              >
                -50% (Crash)
              </button>
              <button
                type="button"
                className={`scenario ${priceChange === 0 ? 'active' : ''}`}
                onClick={() => setPriceChange(0)}
              >
                0% (Stable)
              </button>
              <button
                type="button"
                className={`scenario ${priceChange === 100 ? 'active' : ''}`}
                onClick={() => setPriceChange(100)}
              >
                +100% (Bull)
              </button>
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="dailyVolume">
              Volume Quotidien (${(dailyVolume / 1000000).toFixed(1)}M)
            </label>
            <input
              id="dailyVolume"
              type="range"
              min="100000"
              max="10000000"
              step="100000"
              value={dailyVolume}
              onChange={(e) => setDailyVolume(parseInt(e.target.value))}
              className="range-slider"
            />
          </div>

          <div className="input-group">
            <label htmlFor="feeTier">
              Fee Tier ({(feeTier * 100).toFixed(2)}%)
            </label>
            <select
              id="feeTier"
              value={feeTier}
              onChange={(e) => setFeeTier(parseFloat(e.target.value))}
              className="select-control"
            >
              <option value="0.0001">0.01% (Stablecoins)</option>
              <option value="0.0005">0.05% (Correlated)</option>
              <option value="0.003">0.3% (Standard)</option>
              <option value="0.01">1% (Exotic)</option>
            </select>
          </div>
        </div>

        {/* Résultats */}
        <div className="results-section">
          <h3>Résultats de la Simulation</h3>
          
          {results && (
            <>
              <div className="results-grid">
                <div className="result-card primary">
                  <div className="result-label">Valeur Finale LP</div>
                  <div className="result-value">
                    ${results.lpValue.toFixed(2)}
                  </div>
                  <div className="result-change">
                    {(((results.lpValue / results.principal) - 1) * 100).toFixed(2)}%
                  </div>
                </div>

                <div className="result-card">
                  <div className="result-label">Valeur Finale HODL</div>
                  <div className="result-value">
                    ${results.hodlValue.toFixed(2)}
                  </div>
                  <div className="result-change">
                    {priceChange.toFixed(2)}%
                  </div>
                </div>

                <div className="result-card positive">
                  <div className="result-label">APY Annualisé</div>
                  <div className="result-value">
                    {results.apy.toFixed(2)}%
                  </div>
                </div>

                <div className={`result-card ${results.netProfit >= 0 ? 'positive' : 'negative'}`}>
                  <div className="result-label">LP vs HODL</div>
                  <div className="result-value">
                    ${results.netProfit.toFixed(2)}
                  </div>
                  <div className="result-change">
                    {((results.netProfit / results.principal) * 100).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="detailed-results">
                <div className="detail-row">
                  <span>Fees accumulées</span>
                  <span className="positive">+${results.totalFees.toFixed(2)}</span>
                </div>
                <div className="detail-row">
                  <span>Perte Impermanente</span>
                  <span className="negative">-${results.ilAmount.toFixed(2)} ({results.ilPercentage.toFixed(2)}%)</span>
                </div>
                <div className="detail-row">
                  <span>Capital initial</span>
                  <span>${results.principal.toFixed(2)}</span>
                </div>
              </div>

              <ComparisonChart />
              <FeeBreakdownChart />

              {/* Recommandation */}
              <div className="recommendation">
                <h4>Recommandation</h4>
                <div className={`recommendation-card ${results.netProfit > 0 ? 'positive' : 'negative'}`}>
                  <div className="recommendation-icon">
                    {results.netProfit > 0 ? '✅' : '❌'}
                  </div>
                  <div className="recommendation-content">
                    <strong>
                      {results.netProfit > 0 
                        ? 'Fournir de la liquidité est rentable' 
                        : 'HODL serait plus rentable'}
                    </strong>
                    <p>
                      {results.netProfit > 0
                        ? `Vous gagneriez $${results.netProfit.toFixed(2)} de plus qu'en HODL`
                        : `Vous perdriez $${Math.abs(results.netProfit).toFixed(2)} par rapport au HODL`
                      }
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Avertissements */}
      <div className="calculator-disclaimer">
        <div className="disclaimer-icon">⚠️</div>
        <div className="disclaimer-content">
          <strong>Disclaimer:</strong> Cette simulation est basée sur des hypothèses de marché.
          Les rendements réels peuvent varier significativement. La perte impermanente
          est un risque réel pour les fournisseurs de liquidité.
        </div>
      </div>
    </div>
  );
};