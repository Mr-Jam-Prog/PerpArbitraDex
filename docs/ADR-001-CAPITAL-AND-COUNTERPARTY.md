# ADR-001: Capital Isolation and Counterparty Settlement Architecture

## Context & Problem Statement

In perpetual DEX protocols, managing market counterparty risk, protocol solvency, and capital isolation is a primary design decision.

Prior iterations of the system combined price discovery, position tracking, margin management, and capital liquidity inside `PerpEngine.sol` and `AMMPool.sol`. This architecture created several systemic risks:
1. **Capital Mixing**: Trader collateral (margin) and liquidity provider (LP) capital were stored in the same smart contract balances, obscuring individual asset liabilities.
2. **Bad Debt Contagion**: Losses exceeding a trader's margin (bad debt) directly compromised trader collateral if the insurance fund was underfunded.
3. **Implicit Token Creation / Virtual Deficits**: Uncollateralized virtual PnL could trigger withdrawals that relied on unspent protocol fees or other traders' margins.

We need a clear, institutional-grade architecture that guarantees **100% collateralized counterparty payouts**, strictly segregates capital roles, and explicitly defines how bad debt and trader profits are settled.

---

## Decision Driver Metrics & Invariants

1. **Strict Counterparty Backing**: Every $1 of trader profit must be backed by a $1 loss from counter-traders or $1 of explicit LP capital in a dedicated vault. Zero implicit tokens or unbacked ledger credits.
2. **Capital Isolation**: LP capital, Trader Margin Deposits, Insurance Fund, and Protocol Fee Reserves must reside in distinct balances (or distinct dedicated contracts).
3. **Solvency Guarantee**: Bad debt must be strictly absorbed first by the trader's margin, second by the `InsuranceFund`, and third by the `LiquidityVault`. Trader margin deposits for uninvolved positions must **never** be touched to cover bad debt.
4. **Separation of Virtual Pricing and Real Capital**: `AMMPool` remains the virtual price discovery / skew model (vAMM), while a separate `LiquidityVault` carries actual ERC20 capital and handles settlements.

---

## Core Architecture & Component Responsibilities

```
                                +-------------------+
                                | OracleAggregator  |
                                +---------+---------+
                                          |
                                          v
+---------------+             +-----------+-----------+             +------------------+
| Trader / User | ----------> |    PerpEngine.sol    | ----------> |  LiquidationEngine |
+---------------+             +-----------+-----------+             +------------------+
                                     |         |
                  +------------------+         +------------------+
                  | (Virtual Skew / Mark Price)                   | (Settlements & Margins)
                  v                                               v
          +---------------+                               +---------------+
          |  AMMPool.sol  |                               | LiquidityVault|
          | (Virtual vAMM)|                               |  (LP Capital) |
          +---------------+                               +-------+-------+
                                                                  |
                                                                  v
                                                          +---------------+
                                                          | InsuranceFund |
                                                          +---------------+
```

### 1. `AMMPool.sol` (Virtual Price & Skew Model)
- **Role**: Pure virtual price discovery, funding rate calculation, and net market skew tracking.
- **Capital Held**: **Zero ERC20 Tokens**.
- **Functions**:
  - Computes mark price: $P_{\text{mark}} = P_{\text{index}} \times (1 + \text{Skew} / \text{SkewScale})$.
  - Calculates funding velocity and cumulative funding rate index.
  - Updates long/short open interest counters.

### 2. `PerpEngine.sol` (Position & Risk Engine)
- **Role**: Orchestrates position lifecycles (open, increase, decrease, close, liquidate), verifies risk parameters (leverage, health factors), and enforces liquidation triggers.
- **Capital Held**: Coordinates transfers through `LiquidityVault` (or holds isolated trader margins).

### 3. `LiquidityVault.sol` (Capital Pool & Counterparty Vault)
- **Role**: Holds LP quote token capital, receives trader net losses, pays trader net profits, and provides backstop liquidity for positions where LPs act as passive counterparties.
- **Accounting & Settlement Rules**:
  - **Trader Deposit**: Trader margin is deposited into isolated vault accounting.
  - **Trader Net Profit**: Paid out of `LiquidityVault` LP capital.
  - **Trader Net Loss**: Transferred from Trader Margin into `LiquidityVault` LP capital.
  - **LP Token (LP-Share)**: Represents proportional ownership of net vault quote capital.

### 4. `InsuranceFund.sol` (First-line Bad Debt Reserve)
- **Role**: Accumulates protocol fee shares and liquidation penalties to absorb bad debt before it impacts LP capital in `LiquidityVault`.

---

## Solvency Hypotheses & Waterfall Mechanics

### Bad Debt Waterfall Mechanics

When a position is liquidated with negative equity ($\text{Equity} < 0$, loss exceeding locked margin):

$$\text{BadDebt} = |\text{Equity}| = |\text{Margin} + \text{PnL} - \text{Funding}|$$

The settlement waterfall is strictly executed as follows:

1. **Step 1: Trader Margin Exhaustion**: The entire locked margin $M_i$ of the liquidated position is forfeited and applied against the loss.
2. **Step 2: Insurance Fund Drawdown**: `InsuranceFund.sol` covers $\min(\text{Balance}_{\text{IF}}, \text{BadDebt})$.
3. **Step 3: LiquidityVault LP Capital Drawdown**: If $\text{BadDebt} > \text{Balance}_{\text{IF}}$, the remaining deficit $\text{BadDebt} - \text{Balance}_{\text{IF}}$ is absorbed by `LiquidityVault.sol`, reducing LP share value (net asset value).
4. **Step 4: Auto-Deleveraging (ADL) / Socialized Loss (Fallback)**: If total protocol equity across `LiquidityVault` approaches zero, highly profitable counter-positions are systematically auto-deleveraged at mark price to restore system balance.

---

## Stress Scenarios & Verification Matrix

| Stress Scenario | Protocol Impact | Defense Mechanism | Result |
| :--- | :--- | :--- | :--- |
| **50% Instant Market Flash Crash** | Heavy long position liquidations; potential bad debt from oracle gap. | Insurance Fund absorbs bad debt; remaining deficit falls on `LiquidityVault`. | Trader deposits in un-liquidated positions remain 100% safe. |
| **90% One-Sided Long Skew** | Funding rates spike exponentially to incentivize short positions. | Funding payments paid by longs to shorts / LPs; `AMMPool` velocity cap prevents unbounded rate runaway. | System skew naturally equilibrates or short positions earn high yield. |
| **Oracle Stale / Pause Event** | Trade execution halts via `OracleAggregator` freshness check. | `marketActive` modifier / circuit breaker reverts any opening or margin removal. | No toxic trades executed against stale prices. |
| **Complete Insurance Fund Exhaustion** | Insurance Fund balance reaches 0. | `LiquidityVault` absorbs bad debt via LP capital waterfall; ADL queue activates if vault NAV falls below minimum threshold. | Protocol remains operational without cascading insolvency. |

---

## Alternatives Considered & Rejected

### Alternative 1: Combined Monolithic Contract (`PerpEngine` holding all LP capital + Margin)
- **Rejected Because**: High blast radius, vulnerable to reentrancy attacks between margin deposits and LP withdrawals, complex auditing, and lack of modular separation.

### Alternative 2: Virtual Liquidity without LP Collateral (Pure Peer-to-Peer Matching)
- **Rejected Because**: Highly illiquid for long-tail markets; required exact matching buyers and sellers for every trade; unacceptable execution slippage during high volatility.

### Alternative 3: Socialized Loss / Auto-Deleveraging as First Defense
- **Rejected Because**: Degrades user experience for profitable traders by penalizing winning positions before utilizing protocol reserves or LP backstops.

---

## Status & Implementation Roadmap

- **Status**: **APPROVED ARCHITECTURAL DIRECTION**
- **Phase 1 (Current PR)**: Formalized math spec (`docs/ECONOMIC_SPEC.md`), architectural ADR (`docs/ADR-001-CAPITAL-AND-COUNTERPARTY.md`), and TypeScript executable reference model (`packages/math/`).
- **Phase 2 (Subsequent Task 13B)**: Implement permissioned entry points and `LiquidityVault.sol` contract integration in core smart contracts.
