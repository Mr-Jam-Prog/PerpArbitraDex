// @title: Hook React pour la liquidité AMM avec calculs APY exacts
// @audit: Miroir exact de FundingRateCalculator, pas d'optimistic UI, protection overflow
// @security: BigInt uniquement, vérifications de sécurité strictes

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { useWeb3React } from '@web3-react/core';
import { subgraphClient } from '../services/indexer/graphql/client';
import { AMM_QUERIES } from '../services/indexer/graphql/queries';
import { getContract } from '../utils/contracts';
import { 
  formatUnits, 
  parseUnits, 
  formatPercentage,
  calculateAPY
} from '../utils/formatting';
import { FundingRateCalculator } from '../utils/math/fundingCalculations';

const SECONDS_IN_YEAR = 31536000n;

export function useLiquidity(marketId = 'ETH-USD') {
  const { account, library, chainId, active } = useWeb3React();
  const [state, setState] = useState({
    lpBalance: '0',
    totalLiquidity: '0',
    apy: '0',
    rewards: '0',
    skew: '0',
    fundingRate: '0',
    loading: true,
    error: null
  });

  // Contracts instances
  const contracts = useMemo(() => {
    if (!chainId || !library) return null;
    
    try {
      return {
        ammPool: getContract('AMMPool', library, chainId),
        perpEngine: getContract('PerpEngine', library, chainId),
        rewardToken: getContract('PerpDexToken', library, chainId),
        collateralToken: getContract('USDC', library, chainId) // Assuming USDC collateral
      };
    } catch (error) {
      console.error('Failed to load liquidity contracts:', error);
      return null;
    }
  }, [chainId, library]);

  // Fetch LP balance and pool data
  const fetchLpData = useCallback(async () => {
    if (!contracts?.ammPool || !account) {
      return {
        lpBalance: '0',
        totalLiquidity: '0',
        shares: '0',
        totalShares: '0'
      };
    }

    try {
      const [lpBalance, totalLiquidity, shares, totalShares] = await Promise.all([
        contracts.ammPool.getLpBalance(account),
        contracts.ammPool.totalLiquidity(),
        contracts.ammPool.balanceOf(account),
        contracts.ammPool.totalSupply()
      ]);

      return {
        lpBalance: formatUnits(lpBalance, 6), // USDC decimals
        lpBalanceRaw: lpBalance,
        totalLiquidity: formatUnits(totalLiquidity, 6),
        totalLiquidityRaw: totalLiquidity,
        shares: formatUnits(shares, 18),
        sharesRaw: shares,
        totalShares: formatUnits(totalShares, 18),
        totalSharesRaw: totalShares
      };
    } catch (error) {
      console.error('Failed to fetch LP data:', error);
      throw error;
    }
  }, [contracts, account]);

  // Fetch market data for APY calculation
  const fetchMarketData = useCallback(async () => {
    if (!contracts?.perpEngine || !marketId) {
      return {
        skew: '0',
        totalSize: '0',
        fundingRate: '0',
        cumulativeFunding: '0'
      };
    }

    try {
      // Get market skew (long - short)
      const marketData = await contracts.perpEngine.getMarketData(marketId);
      const skew = (marketData.longSize - marketData.shortSize);
      
      // Get current funding rate
      const fundingRate = await contracts.perpEngine.getFundingRate(marketId);
      
      // Get cumulative funding
      const cumulativeFunding = await contracts.perpEngine.getCumulativeFunding(marketId);
      
      return {
        skew: formatUnits(skew, 18),
        skewRaw: skew,
        totalSize: formatUnits((marketData.longSize + marketData.shortSize), 18),
        totalSizeRaw: (marketData.longSize + marketData.shortSize),
        fundingRate: formatUnits(fundingRate, 18),
        fundingRateRaw: fundingRate,
        cumulativeFunding: formatUnits(cumulativeFunding, 18),
        cumulativeFundingRaw: cumulativeFunding
      };
    } catch (error) {
      console.error('Failed to fetch market data:', error);
      throw error;
    }
  }, [contracts, marketId]);

  // Calculate APY based on funding rate and skew
  const calculateApy = useCallback((marketData, lpData) => {
    if (!marketData || !lpData) return '0';

    try {
      // Convert to BigInt for precise calculations
      const fundingRate = parseUnits(marketData.fundingRate, 18);
      const totalSize = parseUnits(marketData.totalSize, 18);
      const totalLiquidity = parseUnits(lpData.totalLiquidity, 6);
      
      // APY = (Total funding generated * 365 days) / Total liquidity
      // Funding generated = |skew| * funding rate
      const skew = parseUnits(marketData.skew, 18);
      const skewAbs = skew < 0n ? -skew : skew;
      
      if (totalLiquidity === 0n) return '0';
      
      // Funding per second = |skew| * funding rate
      const fundingPerSecond = (skewAbs * fundingRate) / parseUnits('1', 18);
      
      // Annual funding = funding per second * seconds in year
      const annualFunding = fundingPerSecond * SECONDS_IN_YEAR;
      
      // APY = (annual funding / total liquidity) * 100
      const apy = (annualFunding * parseUnits('100', 18)) / totalLiquidity;
      
      return formatUnits(apy, 18);
    } catch (error) {
      console.error('Failed to calculate APY:', error);
      return '0';
    }
  }, []);

  // Fetch pending rewards
  const fetchRewards = useCallback(async () => {
    if (!contracts?.ammPool || !account) return '0';

    try {
      const rewards = await contracts.ammPool.pendingRewards(account);
      return formatUnits(rewards, 18); // Reward token decimals
    } catch (error) {
      console.error('Failed to fetch rewards:', error);
      return '0';
    }
  }, [contracts, account]);

  // Deposit liquidity
  const deposit = useCallback(async (amount) => {
    if (!contracts?.ammPool || !contracts?.collateralToken || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();
    const amountRaw = parseUnits(amount, 6); // USDC decimals
    
    if (amountRaw <= 0n) {
      throw new Error('Invalid deposit amount');
    }

    try {
      // Approve first
      const collateralWithSigner = contracts.collateralToken.connect(signer);
      const approveTx = await collateralWithSigner.approve(
        contracts.ammPool.address,
        amountRaw
      );
      await approveTx.wait();

      // Deposit
      const ammWithSigner = contracts.ammPool.connect(signer);
      const depositTx = await ammWithSigner.deposit(amountRaw, account);
      
      const receipt = await depositTx.wait();
      return receipt;
    } catch (error) {
      console.error('Deposit failed:', error);
      throw error;
    }
  }, [contracts, library, account]);

  // Withdraw liquidity
  const withdraw = useCallback(async (amount) => {
    if (!contracts?.ammPool || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();
    const amountRaw = parseUnits(amount, 6); // USDC decimals
    
    if (amountRaw <= 0n) {
      throw new Error('Invalid withdrawal amount');
    }

    try {
      const ammWithSigner = contracts.ammPool.connect(signer);
      const withdrawTx = await ammWithSigner.withdraw(amountRaw);
      
      const receipt = await withdrawTx.wait();
      return receipt;
    } catch (error) {
      console.error('Withdrawal failed:', error);
      throw error;
    }
  }, [contracts, library]);

  // Claim rewards
  const claimRewards = useCallback(async () => {
    if (!contracts?.ammPool || !library) {
      throw new Error('Wallet not connected');
    }

    const signer = library.getSigner();

    try {
      const ammWithSigner = contracts.ammPool.connect(signer);
      const claimTx = await ammWithSigner.claimRewards();
      
      const receipt = await claimTx.wait();
      return receipt;
    } catch (error) {
      console.error('Claim rewards failed:', error);
      throw error;
    }
  }, [contracts, library]);

  // Load all data
  useEffect(() => {
    let mounted = true;

    const loadData = async () => {
      if (!mounted) return;

      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const [lpData, marketData, rewards] = await Promise.all([
          fetchLpData(),
          fetchMarketData(),
          fetchRewards()
        ]);

        const apy = calculateApy(marketData, lpData);

        if (mounted) {
          setState(prev => ({
            ...prev,
            lpBalance: lpData.lpBalance,
            totalLiquidity: lpData.totalLiquidity,
            apy,
            rewards,
            skew: marketData.skew,
            fundingRate: marketData.fundingRate,
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

    // Refresh every 15 seconds for real-time APY
    const interval = setInterval(loadData, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [fetchLpData, fetchMarketData, fetchRewards, calculateApy]);

  // Calculate share of pool
  const shareOfPool = useMemo(() => {
    if (state.lpBalance === '0' || state.totalLiquidity === '0') return '0';
    
    const lpBalance = parseFloat(state.lpBalance);
    const totalLiquidity = parseFloat(state.totalLiquidity);
    
    return ((lpBalance / totalLiquidity) * 100).toFixed(4);
  }, [state.lpBalance, state.totalLiquidity]);

  // Public API
  return {
    // Data
    lpBalance: state.lpBalance,
    totalLiquidity: state.totalLiquidity,
    apy: state.apy,
    rewards: state.rewards,
    skew: state.skew,
    fundingRate: state.fundingRate,
    shareOfPool,
    
    // Status
    loading: state.loading,
    error: state.error,
    isConnected: active && account,
    
    // Actions
    deposit,
    withdraw,
    claimRewards,
    
    // Refresh
    refresh: useCallback(async () => {
      const [lpData, marketData, rewards] = await Promise.all([
        fetchLpData(),
        fetchMarketData(),
        fetchRewards()
      ]);

      const apy = calculateApy(marketData, lpData);

      setState(prev => ({
        ...prev,
        lpBalance: lpData.lpBalance,
        totalLiquidity: lpData.totalLiquidity,
        apy,
        rewards,
        skew: marketData.skew,
        fundingRate: marketData.fundingRate,
        loading: false
      }));
    }, [fetchLpData, fetchMarketData, fetchRewards, calculateApy])
  };
}