import React, { useState } from 'react';
import { formatUnits } from 'ethers';
import { useGovernance } from '../../hooks/useGovernance';
import { formatTimestamp } from '../../utils/formatting';

export const VotingInterface = ({ proposal }) => {
  const { castVote, isVoting } = useGovernance();
  const [reason, setReason] = useState('');

  const handleVote = async (support) => {
    try {
      await castVote(proposal.id, support, reason);
    } catch (error) {
      console.error('❌ Vote failed:', error);
    }
  };

  if (!proposal) return null;

  return (
    <div className="voting-container p-6 bg-slate-900 rounded-xl border border-slate-800">
      <div className="proposal-header mb-6">
        <span className="status-badge px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
          {proposal.status}
        </span>
        <h2 className="text-2xl font-bold mt-3 text-white">{proposal.title}</h2>
        <p className="text-slate-400 mt-2">{proposal.description}</p>
      </div>

      <div className="votes-stats grid grid-cols-2 gap-4 mb-6">
        <div className="stat-card p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <div className="label text-sm text-slate-400 mb-1">Pour</div>
          <div className="value text-xl font-bold text-green-400">
            {formatUnits(proposal.forVotes || 0n, 18)} PRPB
          </div>
        </div>
        <div className="stat-card p-4 bg-slate-800/50 rounded-lg border border-slate-700">
          <div className="label text-sm text-slate-400 mb-1">Contre</div>
          <div className="value text-xl font-bold text-red-400">
            {formatUnits(proposal.againstVotes || 0n, 18)} PRPB
          </div>
        </div>
      </div>

      <div className="proposal-timeline mb-8 border-l-2 border-slate-800 pl-4 space-y-4">
        <div className="timeline-item">
          <div className="timeline-label text-sm text-slate-500">Début</div>
          <div className="timeline-value text-slate-300 font-medium">
            {formatTimestamp(proposal.startTime)}
          </div>
        </div>
        <div className="timeline-item">
          <div className="timeline-label text-sm text-slate-500">Fin</div>
          <div className="timeline-value text-slate-300 font-medium">
            {formatTimestamp(proposal.endTime)}
          </div>
        </div>
        {proposal.status === 'Succeeded' && (
          <div className="timeline-item">
            <div className="timeline-label text-sm text-slate-500">Exécution possible le</div>
            <div className="timeline-value text-blue-400 font-medium">
              {formatTimestamp(Number(proposal.endTime) + (proposal.timelockDelay || 0))}
            </div>
          </div>
        )}
      </div>

      <div className="vote-actions space-y-4">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Raison de votre vote (optionnel)"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-white focus:outline-none focus:border-blue-500"
          rows={3}
        />
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => handleVote(1)}
            disabled={isVoting || proposal.status !== 'Active'}
            className="btn-vote-for py-3 bg-green-600 hover:bg-green-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg font-bold transition-colors text-white"
          >
            {isVoting ? 'Vote...' : 'Voter POUR'}
          </button>
          <button
            onClick={() => handleVote(0)}
            disabled={isVoting || proposal.status !== 'Active'}
            className="btn-vote-against py-3 bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 rounded-lg font-bold transition-colors text-white"
          >
            {isVoting ? 'Vote...' : 'Voter CONTRE'}
          </button>
        </div>
      </div>

      {proposal.recentVotes?.length > 0 && (
        <div className="recent-votes mt-8">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Votes Récents</h3>
          <div className="space-y-3">
            {proposal.recentVotes.map((vote, i) => (
              <div key={i} className="flex justify-between items-center text-sm p-2 rounded bg-slate-800/30">
                <span className="text-slate-300 font-mono">{vote.voter.slice(0, 6)}...{vote.voter.slice(-4)}</span>
                <span className={vote.support ? 'text-green-400' : 'text-red-400'}>
                  {vote.support ? 'POUR' : 'CONTRE'} ({formatUnits(vote.weight, 18)} PRPB)
                </span>
                <span className="text-slate-600 text-xs">{formatTimestamp(vote.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
