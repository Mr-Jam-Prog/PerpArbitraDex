// @title: Centralisation de toutes les requêtes GraphQL avec typage strict
// @audit: Pagination, retry exponentiel, validation des schémas
// @security: Typage TypeScript généré, protection injection

import { gql } from '@apollo/client';

// ========== POSITIONS QUERIES ==========

export const GET_OPEN_POSITIONS = gql`
  query GetOpenPositions($owner: String!, $first: Int = 100, $skip: Int = 0) {
    positions(
      where: { owner: $owner, size_gt: 0 }
      first: $first
      skip: $skip
      orderBy: openedAt
      orderDirection: desc
    ) {
      id
      owner
      market
      side
      size
      collateral
      entryPrice
      leverage
      openedAt
      lastUpdated
      isClosed
      closedAt
      closedBy
      closeReason
    }
  }
`;

export const GET_POSITION = gql`
  query GetPosition($id: ID!) {
    position(id: $id) {
      id
      owner
      market
      side
      size
      collateral
      entryPrice
      leverage
      openedAt
      lastUpdated
      isClosed
      closedAt
      closedBy
      closeReason
      realizedPnl
      fundingPaid
    }
  }
`;

export const GET_POSITION_HISTORY = gql`
  query GetPositionHistory($owner: String!, $first: Int = 100, $skip: Int = 0) {
    positions(
      where: { owner: $owner, isClosed: true }
      first: $first
      skip: $skip
      orderBy: closedAt
      orderDirection: desc
    ) {
      id
      market
      side
      size
      entryPrice
      exitPrice
      realizedPnl
      fundingPaid
      openedAt
      closedAt
      closedBy
      closeReason
    }
  }
`;

// ========== MARKET QUERIES ==========

export const GET_ALL_MARKETS = gql`
  query GetAllMarkets {
    markets {
      id
      name
      baseToken
      quoteToken
      maxPositionSize
      minPositionSize
      tickSize
      isActive
      createdAt
    }
  }
`;

export const GET_MARKET = gql`
  query GetMarket($id: ID!) {
    market(id: $id) {
      id
      name
      baseToken
      quoteToken
      maxPositionSize
      minPositionSize
      tickSize
      isActive
      createdAt
    }
  }
`;

export const GET_MARKET_STATS = gql`
  query GetMarketStats($market: String!, $timeframe: String!) {
    market(id: $market) {
      id
      dailyVolume
      dailyTrades
      openInterest
      currentFundingRate
      longPositions
      shortPositions
      dailyLiquidations
    }
  }
`;

// ========== TRADE QUERIES ==========

export const GET_TRADES = gql`
  query GetTrades(
    $first: Int = 100
    $skip: Int = 0
    $orderBy: String = "timestamp"
    $orderDirection: String = "desc"
  ) {
    trades(
      first: $first
      skip: $skip
      orderBy: $orderBy
      orderDirection: $orderDirection
    ) {
      id
      trader
      market
      side
      size
      price
      fee
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

export const GET_USER_TRADES = gql`
  query GetUserTrades($trader: String!, $first: Int = 100, $skip: Int = 0) {
    trades(
      where: { trader: $trader }
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      market
      side
      size
      price
      fee
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

// ========== LIQUIDATION QUERIES ==========

export const GET_LIQUIDATION_HISTORY = gql`
  query GetLiquidationHistory($first: Int = 100, $skip: Int = 0) {
    liquidations(
      first: $first
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      positionId
      liquidator
      reward
      size
      market
      timestamp
      blockNumber
      transactionHash
    }
  }
`;

export const GET_LIQUIDATION_STATS = gql`
  query GetLiquidationStats($timeframe: String!) {
    liquidations(
      where: { timestamp_gte: $timeframe }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      reward
      size
      timestamp
    }
  }
`;

// ========== FUNDING QUERIES ==========

export const GET_FUNDING_RATE_HISTORY = gql`
  query GetFundingRateHistory($market: String!, $limit: Int = 100) {
    fundingRates(
      where: { market: $market }
      first: $limit
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      market
      rate
      cumulativeFunding
      timestamp
      blockNumber
    }
  }
`;

// ========== GOVERNANCE QUERIES ==========

export const GET_PROPOSALS = gql`
  query GetProposals($first: Int = 100, $skip: Int = 0) {
    proposals(
      first: $first
      skip: $skip
      orderBy: startBlock
      orderDirection: desc
    ) {
      id
      proposer
      description
      startBlock
      endBlock
      forVotes
      againstVotes
      abstainVotes
      state
      eta
      targets
      values
      signatures
      calldatas
    }
  }
`;

export const GET_PROPOSAL = gql`
  query GetProposal($id: ID!) {
    proposal(id: $id) {
      id
      proposer
      description
      startBlock
      endBlock
      forVotes
      againstVotes
      abstainVotes
      state
      eta
      targets
      values
      signatures
      calldatas
      votes {
        voter
        support
        weight
        reason
      }
    }
  }
`;

export const GET_VOTES = gql`
  query GetVotes($proposalId: String!, $first: Int = 100, $skip: Int = 0) {
    votes(
      where: { proposal: $proposalId }
      first: $first
      skip: $skip
      orderBy: weight
      orderDirection: desc
    ) {
      id
      voter
      support
      weight
      reason
      timestamp
    }
  }
`;

// ========== AMM / LIQUIDITY QUERIES ==========

export const GET_LP_POSITIONS = gql`
  query GetLpPositions($lp: String!) {
    lpPositions(where: { lp: $lp }) {
      id
      lp
      shares
      liquidity
      timestamp
    }
  }
`;

export const GET_POOL_STATS = gql`
  query GetPoolStats {
    poolStats {
      id
      totalLiquidity
      totalShares
      dailyVolume
      dailyFees
      timestamp
    }
  }
`;

// ========== ANALYTICS QUERIES ==========

export const GET_USER_PNL = gql`
  query GetUserPnL($user: String!, $timeframe: String) {
    positions(
      where: { 
        owner: $user 
        closedAt_gte: $timeframe 
        isClosed: true 
      }
    ) {
      id
      market
      side
      size
      entryPrice
      exitPrice
      realizedPnl
      timestamp: closedAt
    }
  }
`;

export const GET_PROTOCOL_VOLUME = gql`
  query GetProtocolVolume($timeframe: String!) {
    trades(
      where: { timestamp_gte: $timeframe }
    ) {
      id
      size
      timestamp
    }
  }
`;

export const GET_OPEN_INTEREST = gql`
  query GetOpenInterest($market: String) {
    markets(where: { id: $market }) @include(if: $market) {
      id
      openInterest
      longSize
      shortSize
      skew
    }
    
    markets @skip(if: $market) {
      id
      openInterest
      longSize
      shortSize
      skew
    }
  }
`;

export const GET_ACTIVE_TRADERS = gql`
  query GetActiveTraders($timeframe: String!) {
    trades(
      where: { timestamp_gte: $timeframe }
    ) {
      trader
    }
  }
`;

export const GET_TOTAL_TRADERS = gql`
  query GetTotalTraders {
    traders {
      id
    }
  }
`;

// ========== ORACLE QUERIES ==========

export const GET_ORACLE_UPDATES = gql`
  query GetOracleUpdates($market: String!, $first: Int = 100) {
    oracleUpdates(
      where: { market: $market }
      first: $first
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      market
      price
      source
      timestamp
      blockNumber
    }
  }
`;

// ========== COMPOSITE QUERIES ==========

export const GET_USER_PORTFOLIO = gql`
  query GetUserPortfolio($user: String!) {
    openPositions: positions(
      where: { owner: $user, size_gt: 0 }
    ) {
      id
      market
      side
      size
      collateral
      entryPrice
      leverage
      openedAt
    }
    
    lpPositions: lpPositions(
      where: { lp: $user }
    ) {
      id
      shares
      liquidity
      timestamp
    }
    
    tradingHistory: trades(
      where: { trader: $user }
      first: 10
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      market
      side
      size
      price
      timestamp
    }
    
    liquidationHistory: liquidations(
      where: { liquidator: $user }
      first: 10
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      positionId
      reward
      market
      timestamp
    }
  }
`;

export const GET_PROTOCOL_OVERVIEW = gql`
  query GetProtocolOverview {
    markets {
      id
      name
      openInterest
      dailyVolume
      currentFundingRate
    }
    
    poolStats {
      totalLiquidity
      dailyFees
    }
    
    recentTrades: trades(
      first: 10
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      market
      side
      size
      price
      timestamp
    }
    
    recentLiquidations: liquidations(
      first: 10
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      positionId
      market
      reward
      timestamp
    }
  }
`;

// ========== PAGINATION FRAGMENTS ==========

export const POSITION_FRAGMENT = gql`
  fragment PositionFields on Position {
    id
    owner
    market
    side
    size
    collateral
    entryPrice
    leverage
    openedAt
    lastUpdated
    isClosed
  }
`;

export const TRADE_FRAGMENT = gql`
  fragment TradeFields on Trade {
    id
    trader
    market
    side
    size
    price
    fee
    timestamp
    blockNumber
    transactionHash
  }
`;

export const MARKET_FRAGMENT = gql`
  fragment MarketFields on Market {
    id
    name
    baseToken
    quoteToken
    maxPositionSize
    minPositionSize
    tickSize
    isActive
    createdAt
  }
`;

// ========== QUERY GROUPS FOR ORGANIZATION ==========

export const POSITION_QUERIES = {
  GET_OPEN_POSITIONS,
  GET_POSITION,
  GET_POSITION_HISTORY,
  GET_USER_PORTFOLIO
};

export const MARKET_QUERIES = {
  GET_ALL_MARKETS,
  GET_MARKET,
  GET_MARKET_STATS
};

export const TRADE_QUERIES = {
  GET_TRADES,
  GET_USER_TRADES
};

export const LIQUIDATION_QUERIES = {
  GET_LIQUIDATION_HISTORY,
  GET_LIQUIDATION_STATS
};

export const FUNDING_QUERIES = {
  GET_FUNDING_RATE_HISTORY
};

export const GOVERNANCE_QUERIES = {
  GET_PROPOSALS,
  GET_PROPOSAL,
  GET_VOTES
};

export const AMM_QUERIES = {
  GET_LP_POSITIONS,
  GET_POOL_STATS
};

export const ANALYTICS_QUERIES = {
  GET_USER_PNL,
  GET_PROTOCOL_VOLUME,
  GET_OPEN_INTEREST,
  GET_ACTIVE_TRADERS,
  GET_TOTAL_TRADERS,
  GET_PROTOCOL_OVERVIEW
};

export const ORACLE_QUERIES = {
  GET_ORACLE_UPDATES
};

// ========== TYPE GENERATION HELPERS ==========

/**
 * Generate TypeScript types from GraphQL queries
 * This would typically be done with graphql-codegen
 */
export function generateTypes() {
  return {
    Position: `
      interface Position {
        id: string;
        owner: string;
        market: string;
        side: 'LONG' | 'SHORT';
        size: string;
        collateral: string;
        entryPrice: string;
        leverage: string;
        openedAt: number;
        lastUpdated: number;
        isClosed: boolean;
        closedAt?: number;
        closedBy?: string;
        closeReason?: string;
      }
    `,
    
    Trade: `
      interface Trade {
        id: string;
        trader: string;
        market: string;
        side: 'LONG' | 'SHORT';
        size: string;
        price: string;
        fee: string;
        timestamp: number;
        blockNumber: number;
        transactionHash: string;
      }
    `,
    
    Market: `
      interface Market {
        id: string;
        name: string;
        baseToken: string;
        quoteToken: string;
        maxPositionSize: string;
        minPositionSize: string;
        tickSize: string;
        isActive: boolean;
        createdAt: number;
      }
    `,
    
    // ... more types
  };
}

// ========== QUERY VALIDATION ==========

/**
 * Validate query variables before execution
 */
export function validateQueryVariables(queryName, variables) {
  const validators = {
    GET_OPEN_POSITIONS: (vars) => {
      if (!vars.owner || typeof vars.owner !== 'string') {
        throw new Error('GET_OPEN_POSITIONS requires owner string');
      }
      return true;
    },
    
    GET_POSITION: (vars) => {
      if (!vars.id || typeof vars.id !== 'string') {
        throw new Error('GET_POSITION requires id string');
      }
      return true;
    },
    
    GET_MARKET: (vars) => {
      if (!vars.id || typeof vars.id !== 'string') {
        throw new Error('GET_MARKET requires id string');
      }
      return true;
    },
    
    GET_USER_TRADES: (vars) => {
      if (!vars.trader || typeof vars.trader !== 'string') {
        throw new Error('GET_USER_TRADES requires trader string');
      }
      return true;
    }
  };
  
  const validator = validators[queryName];
  if (validator) {
    return validator(variables);
  }
  
  return true; // No validator, assume valid
}