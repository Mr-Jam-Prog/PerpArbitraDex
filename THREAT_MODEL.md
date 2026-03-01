# PerpArbitraDEX Threat Model

This document identifies potential attack vectors and the corresponding mitigation strategies implemented in the protocol.

## 1. Oracle Manipulation

**Vector:** An attacker manipulates the index price on a decentralized exchange to trigger liquidations or profit from PnL.
**Mitigation:**
- **Consensus:** Prices are aggregated from Chainlink, Pyth, and internal TWAP. A single manipulated source is ignored by the median logic.
- **Heartbeat:** Stale prices are rejected.
- **Sanity Checks:** Large price deviations between sources or across blocks trigger circuit breakers.

## 2. Liquidation Front-Running (MEV)

**Vector:** A bot spots an underwater position and executes the liquidation in the same block, extracting maximum value from the trader before they can add margin.
**Mitigation:**
- **Liquidation Queue:** Liquidations require a two-step process: Enqueue and Execute.
- **Grace Period:** A mandatory 5-minute wait between enqueuing and execution allows traders time to re-collateralize if the price move was a temporary flash crash.

## 3. Protocol Insolvency

**Vector:** A position becomes deeply underwater, and the protocol pays out more in liquidator rewards and user profits than it has in collateral.
**Mitigation:**
- **Reward Capping:** Liquidator rewards are capped by the *actual* remaining margin of the position.
- **Insurance Fund:** Fees are collected into a dedicated fund to cover bad debt.
- **Real-time Health Monitoring:** The `RiskManager` ensures no position can be opened with a health factor too close to the liquidation threshold.

## 4. Flash Loan Attacks

**Vector:** An attacker uses a flash loan to manipulate market skew and funding rates in a single transaction.
**Mitigation:**
- **Funding Intervals:** Funding is accrued based on time elapsed. Intra-block movements do not generate funding payments.
- **Max Skew Limits:** The AMM caps the net skew to limit the impact of large directional trades.

## 5. Reentrancy and Logic Flaws

**Vector:** Malicious contracts call back into the protocol during a trade to manipulate internal state.
**Mitigation:**
- **OZ ReentrancyGuard:** All state-changing functions in `PerpEngine` and `LiquidationEngine` use the `nonReentrant` modifier.
- **Checks-Effects-Interactions:** Strictly followed across all core contracts.

## 6. Governance and Administrative Risk

**Vector:** A compromised admin key changes protocol parameters (e.g., setting protocol fee to 100%).
**Mitigation:**
- **Timelock:** All parameter changes are subject to a 48-hour delay.
- **Multi-sig:** Crucial functions require signatures from multiple independent guardians.
- **Voting Escrow (vePERP):** Governance is controlled by long-term stakers rather than speculative holders.
