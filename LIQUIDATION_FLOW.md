# PerpArbitraDEX Liquidation Flow

The liquidation system ensures the protocol's solvency by closing positions before their losses exceed their collateral.

## 1. Liquidation Conditions

A position is eligible for liquidation when its **Health Factor (HF)** falls below **1.0**.
- **HF Formula:** $HF = \frac{\text{Margin} + \text{PnL}}{\text{Maintenance Margin}}$
- Maintenance Margin is typically 1% - 5% of the position size.

## 2. MEV-Resistant Process

To prevent front-running and MEV-driven "liquidation racing," the protocol uses a two-step queuing process.

### Step 1: Enqueueing
1. An external bot detects an unhealthy position.
2. The bot calls `queueLiquidation(positionId)`.
3. The position enters the `LiquidationQueue` with a timestamp.

### Step 2: Grace Period
- Positions must remain in the queue for a mandatory **Grace Period** (e.g., 5 minutes).
- This prevents atomic price manipulation in a single block from triggering unfair liquidations.

### Step 3: Execution
1. After the grace period, any bot can call `executeLiquidation(positionId)`.
2. The `LiquidationEngine` calls `PerpEngine.liquidatePosition`.

## 3. Financial Settlement

### 3.1 Reward Capping
The protocol protects itself by capping the rewards paid to liquidators:
- **Nominal Reward:** $Reward = Size \times \text{Liquidation Fee Ratio}$
- **Actual Payout:** $\min(Reward, \text{Remaining Margin})$
This ensures that the protocol never pays out rewards for underwater positions from global liquidity.

### 3.2 Bad Debt Handling
If a position is so far underwater that its margin is $\leq 0$:
1. The position is closed entirely.
2. The remaining loss is recorded as **Total Bad Debt**.
3. Bad debt is recovered via the **Insurance Fund** using the `recoverBadDebt` administrative function.

## 4. Liquidator Incentives
- Liquidators receive a percentage of the position size as a reward.
- The incentive is dynamically adjusted based on market volatility and the length of the liquidation queue.
