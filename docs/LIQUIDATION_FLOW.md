# Liquidation Flow Specification (Prompt 07B)

## 1. Execution Architecture
- **Direct Permissionless Liquidation:** Direct execution via `LiquidationEngine.executeLiquidation` or `executeBatchLiquidation` is the canonical liquidation execution path.
- **Optional Queue Infrastructure:** `LiquidationQueue` is optional infrastructure used for batching, grace periods for queued positions, keeper automation, and liveness prioritization. Queue membership is **not** a correctness prerequisite for direct liquidation.

## 2. Liquidation Parameters & Scope
- **Full Liquidation Only:** Prompt 07B supports canonical full liquidations (`sizeToLiquidate = position.size`). Partial liquidation remains deferred to Prompt 07C.
- **Terminal Insolvency ($HF \le 0$):** Zero health factor or negative equity positions remain terminally liquidatable.

## 3. Price Authority & Health Evaluation
- **Single Authoritative Price Source:** All liquidation health assessments, sizing, penalties, rewards, and settlements fetch the oracle price strictly using `PerpEngine.Market.oracleFeedId`. Legacy `marketFeedIds` mappings do not alter canonical settlement inputs.
- **Preview-Equivalent Elapsed Funding Health:** Read-only health checks (`getHealthFactor`, `isPositionLiquidatable`) evaluate elapsed unaccrued funding using `AMMPool.previewCumulativeFundingIndex` with native quote quantization (CEIL for funding debits, FLOOR for funding credits), matching execution-time post-funding state.
- **Unpaid Funding Execution Equity:** In `PerpEngine.liquidatePosition`, post-funding margin $M_1$ and residual unpaid funding debt $U$ participate in execution health, evaluating equity $E_{\text{exec}} = M_1 + \text{PnL} - U$.

## 4. Economic Formulas & Rounding
- **Canonical Signed Equity:**
  $$\text{Equity} = \text{Margin} + \text{Signed PnL} - \text{Pending Funding}$$
- **Canonical Market Penalty & Native Settlement Quantization:**
  $$\text{PnomWad} = \left\lceil \frac{\text{Notional} \times \text{market.liquidationFeeRatio}}{10^{18}} \right\rceil$$
  where $\text{Notional} = \frac{\text{PositionSize} \times \text{Price}}{10^8}$.

  `PnomWad` is the canonical nominal WAD liquidation penalty reported in `LiquidationResult.penalty`, `LiquidationExecuted.penalty`, and `PositionLiquidated.penalty`.

  Physical Vault settlement converts `PnomWad` to native quote units using native CEIL:
  $$\text{penaltyNative} = \text{CEIL\_CONVERT\_WAD\_TO\_NATIVE}(\text{PnomWad})$$
  $$\text{effectivePenaltyWad} = \text{CONVERT\_NATIVE\_TO\_WAD}(\text{penaltyNative})$$
  For quote decimals $< 18$, $\text{effectivePenaltyWad} \ge \text{PnomWad}$.
- **Canonical Liquidator Reward & Payable Quantization:**
  $$\text{NominalReward} = \left\lfloor \frac{\text{Penalty} \times 5000}{10000} \right\rfloor \quad (\text{50\% Reward Share})$$
  $$\text{rewardNative} = \text{FLOOR\_CONVERT\_WAD\_TO\_NATIVE}(\text{NominalReward})$$
  $$\text{effectiveRewardWad} = \text{CONVERT\_NATIVE\_TO\_WAD}(\text{rewardNative})$$
- **No Dynamic Incentive Multipliers / No `maxReward` Cap:** Canonical Prompt 07B uses a fixed 50% reward share without dynamic queue multipliers, legacy `penaltyRatio` overrides, or arbitrary `maxReward` caps.
- **Payable `minReward` Guarantee:** Caller `params.minReward` is checked against `effectiveRewardWad`. Reverts atomically if `effectiveRewardWad < params.minReward`.

## 5. Settlement & Source of Funds
- **Vault Settlement (`LiquidityVault.settleLiquidation`):** Executes full liquidation settlement atomically across solvent (Branch A), loss-consuming (Branch B), and bad-debt (Branch C) scenarios.
- **Insolvent Liquidator Reward Funding:**
  $$\text{Insurance Fund} \longrightarrow \text{LP Fallback}$$
  Liquidator rewards are paid directly by `LiquidityVault.payLiquidationReward` via PerpEngine without debiting remaining trader margin or failing when the Insurance Fund is empty.
- **`coveredByLP` Accounting:** In terminal bad-debt liquidations (Branch C), `coveredByLP` represents an economic write-off of foregone LP counterparty PnL and does **not** double-debit physical LP capital.
- **Liquidator Rewards Tracking:** On successful Vault payout, `LiquidationEngine` updates `liquidatorRewards[liquidator] += effectiveRewardWad`.
