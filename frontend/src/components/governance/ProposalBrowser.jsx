// @title: Navigateur de propositions avec filtres et recherche
// @data: Subgraph TheGraph pour performances
// @features: Filtrage par statut, recherche, tri

import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { useGovernance } from '../../hooks';
import { formatTimestamp, formatCurrency } from '../../utils';
import { VotingInterface } from './VotingInterface';

export const ProposalBrowser = () => {
  const { proposals, loading, error, fetchProposals } = useGovernance();
  
  const [filter, setFilter] = useState('all'); // all, active, pending, executed
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchProposals();
  }, []);

  // Filtrage et tri
  const filteredProposals = proposals
    .filter(proposal => {
      // Filtre par statut
      if (filter !== 'all') {
        const stateMap = {
          'active': 1,
          'pending': 0,
          'executed': 7,
          'defeated': 3,
          'succeeded': 4
        };
        return proposal.state === stateMap[filter];
      }
      return true;
    })
    .filter(proposal => {
      // Recherche
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        proposal.description.toLowerCase().includes(query) ||
        proposal.proposer.toLowerCase().includes(query) ||
        proposal.id.toString().includes(query)
      );
    })
    .sort((a, b) => {
      // Tri
      switch (sortBy) {
        case 'newest':
          return Number(b.startTime) - Number(a.startTime);
        case 'oldest':
          return Number(a.startTime) - Number(b.startTime);
        case 'votes-high':
          return Number((b.forVotes + b.againstVotes)) - Number((a.forVotes + a.againstVotes));
        case 'votes-low':
          return Number((a.forVotes + a.againstVotes)) - Number((b.forVotes + b.againstVotes));
        default:
          return 0;
      }
    });

  // Pagination
  const totalPages = Math.ceil(filteredProposals.length / itemsPerPage);
  const paginatedProposals = filteredProposals.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getProposalStatus = (state) => {
    const statusMap = {
      0: { label: 'Pending', color: 'gray' },
      1: { label: 'Active', color: 'blue' },
      2: { label: 'Canceled', color: 'red' },
      3: { label: 'Defeated', color: 'red' },
      4: { label: 'Succeeded', color: 'green' },
      5: { label: 'Queued', color: 'yellow' },
      6: { label: 'Expired', color: 'gray' },
      7: { label: 'Executed', color: 'purple' }
    };
    return statusMap[state] || { label: 'Unknown', color: 'gray' };
  };

  const handleProposalSelect = (proposalId) => {
    setSelectedProposal(proposalId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const ProposalCard = ({ proposal }) => {
    const status = getProposalStatus(proposal.state);
    const totalVotes = (proposal.forVotes + proposal.againstVotes).add(proposal.abstainVotes);
    const forPercentage = totalVotes.gt(0) 
      ? Number((proposal.forVotes * 100).div(totalVotes))
      : 0;

    return (
      <div 
        className={`proposal-card ${proposal.state === 1 ? 'active' : ''}`}
        onClick={() => handleProposalSelect(proposal.id)}
      >
        <div className="proposal-card-header">
          <div className="proposal-id">#{proposal.id}</div>
          <div className={`proposal-status status-${status.color}`}>
            {status.label}
          </div>
        </div>

        <div className="proposal-title">
          {proposal.description.length > 100
            ? `${proposal.description.substring(0, 100)}...`
            : proposal.description
          }
        </div>

        <div className="proposal-meta">
          <div className="meta-item">
            <div className="meta-label">Proposer</div>
            <div className="meta-value">
              {`${proposal.proposer.slice(0, 6)}...${proposal.proposer.slice(-4)}`}
            </div>
          </div>

          <div className="meta-item">
            <div className="meta-label">Start</div>
            <div className="meta-value">
              {Number(formatTimestamp(proposal.startTime), 'short')}
            </div>
          </div>

          <div className="meta-item">
            <div className="meta-label">End</div>
            <div className="meta-value">
              {Number(formatTimestamp(proposal.endTime), 'short')}
            </div>
          </div>
        </div>

        <div className="proposal-votes">
          <div className="votes-progress">
            <div 
              className="votes-bar" 
              style={{ width: `${forPercentage}%` }}
            />
            <div className="votes-labels">
              <span className="votes-for">{forPercentage}% For</span>
              <span className="votes-total">
                {formatCurrency(totalVotes)} total
              </span>
            </div>
          </div>
        </div>

        <div className="proposal-actions">
          <button className="view-button">
            {proposal.state === 1 ? 'Voter' : 'Voir détails'}
          </button>
        </div>
      </div>
    );
  };

  if (loading && !proposals.length) {
    return (
      <div className="proposals-loading">
        <div className="loading-spinner"></div>
        <p>Chargement des propositions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="proposals-error">
        <div className="error-icon">⚠️</div>
        <h3>Erreur de chargement</h3>
        <p>{error.message}</p>
        <button onClick={fetchProposals}>Réessayer</button>
      </div>
    );
  }

  return (
    <div className="proposal-browser">
      {/* Vue détaillée d'une proposition */}
      {selectedProposal ? (
        <div className="proposal-detail-view">
          <div className="detail-header">
            <button 
              className="back-button"
              onClick={() => setSelectedProposal(null)}
            >
              ← Retour à la liste
            </button>
            <h2>Proposal #{selectedProposal}</h2>
          </div>
          <VotingInterface proposalId={selectedProposal} />
        </div>
      ) : (
        /* Liste des propositions */
        <>
          {/* Barre de contrôle */}
          <div className="browser-controls">
            <div className="controls-left">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Rechercher une proposition..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                <div className="search-icon">🔍</div>
              </div>

              <div className="filter-buttons">
                {[
                  { key: 'all', label: 'Toutes' },
                  { key: 'active', label: 'Actives' },
                  { key: 'pending', label: 'En attente' },
                  { key: 'succeeded', label: 'Approuvées' },
                  { key: 'executed', label: 'Exécutées' }
                ].map(filterOption => (
                  <button
                    key={filterOption.key}
                    className={`filter-button ${filter === filterOption.key ? 'active' : ''}`}
                    onClick={() => setFilter(filterOption.key)}
                  >
                    {filterOption.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="controls-right">
              <div className="sort-select">
                <label htmlFor="sort">Trier par:</label>
                <select
                  id="sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="sort-dropdown"
                >
                  <option value="newest">Plus récentes</option>
                  <option value="oldest">Plus anciennes</option>
                  <option value="votes-high">Votes (haut)</option>
                  <option value="votes-low">Votes (bas)</option>
                </select>
              </div>

              <div className="stats">
                <span className="stats-label">
                  {filteredProposals.length} proposition(s)
                </span>
              </div>
            </div>
          </div>

          {/* Grille de propositions */}
          {filteredProposals.length === 0 ? (
            <div className="no-proposals">
              <div className="no-data-icon">📋</div>
              <h3>Aucune proposition trouvée</h3>
              <p>
                {searchQuery 
                  ? 'Aucune proposition ne correspond à votre recherche.'
                  : 'Aucune proposition disponible pour le moment.'
                }
              </p>
              {searchQuery && (
                <button 
                  className="clear-search"
                  onClick={() => setSearchQuery('')}
                >
                  Effacer la recherche
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="proposals-grid">
                {paginatedProposals.map(proposal => (
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                  >
                    ← Précédent
                  </button>

                  <div className="page-numbers">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum;
                      if (totalPages <= 5) {
                        pageNum = i + 1;
                      } else if (currentPage <= 3) {
                        pageNum = i + 1;
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                      } else {
                        pageNum = currentPage - 2 + i;
                      }

                      return (
                        <button
                          key={pageNum}
                          className={`page-number ${currentPage === pageNum ? 'active' : ''}`}
                          onClick={() => setCurrentPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    className="pagination-button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Suivant →
                  </button>
                </div>
              )}
            </>
          )}

          {/* Aide et informations */}
          <div className="browser-help">
            <div className="help-card">
              <div className="help-icon">❓</div>
              <div className="help-content">
                <h4>Comment fonctionne la gouvernance ?</h4>
                <p>
                  Les détenteurs de tokens PERP peuvent voter sur les propositions.
                  Chaque token = 1 vote. Les propositions actives peuvent être votées.
                  Une fois approuvée, une proposition passe par un timelock avant exécution.
                </p>
              </div>
            </div>

            <div className="help-card">
              <div className="help-icon">🏛️</div>
              <div className="help-content">
                <h4>Créer une proposition</h4>
                <p>
                  Pour créer une proposition, vous devez détenir au moins 100,000 PERP.
                  Utilisez l'interface de création de proposition pour soumettre votre idée.
                </p>
                <button className="create-proposal-button">
                  Créer une proposition
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};