# Prompt 08D-R1 v2 — Reproducible AST-Backed Security Triage Report

## Executive Summary
- **Base Commit**: `a19a55107f480754d8916432a3ca95cde936abb2`
- **Head Commit**: `aadb9df75af77c2d81aaec70c156f00e0e8b6ab3`
- **Production Solidity Modifications**: `0` (`PRODUCTION_SOLIDITY_CHANGE=0`)
- **Audit Toolchain**: Committed under `scripts/security/08d/` (`OUT_OF_REPO_AUDIT_TOOL_DEPENDENCY=0`)
- **Total Production Compiler Warnings Triaged**: `623`
- **Total Audited AST Symbols**: `853`
- **Root Findings Identified**: `11`
  - **SECURITY_BLOCKER Root Findings**: `10`
  - **ECONOMIC_OR_LOGIC_CHANGE_REQUIRED Root Findings**: `0`
  - **SECURITY_REVIEW_REQUIRED Root Findings**: `0`
  - **CONTEXTUAL_ACCEPTED Root Findings**: `1`

---

## Machine-Readable Ledger Source of Truth
This report is programmatically generated from canonical machine-readable ledgers:
- `docs/security/08D_FINDINGS_LEDGER.json`
- `docs/security/08D_ROOT_FINDINGS.json`
- `docs/security/08D_FUNCTION_AUDIT.json`
- `docs/security/08D_GLOBAL_AUDIT_RULES.json`
- `docs/security/08D_SYMBOL_TABLE.json`

---

## Root Findings Inventory

### SECURITY_BLOCKER Root Findings (10 Items)
1. **AaveFlashLoanIntegrator Hardcoded Price Returns Constant Value in Profitability Estimation** (`ROOT_AAVE_ORACLE_HARDCODED`)
   - **Contracts**: `contracts/integration/AaveFlashLoanIntegrator.sol` (AaveFlashLoanIntegrator._getOraclePrice(uint256), AaveFlashLoanIntegrator.estimateProfitability(uint256,uint256))
   - **Execution Path**: estimateProfitability -> _getOraclePrice returns hardcoded 1000 * 1e8 value
   - **Reachability Status**: `CONDITIONALLY_REACHABLE`
   - **Consequence**: Keeper / automation profitability estimation receives constant price, causing incorrect keeper decisions (skipping profitable candidates or attempting unprofitable ones). Note: price is not called in execution callback.
   - **Remediation Gate**: *Aave Flash Loan Integrator Price Oracle Integration Gate*

2. **CrossChainMessenger Privileged retryMessage Omits Transport Source Address Validation** (`ROOT_CROSS_CHAIN_UNTRUSTED_REMOTE`)
   - **Contracts**: `contracts/integration/CrossChainMessenger.sol` (CrossChainMessenger.retryMessage(uint16,bytes,uint64,bytes))
   - **Execution Path**: retryMessage requires onlyMessenger role (granted to perpEngine) but accepts srcAddress calldata without verifying against trustedRemoteLookup
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Privileged retry path does not revalidate transport source identity, violating cross-chain trust-boundary consistency.
   - **Remediation Gate**: *Cross-Chain Message Source Address Authentication Gate*

3. **CrossChainMessenger Transport Nonce Unbound to Inner Message Nonce** (`ROOT_CROSS_CHAIN_NONCE_UNBOUND`)
   - **Contracts**: `contracts/integration/CrossChainMessenger.sol` (CrossChainMessenger._validateMessage(struct,uint16,uint64))
   - **Execution Path**: _validateMessage accepts transport nonce argument but evaluates inner message.nonce instead
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Transport-level nonce is unbound to payload message.nonce. Exact payload replay is prevented by executedMessages[messageId], but transport delivery ordering guarantees are bypassed.
   - **Remediation Gate**: *Cross-Chain Transport Nonce Binding & Replay Protection Gate*

4. **RiskManager Concentration Limit Bypassed via Hardcoded Zero Open Interest** (`ROOT_RISK_CONCENTRATION_HARDCODED_OI`)
   - **Contracts**: `contracts/core/RiskManager.sol` (RiskManager._getConcentrationLimit(uint256))
   - **Execution Path**: _getConcentrationLimit sets totalOI = 0 hardcoded placeholder
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Position concentration limits fall back to default limit, bypassing dynamic market open interest limits.
   - **Remediation Gate**: *RiskManager Open Interest & Trader Concentration Enforcement Gate*

5. **TimelockController Critical Operation Verification Stub Always Returns False** (`ROOT_TIMELOCK_CRITICAL_OP_DISABLED`)
   - **Contracts**: `contracts/governance/TimelockController.sol` (PerpDexTimelock._isCriticalOperation(address,bytes))
   - **Execution Path**: schedule -> _isCriticalOperation returns hardcoded false stub
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Critical governance operations bypass extended timelock delays.
   - **Remediation Gate**: *Timelock Critical Operation Verification & Governance Delay Gate*

6. **OracleAggregator getTWAP Returns Current Spot Price Ignoring Period** (`ROOT_ORACLE_AGGREGATOR_TWAP_SPOT`)
   - **Contracts**: `contracts/oracles/OracleAggregator.sol` (OracleAggregator.getTWAP(bytes32,uint256))
   - **Execution Path**: getTWAP(feedId, period) ignores period parameter and returns spot price
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: TWAP consumers receive spot prices, leaving protocol vulnerable to single-block price manipulation.
   - **Remediation Gate**: *Oracle Aggregator Time-Weighted Average Price Implementation Gate*

7. **AMMPool getTWAFundingRate Returns Instantaneous Current Rate** (`ROOT_AMM_POOL_TWA_FUNDING_CURRENT`)
   - **Contracts**: `contracts/core/AMMPool.sol` (AMMPool.getTWAFundingRate(uint256,uint256))
   - **Execution Path**: getTWAFundingRate(marketId, period) ignores period parameter and returns current funding rate
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Time-weighted funding rate queries return instantaneous values, skewing funding rate calculations.
   - **Remediation Gate**: *AMM Pool Time-Weighted Funding Rate Calculation Gate*

8. **Treasury executeWithdrawal Uncapped Raw ETH Transfer Prior to State Deletion** (`ROOT_TREASURY_RAW_ETH_ORDERING`)
   - **Contracts**: `contracts/governance/Treasury.sol` (Treasury.executeWithdrawal(address,address,uint256), Treasury.scheduleWithdrawal(address,address,uint256,bytes32))
   - **Execution Path**: executeWithdrawal calls to.call{value: amount} before deleting scheduledWithdrawals[operationId]. Note: currently blocked because scheduleWithdrawal rejects token == address(0) and operation ID hashes diverge.
   - **Reachability Status**: `CURRENTLY_BLOCKED_BY_OTHER_DEFECT`
   - **Consequence**: Latent reentrancy vulnerability in ETH withdrawal execution path.
   - **Remediation Gate**: *Treasury ETH Transfer Ordering & Reentrancy Guard Gate*

9. **AMMPool emergencyResetSkew Exposed Control API Always Reverts** (`ROOT_AMM_POOL_EMERGENCY_RESET_DISABLED`)
   - **Contracts**: `contracts/core/AMMPool.sol` (AMMPool.emergencyResetSkew(uint256))
   - **Execution Path**: emergencyResetSkew external call reverts unconditionally with 'AMMPool: emergencyResetSkew disabled'
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: Emergency control to reset skewed AMM pool state is permanently unavailable during emergency conditions.
   - **Remediation Gate**: *AMM Pool Emergency Skew Reset Functional Availability Gate*

10. **CrossChainMessenger LayerZero / EVM Chain Identity Namespace Mismatch** (`ROOT_CROSS_CHAIN_LAYERZERO_NAMESPACE_MISMATCH`)
   - **Contracts**: `contracts/integration/CrossChainMessenger.sol` (CrossChainMessenger._validateMessage(struct,uint16,uint64))
   - **Execution Path**: _validateMessage checks message.dstChainId == uint16(block.chainid)
   - **Reachability Status**: `ACTIVE_REACHABLE`
   - **Consequence**: LayerZero endpoint chain IDs do not equal EVM block.chainid, causing message validation to fail or misidentify chains.
   - **Remediation Gate**: *Cross-Chain Chain ID Type Safety & Safe Casting Gate*

---

## Triage Integrity Metrics
- **UNMAPPED_PRODUCTION_DIAGNOSTICS**: `0`
- **DUPLICATE_DIAGNOSTIC_MAPPING**: `0`
- **UNKNOWN_SOURCE_SYMBOLS**: `0`
- **ROOT_WITHOUT_EVIDENCE**: `0`
- **DIAGNOSTIC_WITHOUT_DISPOSITION**: `0`
- **GENERIC_OR_TEMPLATED_SECURITY_RATIONALES**: `0`
- **FUNCTIONS_WITH_FABRICATED_TEST_COVERAGE**: `0`
- **AST_ENTRYPOINT_SET_MISMATCH**: `0`
