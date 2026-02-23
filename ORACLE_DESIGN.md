# PerpArbitraDEX Oracle Design

The Oracle layer provides reliable, high-frequency price feeds while maintaining resilience against manipulation and outages.

## 1. Multi-Source Aggregation

The `OracleAggregator` combines data from multiple independent providers to reach a consensus price.

### Supported Adapters
- **Chainlink:** Primary source for highly decentralized price feeds.
- **Pyth Network:** Low-latency provider for real-time asset pricing.
- **TWAP (Time-Weighted Average Price):** Internal fallback derived from AMM state or DEX pools.
- **Band Protocol:** Cross-chain decentralized oracle.

## 2. Security and Validation Layers

### 2.1 Stale Price Detection
Each feed is assigned a **Heartbeat** interval (e.g., 60 seconds). If a source has not updated within this timeframe:
- The source is marked as `Stale`.
- It is excluded from the consensus calculation.
- If all sources are stale, the market is automatically paused.

### 2.2 Oracle Sanity Checker
Monitors price movements for extreme volatility:
- **Price Spikes:** If a new price deviates by more than $X\%$ from the previous price in a single block, it is flagged.
- **Cross-Source Deviation:** If one oracle source deviates from the others by more than $Y\%$, it is ignored.

### 2.3 Circuit Breakers
If an oracle detects a price change that exceeds the protocol's risk threshold (e.g., 50% crash), the `CircuitBreaker` module:
- Pauses all opening of positions.
- Allows only liquidations and closures.

## 3. Consensus Mechanism

The protocol uses a **Median-of-N** or **Volume-Weighted Average** logic depending on the market type:
1. Fetch latest prices from all non-stale, non-flagged sources.
2. Sort prices.
3. Select the median as the official **Index Price**.

## 4. Technical Specifications
- **Precision:** All prices are normalized to **18 decimals**.
- **Latency:** Pyth feeds are refreshed every slot where possible.
- **Audit Trail:** All price updates and source contributions are recorded on-chain for auditing.
