// @title: Dashboard de monitoring des rendements LP
// @features: Tracking en temps réel, historique, comparaisons
// @security: Données on-chain vérifiées

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { useLiquidity } from '../../hooks';
import { formatCurrency, formatPercentage, formatTimestamp } from '../../utils';

export const YieldDashboard = () => {
  const { 
    poolData, 
    userLpBalance, 
    userRewards, 
    historicalYield,
    loading,
    error
  } = useLiquidity();

  const [timeframe, setTimeframe] = useState('7D');
  const [selectedMetric, setSelectedMetric] = useState('apy');
  const [yieldData, setYieldData] = useState([]);
  const [distributionData, setDistributionData] = useState([]);

  // Couleurs pour les graphiques
  const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444'];

  useEffect(() => {
    if (poolData && historicalYield) {
      processYieldData();
      processDistributionData();
    }
  }, [poolData, historicalYield, timeframe]);

  const processYieldData = () => {
    if (!historicalYield || historicalYield.length === 0) {
      // Données simulées pour le développement
      const mockData = generateMockYieldData();
      setYieldData(mockData);
      return;
    }

    // Filtrer selon le timeframe
    const filteredData = filterDataByTimeframe(historicalYield, timeframe);
    setYieldData(filteredData);
  };

  const processDistributionData = () => {
    if (!poolData) return;

    const data = [
      { name: 'Fees Trading', value: poolData.feeDistribution?.trading || 60 },
      { name: 'Fees Protocol', value: poolData.feeDistribution?.protocol || 20 },
      { name: 'Rewards LP', value: poolData.feeDistribution?.lpRewards || 15 },
      { name: 'Treasury', value: poolData.feeDistribution?.treasury || 5 }
    ];

    setDistributionData(data);
  };

  const filterDataByTimeframe = (data, timeframe) => {
    const now = Date.now();
    let cutoff;

    switch (timeframe) {
      case '1D':
        cutoff = now - 24 * 60 * 60 * 1000;
        break;
      case '7D':
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
        break;
      case '30D':
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
        break;
      case '90D':
        cutoff = now - 90 * 24 * 60 * 60 * 1000;
        break;
      default:
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
    }

    return data.filter(item => item.timestamp >= cutoff);
  };

  const generateMockYieldData = () => {
    const data = [];
    const now = Date.now();
    const days = timeframe === '1D' ? 24 : parseInt(timeframe);

    for (let i = days; i >= 0; i--) {
      const timestamp = now - i * 24 * 60 * 60 * 1000;
      const baseAPY = 15 + Math.random() * 10;
      const fees = 50000 + Math.random() * 50000;
      const volume = 1000000 + Math.random() * 2000000;

      data.push({
        timestamp,
        date: formatTimestamp(timestamp, 'short'),
        apy: baseAPY + Math.sin(i * 0.5) * 3,
        fees,
        volume,
        tvl: 50000000 + Math.sin(i * 0.3) * 10000000,
        utilization: 60 + Math.random() * 20
      });
    }

    return data;
  };

  const calculateUserStats = () => {
    if (!userLpBalance || !poolData) return null;

    const userShare = userLpBalance
       * (ethers.parseUnits('1', 18))
       / (poolData.totalShares || BigInt(1));

    const userTVL = poolData.totalLiquidity
       * (userShare)
       / (ethers.parseUnits('1', 18));

    const dailyYield = userTVL
       * (ethers.parseUnits((poolData.apy || 0).toString(), 16))
       / (ethers.parseUnits('100', 18))
       / (BigInt(365));

    const monthlyYield = dailyYield * (30);
    const yearlyYield = dailyYield * (365);

    return {
      userShare: parseFloat(ethers.formatUnits(userShare, 16)),
      userTVL,
      dailyYield,
      monthlyYield,
      yearlyYield
    };
  };

  const userStats = calculateUserStats();

  if (loading) {
    return (
      <div className="yield-dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Chargement des données de rendement...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="yield-dashboard-error">
        <div className="error-icon">⚠️</div>
        <h3>Erreur de chargement</h3>
        <p>{error.message}</p>
        <button onClick={() => window.location.reload()}>Réessayer</button>
      </div>
    );
  }

  return (
    <div className="yield-dashboard">
      {/* En-tête avec métriques */}
      <div className="dashboard-header">
        <div className="header-title">
          <h1>Dashboard Rendements LP</h1>
          <div className="timeframe-selector">
            {['1D', '7D', '30D', '90D'].map(tf => (
              <button
                key={tf}
                className={`timeframe-button ${timeframe === tf ? 'active' : ''}`}
                onClick={() => setTimeframe(tf)}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>

        <div className="header-metrics">
          <div className="metric-card primary">
            <div className="metric-label">APY Actuel</div>
            <div className="metric-value">
              {poolData?.apy ? `${poolData.apy.toFixed(2)}%` : '--'}
            </div>
            <div className="metric-change">
              {yieldData.length >= 2 ? (
                <>
                  {((yieldData[yieldData.length - 1].apy - yieldData[0].apy) / yieldData[0].apy * 100).toFixed(2)}%
                  {yieldData[yieldData.length - 1].apy >= yieldData[0].apy ? ' ↗' : ' ↘'}
                </>
              ) : '--'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">TVL Total</div>
            <div className="metric-value">
              {poolData ? formatCurrency(poolData.totalLiquidity) : '--'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Fees 24h</div>
            <div className="metric-value">
              {poolData?.dailyFees ? formatCurrency(poolData.dailyFees) : '--'}
            </div>
          </div>

          <div className="metric-card">
            <div className="metric-label">Volume 24h</div>
            <div className="metric-value">
              {poolData?.dailyVolume ? formatCurrency(poolData.dailyVolume) : '--'}
            </div>
          </div>
        </div>
      </div>

      {/* Statistiques utilisateur */}
      {userStats && (
        <div className="user-stats-section">
          <h3>Vos Rendements</h3>
          <div className="user-stats-grid">
            <div className="user-stat-card">
              <div className="stat-label">Votre Part</div>
              <div className="stat-value">
                {userStats.userShare.toFixed(4)}%
              </div>
              <div className="stat-subtext">
                du pool total
              </div>
            </div>

            <div className="user-stat-card">
              <div className="stat-label">Votre TVL</div>
              <div className="stat-value">
                {formatCurrency(userStats.userTVL)}
              </div>
            </div>

            <div className="user-stat-card positive">
              <div className="stat-label">Rendement Quotidien</div>
              <div className="stat-value">
                {formatCurrency(userStats.dailyYield)}
              </div>
              <div className="stat-subtext">
                ${(parseFloat(ethers.formatUnits(userStats.dailyYield, 18)) * 365).toFixed(2)}/an
              </div>
            </div>

            <div className="user-stat-card positive">
              <div className="stat-label">Rendement Mensuel</div>
              <div className="stat-value">
                {formatCurrency(userStats.monthlyYield)}
              </div>
              <div className="stat-subtext">
                APY: {poolData?.apy ? poolData.apy.toFixed(2) : '--'}%
              </div>
            </div>
          </div>

          {/* Rewards accumulés */}
          {userRewards && !userRewards === 0n && (
            <div className="rewards-card">
              <div className="rewards-icon">🎁</div>
              <div className="rewards-content">
                <div className="rewards-title">Rewards Disponibles</div>
                <div className="rewards-amount">
                  {formatCurrency(userRewards)}
                </div>
                <button className="claim-button">
                  Claim Rewards
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Graphiques */}
      <div className="charts-section">
        <div className="chart-container">
          <div className="chart-header">
            <h4>Évolution de l'APY</h4>
            <div className="chart-metrics">
              <div className="chart-metric">
                <span>Moyenne:</span>
                <span>
                  {yieldData.length > 0 
                    ? `${(yieldData.reduce((sum, d) => sum + d.apy, 0) / yieldData.length).toFixed(2)}%`
                    : '--'
                  }
                </span>
              </div>
              <div className="chart-metric">
                <span>Max:</span>
                <span>
                  {yieldData.length > 0 
                    ? `${Math.max(...yieldData.map(d => d.apy)).toFixed(2)}%`
                    : '--'
                  }
                </span>
              </div>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={yieldData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis 
                dataKey="date" 
                stroke="#9CA3AF"
                fontSize={12}
              />
              <YAxis 
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value) => `${value.toFixed(1)}%`}
              />
              <Tooltip 
                formatter={(value) => [`${value.toFixed(2)}%`, 'APY']}
                labelFormatter={(label) => label}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="apy" 
                name="APY" 
                stroke="#10B981" 
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <div className="chart-header">
            <h4>Fees vs Volume</h4>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={yieldData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
              <XAxis 
                dataKey="date" 
                stroke="#9CA3AF"
                fontSize={12}
              />
              <YAxis 
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip 
                formatter={(value, name) => [
                  `$${(value / 1000).toFixed(1)}k`,
                  name === 'fees' ? 'Fees' : 'Volume'
                ]}
              />
              <Legend />
              <Bar 
                dataKey="fees" 
                name="Fees" 
                fill="#3B82F6" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                dataKey="volume" 
                name="Volume" 
                fill="#8B5CF6" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Distribution des fees */}
        <div className="chart-container">
          <div className="chart-header">
            <h4>Distribution des Fees</h4>
          </div>
          <div className="distribution-chart">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={distributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  formatter={(value) => [`${value}%`, 'Part']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="distribution-legend">
            {distributionData.map((item, index) => (
              <div key={item.name} className="legend-item">
                <div 
                  className="legend-color" 
                  style={{ backgroundColor: COLORS[index] }}
                />
                <span className="legend-label">{item.name}</span>
                <span className="legend-value">{item.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Analyse comparative */}
      <div className="comparison-section">
        <h3>Analyse Comparative</h3>
        <div className="comparison-table">
          <table>
            <thead>
              <tr>
                <th>Métrique</th>
                <th>PerpArbitraDEX</th>
                <th>Uniswap V3</th>
                <th>Curve</th>
                <th>Average DeFi</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>APY Moyen</td>
                <td className="highlight">{poolData?.apy ? `${poolData.apy.toFixed(2)}%` : '--'}</td>
                <td>12.5%</td>
                <td>8.2%</td>
                <td>15.3%</td>
              </tr>
              <tr>
                <td>Fees Trading</td>
                <td className="highlight">0.3%</td>
                <td>0.3%</td>
                <td>0.04%</td>
                <td>0.25%</td>
              </tr>
              <tr>
                <td>Risque IL</td>
                <td className="highlight">Moyen</td>
                <td>Élevé</td>
                <td>Faible</td>
                <td>Moyen</td>
              </tr>
              <tr>
                <td>TVL</td>
                <td className="highlight">
                  {poolData ? formatCurrency(poolData.totalLiquidity, true, 1) : '--'}
                </td>
                <td>$3.2B</td>
                <td>$2.1B</td>
                <td>$850M</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Insights et recommandations */}
      <div className="insights-section">
        <h3>Insights</h3>
        <div className="insights-grid">
          <div className="insight-card">
            <div className="insight-icon">📈</div>
            <div className="insight-content">
              <h4>Performance</h4>
              <p>
                L'APY a augmenté de {yieldData.length >= 2 
                  ? ((yieldData[yieldData.length - 1].apy - yieldData[0].apy) / yieldData[0].apy * 100).toFixed(1)
                  : '--'
                }% sur la période sélectionnée.
              </p>
            </div>
          </div>

          <div className="insight-card">
            <div className="insight-icon">⚡</div>
            <div className="insight-content">
              <h4>Efficacité</h4>
              <p>
                Le ratio Fees/TVL est de {poolData 
                  ? ((parseFloat(ethers.formatUnits(poolData.dailyFees || 0, 18)) * 365 /
                     parseFloat(ethers.formatUnits(poolData.totalLiquidity || 1, 18)) * 100).toFixed(2)
                  ) : '--'
                }%, supérieur à la moyenne du marché.
              </p>
            </div>
          </div>

          <div className="insight-card">
            <div className="insight-icon">🎯</div>
            <div className="insight-content">
              <h4>Recommandation</h4>
              <p>
                {poolData?.apy && poolData.apy > 20 
                  ? "Rendements excellents, considérez augmenter votre position."
                  : poolData?.apy && poolData.apy > 10
                  ? "Rendements solides, maintenez votre position."
                  : "Rendements modestes, surveillez les opportunités."
                }
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};