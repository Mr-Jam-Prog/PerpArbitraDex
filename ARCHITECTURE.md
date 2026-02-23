# PerpArbitraDEX System Architecture

This document describes the core components and interaction flows of the PerpArbitraDEX protocol.

## 1. Component Overview

### 1.1 PerpEngine (`PerpEngine.sol`)
The central orchestrator of the protocol. It is the primary entry point for users to manage positions.
- **Responsibilities:** Opening, closing, and modifying positions; margin management; fee collection.
- **Unit Handling:** Ensures all internal accounting (PnL, funding, fees) is performed in **Quote Units (USD)** to match the collateral asset.
- **Interactions:** Consults `RiskManager` for validations, `AMMPool` for funding, `OracleAggregator` for prices, and `PositionManager` for ownership.

### 1.2 AMMPool (`AMMPool.sol`)
Manages the internal market balance and funding rate mechanism.
- **Responsibilities:** Tracking long/short Open Interest (OI); calculating hourly funding rates based on skew; distributing funding payments.
- **Interactions:** Real-time updates from `PerpEngine` on every trade.

### 1.3 OracleAggregator (`OracleAggregator.sol`)
A robust price discovery layer.
- **Responsibilities:** Aggregating prices from multiple sources (Chainlink, Pyth, TWAP); detecting stale prices; providing a unified 18-decimal price feed.
- **Interactions:** Sources from external oracles; consulted by `PerpEngine` and `RiskManager`.

### 1.4 LiquidationEngine (`LiquidationEngine.sol`)
The security layer that handles underwater positions.
- **Responsibilities:** Maintaining a MEV-resistant liquidation queue; enforcing grace periods; executing liquidations via `PerpEngine`.
- **Interactions:** Monitored by external liquidator bots; calls `PerpEngine.liquidatePosition`.

### 1.5 RiskManager (`RiskManager.sol`)
The protocol's safety valve.
- **Responsibilities:** Calculating health factors and liquidation prices; enforcing max leverage and maintenance margin requirements; managing circuit breakers.
- **Interactions:** Consulted by `PerpEngine` during every trade and by `LiquidationEngine` during execution.

---

## 2. Core Interaction Flows

### 2.1 Trade Execution (Open/Modify)
1. **User** calls `openPosition` on `PerpEngine`.
2. `PerpEngine` pulls collateral and calculates the protocol fee in **Quote Units**.
3. `PerpEngine` calls `RiskManager.validatePosition` to check leverage (using notional value) and market limits.
4. `PerpEngine` calls `AMMPool.updateSkew` to record the new position size (base units).
5. `PerpEngine` calls `PositionManager.mint` to issue an NFT to the user.

### 2.2 Liquidation Flow
1. **Liquidator Bot** detects an underwater position via `IPositionViewer`.
2. **Liquidator Bot** calls `queueLiquidation` on `LiquidationEngine`.
3. After the **grace period**, the bot calls `executeLiquidation`.
4. `LiquidationEngine` calls `PerpEngine.liquidatePosition`.
5. `PerpEngine` calculates PnL and penalty in **Quote Units**, pays the reward, and closes the position.

### 2.3 Funding Accrual
1. `PerpEngine` calls `AMMPool.applyFunding`.
2. `AMMPool` calculates the cumulative funding multiplier.
3. `PerpEngine` converts the funding payment from base units to **Quote Units** using the current price and applies it to the position's margin.
