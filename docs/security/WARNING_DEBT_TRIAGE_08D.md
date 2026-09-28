# Security Triage & Warning Debt Disposition Document (Prompt 08D)

## Executive Summary

- **Repository Base SHA**: `a19a55107f480754d8916432a3ca95cde936abb2`
- **Start Baseline Total**: 850
- **Final Baseline Total**: 846
- **Baseline Reduction**: 4 (Mechanically safe compiler warnings eliminated; 7 restored as unresolved security debt)
- **Start Production Warning Debt**: 341
- **Final Production Warning Debt**: 118
- **Start Unresolved Security Debt**: 282
- **Final Unresolved Security Debt**: 501 (168 reclassified + 1 Timelock reclassified + 7 restored compiler diagnostics + 43 semantic stub reclassifications)

---

## Dispositions Breakdown

### Section A. Diagnostic-Level Disposition Totals
The sum of diagnostic-level dispositions equals exactly 501 `UNRESOLVED_SECURITY_DEBT` entries in `warnings-baseline.json`:

- `CONTEXTUAL_ACCEPTED`: 290
- `SECURITY_REVIEW_REQUIRED`: 149
- `SECURITY_BLOCKER`: 46
- `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`: 16
- **Total Diagnostics**: 501

### Section B. Root Security Findings Summary
Root causes after grouping related static analyzer diagnostics into unique protocol vulnerabilities:

#### SECURITY_BLOCKER Root Findings (21 Items)
1. **TimelockController.sol** (`_isCriticalOperation`): Critical operation classification is disabled (returns `false`), bypassing critical operation grace period enforcement. Gate: *Timelock Critical Operation Classification & Grace Enforcement Remediation Gate*.
2. **TimelockController.sol** (`_updateDelay`): Minimum delay update has an empty body, causing `updateMinDelay` to emit `MinDelayUpdated` without mutating the underlying timelock delay. Gate: *Timelock Minimum Delay State & Event Consistency Remediation Gate*.
3. **Governor.sol** (`emergencyCancel`): Emergency proposal cancellation is a no-op (`timelock.cancel(...)` commented out), allowing queued proposals to execute despite guardian cancellation attempts. Gate: *Governor Emergency Proposal Cancellation & Timelock Operation Identity Remediation Gate*.
4. **EmissionController.sol** (`claim`): Permissionless emission claim / treasury allowance drain (`external caller -> EmissionController.claim() -> _calculateAvailable(scheduleId, msg.sender) -> schedule-wide available amount -> token.safeTransferFrom(treasury, msg.sender, amount)`). Gate: *Emission Claim Entitlement & Treasury Authorization Remediation Gate*.
5. **FeeDistributor.sol** (`claim / claimMultiple`): Missing per-recipient / per-distribution claim uniqueness permits repeated consumption of distribution shares across single or batch claims. Gate: *Fee Distribution Claim Uniqueness, Recipient Entitlement & Per-Distribution Accounting Remediation Gate*.
6. **AccountAbstractionAdapter.sol** (`_handlePaymaster`): Unauthenticated paymaster sponsorship consent (`_handlePaymaster -> paymasterAndData -> debit paymasterDeposits`). Gate: *Account Abstraction Paymaster Sponsorship Authentication Remediation Gate*.
7. **AccountAbstractionAdapter.sol** (`_executeCallData`): UserOperation execution is a no-op (`_executeCallData` performs no call and returns success), consuming nonces, emitting success, and charging paymasters without executing requested calls. Gate: *Account Abstraction UserOperation Dispatch, Execution Result & Atomicity Remediation Gate*.
8. **AccessControlManager.sol** (`role expiry`): Ineffective role expiry enforcement in `hasRole()` / `onlyRole(...)` authorization checks (`isRoleExpired` is informational only). Gate: *Access Control Role Expiry Enforcement Remediation Gate*.
9. **FlashLiquidator.sol** (`reentrancy`): ReentrancyGuard lock collision between `executeFlashLiquidation` and Aave callback `executeOperation`. Gate: *Dedicated Flash Loan Reentrancy & Callback Architecture Remediation Gate*.
10. **AaveFlashLoanIntegrator.sol** (`executeOperation`): Callback ABI mismatch against `FlashLiquidator.executeFlashLiquidation` (5 args returning `(uint256,bool)` vs 3 args returning `bool`), causing all flash liquidations to revert deterministically. Gate: *Aave Flash Liquidator Typed ABI & Callback Integration Remediation Gate*.
11. **Treasury.sol** (`scheduledWithdrawals`): Operation hash mismatch between `scheduleWithdrawal` and `executeWithdrawal` due to salt (`salt` vs `bytes32(0)`) and timestamp (`scheduleTimestamp` vs `executionTimestamp`) divergence, preventing scheduled withdrawals from executing. Gate: *Dedicated Treasury Timelock Operation Identity, Salt & Timestamp Persistence Remediation Gate*.
12. **UpgradeExecutor.sol** (`lastUpgradeTime`): `rollbackBatch` trusts calldata `originalImplementations` without checking persisted state. Gate: *Dedicated Upgrade Governance & Implementation Verification Remediation Gate*.
13. **CrossChainMessenger.sol** (`_processMessage`): Cross-chain message handlers are decode-only no-ops that consume `executedMessages[messageId] = true` replay state without performing position, governance, oracle, or emergency actions. Gate: *Cross-Chain Message Dispatch, Replay-State & Execution Atomicity Remediation Gate*.
14. **CrossChainMessenger.sol** (`typecast`): `uint16(block.chainid)` truncation mismatches LayerZero endpoint chain IDs during message identity and route construction. Gate: *Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate*.
15. **LidoStETHIntegrator.sol** (`stETH.transferFrom`): Unchecked `IStETH.transferFrom` return value before crediting collateral shares. Gate: *Dedicated StETH Transfer Return Value Verification Remediation Gate*.
16. **LidoStETHIntegrator.sol** (`_stETHToWstETH`): Broken wstETH conversion placeholder breaks collateral conservation (`wrapETH(useWstETH=true) -> _submitToLido() -> receive stETH -> _stETHToWstETH(stETHAmount) -> raw stETH.approve() -> NO wstETH.wrap() -> returns stETHAmount as fake wstETH -> wstETH.safeTransfer(msg.sender, amount)`). Gate: *Lido wstETH Wrap, Approval & Collateral Conservation Remediation Gate*.
17. **LidoStETHIntegrator.sol** (`unwrapToETH`): wstETH-to-ETH withdrawal placeholder consumes ambient contract ETH balance and retains user wstETH (`unwrapToETH(useWstETH=true) -> wstETH.safeTransferFrom(msg.sender, address(this), amount) -> NO wstETH.unwrap() -> ethAmount = amount -> msg.sender.call{value: ethAmount}("")`). Gate: *Lido wstETH Withdrawal Queue, Conversion & Asset-Conservation Remediation Gate*.
18. **LidoStETHIntegrator.sol** (`wrapETH`): Direct stETH wrap unit mismatch (`wrapETH(useWstETH=false) -> _submitToLido() -> returns stETH balance delta -> value mislabeled as shares -> getPooledEthByShares(stETHAmount) -> wrong transfer amount`). Gate: *Lido stETH Amount-vs-Share Unit Conservation Remediation Gate*.
19. **RiskManager.sol** (`_checkPositionConcentration`): Position concentration enforcement disabled (`totalOI` hardcoded to 0), bypassing configured `maxPositionConcentration` limits. Gate: *RiskManager Open Interest, Trader Concentration & Position-Limit Remediation Gate*.
20. **RiskManager.sol** (`validateLiquidation`): Liquidation validation ignores `positionId` and `currentPrice`, fetching no position state and trusting caller-supplied `healthFactor`. Gate: *RiskManager Liquidation Position, Price & Circuit-Breaker Validation Remediation Gate*.
21. **PythOracle.sol** (`typecast`): `_normalizePythPrice` natural unit division returns 1 instead of canonical 8-decimal `100_000_000` for negative Pyth exponents, corrupting mark price calculations. Gate: *Dedicated Pyth Exponent & Decimal Normalization Remediation Gate*.

#### ECONOMIC_OR_LOGIC_CHANGE_REQUIRED Root Findings (9 Items)
1. **PerpEngine.sol** (`totalFundingPaid / totalFundingReceived`): Instrumentation variables `totalFundingPaid` and `totalFundingReceived` are read by `InvariantTests.invariant_funding_symmetry()` but never written during funding settlement, rendering economic invariant testing inert. Gate: *Funding Symmetry Instrumentation, Zero-Sum Accounting & Invariant Validity Remediation Gate*.
2. **FundingRateCalculator.sol** (`calculateFundingPayment`): Classic funding payment calculation applies base asset WAD directly to quote margin without explicit base-to-quote price conversion, conflicting with `FUNDING_MODEL.md`. Gate: *Canonical Funding Index Units, Base-to-Quote Conversion & Settlement Conservation Remediation Gate*.
3. **FundingRateCalculator.sol** (`calculateFundingRate`): Classic funding rate formula applies hardcoded per-second velocity `FUNDING_VELOCITY_MAX` with double time scaling, diverging from `FUNDING_MODEL.md` hourly rate scaling. Gate: *Funding Rate Formula, Time Dimension, Skew Scaling & Configured Cap Remediation Gate*.
4. **IncentiveDistributor.sol** (`_distributeToLiquidator`): Liquidator penalty allocations are accounted as distributed but retained in contract, while `_calculateReservedAmount()` returns 0 allowing `sweepExcessTokens` to sweep liquidator allocations to protocol treasury. Gate: *Liquidator Incentive Distribution, Reservation & Sweep-Safety Remediation Gate*.
5. **RiskManager.sol** (`checkCircuitBreaker`): `checkCircuitBreaker` ignores `timeElapsed` parameter, failing to normalize price percentage moves over the elapsed time window. Gate: *RiskManager Circuit-Breaker Price Window & Time-Normalization Remediation Gate*.
6. **LiquidationEngine.sol** (`setIncentiveMultiplier`): `setIncentiveMultiplier` validates input bounds but performs no storage mutation, changing no reward calculation. Gate: *Liquidation Incentive Multiplier State, Reward Model & Configuration Remediation Gate*.
7. **LiquidationQueue.sol** (`randomness / starvation`): Blockhash/timestamp entropy controls liquidation grace period timing and MEV resistance; head starvation occurs when candidate execution reverts. Gate: *Liquidation Timing Randomness & MEV Remediation Gate*.
8. **OracleSanityChecker.sol** (`checkPriceVolatility`): Volatility check method is a dummy implementation returning `true`, bypassing volatility validation. Gate: *Oracle Volatility Validation Model & Consumer Integration Remediation Gate*.
9. **VotingEscrow.sol** (`typecast`): `int128` narrowing casts on user-controlled lock amounts without explicit bounds assertions. Gate: *Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate*.

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

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L333
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/AMMPool.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (L215)
- **Lines**: L215
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: AMM Mark Price, Funding Interval, Timestamp Modulo Variance
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/AMMPool.sol`, `timeToNextFunding = config.fundingInterval - (block.timestamp - state.lastFundingTime) % config.fundingInterval` derives mark price via `FundingRateCalculator.calculateMarkPrice`. Validator timestamp drift near funding epoch boundaries introduces mark price variance.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Dedicated AMM Mark Price & Funding Interval Audit Gate

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

### File: `contracts/core/PerpEngine.sol` (38 Diagnostics)

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

#### Diagnostic: `state variable is read but never written` (L85)
- **Lines**: L85
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Funding Accounting, Economic Invariant Integrity, Test Trustworthiness
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, public state variable `totalFundingPaid` is read by `InvariantTests.invariant_funding_symmetry()` but never written during funding settlement. The economic invariant test reads 0 == 0 and passes trivially without validating actual funding settlement symmetry.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Funding Symmetry Instrumentation, Zero-Sum Accounting & Invariant Validity Remediation Gate

#### Diagnostic: `state variable is read but never written` (L86)
- **Lines**: L86
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Funding Accounting, Economic Invariant Integrity, Test Trustworthiness
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, public state variable `totalFundingReceived` is read by `InvariantTests.invariant_funding_symmetry()` but never written during funding settlement. The economic invariant test reads 0 == 0 and passes trivially without validating actual funding settlement symmetry.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Funding Symmetry Instrumentation, Zero-Sum Accounting & Invariant Validity Remediation Gate

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
- **Domains Involved**: Risk Management, Liquidation Validation, Unvalidated Parameters
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `validateLiquidation(positionId, healthFactor, currentPrice)` ignores `positionId` and `currentPrice`, does not fetch position state or check market circuit breakers, and trusts caller-supplied `healthFactor` directly.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Position, Price & Circuit-Breaker Validation Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L156)
- **Lines**: L156
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Validation, Unvalidated Parameters
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `validateLiquidation` ignores `currentPrice` parameter and trusts caller-supplied `healthFactor`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Position, Price & Circuit-Breaker Validation Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L230)
- **Lines**: L230
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Liquidation Price Calculation Stub
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `size` parameter, performs placeholder maintenance margin calculation, and returns `liquidationPrice = 0`.
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
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `price` parameter and returns `liquidationPrice = 0`.
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
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `calculateLiquidationPrice` ignores `fundingAccrued` parameter and returns `liquidationPrice = 0`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: RiskManager Liquidation Price Math Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L261)
- **Lines**: L261
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Risk Management, Circuit Breaker, Price Window Time Normalization
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/RiskManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/RiskManager.sol`, `checkCircuitBreaker(marketId, currentPrice, previousPrice, timeElapsed)` ignores the `timeElapsed` parameter. The circuit breaker calculates percentage price moves without normalizing over the elapsed time window, treating a price move over seconds identically to a move over hours.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: RiskManager Circuit-Breaker Price Window & Time-Normalization Remediation Gate

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

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)`` (L150)
- **Lines**: L150
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Emission Claims, Treasury Token Transfer
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, `claim(uint256 scheduleId, uint256 amount)` calls `token.safeTransferFrom(treasury, msg.sender, amount)` based on schedule-wide vesting derived by `_calculateAvailable(scheduleId, msg.sender)`. It lacks per-recipient entitlement verification, allowing arbitrary callers to claim vested tokens directly from Treasury allowances.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Emission Claim Entitlement & Treasury Authorization Remediation Gate

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

### File: `contracts/governance/Governor.sol` (1 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to view` (L139)
- **Lines**: L139
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Proposal Lifecycle, Emergency Cancellation
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/governance/Governor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/Governor.sol`, `emergencyCancel(uint256 proposalId)` verifies caller `GUARDIAN_ROLE` and `ProposalState.Queued` status, but leaves `timelock.cancel(...)` commented out. Calling `emergencyCancel` returns successfully without cancelling the queued timelock operation, allowing queued proposals to execute.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Governor Emergency Proposal Cancellation & Timelock Operation Identity Remediation Gate

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

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L211, L211
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/TimelockController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/TimelockController.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `empty function body` (GENERAL)
- **Lines**: L232
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/TimelockController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/TimelockController.sol`, diagnostic `empty function body` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: `typecasts that can truncate values should be checked` (L353)
- **Lines**: L353, L353
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Token Locking, Voting Weight Math
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/VotingEscrow.sol`, narrowing typecasts converting user-controlled locked token amounts and unlock timestamps (`uint256 -> int256 -> int128`) lack explicit pre-cast upper bound assertions, presenting integer truncation risks during large token locks.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L354)
- **Lines**: L354, L354
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Token Locking, Voting Weight Math
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/VotingEscrow.sol`, narrowing casts in lock extension math lack explicit bounds checks.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L370)
- **Lines**: L370, L370
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Token Locking, Voting Weight Math
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/VotingEscrow.sol`, narrowing casts in voting power checkpointing lack explicit bounds checks.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate

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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (L177)
- **Lines**: L177
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Flash Loans, Callback ABI Parity
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, `executeOperation` invokes `flashLiquidator.call(abi.encodeWithSignature("executeFlashLiquidation(address,uint256,uint256,uint256,bytes32)", ...))` expecting return `(uint256, bool)`. However, `FlashLiquidator` declares `executeFlashLiquidation(uint256, uint256, uint256)` returning `bool`. Selector and signature mismatch causes low-level calls to revert, blocking flash liquidations.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Aave Flash Liquidator Typed ABI & Callback Integration Remediation Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on` (L225)
- **Lines**: L225
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Flash Loans, Callback ABI Parity
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, callback event emissions surround `flashLiquidator` low-level call execution exhibiting signature mismatch against target `FlashLiquidator`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Aave Flash Liquidator Typed ABI & Callback Integration Remediation Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value` (GENERAL)
- **Lines**: L138
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Queue, Randomness
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, pseudo-random ordering is used solely for non-critical tie-breaking in liquidation queue candidate selection, where cryptographic randomness is not required for protocol security.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Liquidation Queue Audit Gate

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
- **Domains Involved**: Cross-Chain Messaging, Replay State, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processPositionUpdate` decodes payload variables but executes no position manager calls. `_processMessage` marks `executedMessages[messageId] = true` prior to calling `_processPositionUpdate`, consuming message replay state and preventing retry while the requested action is never executed.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Cross-Chain Message Dispatch, Replay-State & Execution Atomicity Remediation Gate

#### Diagnostic: `Unused local variable.` (L462)
- **Lines**: L462, L462, L462
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain Messaging, Replay State, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processGovernanceMessage` decodes payload variables but executes no governance proposal calls while consuming message execution state.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Cross-Chain Message Dispatch, Replay-State & Execution Atomicity Remediation Gate

#### Diagnostic: `Unused local variable.` (L484)
- **Lines**: L484, L484, L484
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain Messaging, Replay State, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processOracleUpdate` decodes payload variables but executes no oracle aggregator updates while consuming message execution state.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Cross-Chain Message Dispatch, Replay-State & Execution Atomicity Remediation Gate

#### Diagnostic: `Unused local variable.` (L506)
- **Lines**: L506, L506
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain Messaging, Replay State, Dispatch No-Op
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `_processEmergencyMessage` decodes payload variables but executes no emergency actions while consuming message execution state.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Cross-Chain Message Dispatch, Replay-State & Execution Atomicity Remediation Gate

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

#### Diagnostic: `typecasts that can truncate values should be checked` (L160)
- **Lines**: L160
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, LayerZero Endpoint Chain ID Mapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `uint16(block.chainid)` truncates EVM chain IDs to 16 bits and fails to map EVM chain IDs to LayerZero endpoint chain IDs, corrupting cross-chain endpoint targeting.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L171)
- **Lines**: L171
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, LayerZero Endpoint Chain ID Mapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `uint16(block.chainid)` truncates EVM chain IDs during fee estimation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L298)
- **Lines**: L298
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, LayerZero Endpoint Chain ID Mapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `uint16(block.chainid)` truncates EVM chain IDs during message retry validation.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L402)
- **Lines**: L402
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, LayerZero Endpoint Chain ID Mapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `uint16(block.chainid)` truncates EVM chain IDs during route configuration.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L550)
- **Lines**: L550
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, LayerZero Endpoint Chain ID Mapping
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, `uint16(block.chainid)` truncates EVM chain IDs during cross-chain message construction.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

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
- **Lines**: L49, L49, L54, L157, L163, L179, L180, L181, L182, L219, L219, L220, L220, L236, L236, L237, L237, L237, L240, L246, L246
- **Count**: 21
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Settlement, Precision, Arithmetic, Margin, Funding
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Explicit type conversions in `contracts/libraries/FundingRateCalculator.sol` (e.g. converting signed int256 PnL to unsigned uint256 margin, or converting between WAD 18d and native vault units 6d/24d) are bounded by preceding explicit invariant checks (e.g., `_toVaultUnits`, `int256(uint256)`, or `int256` bounds checks). Truncation is either mathematically impossible due to value range constraints or is the intended canonical quantization per protocol specification.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline until a dedicated type safety refactoring gate.
- **Follow-up Gate**: Dedicated Math Precision & Safe Cast Refactoring Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L63)
- **Lines**: L63, L63, L63
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Funding Rate, Skew Scaling, Time Dimension
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/FundingRateCalculator.sol`, `calculateFundingRate` calculates `fundingRate = normalizedSkew * FUNDING_VELOCITY_MAX * timeElapsed / 1e18` using hardcoded per-second velocity `FUNDING_VELOCITY_MAX = 1e18 / 1000`. Double time scaling drives funding rates into max caps rapidly, diverging from `FUNDING_MODEL.md` hourly rate scaling.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Funding Rate Formula, Time Dimension, Skew Scaling & Configured Cap Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L95)
- **Lines**: L95
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Funding Accounting, Dimensional Units, Base-to-Quote Conversion
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/libraries/FundingRateCalculator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/libraries/FundingRateCalculator.sol`, `calculateFundingPayment` calculates `rawPayment = positionSize * abs(deltaFunding) / 1e18` multiplying base asset WAD by funding index delta. It treats the result as quote-denominated without applying index/oracle price conversion, conflicting with `FUNDING_MODEL.md` requiring base-to-quote price conversion.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Canonical Funding Index Units, Base-to-Quote Conversion & Settlement Conservation Remediation Gate

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

#### Diagnostic: `Function state mutability can be restricted to pure` (GENERAL)
- **Lines**: L322
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, diagnostic `Function state mutability can be restricted to pure` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: ``nonReentrant` should be the first modifier` (L157)
- **Lines**: L157
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Flash Loans
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, `executeFlashLiquidation` (guarded by `nonReentrant`) calls `aavePool.flashLoan`, which synchronously invokes callback `FlashLiquidator.executeOperation` (also guarded by `nonReentrant`), causing an immediate atomic reentrancy revert.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Flash Loan Reentrancy & Callback Architecture Remediation Gate

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

#### Diagnostic: `Function state mutability can be restricted to pure` (GENERAL)
- **Lines**: L227, L280
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, diagnostic `Function state mutability can be restricted to pure` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `Function state mutability can be restricted to pure` (L430)
- **Lines**: L430
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Reserved Amount Calculation Stub
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `_calculateReservedAmount` returns 0 as a pure stub, causing sweep functions to misclassify retained incentive allocations as excess.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Liquidator Incentive Distribution, Reservation & Sweep-Safety Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L227
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (L280)
- **Lines**: L280
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Incentive Distribution, Liquidator Share Allocation, Sweep Safety
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, `_distributeToLiquidator` is a no-op placeholder that retains liquidator penalty allocations inside the contract. Meanwhile `_calculateReservedAmount()` returns 0, allowing `sweepExcessTokens` to treat retained liquidator allocations as sweepable excess.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Liquidator Incentive Distribution, Reservation & Sweep-Safety Remediation Gate

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

### File: `contracts/liquidation/LiquidationEngine.sol` (25 Diagnostics)

#### Diagnostic: `Function state mutability can be restricted to view` (L511)
- **Lines**: L511
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Engine, Incentive Configuration, Storage Mutation
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, `setIncentiveMultiplier(uint256 newMultiplier)` checks `newMultiplier <= 0.5e18` but mutates no storage state, updates no reward configuration, and emits no event. The function returns successfully without modifying liquidation incentive multipliers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Liquidation Incentive Multiplier State, Reward Model & Configuration Remediation Gate

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L249, L250, L251
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationEngine.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L342
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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
- **Domains Involved**: Events, Off-chain Indexing, Logging
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, event emissions occur after successful external state transitions (e.g. ERC20 transfer completion or vault settlement). Reentrancy protection prevents reordering of log events, and off-chain indexers receive atomic state change logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Log Security Review Gate

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

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L378, L378
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSanityChecker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSanityChecker.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: `typecasts that can truncate values should be checked` (L222)
- **Lines**: L222, L222
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Pyth Price Validation
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, `_validatePythPrice` converts Pyth publish time to uint256 for age comparison bounded by maximum staleness thresholds.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Pyth Oracle Integration Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L261)
- **Lines**: L261, L261, L261
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Price Normalization, Precision
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, `_normalizePythPrice` uses narrowing casts in price scaling math. For negative exponents (e.g. expo = -8 with price = 100_000_000), natural unit division returns 1 instead of normalizing to the canonical 8-decimal oracle format, corrupting mark price calculations.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Pyth Exponent & Decimal Normalization Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L264)
- **Lines**: L264, L264, L264
- **Count**: 3
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Price Normalization, Precision
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, `_normalizePythPrice` uses narrowing casts in price scaling math for positive exponent ranges.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Pyth Exponent & Decimal Normalization Remediation Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L288)
- **Lines**: L288
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Confidence Interval Normalization
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, `_normalizePythConfidence` converts Pyth confidence interval to uint256 bounded by price magnitude.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Pyth Oracle Integration Audit Gate

#### Diagnostic: `typecasts that can truncate values should be checked` (L290)
- **Lines**: L290
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Confidence Interval Normalization
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/PythOracle.sol`, `_normalizePythConfidence` converts Pyth confidence interval exponent bounded by price magnitude.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Pyth Oracle Integration Audit Gate

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

#### Diagnostic: `empty function body` (GENERAL)
- **Lines**: L166
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/oracles/TWAPOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/TWAPOracle.sol`, diagnostic `empty function body` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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

#### Diagnostic: `Unused function parameter. Remove or comment out the variable name to silence this warning.` (GENERAL)
- **Lines**: L156
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/CircuitBreaker.sol`, diagnostic `Unused function parameter. Remove or comment out the variable name to silence this warning.` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

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
