# PerpArbitraDex External Audit Readiness Plan

This document prepares the protocol for a professional external security audit. It identifies high-risk areas, provides a security checklist, and maps out the documentation required for auditors.

## 1. High-Risk Scopes (Priority for Auditors)

| Module | Why it's critical |
| :--- | :--- |
| **PerpEngine.sol** | Managing margins, PnL, and collateral. Small errors lead to protocol insolvency. |
| **OracleAggregator.sol** | Multi-source logic and decimal normalization. Oracle manipulation is the #1 DeFi exploit vector. |
| **LiquidationEngine.sol** | `LiquidationQueue` jitter logic. Potential for stuck positions or MEV leakage if timing is exploitable. |
| **PositionMath.sol** | Complex math for liquidation prices and health factors using fixed-point arithmetic. |

---

## 2. Security Documentation Checklist

Auditors need a clear understanding of the "intended" behavior to find deviations.

- [x] **Technical Specification:** Expanded `ARCHITECTURE.md` explaining the flow of quote tokens and NFT ownership.
- [x] **Threat Model:** Documenting simulated scenarios (e.g., Pyth/Chainlink price divergence, low-liquidity vAMM skewing).
- [x] **Economic Safety Report:** Results from recent Foundry invariant tests (`InvariantEconomic.t.sol`).
- [ ] **Access Control Map:** Table of all `onlyGovernance`, `onlyTimelock`, and `onlyPerpEngine` modifiers.

---

## 3. Preparation Checklist (Pre-Audit)

### A. Code Quality
- [ ] Ensure all `require` statements have corresponding `revert CustomError()`.
- [x] Clean up all compilation warnings (unused variables, state mutability).
- [x] Ensure 100% test coverage on the math libraries (`PositionMath`, `SafeDecimalMath`).

### B. Deployment Consistency
- [ ] Provide a verified mainnet-equivalent deployment on a testnet (Arbitrum Sepolia).
- [ ] Share current `foundry.toml` and Hardhat configurations.

### C. Known Issues / Disclosures
- [ ] Document the current circular dependency in deployment (Engine ↔ Pool).
- [ ] Disclose the "Global vs Local" parameter migration status.

---

## 4. Suggested Audit Timeline (4 Weeks)

1.  **Week 1:** Core Logic & Math Validation. Focus on `PerpEngine` and `PositionMath`.
2.  **Week 2:** Oracle & External Integrations. Focus on `OracleAggregator` and `OracleSanityChecker`.
3.  **Week 3:** Economic Stress & MEV. Focus on `AMMPool` (skew) and `LiquidationQueue`.
4.  **Week 4:** Reporting & Fix Verification.

---

## 5. Potential Auditors

- **Tier 1:** OpenZeppelin, Trail of Bits (High cost, high prestige).
- **Tier 2:** Halborn, CertiK, Sherlock (Moderate cost, strong technical focus).
- **Tier 3:** Code4rena (Incentivized community audit - great for broad coverage).
