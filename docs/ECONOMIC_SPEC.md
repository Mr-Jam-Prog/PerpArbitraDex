# Perp DEX Economic and Mathematical Specification

## 1. Overview & Core Principles

This document establishes the formal mathematical specification for the Perpetual DEX protocol. All calculations, state transitions, ledger balances, and unit conversions are strictly defined to guarantee **protocol solvency**, **deterministic accounting**, and **conservative balance conservation**.

### Key System Axioms

1. **No Implicit Token Creation**: Every token transferred or settled by the protocol originates from a fully collateralized balance (Trader Margin Deposits or the `LiquidityVault`).
2. **Conservative Accounting**: Rounding errors across all operations (fees, PnL settlements, liquidations, rewards) always favor protocol solvency.
3. **Explicit Unit Transformations**: No implicit decimal assumptions exist. External oracle prices, base asset quantities, and native ERC20 quote token transfers are converted explicitly to/from standard 18-decimal fixed-point representation (WAD).
4. **Non-Truncating Signed Operations**: Signed integers (`int256`) representing equity or unrealized PnL must never be cast to unsigned integers (`uint256`) without explicit sign checks and bounds validation.

---

## 2. Precision, Units & Decimal Conversions

### 2.1 Base Units & Decimals

- **Base Token Size ($S$)**: Position size in base asset units, scaled as WAD ($1\text{ WAD} = 10^{18}$).
- **Oracle Index Price ($P_{\text{index}}$)**: Raw external price feed value, typically using 8 decimals ($10^8$).
- **Normalized Price ($P$)**: Price scaled to WAD ($10^{18}$):
  $$P_{\text{WAD}} = P_{\text{raw}} \times 10^{18 - D_{\text{oracle}}}$$
  For standard Chainlink / Pyth feeds with $D_{\text{oracle}} = 8$:
  $$P_{\text{WAD}} = P_{\text{8}} \times 10^{10}$$
- **Notional Quote Value ($N$)**: Value of a position in 18-decimal quote units:
  $$N_{\text{WAD}} = \frac{S_{\text{WAD}} \times P_{\text{WAD}}}{10^{18}}$$
- **Native Quote ERC20 Token ($Q_{\text{native}}$)**: Native token transfers (e.g. USDC with $D_{\text{quote}} = 6$ or DAI/USDT with $D_{\text{quote}} = 18$).
  Conversion between 18-decimal internal accounting ($Q_{\text{WAD}}$) and native token transfers ($Q_{\text{native}}$):
  $$Q_{\text{native}} = \lfloor \frac{Q_{\text{WAD}}}{10^{18 - D_{\text{quote}}}} \rfloor$$
  $$Q_{\text{WAD}} = Q_{\text{native}} \times 10^{18 - D_{\text{quote}}}$$

### 2.2 Rounding Rules for Solvency Preservation

| Operation | Rounding Direction | Solvency Impact |
| :--- | :--- | :--- |
| **Trading & Protocol Fees** | Ceil ($\lceil \dots \rceil$) | Protocol collects slightly more fee |
| **Trader Payout / Withdrawal** | Floor ($\lfloor \dots \rfloor$) | Protocol retains fractional dust |
| **Required / Maintenance Margin** | Ceil ($\lceil \dots \rceil$) | Stronger margin requirement |
| **Health Factor** | Floor ($\lfloor \dots \rfloor$) | Earlier trigger for liquidations |
| **Liquidator Reward** | Floor ($\lfloor \dots \rfloor$) | Liquidator gets floor, remainder stays in protocol |
| **Liquidation Penalty Charged** | Ceil ($\lceil \dots \rceil$) | Penalty charged to liquidated position is maxed |

---

## 3. Prices: Index Price vs. Mark Price

### 3.1 Index Price ($P_{\text{index}}$)
The spot price aggregated from reliable external oracle sources (Chainlink, Pyth, TWAP), normalized to WAD ($10^{18}$).

### 3.2 Mark Price ($P_{\text{mark}}$)
The price used for execution, funding rate estimation, and unrealized PnL valuation. It incorporates market skew from the AMM virtual price curve:
$$P_{\text{mark}} = P_{\text{index}} \times \left(1 + \frac{\text{Skew}}{\text{SkewScale}}\right)$$
where $\text{Skew} = \sum S_{\text{long}} - \sum S_{\text{short}}$.

---

## 4. Formal Position & Portfolio Mathematics

### 4.1 Position State
For any active position $i$:
- $S_i \in \mathbb{R}_{>0}$: Position size (WAD 1e18)
- $d_i \in \{+1, -1\}$: Direction ($+1$ for Long, $-1$ for Short)
- $E_i \in \mathbb{R}_{>0}$: Entry price (WAD 1e18)
- $M_i \in \mathbb{R}_{\ge 0}$: Locked margin collateral (WAD 1e18)
- $F_0$: Cumulative funding index at position entry (WAD 1e18)

### 4.2 Position Value & Unadjusted Notional
$$N_i = \frac{S_i \times P}{10^{18}}$$

### 4.3 Unrealized PnL ($\text{PnL}_i$)
$$\text{PnL}_i = d_i \times \frac{S_i \times (P - E_i)}{10^{18}}$$
- **Long ($d_i = +1$)**: Profit when $P > E_i$, Loss when $P < E_i$.
- **Short ($d_i = -1$)**: Profit when $P < E_i$, Loss when $P > E_i$.
- **Symmetry Invariant**: $\text{PnL}_{\text{long}}(S, E, P) = -\text{PnL}_{\text{short}}(S, E, P)$.

### 4.4 Cumulative Funding Payment
Let $F_{\text{curr}}$ be the market's cumulative funding index per unit of size (WAD).
$$\Delta F_i = F_{\text{curr}} - F_0$$
$$\text{FundingPayment}_i = d_i \times \frac{S_i \times \Delta F_i}{10^{18}}$$
- **Sign Convention**:
  - If $\text{FundingPayment}_i > 0$, the trader **owes** this amount to counterparty/LPs.
  - If $\text{FundingPayment}_i < 0$, the trader **receives** this amount from counterparty/LPs.

### 4.5 Position Equity ($\text{Equity}_i$)
$$\text{Equity}_i = M_i + \text{PnL}_i - \text{FundingPayment}_i$$

### 4.6 Leverage ($L_i$)
$$L_i = \frac{N_i}{\max(1, \text{Equity}_i)}$$

### 4.7 Margin Requirements
- **Initial Margin Requirement ($\text{IM}_i$)**:
  $$\text{IM}_i = \frac{N_i}{\text{MaxLeverage}} = N_i \times \text{IMR}_{\text{bps}} / 10000$$
- **Maintenance Margin Requirement ($\text{MM}_i$)**:
  $$\text{MM}_i = N_i \times \text{MMR}_{\text{bps}} / 10000$$

### 4.8 Health Factor ($\text{HF}_i$)
$$\text{HF}_i = \begin{cases}
0 & \text{if } \text{Equity}_i \le 0 \\
\lfloor \frac{\text{Equity}_i \times 10^{18}}{\text{MM}_i} \rfloor & \text{if } \text{Equity}_i > 0
\end{cases}$$
A position is **liquidatable** if $\text{HF}_i < 10^{18}$ (i.e. $\text{Equity}_i < \text{MM}_i$).

### 4.9 Liquidation Price ($P_{\text{liq}}$)
The price $P_{\text{liq}}$ at which $\text{Equity}_i(P_{\text{liq}}) = \text{MM}_i(P_{\text{liq}})$.

For Long ($d_i = +1$):
$$P_{\text{liq}}^{\text{long}} = \frac{M_i - \frac{S_i \cdot E_i}{10^{18}} - \text{FundingPayment}_i}{S_i \cdot (\text{MMR} - 1) / 10^{18}} = \frac{\frac{S_i \cdot E_i}{10^{18}} + \text{FundingPayment}_i - M_i}{S_i \cdot (1 - \text{MMR}) / 10^{18}}$$

For Short ($d_i = -1$):
$$P_{\text{liq}}^{\text{short}} = \frac{\frac{S_i \cdot E_i}{10^{18}} - \text{FundingPayment}_i + M_i}{S_i \cdot (1 + \text{MMR}) / 10^{18}}$$

---

## 5. Lifecycle Operations & Accounting Ledger

### 5.1 Opening & Increasing Positions
When opening or adding size $\Delta S$ at price $P_{\text{exec}}$ with additional margin $\Delta M$:
1. **Fee Calculation**:
   $$\text{Fee} = \lceil \frac{\Delta S \times P_{\text{exec}}}{10^{18}} \rceil \times \text{ProtocolFeeBps} / 10000$$
2. **Net Margin Added**:
   $$\Delta M_{\text{net}} = \Delta M - \text{Fee}$$
3. **Volume-Weighted Average Entry Price ($E_{\text{new}}$)**:
   $$E_{\text{new}} = \frac{(S_{\text{old}} \times E_{\text{old}}) + (\Delta S \times P_{\text{exec}})}{S_{\text{old}} + \Delta S}$$
4. **Funding Accrual**: Prior accrued funding is settled or rolled over into updated $F_0$. Unpaid funding debt blocks non-terminal risk/exposure mutations (`increasePosition`) and withdrawals (`removeMargin`, non-terminal `decreasePosition`). `addMargin` is the recovery path: newly deposited collateral first cures any unpaid funding debt, and only the residual increases position margin.

### 5.2 Partial Decrease & Full Close
When decreasing position by size $\Delta S \le S$:
1. **Realized PnL**:
   $$\text{PnL}_{\text{realized}} = d_i \times \frac{\Delta S \times (P_{\text{exec}} - E_i)}{10^{18}}$$
2. **Realized Funding**:
   $$\text{Funding}_{\text{realized}} = d_i \times \frac{\Delta S \times (F_{\text{curr}} - F_0)}{10^{18}}$$
3. **Margin Portion Released**:
   $$\Delta M_{\text{rel}} = \frac{\Delta S}{S} \times M_i$$
4. **Payout to Trader**:
   $$\text{Payout} = \Delta M_{\text{rel}} + \text{PnL}_{\text{realized}} - \text{Funding}_{\text{realized}} - \text{ClosingFee}$$
   - If $\text{Payout} > 0$: Protocol pays $\lfloor \text{Payout} \rfloor$ to trader from `LiquidityVault` / Margin pool.
   - If $\text{Payout} < 0$: The deficit is deducted from the remaining margin $M_i - \Delta M_{\text{rel}}$.

### 5.3 Liquidation Mechanics & Bad Debt
When a position is liquidated ($\text{HF}_i < 10^{18}$):
1. **Liquidation Penalty ($\text{Pen}$)**:
   $$\text{Pen} = \lceil N_i \times \text{LiquidationPenaltyBps} / 10000 \rceil$$
2. **Liquidator Reward ($\text{Reward}$)**:
   $$\text{Reward} = \lfloor \text{Pen} \times \text{RewardShareBps} / 10000 \rfloor$$
3. **Net Equity After Penalty**:
   $$\text{Equity}_{\text{rem}} = \text{Equity}_i - \text{Pen}$$
4. **Outcome Branches**:
   - **Solvent Liquidation ($\text{Equity}_{\text{rem}} \ge 0$)**:
     - Liquidator receives $\text{Reward}$.
     - Insurance Fund receives $\text{Pen} - \text{Reward}$.
     - Remaining equity $\text{Equity}_{\text{rem}}$ is returned to trader or retained as protocol reserve.
   - **Insolvent Liquidation / Bad Debt ($\text{Equity}_i < 0$)**:
     - $\text{BadDebt} = |\text{Equity}_i|$.
     - Liquidator reward is paid from Insurance Fund (or fallback LP Vault).
     - **Trader negative equity waterfall**:
       1. Forfeit available trader collateral (transferred to LP capital).
       2. Insurance Fund compensates LPs up to its available balance (reclassified to LP capital).
       3. Any unrecovered remainder is economically socialized to LPs as foregone counterparty PnL (`coveredByLP`).
       The LP absorption at step 3 is a write-off of an uncollected receivable, not an additional quote-token outflow. Therefore no second decrement of `totalLpAssets` occurs at that step.

---

## 6. Conservative System Ledger Invariant

At any block, total quote token assets held across protocol contracts must equal the sum of all liabilities:

$$\text{Total Quote Assets} = \sum_{i} M_i + \text{VaultCapital}_{\text{LP}} + \text{Balance}_{\text{Insurance}} + \sum \text{AccumulatedFees}$$

Where:
- $\sum_{i} M_i$: Aggregate locked trader collateral.
- $\text{VaultCapital}_{\text{LP}}$: Capital contributed by LPs in `LiquidityVault` + cumulative LP PnL.
- $\text{Balance}_{\text{Insurance}}$: Unspent insurance fund reserves.
- $\sum \text{AccumulatedFees}$: Unclaimed protocol/governance fees.

---

## 7. Current System Divergences (Solidity Implementation)

The following behaviors in current core Solidity smart contracts diverge from this formal specification:

| Area | Formal Spec Behavior | Current Solidity Behavior | Impact / Severity |
| :--- | :--- | :--- | :--- |
| **Capital Isolation** | Trader margin and LP capital are held in a separate `LiquidityVault`. | `PerpEngine.sol` directly holds quote tokens and processes all transfers. | High: Blends LP capital and trader margin in single contract. |
| **Funding Index Calculation** | Funding accumulated per WAD unit of base size in quote WAD (`F_curr`). | `AMMPool.sol` / `PerpEngine.sol` calculates funding payment in base units and converts on-the-fly to quote using current oracle price. | Medium: Path-dependent conversion differences during price volatile periods. |
| **Native Decimals** | Quote transfers adapt via `10^(18 - quoteDecimals)` (e.g. USDC 6 decimals). | `PerpEngine.sol` internal math assumes 18 decimals without scaling native ERC20 transfer amounts for 6-decimal quote tokens. | High: Incompatible with USDC (6 decimals) without external wrapper. |
| **Liquidation Fee Routing** | Penalty is deducted from equity; liquidator reward + insurance share distributed via `IncentiveDistributor`. | `PerpEngine.sol` `liquidatePosition` sends 50% penalty to liquidator and 50% directly to `insuranceFund` address. | Medium: Ignores negative equity / bad debt scenarios in direct contract calls. |
| **Health Factor Bound** | $\text{HF} = \lfloor \text{Equity} \cdot 10^{18} / \text{MM} \rfloor$. | `PositionMath.sol` caps HF at `100 * 1e18` (100x WAD). | Low: Cosmetic cap for UI, does not affect liquidation trigger point. |
| **Bad Debt Settlement** | Explicit bad debt accounting against `InsuranceFund` and `LiquidityVault`. | `PerpEngine.sol` reverts if trader margin is insufficient to cover total losses without invoking `settleBadDebt`. | High: Can block liquidations of deeply insolvent positions during extreme market gaps. |

---

## 8. Golden Vectors (20 Numerical Examples)

Below are 20 canonical golden vectors specified in standard numerical units and WAD equivalents.

### Vector Summary Table

| ID | Description | Direction | Size (WAD) | Entry Price ($) | Current Price ($) | Margin (Quote) | Quote Decimals | Expected PnL (WAD) | Expected HF (WAD) | Notes / Solvency Outcome |
|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|:---|
| **GV-01** | Standard Long Profit ($1,000 to $1,200) | Long | 1e18 | 1,000 | 1,200 | 200 (18d) | 18 | +200e18 | 16.66e18 | Healthy profit |
| **GV-02** | Standard Short Profit ($1,000 to $800) | Short | 1e18 | 1,000 | 800 | 200 (18d) | 18 | +200e18 | 25.00e18 | Healthy profit |
| **GV-03** | Low Price Token ($1.00 to $1.20) | Long | 1000e18 | 1.00 | 1.20 | 200 (18d) | 18 | +200e18 | 16.66e18 | Low price normalization |
| **GV-04** | High Price Token ($2,000 to $2,500) | Long | 0.5e18 | 2,000 | 2,500 | 200 (18d) | 18 | +250e18 | 18.00e18 | High price normalization |
| **GV-05** | USDC 6 Decimals Long Profit | Long | 1e18 | 2,000 | 2,200 | 200 USDC (6d) | 6 | +200e18 | 9.09e18 | Native USDC conversion |
| **GV-06** | USDC 6 Decimals Short Profit | Short | 1e18 | 2,000 | 1,800 | 200 USDC (6d) | 6 | +200e18 | 11.11e18 | Native USDC conversion |
| **GV-07** | Positive Funding Long (Trader Pays) | Long | 1e18 | 2,000 | 2,000 | 200 (18d) | 18 | 0 | 8.00e18 | $20 funding deducted |
| **GV-08** | Negative Funding Short (Trader Pays) | Short | 1e18 | 2,000 | 2,000 | 200 (18d) | 18 | 0 | 8.00e18 | Negative funding rate payment |
| **GV-09** | Long Loss Near Liquidation Threshold | Long | 1e18 | 2,000 | 1,820 | 200 (18d) | 18 | -180e18 | 0.549e18 | HF < 1.0 -> Liquidatable |
| **GV-10** | Short Loss Near Liquidation Threshold | Short | 1e18 | 2,000 | 2,180 | 200 (18d) | 18 | -180e18 | 0.458e18 | HF < 1.0 -> Liquidatable |
| **GV-11** | Partial Decrease (50% Close) Long | Long | 1e18 -> 0.5e18 | 2,000 | 2,400 | 200 -> 100 | 18 | +200e18 (total) | 18.33e18 | $100 profit realized |
| **GV-12** | Partial Decrease (50% Close) Short | Short | 1e18 -> 0.5e18 | 2,000 | 1,600 | 200 -> 100 | 18 | +200e18 (total) | 25.00e18 | $100 profit realized |
| **GV-13** | Solv. Liquidation Long (5% MMR, 2.5% Pen) | Long | 1e18 | 2,000 | 1,820 | 200 (18d) | 18 | -180e18 | Liquidated | $20 rem equity - $45.5 pen -> Solvent |
| **GV-14** | Insolvent Liquidation Long (Bad Debt) | Long | 1e18 | 2,000 | 1,700 | 200 (18d) | 18 | -300e18 | Liquidated | -$100 bad debt absorbed by IF/Vault |
| **GV-15** | Insolvent Liquidation Short (Bad Debt) | Short | 1e18 | 2,000 | 2,300 | 200 (18d) | 18 | -300e18 | Liquidated | -$100 bad debt absorbed by IF/Vault |
| **GV-16** | Minimum Size & Price (1 wei size, $1) | Long | 1 wei | 1.00 | 2.00 | 1 wei | 18 | +1 wei | Healthy | No overflow/underflow |
| **GV-17** | Rounding Ceil on Protocol Fee | Long | 100e18 | 1.00 | 1.00 | 10 (18d) | 18 | 0 | Healthy | Fee rounds UP to 1 wei |
| **GV-18** | Rounding Floor on Trader Payout | Long | 1e18 | 100 | 100.000000000000000001 | 10 (18d) | 6 | +1 wei | Healthy | Payout floor retains dust |
| **GV-19** | Zero Funding Drift (No time elapsed) | Long | 5e18 | 1,500 | 1,500 | 500 (18d) | 18 | 0 | 13.33e18 | Equity preserved exactly |
| **GV-20** | Deep Out of Money Long (100% Margin Loss) | Long | 1e18 | 1,000 | 500 | 200 (18d) | 18 | -500e18 | 0 | Total margin wiped, -$300 bad debt |

---

## 9. Invariant & Symmetry Properties

1. **Long/Short PnL Symmetry Ex-Fees**:
   For any size $S$, entry price $E$, and current price $P$:
   $$\text{PnL}_{\text{long}}(S, E, P) + \text{PnL}_{\text{short}}(S, E, P) = 0$$
2. **Funding Time-Step Independence**:
   For any sequence of funding intervals $\Delta t_1, \Delta t_2, \dots, \Delta t_n$ summing to $T$:
   $$\sum_{k=1}^n \text{FundingPayment}(\Delta t_k) = \text{FundingPayment}(T)$$
3. **Ledger Balance Conservation**:
   Total quote tokens in system always equals total liabilities (Margin + LP Vault Capital + Insurance Reserves + Protocol Fees).
