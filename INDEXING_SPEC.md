# PerpArbitraDEX Event Indexing Specification (Subgraph/Sentinel)

This document defines the events that MUST be indexed for the frontend to maintain a consistent state of positions, markets, and protocol health.

## 1. Core Trading Events (PerpEngine)

### PositionOpened
- **Triggers:** New position created.
- **Data to Store:** `positionId`, `trader`, `marketId`, `isLong`, `size`, `margin`, `entryPrice`, `leverage`, `fee`, `timestamp`.
- **Indexing logic:** Create new `Position` entity.

### PositionIncreased / PositionDecreased
- **Triggers:** Position size or margin modified.
- **Data to Store:** Updated `size`, `margin`, `newEntryPrice`.
- **Indexing logic:** Update existing `Position` entity; record as a `Trade` history item.

### PositionClosed
- **Triggers:** Position fully closed.
- **Data to Store:** `exitPrice`, `pnl`, `fee`, `returnedMargin`.
- **Indexing logic:** Mark `Position` entity as `Closed`; record realized PnL.

### PositionLiquidated
- **Triggers:** Position closed by liquidator.
- **Data to Store:** `liquidator`, `liquidationPrice`, `penalty`, `reward`.
- **Indexing logic:** Mark `Position` entity as `Liquidated`; record liquidation event.

## 2. Market State Events (AMMPool & PerpEngine)

### FundingAccrued
- **Triggers:** Periodic funding rate update.
- **Data to Store:** `marketId`, `fundingRate`, `longFundingPayment`, `shortFundingPayment`.
- **Indexing logic:** Update `Market` entity's `currentFundingRate`.

### SkewUpdated
- **Triggers:** Any trade that changes Open Interest.
- **Data to Store:** `longOI`, `shortOI`, `netSkew`.
- **Indexing logic:** Update `Market` entity's OI and Skew metrics.

### MarketInitialized
- **Triggers:** New market added to the protocol.
- **Data to Store:** `marketId`, `oracleFeedId`, parameters.
- **Indexing logic:** Create new `Market` entity.

## 3. Infrastructure Events (Oracle & Config)

### PriceUpdated
- **Triggers:** Real-time price feed update.
- **Indexing logic:** (Optional for Subgraph, critical for Sentinel) Update real-time mark prices.

### MarketStatusChanged
- **Triggers:** Market paused or unpaused.
- **Indexing logic:** Update `Market.isActive` status.

## 4. Entity Schema Requirements

- **Position:** ID, Trader, Market, Status (Open/Closed/Liq), Size, Margin, EntryPrice, RealizedPnL, OpenTime, CloseTime.
- **Market:** ID, Symbol, IsActive, TotalLongOI, TotalShortOI, NetSkew, CurrentFundingRate, LastFundingTime.
- **ProtocolStats:** TotalVolume, TotalFees, TotalLiquidations, TotalActivePositions.
