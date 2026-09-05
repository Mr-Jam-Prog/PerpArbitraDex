# Liquidation Flow Specification (Prompt 07B)

## 1. Execution Architecture
- **Direct Permissionless Liquidation:** Direct execution via `LiquidationEngine.executeLiquidation` or `executeBatchLiquidation` is the canonical liquidation execution path.
- **Optional Queue Infrastructure:** `LiquidationQueue` is optional infrastructure used for batching, grace periods for queued positions, keeper automation, and liveness prioritization. Queue membership is **not** a correctness prerequisite for direct liquidation.

## 2. Liquidation Parameters & Scope
- **Full Liquidation Only:** Prompt 07B supports canonical full liquidations (`sizeToLiquidate = position.size`). Partial liquidation remains deferred to Prompt 07C.
- **Terminal Insolvency ($HF \le 0$):** Zero health factor or negative equity positions remain terminally liquidatable.

## 3. Economic Formulas & Rounding
- **Canonical Signed Equity:**
  $$\text{Equity} = \text{Margin} + \text{Signed PnL} - \text{Pending Funding}$$
- **Canonical Market Penalty:**
  $$\text{Penalty} = \left\lceil \frac{\text{Notional} \times \text{market.liquidationFeeRatio}}{10^{18}} \right\rceil$$
  where $\text{Notional} = \frac{\text{PositionSize} \times \text{Price}}{10^8}$.
- **Canonical Liquidator Reward:**
  $$\text{Reward} = \left\lfloor \frac{\text{Penalty} \times 5000}{10000} \right\rfloor \quad (\text{50\% Reward Share})$$
- **No Dynamic Incentive Multipliers:** Canonical Prompt 07B uses fixed 50% reward share without dynamic queue multipliers or legacy `LiquidatorConfig.penaltyRatio` overrides.
- **No `maxReward` Cap:** In accordance with `ECONOMIC_SPEC.md §5.3`, no arbitrary `maxReward` cap is applied to the 50% reward formula.

## 4. Settlement & Source of Funds
- **Vault Settlement (`LiquidityVault.settleLiquidation`):** Executes full liquidation settlement atomically across solvent (Branch A), loss-consuming (Branch B), and bad-debt (Branch C) scenarios.
- **Insolvent Liquidator Reward Funding:**
  $$\text{Insurance Fund} \longrightarrow \text{LP Fallback}$$
  Liquidator rewards are paid directly by `LiquidityVault.payLiquidationReward` via PerpEngine without debiting remaining trader margin or failing when the Insurance Fund is empty.
- **Single Reward Payment:** Liquidator reward is paid exactly once during Vault settlement.
