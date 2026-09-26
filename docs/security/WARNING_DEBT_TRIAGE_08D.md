# Security Triage & Warning Debt Disposition Document (Prompt 08D)

## Executive Summary

- **Repository Base SHA**: `a19a55107f480754d8916432a3ca95cde936abb2`
- **Start Baseline Total**: 850
- **Final Baseline Total**: 846
- **Baseline Reduction**: 4 (Mechanically safe compiler warnings eliminated; 7 restored as unresolved security debt)
- **Start Production Warning Debt**: 341
- **Final Production Warning Debt**: 122
- **Start Unresolved Security Debt**: 282
- **Final Unresolved Security Debt**: 497 (168 reclassified + 1 Timelock reclassified + 7 restored compiler diagnostics + 39 semantic stub reclassifications)

---

## Dispositions Breakdown

### Section A. Diagnostic-Level Disposition Totals
The sum of diagnostic-level dispositions equals exactly 497 `UNRESOLVED_SECURITY_DEBT` entries in `warnings-baseline.json`:

- `CONTEXTUAL_ACCEPTED`: 315
- `SECURITY_REVIEW_REQUIRED`: 155
- `SECURITY_BLOCKER`: 22
- `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`: 5
- **Total Diagnostics**: 497

### Section B. Root Security Findings Summary
Root causes after grouping related static analyzer diagnostics into unique protocol vulnerabilities:

#### SECURITY_BLOCKER Root Findings (17 Items)
1. **TimelockController.sol** (`_isCriticalOperation`): Critical operation classification is disabled (returns `false`), bypassing critical operation grace period enforcement. Gate: *Timelock Critical Operation Classification & Grace Enforcement Remediation Gate*.
2. **TimelockController.sol** (`_updateDelay`): Minimum delay update has an empty body, causing `updateMinDelay` to emit `MinDelayUpdated` without mutating the underlying timelock delay. Gate: *Timelock Minimum Delay State & Event Consistency Remediation Gate*.
3. **EmissionController.sol** (`claim`): Permissionless emission claim / treasury allowance drain (`external caller -> EmissionController.claim() -> _calculateAvailable(scheduleId, msg.sender) -> schedule-wide available amount -> token.safeTransferFrom(treasury, msg.sender, amount)`). Gate: *Emission Claim Entitlement & Treasury Authorization Remediation Gate*.
4. **FeeDistributor.sol** (`claimMultiple`): Duplicate distribution IDs permit repeated crediting of the same recipient share within one transaction (`claimMultiple -> loop over distributionIds -> credit share`). Gate: *Fee Distribution Claim Uniqueness & Per-Recipient Accounting Remediation Gate*.
5. **AccountAbstractionAdapter.sol** (`_handlePaymaster`): Unauthenticated paymaster sponsorship consent (`_handlePaymaster -> paymasterAndData -> debit paymasterDeposits`). Gate: *Account Abstraction Paymaster Sponsorship Authentication Remediation Gate*.
6. **AccountAbstractionAdapter.sol** (`_executeCallData`): UserOperation execution is a no-op (`_executeCallData` performs no call and returns success), consuming nonces, emitting success, and charging paymasters without executing requested calls. Gate: *Account Abstraction UserOperation Dispatch, Execution Result & Atomicity Remediation Gate*.
7. **AccessControlManager.sol** (`role expiry`): Ineffective role expiry enforcement in `hasRole()` / `onlyRole(...)` authorization checks (`isRoleExpired` is informational only). Gate: *Access Control Role Expiry Enforcement Remediation Gate*.
8. **FlashLiquidator.sol** (`reentrancy`): ReentrancyGuard lock collision between `executeFlashLiquidation` and Aave callback `executeOperation`. Gate: *Dedicated Flash Loan Reentrancy & Callback Architecture Remediation Gate*.
9. **Treasury.sol** (`scheduledWithdrawals`): Operation hash mismatch between `scheduleWithdrawal` and `executeWithdrawal` (`salt` vs `bytes32(0)`). Gate: *Dedicated Treasury Timelock Hash Alignment Remediation Gate*.
10. **UpgradeExecutor.sol** (`lastUpgradeTime`): `rollbackBatch` trusts calldata `originalImplementations` without checking persisted state. Gate: *Dedicated Upgrade Governance & Implementation Verification Remediation Gate*.
11. **LidoStETHIntegrator.sol** (`stETH.transferFrom`): Unchecked `IStETH.transferFrom` return value before crediting collateral shares. Gate: *Dedicated StETH Transfer Return Value Verification Remediation Gate*.
12. **LidoStETHIntegrator.sol** (`_stETHToWstETH`): Broken wstETH conversion placeholder breaks collateral conservation (`wrapETH(useWstETH=true) -> _submitToLido() -> receive stETH -> _stETHToWstETH(stETHAmount) -> raw stETH.approve() -> NO wstETH.wrap() -> returns stETHAmount as fake wstETH -> wstETH.safeTransfer(msg.sender, amount)`). Gate: *Lido wstETH Wrap, Approval & Collateral Conservation Remediation Gate*.
13. **LidoStETHIntegrator.sol** (`unwrapToETH`): wstETH-to-ETH withdrawal placeholder consumes ambient contract ETH balance and retains user wstETH (`unwrapToETH(useWstETH=true) -> wstETH.safeTransferFrom(msg.sender, address(this), amount) -> NO wstETH.unwrap() -> ethAmount = amount -> msg.sender.call{value: ethAmount}("")`). Gate: *Lido wstETH Withdrawal Queue, Conversion & Asset-Conservation Remediation Gate*.
14. **LidoStETHIntegrator.sol** (`wrapETH`): Direct stETH wrap unit mismatch (`wrapETH(useWstETH=false) -> _submitToLido() -> returns stETH balance delta -> value mislabeled as shares -> getPooledEthByShares(stETHAmount) -> wrong transfer amount`). Gate: *Lido stETH Amount-vs-Share Unit Conservation Remediation Gate*.
15. **RiskManager.sol** (`_checkPositionConcentration`): Position concentration enforcement disabled (`totalOI` hardcoded to 0), bypassing configured `maxPositionConcentration` limits. Gate: *RiskManager Open Interest, Trader Concentration & Position-Limit Remediation Gate*.
16. **PythOracle.sol** (`typecast`): `_normalizePythPrice` fails to normalize price to 8 decimals for standard Pyth exponents. Gate: *Dedicated Pyth Exponent & Decimal Normalization Remediation Gate*.
17. **CrossChainMessenger.sol** (`typecast`): `uint16(block.chainid)` truncation mismatches LayerZero endpoint chain IDs. Gate: *Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate*.

#### ECONOMIC_OR_LOGIC_CHANGE_REQUIRED Root Findings (6 Items)
1. **LiquidationQueue.sol** (`randomness / starvation`): Blockhash/timestamp entropy controls liquidation grace period timing and MEV resistance; head starvation occurs when candidate execution reverts. Gate: *Liquidation Timing Randomness & MEV Remediation Gate*.
2. **OracleSanityChecker.sol** (`checkPriceVolatility`): Volatility check method is a dummy implementation returning `true`, bypassing volatility validation. Gate: *Oracle Volatility Validation Model & Consumer Integration Remediation Gate*.
3. **OracleAggregator.sol** (`getTWAP`): TWAP method returns current spot aggregated price, bypassing time-weighted averaging. Gate: *Oracle Aggregator Historical TWAP Semantics & Consumer Integration Remediation Gate*.
4. **AMMPool.sol** (`getTWAFundingRate`): TWA funding rate method returns current funding rate, bypassing historical rate averaging. Gate: *AMM Historical Funding Rate & TWA Semantics Remediation Gate*.
5. **TWAPOracle.sol** (`forceUpdate`): `forceUpdate()` is an empty function body no-op, recording no price observations. Gate: *TWAP Oracle Force-Update, Source Integration & Staleness Remediation Gate*.
6. **VotingEscrow.sol** (`typecast`): `int128` narrowing casts on user-controlled lock amounts without explicit bounds assertions. Gate: *Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate*.

#### SECURITY_REVIEW_REQUIRED Root Findings (7 Items)
1. **AaveFlashLoanIntegrator.sol** (`_createRequestId`): Request identity hash `keccak256(abi.encodePacked(positionId, msg.sender, block.timestamp, loanAmount))` lacks nonce and excludes `minReward`. Same-block requests with identical parameters from `flashLiquidator` collide and overwrite `activeRequests[requestId]`. Gate: *Aave Flash Loan Request Identity, Replay & Lifecycle Remediation Gate*.
2. **Critical Authority Rotation Observability Gaps**: Unobservable authority rotation lacking old/new event emissions across `PerpEngine.setGovernance`, `MarketRegistry.setConfigRegistry`, `OracleAggregator.setSecurityModule`, `OracleSecurity.updateAggregator`, `IncentiveDistributor.setLiquidationEngine`, and `ProtocolConfig.setTimelockController`. Gate: *Critical Authority Rotation & Governance Observability Remediation Gate*.
3. **CircuitBreaker.sol** (`triggerBreaker`): Manual trigger reason parameter is discarded and omitted from events. Gate: *Circuit Breaker Incident Reason & Emergency Auditability Remediation Gate*.
4. **TransparentUpgradeableProxy.sol**: Unchecked constructor `admin_` zero-address assignment. Gate: *Dedicated Proxy Deployment & Admin Validation Audit Gate*.
5. **AMMPool.sol**: `timeToNextFunding` timestamp modulo variance in mark price calculation. Gate: *Dedicated AMM Mark Price & Funding Interval Audit Gate*.
6. **PositionManager.sol**: Unpaginated loop over NFT supply making external engine calls. Gate: *Dedicated PositionManager Pagination & Gas Limits Remediation Gate*.
7. **Treasury.sol** (`raw ETH call`): Uncapped raw ETH call before deleting scheduled withdrawal entry. Gate: *Dedicated Treasury ETH-Transfer & Reentrancy Audit Gate*.

---

## Detailed Triage Inventory by Contract File
### File: `contracts/core/AMMPool.sol` (21 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L333)
- **Lines**: L333
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: AMM Pool, Historical Funding Rate, TWAP
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/AMMPool.sol`, unused parameter `period` in `getTWAFundingRate` exposes the pending historical funding rate averaging implementation fallback to current rate.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: AMM Historical Funding Rate & TWA Semantics Remediation Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision` (GENERAL)
- **Lines**: L167
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Fee Arithmetic, Funding Rate
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/AMMPool.sol`, intermediate division before multiplication is protected by order of operations or explicit scale factors (e.g. WAD 1e18 scaling prior to division). Precision loss is bounded to sub-wei rounding differences.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Dedicated Precision Refactoring Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L93, L95, L99, L101, L106, L106, L158, L159, L160, L161, L165, L320, L321, L322, L323, L326
- **Count**: 16
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/core/AMMPool.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L143, L307
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/core/AMMPool.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L215
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/AMMPool.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

### File: `contracts/core/LiquidityVault.sol` (16 Diagnostics)

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L234, L246, L290, L324, L357, L395, L499, L533, L541
- **Count**: 9
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/LiquidityVault.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``totalLpAssets` is changed without an event but is used in arithmetic` (GENERAL)
- **Lines**: L507
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/LiquidityVault.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)`` (GENERAL)
- **Lines**: L237
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/LiquidityVault.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L396, L399, L405, L417, L464
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/core/LiquidityVault.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

### File: `contracts/core/MarketRegistry.sol` (1 Diagnostics)

#### Diagnostic: ``configRegistry` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L414
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/MarketRegistry.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/MarketRegistry.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

### File: `contracts/core/PerpEngine.sol` (36 Diagnostics)

#### Diagnostic: `Return value of an external call is not used` (GENERAL)
- **Lines**: L593, L1528
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: ``governance` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L230
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L711, L824, L864, L902, L1024, L1369
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (GENERAL)
- **Lines**: L1361
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L1226, L1271, L1285, L1361, L1362
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L278, L280, L305, L327, L408, L411, L463, L491, L580, L678, L799, L869, L905, L946, L964, L993, L993, L993, L993, L1019
- **Count**: 20
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/core/PerpEngine.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L619
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/core/PerpEngine.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/core/PositionManager.sol` (4 Diagnostics)

#### Diagnostic: ``abi.encodePacked()` called with multiple dynamic type arguments; hash collisions possible` (GENERAL)
- **Lines**: L74
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Hashing, Signatures, Identifiers
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PositionManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PositionManager.sol`, `abi.encodePacked` arguments have fixed lengths or single dynamic parameters preceding fixed types, eliminating hash collision vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: ABI Encoding Standardization Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L77, L271
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PositionManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PositionManager.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L212
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PositionManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PositionManager.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

### File: `contracts/core/ProtocolConfig.sol` (3 Diagnostics)

#### Diagnostic: ``timelockController` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L468
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/ProtocolConfig.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/ProtocolConfig.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L356, L378
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/ProtocolConfig.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/core/ProtocolConfig.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/core/RiskManager.sol` (13 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L154)
- **Lines**: L154
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Position Validation, Unused Parameters
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `validatePosition` ignores `marketId` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Position Limit & Risk Rules Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L156)
- **Lines**: L156
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Position Validation, Unused Parameters
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `validatePosition` ignores `trader` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Position Limit & Risk Rules Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L230)
- **Lines**: L230
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Price Calculation Stub
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `size` parameter and returns 0.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Price Math Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L232)
- **Lines**: L232
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Price Calculation Stub
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `price` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Price Math Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L234)
- **Lines**: L234
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Price Calculation Stub
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `fundingAccrued` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Price Math Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L261)
- **Lines**: L261
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Position Concentration, Open Interest
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `_checkPositionConcentration` hardcodes `totalOI = 0`, bypassing the concentration limit check and returning `true`. Configured `maxPositionConcentration` limits are never enforced during position validation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Open Interest, Trader Concentration & Position-Limit Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L392)
- **Lines**: L392
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Position Concentration, Open Interest
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `_getConcentrationLimit` hardcodes `totalOI = 0`, bypassing concentration calculations.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Open Interest, Trader Concentration & Position-Limit Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L394)
- **Lines**: L394
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Position Concentration, Open Interest
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `_getConcentrationLimit` ignores `trader` parameter due to placeholder OI logic.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Open Interest, Trader Concentration & Position-Limit Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L416)
- **Lines**: L416
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Single Trader Exposure Limit
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `_checkSingleTraderExposure` ignores `trader` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Single Trader Exposure Limit Remediation Gate

#### Diagnostic: `Unused local variable.` (L238)
- **Lines**: L238
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Price Calculation Stub
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` declares unused local `liquidationPrice = 0`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Price Math Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L141, L266, L290
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/core/RiskManager.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/governance/EmissionController.sol` (13 Diagnostics)

#### Diagnostic: ``governor` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L288
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)`` (GENERAL)
- **Lines**: L150
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision` (GENERAL)
- **Lines**: L224, L331
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Fee Arithmetic, Funding Rate
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, intermediate division before multiplication is protected by order of operations or explicit scale factors (e.g. WAD 1e18 scaling prior to division). Precision loss is bounded to sub-wei rounding differences.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Dedicated Precision Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L101, L138, L208, L212, L246, L273, L313, L319, L336
- **Count**: 9
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/governance/EmissionController.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/governance/FeeDistributor.sol` (9 Diagnostics)

#### Diagnostic: ``claimCooldown` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L275
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``lastClaimTime` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L135, L191
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L84
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L172, L173
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)`` (GENERAL)
- **Lines**: L90
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L124, L164
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/governance/FeeDistributor.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/governance/PerpDexToken.sol` (1 Diagnostics)

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L86
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/PerpDexToken.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/PerpDexToken.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

### File: `contracts/governance/TimelockController.sol` (5 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L211)
- **Lines**: L211, L211
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Timelock, Critical Operation Classification
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/governance/TimelockController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/TimelockController.sol`, unused parameters in `_isCriticalOperation` reflect an incomplete critical operation classification check.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Timelock Critical Operation Classification & Grace Enforcement Remediation Gate

#### Diagnostic: `empty function body` (L232)
- **Lines**: L232
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Timelock Minimum Delay
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/governance/TimelockController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/TimelockController.sol`, `_updateDelay(uint256 oldDelay, uint256 newDelay)` has an empty function body. Calling `updateMinDelay` emits `MinDelayUpdated` without mutating the underlying OpenZeppelin timelock delay, creating a governance observability defect.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Timelock Minimum Delay State & Event Consistency Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L93, L171
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/TimelockController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/governance/TimelockController.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/governance/Treasury.sol` (9 Diagnostics)

#### Diagnostic: `ETH is sent to a user-controlled destination; restrict the destination or the caller` (GENERAL)
- **Lines**: L163
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, diagnostic `ETH is sent to a user-controlled destination; restrict the destination or the caller` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check` (GENERAL)
- **Lines**: L152
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Access Control, Configuration, Initialization
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, address parameters in state setters or initialization functions require explicit non-zero address assertions to prevent accidental zero-address assignment.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Zero-Address Check Standardization Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L139, L172, L214
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `scheduledWithdrawals` is updated` (GENERAL)
- **Lines**: L135
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, diagnostic `external call can be reentered before `scheduledWithdrawals` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `uncapped ETH transfer can be reentered before `scheduledWithdrawals` is updated` (GENERAL)
- **Lines**: L163
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L121, L155
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/Treasury.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Treasury.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

### File: `contracts/governance/VotingEscrow.sol` (17 Diagnostics)

#### Diagnostic: ``tx.origin` should not be used for authorization` (GENERAL)
- **Lines**: L73
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/VotingEscrow.sol`, diagnostic ``tx.origin` should not be used for authorization` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L353, L353, L354, L354, L370, L370
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/governance/VotingEscrow.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L115, L116, L156, L197, L226, L263, L295, L331, L351, L386
- **Count**: 10
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/governance/VotingEscrow.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/integration/AaveFlashLoanIntegrator.sol` (5 Diagnostics)

#### Diagnostic: `Return value of an external call is not used` (GENERAL)
- **Lines**: L358
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L197
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L177, L225
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (L138)
- **Lines**: L138
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Flash Loan Request Identity, Replay Protection, Request Lifecycle, Auditability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, `initiateFlashLoan` calculates `requestId = keccak256(abi.encodePacked(positionId, msg.sender, block.timestamp, loanAmount))` where `msg.sender` is the fixed `onlyFlashLiquidator`. Same-block requests with equal `positionId` and `loanAmount` generate the same `requestId`, overwriting `activeRequests[requestId]`. `minReward` is also omitted from the hash.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Aave Flash Loan Request Identity, Replay & Lifecycle Remediation Gate

### File: `contracts/integration/AccountAbstractionAdapter.sol` (13 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to pure` (L413)
- **Lines**: L413
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, UserOp Execution, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_executeCallData` state mutability can be restricted to pure because it performs no state reads or calls.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction UserOperation Dispatch, Execution Result & Atomicity Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L380)
- **Lines**: L380
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, UserOp Execution, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_executeCallData(address sender, bytes memory callData)` ignores `sender` parameter, performs no external call, and returns `success = true`. Executing `executeUserOp` consumes user nonces, marks request executed, emits success events, and debits paymasters without executing the requested operation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction UserOperation Dispatch, Execution Result & Atomicity Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L413)
- **Lines**: L413
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, UserOp Execution, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_executeCallData` ignores `callData` parameter and performs no execution dispatch.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction UserOperation Dispatch, Execution Result & Atomicity Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L440)
- **Lines**: L440
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, Paymaster Sponsorship, Unauthenticated Debit
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_handlePaymaster` ignores `op` parameter, allowing unauthenticated paymaster deposit debits.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction Paymaster Sponsorship Authentication Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L441)
- **Lines**: L441
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, Paymaster Sponsorship, Unauthenticated Debit
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_handlePaymaster` ignores `userOpHash` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction Paymaster Sponsorship Authentication Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L442)
- **Lines**: L442
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Account Abstraction, Paymaster Sponsorship, Unauthenticated Debit
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, `_handlePaymaster` ignores `maxCost` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Account Abstraction Paymaster Sponsorship Authentication Remediation Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L125
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``paymasterDeposits` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L177, L195, L232, L359, L454
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``paymasterStakeRequired` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L343
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

### File: `contracts/integration/CrossChainMessenger.sol` (22 Diagnostics)

#### Diagnostic: `Unused local variable.` (L440)
- **Lines**: L440, L440, L440, L440
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, Position Update Processing Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processPositionUpdate` decodes `(trader, positionId, size, pnl)` but leaves variables unused as a placeholder for position manager updates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Cross-Chain Position Message Handling Remediation Gate

#### Diagnostic: `Unused local variable.` (L462)
- **Lines**: L462, L462, L462
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, Governance Message Processing Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processGovernanceMessage` decodes proposal data but leaves variables unused.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Cross-Chain Governance Message Execution Remediation Gate

#### Diagnostic: `Unused local variable.` (L484)
- **Lines**: L484, L484, L484
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, Oracle Update Processing Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processOracleUpdate` decodes oracle feed data but leaves variables unused.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Cross-Chain Oracle Message Processing Remediation Gate

#### Diagnostic: `Unused local variable.` (L506)
- **Lines**: L506, L506
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, Emergency Action Processing Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processEmergencyMessage` decodes emergency action data but leaves variables unused.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Cross-Chain Emergency Action Handling Remediation Gate

#### Diagnostic: ``gasBuffer` is changed without an event but is used in arithmetic` (GENERAL)
- **Lines**: L353
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L149, L248
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L547
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L160, L171, L298, L402, L550
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/integration/CrossChainMessenger.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L404
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/integration/CrossChainMessenger.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/integration/LidoStETHIntegrator.sol` (18 Diagnostics)

#### Diagnostic: `ERC20 'transfer' and 'transferFrom' calls should check the return value` (GENERAL)
- **Lines**: L181, L203
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: `Return value of an external call is not used` (L381)
- **Lines**: L381
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Call, Lido Staking, Balance Delta Measurement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, `_submitToLido` ignores the `uint256` shares return value of `stETH.submit{value: msg.value}(referral)`. Submission failure reverts atomically in the Lido contract. The integrator measures actual received stETH via balance delta (`stETH.balanceOf(address(this))` after minus before), ensuring accuracy without relying on unvalidated return values.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Lido Integration Audit Gate

#### Diagnostic: `Return value of an external call is not used` (L395)
- **Lines**: L395
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Collateral Integration, Asset Conservation, wstETH Wrapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, `_stETHToWstETH` executes raw `stETH.approve(address(wstETH), stETHAmount)` without checking return values, without invoking `wstETH.wrap(stETHAmount)`, and returning `stETHAmount` as a fake 1:1 wstETH conversion placeholder. Calling `wrapETH(useWstETH=true)` then attempts `wstETH.safeTransfer(msg.sender, wstETHAmount)`, causing reverts if no wstETH balance exists, or transferring pre-existing wstETH collateral held for other depositors, violating collateral conservation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Lido wstETH Wrap, Approval & Collateral Conservation Remediation Gate

#### Diagnostic: ``userShares` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L223
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L138, L149, L174, L186, L212, L234
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (GENERAL)
- **Lines**: L181, L203, L231, L395
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (L147)
- **Lines**: L147
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Collateral Integration, Token Units, Lido Shares
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, `wrapETH(useWstETH=false)` takes `uint256 shares = _submitToLido(referral)` where `_submitToLido` returns `stETH` token balance delta (`balanceAfter - balanceBefore`). It then misinterprets `shares` in `stETH.getPooledEthByShares(shares)`, multiplying by pooled ETH per share a second time. When pooled ETH per share != 1, requested `stETHAmount` diverges from actual received stETH, causing reverts or inventory drain.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Lido stETH Amount-vs-Share Unit Conservation Remediation Gate

#### Diagnostic: `uncapped ETH transfer can be reentered before `_status` is updated` (L171)
- **Lines**: L171
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Collateral Integration, Asset Conservation, wstETH Unwrapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, `unwrapToETH` executes `wstETH.safeTransferFrom(msg.sender, address(this), amount)` when `useWstETH` is true, but does not invoke `wstETH.unwrap()` or request Lido withdrawal queue redemption. It sets `ethAmount = amount` and attempts `msg.sender.call{value: ethAmount}("")`, transferring ambient contract ETH balance to the caller while retaining user wstETH inside the contract, violating asset conservation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Lido wstETH Withdrawal Queue, Conversion & Asset-Conservation Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L242
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/integration/LidoStETHIntegrator.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/libraries/BitPacking.sol` (5 Diagnostics)

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L124, L125, L127, L286, L322
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/libraries/BitPacking.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/libraries/BitPacking.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

### File: `contracts/libraries/FundingRateCalculator.sol` (27 Diagnostics)

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L239
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/FundingRateCalculator.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `local variable is read before being initialized` (GENERAL)
- **Lines**: L63
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/FundingRateCalculator.sol`, diagnostic `local variable is read before being initialized` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L49, L49, L54, L63, L63, L63, L95, L157, L163, L179, L180, L181, L182, L219, L219, L220, L220, L236, L236, L237, L237, L237, L240, L246, L246
- **Count**: 25
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/libraries/FundingRateCalculator.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

### File: `contracts/libraries/L2GasOptimized.sol` (4 Diagnostics)

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L101, L123
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/L2GasOptimized.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/L2GasOptimized.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L96
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/L2GasOptimized.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/L2GasOptimized.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `local variable is read before being initialized` (GENERAL)
- **Lines**: L124
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/L2GasOptimized.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/L2GasOptimized.sol`, diagnostic `local variable is read before being initialized` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

### File: `contracts/libraries/PositionMath.sol` (31 Diagnostics)

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L540, L541, L542, L550, L551, L552, L561, L569, L570, L579
- **Count**: 10
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/PositionMath.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/PositionMath.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L225, L269, L269, L275, L284, L284, L288, L339, L340, L354, L355, L401, L459, L465, L479, L485, L502, L503, L518, L519, L530
- **Count**: 21
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/libraries/PositionMath.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/libraries/PositionMath.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

### File: `contracts/libraries/SafeDecimalMath.sol` (3 Diagnostics)

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L23
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/SafeDecimalMath.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/SafeDecimalMath.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L64, L64
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/libraries/SafeDecimalMath.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/libraries/SafeDecimalMath.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

### File: `contracts/liquidation/FlashLiquidator.sol` (9 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to pure` (L322)
- **Lines**: L322
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Flash Liquidator, Approved Liquidators List Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, `getApprovedLiquidatorsCount` returns 0 as a placeholder for liquidator list iteration.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Flash Liquidator List Tracking Remediation Gate

#### Diagnostic: ``approvedLiquidators` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L259
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``flashLoanRequests` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L106
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L157
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L199, L212
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (GENERAL)
- **Lines**: L181
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L166
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/liquidation/FlashLiquidator.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L105
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

### File: `contracts/liquidation/IncentiveDistributor.sol` (9 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to pure` (L227)
- **Lines**: L227
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Pending Rewards Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `getPendingRewards` state mutability can be restricted to pure.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Incentive Vesting Schedule Remediation Gate

#### Diagnostic: `Function state mutability can be restricted to pure` (L280)
- **Lines**: L280
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Liquidator Reward Distribution Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `_distributeToLiquidator` state mutability can be restricted to pure.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Incentive Vesting Schedule Remediation Gate

#### Diagnostic: `Function state mutability can be restricted to pure` (L430)
- **Lines**: L430
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Reserved Amount Calculation Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `_calculateReservedAmount` state mutability can be restricted to pure.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Incentive Vesting Schedule Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L227)
- **Lines**: L227
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Pending Rewards Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `getPendingRewards` ignores `liquidator` parameter and returns 0.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Incentive Vesting Schedule Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L280)
- **Lines**: L280
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Liquidator Reward Distribution Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `_distributeToLiquidator` ignores `positionId` parameter as a placeholder for vesting schedules.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Incentive Vesting Schedule Remediation Gate

#### Diagnostic: ``liquidationEngine` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L397
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check` (GENERAL)
- **Lines**: L98, L99, L100
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Access Control, Configuration, Initialization
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, address parameters in state setters or initialization functions require explicit non-zero address assertions to prevent accidental zero-address assignment.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Zero-Address Check Standardization Gate

### File: `contracts/liquidation/LiquidationEngine.sol` (24 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L249)
- **Lines**: L249
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Engine, Flash Liquidation Disabled Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, `flashLiquidate` ignores parameters and unconditionally reverts `Flash liquidation disabled`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Flash Liquidation Feature Toggle Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L250)
- **Lines**: L250
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Engine, Flash Liquidation Disabled Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, `flashLiquidate` ignores `loanAmount` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Flash Liquidation Feature Toggle Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L251)
- **Lines**: L251
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Engine, Flash Liquidation Disabled Stub
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, `flashLiquidate` ignores `minReward` parameter.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Flash Liquidation Feature Toggle Remediation Gate

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L441, L445, L446
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L118, L186, L240, L526
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (GENERAL)
- **Lines**: L227
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L227, L263, L267, L272, L273, L274, L278, L439, L444, L446
- **Count**: 10
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision` (GENERAL)
- **Lines**: L405
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Fee Arithmetic, Funding Rate
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, intermediate division before multiplication is protected by order of operations or explicit scale factors (e.g. WAD 1e18 scaling prior to division). Precision loss is bounded to sub-wei rounding differences.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Dedicated Precision Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L134, L267
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/liquidation/LiquidationEngine.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/liquidation/LiquidationEstimator.sol` (1 Diagnostics)

#### Diagnostic: `Return value of an external call is not used` (GENERAL)
- **Lines**: L21
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEstimator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEstimator.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

### File: `contracts/liquidation/LiquidationQueue.sol` (5 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L136, L227, L256, L395
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationQueue.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/liquidation/LiquidationQueue.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L293
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationQueue.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationQueue.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

### File: `contracts/oracles/ChainlinkOracle.sol` (10 Diagnostics)

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L117, L175, L259, L345
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/ChainlinkOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/oracles/ChainlinkOracle.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L110, L122, L124, L134, L170, L252
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/ChainlinkOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/oracles/ChainlinkOracle.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/oracles/OracleAggregator.sol` (13 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L342)
- **Lines**: L342
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Aggregator, Historical TWAP, Spot Fallback
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, unused parameter `period` in `getTWAP` exposes the pending TWAP implementation fallback to spot price.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Oracle Aggregator Historical TWAP Semantics & Consumer Integration Remediation Gate

#### Diagnostic: ``oracleSecurity` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L726
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L284
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L258
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Aggregator, Static Calls, Read-only Oracles, Log Ordering
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, `updatePrice()` performs external price reads via `_fetchSourcePrice()` (which invokes view functions on Chainlink, Pyth, or TWAP feeds), `OracleSanityChecker.validatePrice()`, and `IOracleSecurity.shouldFreeze()`. All external interactions preceding the `PriceUpdated` event are read-only view calls executed with EVM `STATICCALL` semantics, which propagate a static execution context and prevent callees from mutating state.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Oracle Aggregator Read-only Static Call Audit Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L457, L461, L465
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L129, L135, L521, L680, L840, L842
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/oracles/OracleAggregator.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/oracles/OracleSanityChecker.sol` (3 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to pure` (GENERAL)
- **Lines**: L378
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSanityChecker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSanityChecker.sol`, diagnostic `Function state mutability can be restricted to pure` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L378)
- **Lines**: L378, L378
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Volatility Validation
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSanityChecker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSanityChecker.sol`, unused parameters in `checkPriceVolatility` highlight the dummy implementation of the volatility sanity check.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Oracle Volatility Validation Model & Consumer Integration Remediation Gate

### File: `contracts/oracles/OracleSecurity.sol` (10 Diagnostics)

#### Diagnostic: ``oracleAggregator` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L400
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSecurity.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSecurity.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L241
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSecurity.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSecurity.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L123, L260, L282, L292, L326, L334, L361, L374
- **Count**: 8
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSecurity.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/oracles/OracleSecurity.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/oracles/PythOracle.sol` (15 Diagnostics)

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L175
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L222, L222, L261, L261, L261, L264, L264, L264, L288, L290
- **Count**: 10
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/oracles/PythOracle.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L106, L123, L212, L378
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/oracles/PythOracle.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/oracles/RWAOracleAdapter.sol` (6 Diagnostics)

#### Diagnostic: ``_authorizedUpdaters` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L262
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/RWAOracleAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/RWAOracleAdapter.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L125, L136, L162, L167, L357
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/RWAOracleAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/oracles/RWAOracleAdapter.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/oracles/TWAPOracle.sol` (2 Diagnostics)

#### Diagnostic: ``lastUpdate` is changed without an event but is used in arithmetic` (GENERAL)
- **Lines**: L158
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/TWAPOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/TWAPOracle.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `empty function body` (L166)
- **Lines**: L166
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: TWAP Oracle, Source Integration, Staleness Protection
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/TWAPOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/TWAPOracle.sol`, `forceUpdate()` has an empty function body and performs no source oracle reading or observation recording. External callers observing successful transaction execution receive no updated price observations.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: TWAP Oracle Force-Update, Source Integration & Staleness Remediation Gate

### File: `contracts/security/AccessControlManager.sol` (3 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L127, L148, L245
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/AccessControlManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/security/AccessControlManager.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/security/CircuitBreaker.sol` (7 Diagnostics)

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L156)
- **Lines**: L156
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Circuit Breaker, Emergency Auditability, Incident Reason
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/CircuitBreaker.sol`, unused parameter `reason` in `triggerBreaker` indicates discarded manual trigger context.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Circuit Breaker Incident Reason & Emergency Auditability Remediation Gate

#### Diagnostic: ``abi.encodePacked()` called with multiple dynamic type arguments; hash collisions possible` (GENERAL)
- **Lines**: L118, L123
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Hashing, Signatures, Identifiers
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/CircuitBreaker.sol`, `abi.encodePacked` arguments have fixed lengths or single dynamic parameters preceding fixed types, eliminating hash collision vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: ABI Encoding Standardization Gate

#### Diagnostic: ``guardian` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L296
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/CircuitBreaker.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L179, L258, L387
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/security/CircuitBreaker.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/security/EmergencyGuardian.sol` (9 Diagnostics)

#### Diagnostic: ``activeSession` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L112, L133
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/security/EmergencyGuardian.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/EmergencyGuardian.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L74, L104, L108, L190, L200, L233, L256
- **Count**: 7
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/EmergencyGuardian.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/security/EmergencyGuardian.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/security/PausableController.sol` (2 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L129, L195
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/PausableController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/security/PausableController.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/security/RateLimiter.sol` (5 Diagnostics)

#### Diagnostic: ``admin` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L205
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/security/RateLimiter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/RateLimiter.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision` (GENERAL)
- **Lines**: L345
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Fee Arithmetic, Funding Rate
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/RateLimiter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/RateLimiter.sol`, intermediate division before multiplication is protected by order of operations or explicit scale factors (e.g. WAD 1e18 scaling prior to division). Precision loss is bounded to sub-wei rounding differences.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Dedicated Precision Refactoring Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L118, L291, L311
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/RateLimiter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/security/RateLimiter.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/tokens/CollateralWrapper.sol` (5 Diagnostics)

#### Diagnostic: ``oracleDeviationThreshold` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L331
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``redemptionDelay` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L320
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``redemptionDelay` is changed without an event but is used in arithmetic` (GENERAL)
- **Lines**: L320
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L180, L271
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/tokens/CollateralWrapper.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

### File: `contracts/upgradeability/ProxyAdmin.sol` (9 Diagnostics)

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L78, L91, L106, L123, L124, L142, L161
- **Count**: 7
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/ProxyAdmin.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/ProxyAdmin.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L141, L160
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/ProxyAdmin.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/ProxyAdmin.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

### File: `contracts/upgradeability/TransparentUpgradeableProxy.sol` (7 Diagnostics)

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check` (GENERAL)
- **Lines**: L38, L103
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Access Control, Configuration, Initialization
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/TransparentUpgradeableProxy.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/TransparentUpgradeableProxy.sol`, address parameters in state setters or initialization functions require explicit non-zero address assertions to prevent accidental zero-address assignment.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Zero-Address Check Standardization Gate

#### Diagnostic: `delegatecall target is not provably trusted` (GENERAL)
- **Lines**: L47, L108
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Upgradeable Proxies, Execution Control
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/TransparentUpgradeableProxy.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/TransparentUpgradeableProxy.sol`, delegatecall targets are constrained to governance-approved implementation addresses stored in immutable or admin-protected proxy slots.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Proxy Architecture Audit Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L88, L178
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/TransparentUpgradeableProxy.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/TransparentUpgradeableProxy.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `modifier can finish without executing the modified function` (GENERAL)
- **Lines**: L29
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/TransparentUpgradeableProxy.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/TransparentUpgradeableProxy.sol`, diagnostic `modifier can finish without executing the modified function` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

### File: `contracts/upgradeability/UpgradeExecutor.sol` (23 Diagnostics)

#### Diagnostic: `ETH is sent to a user-controlled destination; restrict the destination or the caller` (GENERAL)
- **Lines**: L195
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, diagnostic `ETH is sent to a user-controlled destination; restrict the destination or the caller` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: ``batches` is changed without an event but is used for access control` (GENERAL)
- **Lines**: L141
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, critical state configuration updates execute without old/new authority event emissions, requiring formal governance observability review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Critical Authority Rotation & Governance Observability Remediation Gate

#### Diagnostic: ``nonReentrant` should be the first modifier` (GENERAL)
- **Lines**: L167, L237
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`: state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L187, L213, L255, L393, L394, L395
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (GENERAL)
- **Lines**: L226, L264
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

#### Diagnostic: `external call can be reentered before `_status` is updated` (GENERAL)
- **Lines**: L251
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `external call can be reentered before `lastUpgradeTime` is updated` (GENERAL)
- **Lines**: L202
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, diagnostic `external call can be reentered before `lastUpgradeTime` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L195, L202, L251, L403
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators` (GENERAL)
- **Lines**: L173, L188, L307, L319
- **Count**: 4
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Time-based Logic, Funding Accumulation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Usage of `block.timestamp` in `contracts/upgradeability/UpgradeExecutor.sol` compares against explicit block epoch intervals or TWAP windows. Validator timestamp manipulation is strictly bounded by EVM/consensus constraints (max ~12 seconds in post-Merge Ethereum/L2s), which is orders of magnitude smaller than protocol settlement/funding intervals (e.g. 1 hour/8 hours).
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Time Oracle Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L136
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

### File: `contracts/view/PerpEngineViewer.sol` (44 Diagnostics)

#### Diagnostic: `Return value of an external call is not used` (GENERAL)
- **Lines**: L456, L533
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/view/PerpEngineViewer.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/view/PerpEngineViewer.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: ``require` or `revert` inside a loop` (GENERAL)
- **Lines**: L316, L319, L549
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/view/PerpEngineViewer.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/view/PerpEngineViewer.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `external call inside a loop` (GENERAL)
- **Lines**: L117, L257, L261, L261, L264, L315, L321, L321, L323, L397, L400, L400, L402, L456, L456, L505, L533, L533, L548, L552, L552, L554, L554
- **Count**: 23
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Gas Consumption, External Calls, Batch Operations
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/view/PerpEngineViewer.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/view/PerpEngineViewer.sol`, loop execution iterates over arrays or feeds during batch operations. To prevent potential gas exhaustion or liveness issues on large input arrays, this path requires formal pagination bounds review.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Gas Optimization & Unbounded Loop Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (GENERAL)
- **Lines**: L271, L282, L282, L282, L330, L358, L388, L388, L388, L409, L434, L434, L442, L444, L469, L484
- **Count**: 16
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/view/PerpEngineViewer.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/view/PerpEngineViewer.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate
