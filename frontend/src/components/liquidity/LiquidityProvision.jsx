// @title: Interface de fourniture de liquidité AMM
// @security: Vérification des approvals, limites de dépôt
// @risk: Calcul IL, exposition au risque du protocole

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { usePerpDex, useLiquidity } from '../../hooks';
import { formatCurrency, calculateImpermanentLoss } from '../../utils';

export const LiquidityProvision = () => {
  const { account, signer } = usePerpDex();
  const { 
    poolData, 
    userLpBalance, 
    deposit, 
    withdraw, 
    loading, 
    error 
  } = useLiquidity();

  const [amount, setAmount] = useState('');
  const [action, setAction] = useState('deposit'); // 'deposit' or 'withdraw'
  const [selectedToken, setSelectedToken] = useState('USDC');
  const [slippage, setSlippage] = useState('0.5');
  const [estimatedShares, setEstimatedShares] = useState(BigInt(0));
  const [impermanentLoss, setImpermanentLoss] = useState(null);

  // Tokens supportés
  const SUPPORTED_TOKENS = [
    { symbol: 'USDC', address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6 },
    { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
    { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 }
  ];

  useEffect(() => {
    if (amount && poolData) {
      calculateEstimatedShares();
      calculateImpermanentLossRisk();
    }
  }, [amount, action, selectedToken, poolData]);

  const calculateEstimatedShares = () => {
    if (!amount || !poolData || !poolData.totalLiquidity || !poolData.totalShares) {
      setEstimatedShares(BigInt(0));
      return;
    }

    const amountBN = ethers.parseUnits(
      amount, 
      SUPPORTED_TOKENS.find(t => t.symbol === selectedToken)?.decimals || 18
    );

    if (action === 'deposit') {
      // Estimation des shares reçues
      const estimated = amountBN
         * (poolData.totalShares)
         / (poolData.totalLiquidity);
      setEstimatedShares(estimated);
    } else {
      // Estimation des tokens reçus pour le retrait
      const userShares = userLpBalance || BigInt(0);
      const sharePercentage = amountBN * (10000) / (userShares); // en bps
      const estimated = poolData.totalLiquidity * (sharePercentage) / (10000);
      // Pour l'affichage, on garde en shares
      setEstimatedShares(amountBN);
    }
  };

  const calculateImpermanentLossRisk = () => {
    if (!poolData || !amount) return;

    const scenarios = [
      { label: '+25%', change: 0.25 },
      { label: '+50%', change: 0.50 },
      { label: '+100%', change: 1.00 },
      { label: '-25%', change: -0.25 },
      { label: '-50%', change: -0.50 },
    ];

    const results = scenarios.map(scenario => {
      const il = calculateImpermanentLoss(scenario.change);
      return {
        ...scenario,
        lossPercentage: il * 100,
        lossAmount: parseFloat(amount) * (il / 100)
      };
    });

    setImpermanentLoss(results);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!account || !signer) {
      alert('Veuillez connecter votre wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      alert('Veuillez entrer un montant valide');
      return;
    }

    try {
      const token = SUPPORTED_TOKENS.find(t => t.symbol === selectedToken);
      const amountBN = ethers.parseUnits(amount, token.decimals);

      if (action === 'deposit') {
        await deposit(token.address, amountBN, slippage);
      } else {
        await withdraw(amountBN, slippage);
      }

      // Reset form
      setAmount('');
      alert(`${action === 'deposit' ? 'Dépôt' : 'Retrait'} réussi!`);
    } catch (error) {
      console.error('Transaction error:', error);
      alert(`Erreur: ${error.message}`);
    }
  };

  const handleMaxAmount = () => {
    if (action === 'deposit') {
      // Pour simplifier, on met un montant arbitraire
      // En production, on récupérerait le balance de l'utilisateur
      setAmount('1000');
    } else {
      // Retrait max = toutes les LP shares
      const maxShares = ethers.formatUnits(
        userLpBalance || BigInt(0),
        18
      );
      setAmount(maxShares);
    }
  };

  if (!account) {
    return (
      <div className="liquidity-connect">
        <div className="connect-icon">🔗</div>
        <h3>Connectez votre wallet</h3>
        <p>Connectez votre wallet pour fournir de la liquidité</p>
      </div>
    );
  }

  return (
    <div className="liquidity-provision">
      <div className="liquidity-header">
        <h2>Fournir de la Liquidité</h2>
        <div className="pool-stats">
          <div className="stat">
            <div className="stat-label">TVL Total</div>
            <div className="stat-value">
              {poolData ? formatCurrency(poolData.totalLiquidity) : '--'}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">APY</div>
            <div className="stat-value">
              {poolData?.apy ? `${poolData.apy.toFixed(2)}%` : '--'}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Vos Parts</div>
            <div className="stat-value">
              {userLpBalance ? ethers.formatUnits(userLpBalance, 18) : '0'}
            </div>
          </div>
        </div>
      </div>

      <div className="liquidity-form-container">
        {/* Onglets Dépôt/Retrait */}
        <div className="action-tabs">
          <button
            className={`tab ${action === 'deposit' ? 'active' : ''}`}
            onClick={() => setAction('deposit')}
          >
            <span className="tab-icon">⬆️</span>
            <span>Déposer</span>
          </button>
          <button
            className={`tab ${action === 'withdraw' ? 'active' : ''}`}
            onClick={() => setAction('withdraw')}
            disabled={!userLpBalance || userLpBalance.isZero()}
          >
            <span className="tab-icon">⬇️</span>
            <span>Retirer</span>
          </button>
        </div>

        {/* Formulaire */}
        <form onSubmit={handleSubmit} className="liquidity-form">
          {action === 'deposit' && (
            <div className="form-group">
              <label htmlFor="token">Token</label>
              <select
                id="token"
                value={selectedToken}
                onChange={(e) => setSelectedToken(e.target.value)}
                className="token-select"
              >
                {SUPPORTED_TOKENS.map(token => (
                  <option key={token.symbol} value={token.symbol}>
                    {token.symbol}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="form-group">
            <div className="amount-header">
              <label htmlFor="amount">
                {action === 'deposit' ? 'Montant à déposer' : 'Parts à retirer'}
              </label>
              <button
                type="button"
                onClick={handleMaxAmount}
                className="max-button"
              >
                MAX
              </button>
            </div>
            <div className="amount-input-wrapper">
              <input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.0"
                min="0"
                step="any"
                className="amount-input"
              />
              <div className="amount-suffix">
                {action === 'deposit' ? selectedToken : 'LP'}
              </div>
            </div>
            <div className="amount-conversion">
              {action === 'deposit' ? (
                <span>
                  ≈ {estimatedShares > (0)
                    ? ethers.formatUnits(estimatedShares, 18)
                    : '0'} LP shares
                </span>
              ) : (
                <span>
                  ≈ {estimatedShares > (0)
                    ? formatCurrency(
                        estimatedShares
                           * (poolData?.totalLiquidity || BigInt(0))
                           / (poolData?.totalShares || BigInt(1))
                      )
                    : '0'} en valeur
                </span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="slippage">
              Tolérance de Slippage ({slippage}%)
            </label>
            <div className="slippage-control">
              <input
                type="range"
                id="slippage"
                min="0.1"
                max="5"
                step="0.1"
                value={slippage}
                onChange={(e) => setSlippage(e.target.value)}
                className="slippage-slider"
              />
              <div className="slippage-presets">
                {['0.1', '0.5', '1.0'].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    className={`slippage-preset ${slippage === preset ? 'active' : ''}`}
                    onClick={() => setSlippage(preset)}
                  >
                    {preset}%
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Résumé de la transaction */}
          <div className="transaction-summary">
            <h4>Résumé</h4>
            <div className="summary-row">
              <span>Type</span>
              <span>{action === 'deposit' ? 'Dépôt' : 'Retrait'}</span>
            </div>
            <div className="summary-row">
              <span>Montant</span>
              <span>
                {amount || '0'} {action === 'deposit' ? selectedToken : 'LP'}
              </span>
            </div>
            <div className="summary-row">
              <span>Frais estimés</span>
              <span>0.3%</span>
            </div>
            <div className="summary-row">
              <span>Reçu estimé</span>
              <span>
                {action === 'deposit' 
                  ? `${ethers.formatUnits(estimatedShares, 18) || '0'} LP`
                  : `${formatCurrency(
                      estimatedShares
                         * (poolData?.totalLiquidity || BigInt(0))
                         / (poolData?.totalShares || BigInt(1))
                    )}`
                }
              </span>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !amount || parseFloat(amount) <= 0}
            className="submit-button"
          >
            {loading ? (
              <>
                <div className="loading-spinner"></div>
                Traitement...
              </>
            ) : (
              `${action === 'deposit' ? 'Déposer' : 'Retirer'}`
            )}
          </button>
        </form>
      </div>

      {/* Avertissement Impermanent Loss */}
      <div className="impermanent-loss-warning">
        <div className="warning-header">
          <div className="warning-icon">⚠️</div>
          <h4>Risque de Perte Impermanente</h4>
        </div>
        <p>
          En fournissant de la liquidité, vous êtes exposé au risque de perte impermanente.
          Ceci se produit lorsque le prix des tokens dans le pool change.
        </p>
        
        {impermanentLoss && (
          <div className="il-scenarios">
            <h5>Scénarios de perte impermanente:</h5>
            <div className="scenarios-grid">
              {impermanentLoss.map(scenario => (
                <div key={scenario.label} className="scenario-card">
                  <div className="scenario-change">
                    {scenario.label}
                  </div>
                  <div className={`scenario-loss ${scenario.lossPercentage > 0 ? 'negative' : 'positive'}`}>
                    {scenario.lossPercentage > 0 ? '-' : '+'}
                    {Math.abs(scenario.lossPercentage).toFixed(2)}%
                  </div>
                  <div className="scenario-amount">
                    ≈ ${scenario.lossAmount.toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Informations pool */}
      {poolData && (
        <div className="pool-information">
          <h4>Informations du Pool</h4>
          <div className="info-grid">
            <div className="info-card">
              <div className="info-label">Utilisateurs</div>
              <div className="info-value">{poolData.userCount}</div>
            </div>
            <div className="info-card">
              <div className="info-label">Frais 24h</div>
              <div className="info-value">
                {formatCurrency(poolData.dailyFees)}
              </div>
            </div>
            <div className="info-card">
              <div className="info-label">Volume 24h</div>
              <div className="info-value">
                {formatCurrency(poolData.dailyVolume)}
              </div>
            </div>
            <div className="info-card">
              <div className="info-label">Reserve Ratio</div>
              <div className="info-value">
                {(poolData.reserveRatio * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};