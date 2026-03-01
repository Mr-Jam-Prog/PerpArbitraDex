# PerpArbitraDEX Funding Model

The funding mechanism ensures the protocol stays balanced by incentivizing traders to take positions against the majority skew.

## 1. Skew-Based Calculation

Funding rates are determined by the imbalance between Long and Short Open Interest (OI).

### Definitions
- **Long OI ($OI_L$):** Total size of all open long positions.
- **Short OI ($OI_S$):** Total size of all open short positions.
- **Net Skew ($S$):** $OI_L - OI_S$
- **Skew Scale ($K$):** A parameter representing the market's depth; used to normalize the skew.
- **Max Funding Rate ($R_{max}$):** The maximum possible hourly funding rate (e.g., 0.1%).

### Formula
The hourly funding rate $R$ is calculated as:
$$R = \frac{S}{K} \times R_{max}$$

- If $R > 0$ (Long skew): Longs pay Shorts.
- If $R < 0$ (Short skew): Shorts pay Longs.

## 2. Funding Accrual and Realization

### 2.1 Accumulation Index
To handle funding efficiently for thousands of positions, the protocol uses a cumulative index:
$$Index_T = Index_{T-1} + (R \times \Delta t)$$
where $\Delta t$ is the time since the last update.

### 2.2 Individual Position Payment
When a user closes or modifies a position, the funding payment $P_{base}$ is first calculated in base units:
$$P_{base} = Size_{base} \times (Index_{now} - Index_{at\_open})$$

**Important:** This base-unit payment is then converted to **Quote Units (USD)** using the current index price $Price_{index}$ before being applied to the position's margin:
$$P_{quote} = \frac{P_{base} \times Price_{index}}{10^{18}}$$

## 3. Economic Constraints

- **Interval:** Funding is calculated hourly but accumulated continuously.
- **Clamping:** If the calculated rate exceeds $R_{max}$, it is clamped to the maximum.
- **Solvency Protection:** Funding payments are realized in quote units to maintain consistency with the margin asset.

## 4. Market Parameters
Each market has its own `skewScale` and `maxFundingRate` to reflect its specific liquidity and volatility profile. These are managed via the `ConfigRegistry`.
