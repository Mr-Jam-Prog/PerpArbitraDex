# PerpArbitraDEX Risk Model

The Risk Model defines the parameters and constraints that protect the protocol and its Liquidity Providers (LPs) from catastrophic losses.

## 1. Leverage and Margin

### 1.1 Maximum Leverage
Each market has a hard-coded maximum leverage (e.g., 20x for BTC, 10x for altcoins).
- **Enforcement:** Checked by `RiskManager.validatePosition` during every open or increase action.

### 1.2 Initial Margin
The minimum collateral required to open a position.
- $Margin_{min} = \frac{\text{Size}}{\text{Max Leverage}}$

### 1.3 Maintenance Margin Ratio (MMR)
The minimum collateral required to keep a position open.
- Typically set at **1% - 2%**.
- If $\frac{\text{Equity}}{\text{Size}} < MMR$, the position is liquidatable.

## 2. Open Interest (OI) Limits

### 2.1 Market-Level OI Cap
The maximum absolute size ($OI_L + OI_S$) allowed for a single market. This prevents the protocol from growing faster than its underlying liquidity buffer.

### 2.2 Net Skew Cap
The maximum difference allowed between longs and shorts ($|OI_L - OI_S|$). This limits the directional risk for the protocol.

## 3. Concentration Risk
To prevent single-trader manipulation:
- **Max Position Size:** A cap on the size of an individual position.
- **Trader Limit:** Total OI per address is capped relative to the total market OI.

## 4. Fee Structure

| Fee Type | Target | purpose |
|----------|--------|---------|
| Protocol Fee | Treasury | Revenue and system maintenance. |
| Liquidation Fee | Liquidators | Incentivizing bot participation. |
| Funding Fee | Traders | Balancing the market skew. |

## 5. Circuit Breakers

The protocol monitors volatility and liquidity in real-time.
- **Trigger:** A price move of >20% in 1 hour.
- **Action:** Pauses `openPosition` calls for the affected market while allowing `closePosition` and liquidations to reduce risk.
- **Cooldown:** Manual or time-based reset after market stabilization.
