// @title: Hook React pour la gouvernance avec timelock et veToken
// @audit: Lecture subgraph prioritaire, fallback RPC, multi-chain support
// @security: Read-only safe, no transactions without wallet

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useWeb3React } from '@web3-react/core';
import { subgraphClient } from '../services/indexer/graphql/client';
import { GOVERNANCE_QUERIES } from '../services/indexer/graphql/queries';
import { getContract } from '../utils/contracts';
import { formatUnits, parseUnits } from '../utils/formatting';

const PROPOSAL_STATES = {
  0: 'PENDING',
  1: 'ACTIVE',
  2: 'CANCELED',
  3: 'DEFEATED',
  4: 'SUCCEEDED',
  5: 'QUEUED',
  6: 'EXPIRED',
  7: 'EXECUTED'
};

export function useGovernance() {
  const { account, library, chainId, active } = useWeb3React();
  const [state, setState] = useState({
    proposals: [],
    votingPower: {
      token: '0',
      veToken: '0',
      total: '0'
    },
    loading: true,
    error: null,
    subgraphAvailable: true
  });

  // Contracts instances
  const contracts = useMemo(() => {
    if (!chainId || !library) return null;
    
    try {
      return {
        token: getContract('PerpDexToken', library, chainId),
        governor: getContract('Governor', library, chainId),
        timelock: getContract('TimelockController', library, chainId),
        votingEscrow: getContract('VotingEscrow', library, chainId)
      };
    } catch (error) {
      console.error('Failed to load governance contracts:', error);
      return null;
    }
  }, [chainId, library]);

  // Fetch proposals from subgraph with fallback
  const fetchProposals = useCallback(async () => {
    try {
      // Try subgraph first
      const subgraphData = await subgraphClient.query({
        query: GOVERNANCE_QUERIES.GET_PROPOSALS,
        variables: { first: 100, skip: 0 }
      });

      if (subgraphData?.data?.proposals) {
        return subgraphData.data.proposals.map(proposal => ({
          id: proposal.id,
          proposer: proposal.proposer,
          description: proposal.description,
          startBlock: parseInt(proposal.startBlock),
          endBlock: parseInt(proposal.endBlock),
          forVotes: proposal.forVotes,
          againstVotes: proposal.againstVotes,
          abstainVotes: proposal.abstainVotes,
          state: PROPOSAL_STATES[proposal.state] || 'UNKNOWN',
          eta: proposal.eta ? parseInt(proposal.eta) : null,
          targets: proposal.targets || [],
          values: proposal.values || [],
          signatures: proposal.signatures || [],
          calldatas: proposal.calldatas || []
        }));
      }
    } catch (error) {
      console.warn('Subgraph unavailable, falling back to RPC:', error);
      setState(prev => ({ ...prev, subgraphAvailable: false }));
    }

    // Fallback to RPC
    if (!contracts?.governor) return [];

    try {
      const proposalCount = await contracts.governor.proposalCount();
      const proposals = [];

      for (let i = 0; i < Math.min(proposalCount.toNumber(), 100); i++) {
        const proposalId = await contracts.governor.proposalIds(i);
        const proposal = await contracts.governor.proposals(proposalId);
        const state = await contracts.governor.state(proposalId);

        proposals.push({
          id: proposalId.toString(),
          proposer: proposal.proposer,
          description: proposal.description,
          startBlock: proposal.startBlock.toNumber(),
          endBlock: proposal.endBlock.toNumber(),
          forVotes: formatUnits(proposal.forVotes, 18),
          againstVotes: formatUnits(proposal.againstVotes, 18),
          abstainVotes: formatUnits(proposal.abstainVotes, 18),
          state: PROPOSAL_STATES[state],
          eta: proposal.eta.toNumber(),
          targets: [],
          values: [],
          signatures: [],
          calldatas: []
        });
      }

      return proposals;
    } catch (error) {
      console.error('Failed to fetch proposals from RPC:', error);
      return [];
    }
  }, [contracts]);

  // Calculate voting power (token + veToken)
  const fetchVotingPower = useCallback(async (address) => {
    if (!contracts?.token || !contracts?.votingEscrow || !address) {
      return { token: '0', veToken: '0', total: '0' };
    }

    try {
      // ERC-20 voting power
      const tokenBalance = await contracts.token.balanceOf(address);
      const tokenVotes = await contracts.token.getVotes(address);
      
      // veToken voting power (time-weighted)
      const veBalance = await contracts.votingEscrow.balanceOf(address);
      const veTotalSupply = await contracts.votingEscrow.totalSupply();
      
      // Total voting power = token votes + veToken balance
      const total = tokenVotes + (veBalance);
      
      return {
        token: formatUnits(tokenVotes, 18),
        veToken: formatUnits(veBalance, 18),
        total: formatUnits(total, 18),
        tokenRaw: tokenVotes,
        veTokenRaw: veBalance,
        tokenBalance: formatUnits(tokenBalance, 18)
      };
    } catch (error) {
      console.error('Failed to fetch voting power:', error);
      return { token: '0', veToken: '0', total: '0' };
    }
  }, [contracts]);

  // Check if user has voted on a proposal
  const hasVoted = useCallback(async (proposalId) => {
    if (!contracts?.governor || !account) return false;

    try {
      const receipt = await contracts.governor.getReceipt(proposalId, account);
      return receipt.hasVoted;
    } catch (error) {
      console.error('Failed to check vote:', error);
      return false;
    }
  }, [contracts, account]);

  // Submit a vote
  const vote = useCallback(async (proposalId, support, reason = '') => {
    if (!contracts?.governor || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();
    const governorWithSigner = contracts.governor.connect(signer);

    try {
      const tx = await governorWithSigner.castVoteWithReason(
        proposalId,
        support,
        reason
      );

      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Failed to cast vote:', error);
      throw error;
    }
  }, [contracts, library]);

  // Queue a succeeded proposal
  const queueProposal = useCallback(async (proposalId) => {
    if (!contracts?.governor || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();
    const governorWithSigner = contracts.governor.connect(signer);

    try {
      // Get proposal data
      const proposal = await contracts.governor.proposals(proposalId);
      
      const tx = await governorWithSigner.queue(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        ethers.keccak256(ethers.utils.toUtf8Bytes(proposal.description))
      );

      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Failed to queue proposal:', error);
      throw error;
    }
  }, [contracts, library]);

  // Execute a queued proposal
  const executeProposal = useCallback(async (proposalId) => {
    if (!contracts?.governor || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();
    const governorWithSigner = contracts.governor.connect(signer);

    try {
      // Get proposal data
      const proposal = await contracts.governor.proposals(proposalId);
      
      const tx = await governorWithSigner.execute(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        ethers.keccak256(ethers.utils.toUtf8Bytes(proposal.description))
      );

      const receipt = await tx.wait();
      return receipt;
    } catch (error) {
      console.error('Failed to execute proposal:', error);
      throw error;
    }
  }, [contracts, library]);

  // Calculate time until execution (timelock)
  const getTimeUntilExecution = useCallback((eta) => {
    if (!eta) return null;
    
    const now = Math.floor(Date.now() / 1000);
    if (eta <= now) return { ready: true, seconds: 0 };
    
    return {
      ready: false,
      seconds: eta - now,
      days: Math.floor((eta - now) / 86400),
      hours: Math.floor(((eta - now) % 86400) / 3600),
      minutes: Math.floor(((eta - now) % 3600) / 60)
    };
  }, []);

  // Load all data
  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!mounted) return;

      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const [proposals, votingPower] = await Promise.all([
          fetchProposals(),
          account ? fetchVotingPower(account) : Promise.resolve({ token: '0', veToken: '0', total: '0' })
        ]);

        if (mounted) {
          setState(prev => ({
            ...prev,
            proposals,
            votingPower,
            loading: false
          }));
        }
      } catch (error) {
        if (mounted) {
          setState(prev => ({
            ...prev,
            error: error.message,
            loading: false
          }));
        }
      }
    };

    loadData();

    // Refresh every 30 seconds for active proposals
    const interval = setInterval(loadData, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchProposals, fetchVotingPower, account]);

  // Public API
  return {
    // Data
    proposals: state.proposals,
    votingPower: state.votingPower,
    
    // Status
    loading: state.loading,
    error: state.error,
    subgraphAvailable: state.subgraphAvailable,
    isConnected: active && account,
    
    // Actions
    vote,
    queueProposal,
    executeProposal,
    
    // Queries
    hasVoted: useCallback((proposalId) => hasVoted(proposalId), [hasVoted]),
    getTimeUntilExecution,
    
    // Refresh
    refresh: useCallback(async () => {
      const [proposals, votingPower] = await Promise.all([
        fetchProposals(),
        account ? fetchVotingPower(account) : Promise.resolve({ token: '0', veToken: '0', total: '0' })
      ]);
      
      setState(prev => ({
        ...prev,
        proposals,
        votingPower,
        loading: false
      }));
    }, [fetchProposals, fetchVotingPower, account])
  };
}