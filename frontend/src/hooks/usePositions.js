// @title: Hook de Gestion des Positions avec Sync On-Chain + Indexer
// @features: Real-time updates, batch fetching, PnL calculation
// @security: Validation on-chain, fallback to indexer

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { usePerpDex } from './usePerpDex';
import { SUBGRAPH_URL } from '../services/indexer/graphql';
import { calculatePnL, calculateHealthFactor } from '../utils/calculations';
import { formatUSD } from '../utils/formatting';
import { toast } from 'react-toastify';

// GraphQL queries
const GET_POSITIONS_QUERY = `
  query GetPositions($owner: String!, $first: Int!, $skip: Int!) {
    positions(
      where: { owner: $owner, size_gt: 0 }
      first: $first
      skip: $skip
      orderBy: createdAt
      orderDirection: desc
    ) {
      id
      owner
      market {
        id
        name
        symbol
      }
      size
      collateral
      entryPrice
      isLong
      healthFactor
      createdAt
      lastFundingTime
      cumulativeFunding
      isLiquidated
    }
  }
`;

export const usePositions = () => {
  const { account, chainId, contracts, isReadOnly } = usePerpDex();
  
  const [positions, setPositions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  
  // Fetch positions from multiple sources
  const fetchPositions = useCallback(async (forceRefresh = false) => {
    if (!account || !chainId) {
      setPositions([]);
      return;
    }
    
    // Don't refresh too often (5 second cooldown)
    if (!forceRefresh && lastUpdated && Date.now() - lastUpdated < 5000) {
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      let positionsData = [];
      
      // Try Subgraph first (faster, but may be delayed)
      try {
        const subgraphPositions = await fetchFromSubgraph(account);
        positionsData = subgraphPositions;
      } catch (subgraphError) {
        console.warn('Subgraph fetch failed, trying on-chain:', subgraphError);
      }
      
      // If no positions from subgraph or we want to verify, check on-chain
      if (positionsData.length === 0 || forceRefresh) {
        const onChainPositions = await fetchFromOnChain(account);
        
        // Merge and deduplicate
        const merged = mergePositions(positionsData, onChainPositions);
        positionsData = merged;
      }
      
      // Enrich with current prices and PnL
      const enrichedPositions = await enrichPositions(positionsData);
      
      setPositions(enrichedPositions);
      setLastUpdated(Date.now());
      
    } catch (err) {
      console.error('Failed to fetch positions:', err);
      setError(err.message);
      toast.error('Failed to load positions');
    } finally {
      setIsLoading(false);
    }
  }, [account, chainId, contracts, lastUpdated]);
  
  // Fetch from Subgraph
  const fetchFromSubgraph = async (ownerAddress) => {
    const query = {
      query: GET_POSITIONS_QUERY,
      variables: {
        owner: ownerAddress.toLowerCase(),
        first: 100,
        skip: 0
      }
    };
    
    const response = await fetch(SUBGRAPH_URL[chainId], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query)
    });
    
    const { data, errors } = await response.json();
    
    if (errors) {
      throw new Error(`GraphQL errors: ${errors.map(e => e.message).join(', ')}`);
    }
    
    return data?.positions || [];
  };
  
  // Fetch from on-chain
  const fetchFromOnChain = async (ownerAddress) => {
    if (!contracts.positionManager || !contracts.perpEngine) {
      return [];
    }
    
    const positions = [];
    
    try {
      // Get total positions for this owner
      const balance = await contracts.positionManager.balanceOf(ownerAddress);
      
      // Fetch each position
      for (let i = 0; i < balance.toNumber(); i++) {
        try {
          const tokenId = await contracts.positionManager.tokenOfOwnerByIndex(ownerAddress, i);
          const positionData = await contracts.perpEngine.getPosition(tokenId);
          
          // Skip if size is 0 (closed position)
          if (positionData.size.eq(0)) continue;
          
          // Get position details
          const positionDetails = {
            id: tokenId.toString(),
            owner: ownerAddress,
            size: parseFloat(ethers.utils.formatUnits(positionData.size, 18)),
            collateral: parseFloat(ethers.utils.formatUnits(positionData.collateral, 6)),
            entryPrice: parseFloat(ethers.utils.formatUnits(positionData.entryPrice, 8)),
            isLong: positionData.isLong,
            healthFactor: parseFloat(ethers.utils.formatUnits(positionData.healthFactor, 18)),
            createdAt: positionData.createdAt.toNumber(),
            lastFundingTime: positionData.lastFundingTime.toNumber(),
            isLiquidated: positionData.isLiquidated
          };
          
          positions.push(positionDetails);
        } catch (positionError) {
          console.warn(`Failed to fetch position ${i}:`, positionError);
        }
      }
    } catch (err) {
      console.error('On-chain fetch failed:', err);
      throw err;
    }
    
    return positions;
  };
  
  // Merge positions from different sources
  const mergePositions = (subgraphPositions, onChainPositions) => {
    const merged = [...onChainPositions];
    
    // Add any positions from subgraph that aren't in on-chain
    subgraphPositions.forEach(subPos => {
      const exists = merged.some(onChainPos => onChainPos.id === subPos.id);
      if (!exists) {
        merged.push(subPos);
      }
    });
    
    return merged;
  };
  
  // Enrich positions with current data
  const enrichPositions = async (positions) => {
    if (!contracts.oracleAggregator) return positions;
    
    return Promise.all(positions.map(async (position) => {
      try {
        // Get current price
        const priceData = await contracts.oracleAggregator.getPrice(position.market.id);
        const currentPrice = parseFloat(ethers.utils.formatUnits(priceData, 8));
        
        // Calculate PnL
        const pnl = calculatePnL(
          position.size,
          position.entryPrice,
          currentPrice,
          position.isLong
        );
        
        // Calculate health factor
        const healthFactor = calculateHealthFactor(
          position.collateral,
          position.size,
          currentPrice,
          position.isLong
        );
        
        // Calculate liquidation price (simplified)
        const maintenanceMargin = 0.08; // 8%
        const liquidationPrice = position.isLong
          ? position.entryPrice * (1 - maintenanceMargin / position.leverage)
          : position.entryPrice * (1 + maintenanceMargin / position.leverage);
        
        // Determine status
        let status = 'active';
        if (position.isLiquidated) {
          status = 'liquidated';
        } else if (healthFactor < 1.05) {
          status = 'danger';
        } else if (healthFactor < 1.2) {
          status = 'warning';
        }
        
        return {
          ...position,
          currentPrice,
          pnl,
          pnlPercentage: (pnl / position.collateral) * 100,
          healthFactor,
          liquidationPrice,
          status,
          market: position.market || {
            id: 'unknown',
            name: 'Unknown Market',
            symbol: 'UNKNOWN'
          }
        };
      } catch (err) {
        console.error(`Failed to enrich position ${position.id}:`, err);
        return position;
      }
    }));
  };
  
  // Open a new position
  const openPosition = useCallback(async (marketId, collateral, size, isLong) => {
    if (!contracts.perpEngine || isReadOnly) {
      throw new Error('Cannot open position: no signer or read-only mode');
    }
    
    try {
      const collateralInWei = ethers.utils.parseUnits(collateral.toString(), 6);
      const sizeInWei = ethers.utils.parseUnits(size.toString(), 18);
      
      const tx = await contracts.perpEngine.openPosition(
        marketId,
        collateralInWei,
        sizeInWei,
        isLong,
        { gasLimit: 1000000 }
      );
      
      toast.info('Opening position...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        toast.success('Position opened successfully');
        await fetchPositions(true); // Force refresh
        return receipt;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (err) {
      console.error('Failed to open position:', err);
      throw err;
    }
  }, [contracts.perpEngine, isReadOnly, fetchPositions]);
  
  // Close a position
  const closePosition = useCallback(async (positionId) => {
    if (!contracts.perpEngine || isReadOnly) {
      throw new Error('Cannot close position: no signer or read-only mode');
    }
    
    try {
      const tx = await contracts.perpEngine.closePosition(
        positionId,
        { gasLimit: 500000 }
      );
      
      toast.info('Closing position...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        toast.success('Position closed successfully');
        await fetchPositions(true); // Force refresh
        return receipt;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (err) {
      console.error('Failed to close position:', err);
      throw err;
    }
  }, [contracts.perpEngine, isReadOnly, fetchPositions]);
  
  // Add collateral to position
  const addCollateral = useCallback(async (positionId, amount) => {
    if (!contracts.perpEngine || isReadOnly) {
      throw new Error('Cannot add collateral: no signer or read-only mode');
    }
    
    try {
      const amountInWei = ethers.utils.parseUnits(amount.toString(), 6);
      
      const tx = await contracts.perpEngine.addCollateral(
        positionId,
        amountInWei,
        { gasLimit: 300000 }
      );
      
      toast.info('Adding collateral...');
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        toast.success('Collateral added successfully');
        await fetchPositions(true);
        return receipt;
      } else {
        throw new Error('Transaction failed');
      }
    } catch (err) {
      console.error('Failed to add collateral:', err);
      throw err;
    }
  }, [contracts.perpEngine, isReadOnly, fetchPositions]);
  
  // Refresh positions
  const refreshPositions = useCallback(() => {
    return fetchPositions(true);
  }, [fetchPositions]);
  
  // Auto-refresh positions periodically
  useEffect(() => {
    if (!account) return;
    
    fetchPositions();
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      fetchPositions();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [account, fetchPositions]);
  
  // Calculate portfolio totals
  const portfolioTotals = useCallback(() => {
    const totals = {
      totalCollateral: 0,
      totalPnl: 0,
      totalValue: 0,
      activePositions: 0,
      liquidatedPositions: 0
    };
    
    positions.forEach(position => {
      if (position.isLiquidated) {
        totals.liquidatedPositions++;
        return;
      }
      
      totals.activePositions++;
      totals.totalCollateral += position.collateral;
      totals.totalPnl += position.pnl;
      totals.totalValue += position.collateral + position.pnl;
    });
    
    return totals;
  }, [positions]);
  
  return {
    // Data
    positions,
    isLoading,
    error,
    lastUpdated,
    
    // Portfolio summary
    portfolio: portfolioTotals(),
    
    // Actions
    openPosition,
    closePosition,
    addCollateral,
    refreshPositions,
    fetchPositions,
    
    // Status
    hasPositions: positions.length > 0,
    activePositions: positions.filter(p => !p.isLiquidated).length,
  };
};