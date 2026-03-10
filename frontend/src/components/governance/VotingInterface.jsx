// @title: Interface de vote avec timelock et vérifications
// @security: Vérification du voting power, délais, confirmations
// @transparency: Historique complet des votes

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { usePerpDex, useGovernance } from '../../hooks';
import { formatCurrency, formatTimestamp, formatPercentage } from '../../utils';

export const VotingInterface = ({ proposalId }) => {
  const { account, signer } = usePerpDex();
  const { 
    proposal,
    userVotingPower,
    castVote,
    delegateVote,
    loading,
    error
  } = useGovernance();

  const [voteChoice, setVoteChoice] = useState(null); // 0: Against, 1: For, 2: Abstain
  const [delegateAddress, setDelegateAddress] = useState('');
  const [votingWeight, setVotingWeight] = useState('');
  const [isDelegating, setIsDelegating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState(null);

  // État de la proposal
  const PROPOSAL_STATES = {
    0: 'Pending',
    1: 'Active',
    2: 'Canceled',
    3: 'Defeated',
    4: 'Succeeded',
    5: 'Queued',
    6: 'Expired',
    7: 'Executed'
  };

  useEffect(() => {
    if (userVotingPower) {
      setVotingWeight(ethers.formatUnits(userVotingPower, 18));
    }
  }, [userVotingPower]);

  const handleVote = async (choice) => {
    if (!account || !signer) {
      alert('Veuillez connecter votre wallet');
      return;
    }

    if (!proposalId || !proposal) {
      alert('Proposal non trouvée');
      return;
    }

    if (proposal.state !== 1) { // 1 = Active
      alert('Cette proposal n\'est plus active');
      return;
    }

    try {
      setTransactionStatus('pending');
      
      const tx = await castVote(proposalId, choice);
      await tx.wait();
      
      setTransactionStatus('success');
      setVoteChoice(choice);
      
      alert('Vote enregistré avec succès!');
    } catch (error) {
      console.error('Error casting vote:', error);
      setTransactionStatus('error');
      alert(`Erreur: ${error.message}`);
    }
  };

  const handleDelegate = async () => {
    if (!account || !signer) {
      alert('Veuillez connecter votre wallet');
      return;
    }

    if (!ethers.isAddress(delegateAddress)) {
      alert('Adresse invalide');
      return;
    }

    if (delegateAddress.toLowerCase() === account.toLowerCase()) {
      alert('Vous ne pouvez pas vous déléguer à vous-même');
      return;
    }

    try {
      setTransactionStatus('delegating');
      
      const tx = await delegateVote(delegateAddress);
      await tx.wait();
      
      setTransactionStatus('delegated');
      setIsDelegating(false);
      
      alert('Délégation réussie!');
    } catch (error) {
      console.error('Error delegating vote:', error);
      setTransactionStatus('error');
      alert(`Erreur: ${error.message}`);
    }
  };

  const calculateTimeRemaining = () => {
    if (!proposal) return null;

    const now = Math.floor(Date.now() / 1000);
    const endTime = Number(proposal.endTime);

    if (now >= endTime) {
      return 'Terminé';
    }

    const remaining = endTime - now;
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor((remaining % 86400) / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    return `${days}j ${hours}h ${minutes}m`;
  };

  const calculateQuorumProgress = () => {
    if (!proposal) return 0;

    const forVotes = parseFloat(ethers.formatUnits(proposal.forVotes, 18));
    const againstVotes = parseFloat(ethers.formatUnits(proposal.againstVotes, 18));
    const totalVotes = forVotes + againstVotes;
    const quorum = parseFloat(ethers.formatUnits(proposal.quorumVotes || 0, 18));

    if (quorum === 0) return 0;
    return Math.min(100, (totalVotes / quorum) * 100);
  };

  const VotingProgressBar = ({ forPercentage, againstPercentage, abstainPercentage }) => {
    return (
      <div className="voting-progress-bar">
        <div 
          className="progress-segment for" 
          style={{ width: `${forPercentage}%` }}
          title={`For: ${forPercentage.toFixed(1)}%`}
        >
          <span>For</span>
        </div>
        <div 
          className="progress-segment against" 
          style={{ width: `${againstPercentage}%` }}
          title={`Against: ${againstPercentage.toFixed(1)}%`}
        >
          <span>Against</span>
        </div>
        <div 
          className="progress-segment abstain" 
          style={{ width: `${abstainPercentage}%` }}
          title={`Abstain: ${abstainPercentage.toFixed(1)}%`}
        >
          <span>Abstain</span>
        </div>
      </div>
    );
  };

  if (loading && !proposal) {
    return (
      <div className="voting-loading">
        <div className="loading-spinner"></div>
        <p>Chargement de la proposal...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="voting-error">
        <div className="error-icon">⚠️</div>
        <h3>Erreur</h3>
        <p>{error.message}</p>
      </div>
    );
  }

  if (!proposal) {
    return (
      <div className="voting-not-found">
        <div className="not-found-icon">🔍</div>
        <h3>Proposal non trouvée</h3>
        <p>La proposal {proposalId} n'existe pas ou a été supprimée.</p>
      </div>
    );
  }

  // Calcul des pourcentages
  const totalVotes = parseFloat(ethers.formatUnits(proposal.forVotes + (proposal.againstVotes) + (proposal.abstainVotes), 18));
  const forPercentage = totalVotes > 0 ? (parseFloat(ethers.formatUnits(proposal.forVotes, 18)) / totalVotes) * 100 : 0;
  const againstPercentage = totalVotes > 0 ? (parseFloat(ethers.formatUnits(proposal.againstVotes, 18)) / totalVotes) * 100 : 0;
  const abstainPercentage = totalVotes > 0 ? (parseFloat(ethers.formatUnits(proposal.abstainVotes, 18)) / totalVotes) * 100 : 0;

  return (
    <div className="voting-interface">
      {/* En-tête de la proposal */}
      <div className="proposal-header">
        <div className="proposal-meta">
          <span className="proposal-id">Proposal #{proposalId}</span>
          <span className={`proposal-state state-${proposal.state}`}>
            {PROPOSAL_STATES[proposal.state]}
          </span>
        </div>
        <h1 className="proposal-title">{proposal.description}</h1>
        
        <div className="proposal-timeline">
          <div className="timeline-item">
            <div className="timeline-label">Début</div>
            <div className="timeline-value">
              {Number(formatTimestamp(proposal.startTime))}
            </div>
          </div>
          <div className="timeline-item">
            <div className="timeline-label">Fin</div>
            <div className="timeline-value">
              {Number(formatTimestamp(proposal.endTime))}
            </div>
          </div>
          <div className="timeline-item">
            <div className="timeline-label">Temps restant</div>
            <div className="timeline-value countdown">
              {calculateTimeRemaining()}
            </div>
          </div>
        </div>
      </div>

      {/* Statut du vote */}
      <div className="voting-status">
        <div className="status-card">
          <div className="status-label">Quorum Progress</div>
          <div className="progress-container">
            <div 
              className="progress-bar" 
              style={{ width: `${calculateQuorumProgress()}%` }}
            />
            <div className="progress-text">
              {calculateQuorumProgress().toFixed(1)}%
            </div>
          </div>
          <div className="status-note">
            Quorum requis: {formatCurrency(proposal.quorumVotes || BigInt(0))}
          </div>
        </div>

        <div className="status-card">
          <div className="status-label">Total Votes</div>
          <div className="status-value">
            {formatCurrency(
              proposal.forVotes + (proposal.againstVotes) + (proposal.abstainVotes)
            )}
          </div>
        </div>

        <div className="status-card">
          <div className="status-label">Voters</div>
          <div className="status-value">
            {proposal.voterCount ? Number(proposal.voterCount) : '--'}
          </div>
        </div>
      </div>

      {/* Résultats du vote */}
      <div className="voting-results">
        <h3>Résultats Actuels</h3>
        
        <VotingProgressBar 
          forPercentage={forPercentage}
          againstPercentage={againstPercentage}
          abstainPercentage={abstainPercentage}
        />

        <div className="results-breakdown">
          <div className="result-item for">
            <div className="result-label">
              <div className="result-color"></div>
              <span>For</span>
            </div>
            <div className="result-value">
              {formatCurrency(proposal.forVotes)} ({forPercentage.toFixed(1)}%)
            </div>
          </div>

          <div className="result-item against">
            <div className="result-label">
              <div className="result-color"></div>
              <span>Against</span>
            </div>
            <div className="result-value">
              {formatCurrency(proposal.againstVotes)} ({againstPercentage.toFixed(1)}%)
            </div>
          </div>

          <div className="result-item abstain">
            <div className="result-label">
              <div className="result-color"></div>
              <span>Abstain</span>
            </div>
            <div className="result-value">
              {formatCurrency(proposal.abstainVotes)} ({abstainPercentage.toFixed(1)}%)
            </div>
          </div>
        </div>
      </div>

      {/* Interface de vote */}
      {proposal.state === 1 && account && ( // 1 = Active
        <div className="vote-action-section">
          <div className="voting-power-card">
            <div className="power-label">Votre Voting Power</div>
            <div className="power-value">
              {formatCurrency(userVotingPower || BigInt(0))}
            </div>
            
            {!isDelegating ? (
              <button
                className="delegate-button"
                onClick={() => setIsDelegating(true)}
              >
                🏛️ Déléguer vos votes
              </button>
            ) : (
              <div className="delegate-form">
                <input
                  type="text"
                  value={delegateAddress}
                  onChange={(e) => setDelegateAddress(e.target.value)}
                  placeholder="0x..."
                  className="delegate-input"
                />
                <div className="delegate-actions">
                  <button
                    onClick={handleDelegate}
                    disabled={!delegateAddress || transactionStatus === 'delegating'}
                    className="delegate-submit"
                  >
                    {transactionStatus === 'delegating' ? 'Délégation...' : 'Confirmer'}
                  </button>
                  <button
                    onClick={() => setIsDelegating(false)}
                    className="delegate-cancel"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="vote-options">
            <h4>Votre Vote</h4>
            <p className="vote-instruction">
              Sélectionnez votre position et confirmez avec votre wallet
            </p>

            <div className="vote-buttons">
              <button
                className={`vote-button for ${voteChoice === 1 ? 'selected' : ''}`}
                onClick={() => handleVote(1)}
                disabled={transactionStatus === 'pending'}
              >
                <div className="vote-icon">✅</div>
                <div className="vote-content">
                  <div className="vote-title">For</div>
                  <div className="vote-weight">
                    Poids: {votingWeight} tokens
                  </div>
                </div>
                {transactionStatus === 'pending' && voteChoice === 1 && (
                  <div className="vote-loading"></div>
                )}
              </button>

              <button
                className={`vote-button against ${voteChoice === 0 ? 'selected' : ''}`}
                onClick={() => handleVote(0)}
                disabled={transactionStatus === 'pending'}
              >
                <div className="vote-icon">❌</div>
                <div className="vote-content">
                  <div className="vote-title">Against</div>
                  <div className="vote-weight">
                    Poids: {votingWeight} tokens
                  </div>
                </div>
                {transactionStatus === 'pending' && voteChoice === 0 && (
                  <div className="vote-loading"></div>
                )}
              </button>

              <button
                className={`vote-button abstain ${voteChoice === 2 ? 'selected' : ''}`}
                onClick={() => handleVote(2)}
                disabled={transactionStatus === 'pending'}
              >
                <div className="vote-icon">⚪</div>
                <div className="vote-content">
                  <div className="vote-title">Abstain</div>
                  <div className="vote-weight">
                    Poids: {votingWeight} tokens
                  </div>
                </div>
                {transactionStatus === 'pending' && voteChoice === 2 && (
                  <div className="vote-loading"></div>
                )}
              </button>
            </div>

            {transactionStatus === 'success' && (
              <div className="vote-success">
                <div className="success-icon">🎉</div>
                <div className="success-message">
                  Vote enregistré avec succès!
                </div>
              </div>
            )}

            <div className="vote-disclaimer">
              <div className="disclaimer-icon">⚠️</div>
              <p>
                Une fois voté, vous ne pouvez pas changer votre vote.
                Les votes sont soumis au timelock du protocole.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Détails de la proposal */}
      <div className="proposal-details">
        <h3>Détails de la Proposal</h3>
        
        <div className="details-grid">
          <div className="detail-item">
            <div className="detail-label">Proposer</div>
            <div className="detail-value">
              <a 
                href={`https://arbiscan.io/address/${proposal.proposer}`}
                target="_blank"
                rel="noopener noreferrer"
                className="address-link"
              >
                {`${proposal.proposer.slice(0, 6)}...${proposal.proposer.slice(-4)}`}
              </a>
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Calldata</div>
            <div className="detail-value">
              <button className="view-calldata">
                Voir les données d'exécution
              </button>
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Timelock Delay</div>
            <div className="detail-value">
              {proposal.timelockDelay ? `${proposal.timelockDelay / 86400} jours` : '--'}
            </div>
          </div>

          <div className="detail-item">
            <div className="detail-label">Exécution ETA</div>
            <div className="detail-value">
              {proposal.state === 4 ? // Succeeded
                Number(formatTimestamp(proposal.endTime) + (proposal.timelockDelay || 0))
                : '--'
              }
            </div>
          </div>
        </div>

        {/* Targets et valeurs */}
        {proposal.targets && proposal.targets.length > 0 && (
          <div className="proposal-actions">
            <h4>Actions à exécuter</h4>
            {proposal.targets.map((target, index) => (
              <div key={index} className="action-item">
                <div className="action-target">
                  Target {index + 1}:{' '}
                  <a 
                    href={`https://arbiscan.io/address/${target}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="address-link"
                  >
                    {`${target.slice(0, 8)}...${target.slice(-6)}`}
                  </a>
                </div>
                <div className="action-value">
                  Value: {formatCurrency(proposal.values?.[index] || BigInt(0))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Historique des votes (si disponible) */}
      {proposal.votes && proposal.votes.length > 0 && (
        <div className="vote-history">
          <h3>Historique des Votes</h3>
          <div className="history-table">
            <table>
              <thead>
                <tr>
                  <th>Voter</th>
                  <th>Choix</th>
                  <th>Voting Power</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {proposal.votes.slice(0, 10).map((vote, index) => (
                  <tr key={index}>
                    <td>
                      <a 
                        href={`https://arbiscan.io/address/${vote.voter}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="address-link"
                      >
                        {`${vote.voter.slice(0, 6)}...${vote.voter.slice(-4)}`}
                      </a>
                    </td>
                    <td>
                      <span className={`vote-tag ${
                        vote.support === 1 ? 'for' : 
                        vote.support === 0 ? 'against' : 'abstain'
                      }`}>
                        {vote.support === 1 ? 'For' : 
                         vote.support === 0 ? 'Against' : 'Abstain'}
                      </span>
                    </td>
                    <td>
                      {formatCurrency(vote.votes)}
                    </td>
                    <td>
                      {Number(formatTimestamp(vote.timestamp))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};