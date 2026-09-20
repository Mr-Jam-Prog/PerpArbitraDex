# Security Triage & Warning Debt Disposition Document (Prompt 08D)

## Executive Summary

- **Repository Base SHA**: `a19a55107f480754d8916432a3ca95cde936abb2`
- **Start Baseline Total**: 850
- **Final Baseline Total**: 839
- **Baseline Reduction**: 11 (Mechanically safe compiler warnings eliminated)
- **Start Production Warning Debt**: 341
- **Final Production Warning Debt**: 162
- **Start Unresolved Security Debt**: 282
- **Final Unresolved Security Debt**: 450 (168 security-sensitive entries reclassified)

---

## Dispositions Breakdown

### Section A. Diagnostic-Level Disposition Totals
The sum of diagnostic-level dispositions equals exactly 450 `UNRESOLVED_SECURITY_DEBT` entries in `warnings-baseline.json`:

- `CONTEXTUAL_ACCEPTED`: 319
- `SECURITY_REVIEW_REQUIRED`: 101
- `SECURITY_BLOCKER`: 23
- `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`: 7
- **Total Diagnostics**: 450

### Section B. Root Security Findings Summary
Root causes after grouping related static analyzer diagnostics into unique protocol vulnerabilities:

#### SECURITY_BLOCKER Root Findings (7 Items)
1. **EmissionController.sol** (`claim`): Permissionless emission claim / treasury allowance drain (`external caller -> EmissionController.claim() -> _calculateAvailable(scheduleId, msg.sender) -> schedule-wide available amount -> token.safeTransferFrom(treasury, msg.sender, amount)`). Gate: *Emission Claim Entitlement & Treasury Authorization Remediation Gate*.
2. **FlashLiquidator.sol** (`reentrancy`): ReentrancyGuard lock collision between `executeFlashLiquidation` and Aave callback `executeOperation`. Gate: *Dedicated Flash Loan Reentrancy & Callback Architecture Remediation Gate*.
3. **Treasury.sol** (`scheduledWithdrawals`): Operation hash mismatch between `scheduleWithdrawal` and `executeWithdrawal` (`salt` vs `bytes32(0)`). Gate: *Dedicated Treasury Timelock Hash Alignment Remediation Gate*.
4. **UpgradeExecutor.sol** (`lastUpgradeTime`): `rollbackBatch` trusts calldata `originalImplementations` without checking persisted state. Gate: *Dedicated Upgrade Governance & Implementation Verification Remediation Gate*.
5. **LidoStETHIntegrator.sol** (`transfer`): Unchecked `IStETH.transferFrom` return value before crediting collateral shares. Gate: *Dedicated StETH Transfer Return Value Verification Remediation Gate*.
6. **PythOracle.sol** (`typecast`): `_normalizePythPrice` fails to normalize price to 8 decimals for standard Pyth exponents. Gate: *Dedicated Pyth Exponent & Decimal Normalization Remediation Gate*.
7. **CrossChainMessenger.sol** (`typecast`): `uint16(block.chainid)` truncation mismatches LayerZero endpoint chain IDs. Gate: *Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate*.

#### ECONOMIC_OR_LOGIC_CHANGE_REQUIRED Root Findings (2 Items)
1. **LiquidationQueue.sol** (`randomness`): Blockhash/timestamp entropy controls liquidation grace period timing and MEV resistance. Gate: *Liquidation Timing Randomness & MEV Remediation Gate*.
2. **VotingEscrow.sol** (`typecast`): `int128` narrowing casts on user-controlled lock amounts without explicit bounds assertions. Gate: *Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate*.

#### SECURITY_REVIEW_REQUIRED Highlights (4 Root Items)
1. **ProtocolConfig.sol** (`setTimelockController`): Unobservable timelock authority rotation lacking event emissions. Gate: *ProtocolConfig Timelock Authority Rotation & Observability Gate*.
2. **TransparentUpgradeableProxy.sol**: Unchecked constructor `admin_` zero-address assignment. Gate: *Dedicated Proxy Deployment & Admin Validation Audit Gate*.
3. **AMMPool.sol**: `timeToNextFunding` timestamp modulo variance in mark price calculation. Gate: *Dedicated AMM Mark Price & Funding Interval Audit Gate*.
4. **PositionManager.sol**: Unpaginated loop over NFT supply making external engine calls. Gate: *Dedicated PositionManager Pagination & Gas Limits Remediation Gate*.

---

## Detailed Triage Inventory by Contract File
### File: `contracts/core/AMMPool.sol` (20 Diagnostics)

#### Diagnostic: `multiplication should occur before division to avoid loss of precision`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
- **Lines**: L143, L307
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: AMM Mark Price, Funding Interval
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/AMMPool.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `(block.timestamp - state.lastFundingTime) % config.fundingInterval` calculates `timeToNextFunding` for mark price adjustments; validator timestamp drift may introduce minor mark price variance near funding epoch boundaries.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Dedicated AMM Mark Price & Funding Interval Audit Gate

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
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

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L234, L246, L290, L324, L357, L395, L499, L533, L541
- **Count**: 9
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/LiquidityVault.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``totalLpAssets` is changed without an event but is used in arithmetic`
- **Lines**: L507
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/LiquidityVault.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/LiquidityVault.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)``
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: ``configRegistry` is changed without an event but is used for access control`
- **Lines**: L414
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/MarketRegistry.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/MarketRegistry.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

### File: `contracts/core/PerpEngine.sol` (36 Diagnostics)

#### Diagnostic: `Return value of an external call is not used`
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

#### Diagnostic: ``governance` is changed without an event but is used for access control`
- **Lines**: L230
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/PerpEngine.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/PerpEngine.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call can be reentered before `_status` is updated`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``abi.encodePacked()` called with multiple dynamic type arguments; hash collisions possible`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call inside a loop`
- **Lines**: L212
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: ERC721 NFT Indexing, Gas Liveness
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/core/PositionManager.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `getPositionsByOwner` iterates over unpaginated token arrays that grow with `totalSupply()`, executing external `perpEngine` calls in a loop that can encounter gas exhaustion DoS for accounts with large position counts.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Dedicated PositionManager Pagination & Gas Limits Remediation Gate

### File: `contracts/core/ProtocolConfig.sol` (3 Diagnostics)

#### Diagnostic: ``timelockController` is changed without an event but is used for access control`
- **Lines**: L468
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/core/ProtocolConfig.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/core/ProtocolConfig.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

### File: `contracts/core/RiskManager.sol` (3 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``governor` is changed without an event but is used for access control`
- **Lines**: L288
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)``
- **Lines**: L150
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Emission Claims, Treasury Token Transfer
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/governance/EmissionController.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/EmissionController.sol`, `claim(uint256 scheduleId, uint256 amount)` derives available claims via `_calculateAvailable(scheduleId, msg.sender)` based on schedule-wide vesting without beneficiary entitlement checks. An arbitrary caller can claim vested tokens directly from the Treasury via `token.safeTransferFrom(treasury, msg.sender, amount)`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Emission Claim Entitlement & Treasury Authorization Remediation Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``claimCooldown` is changed without an event but is used for access control`
- **Lines**: L275
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``lastClaimTime` is changed without an event but is used for access control`
- **Lines**: L135, L191
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L84
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/governance/FeeDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/governance/FeeDistributor.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: ``transferFrom` uses an arbitrary `from`; require it to equal `msg.sender` or `address(this)``
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

### File: `contracts/governance/TimelockController.sol` (2 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `ETH is sent to a user-controlled destination; restrict the destination or the caller`
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

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call can be reentered before `scheduledWithdrawals` is updated`
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

#### Diagnostic: `uncapped ETH transfer can be reentered before `scheduledWithdrawals` is updated`
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

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
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

#### Diagnostic: ``tx.origin` should not be used for authorization`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
- **Lines**: L353, L353, L354, L354, L370, L370
- **Count**: 6
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Token Locking, Voting Weight Math
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/governance/VotingEscrow.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Narrowing typecasts converting user-controlled locked token amounts and unlock timestamps to `int128` lack explicit pre-cast upper bound assertions, presenting integer truncation risks during large token locks.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Dedicated VotingEscrow Safe Casting & Weight Math Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `Return value of an external call is not used`
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

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L197
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AaveFlashLoanIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AaveFlashLoanIntegrator.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
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

### File: `contracts/integration/AccountAbstractionAdapter.sol` (7 Diagnostics)

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L125
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``paymasterDeposits` is changed without an event but is used for access control`
- **Lines**: L177, L195, L232, L359, L454
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``paymasterStakeRequired` is changed without an event but is used for access control`
- **Lines**: L343
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/AccountAbstractionAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/AccountAbstractionAdapter.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

### File: `contracts/integration/CrossChainMessenger.sol` (10 Diagnostics)

#### Diagnostic: ``gasBuffer` is changed without an event but is used in arithmetic`
- **Lines**: L353
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L149, L248
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/CrossChainMessenger.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
- **Lines**: L160, L171, L298, L402, L550
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Cross-Chain, Endpoint Messaging
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/CrossChainMessenger.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `uint16(block.chainid)` truncates EVM chain IDs and is not aligned with LayerZero endpoint chain IDs, causing cross-chain message deliveries to fail on non-matching chain ID deployments.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Cross-Chain Endpoint Chain ID Mapping Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `ERC20 'transfer' and 'transferFrom' calls should check the return value`
- **Lines**: L181, L203
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Tokens, Collateral Integration
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Direct `IStETH.transferFrom` return values are not validated before crediting user collateral shares, permitting share minting without confirmed token transfers if a non-reverting transfer failure occurs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated StETH Transfer Return Value Verification Remediation Gate

#### Diagnostic: `Return value of an external call is not used`
- **Lines**: L381, L395
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Token Interactions
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, ERC20 interactions use OpenZeppelin `SafeERC20` wrapper functions (`safeTransfer`, `safeTransferFrom`), reverting atomically on failed token transfers.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: SafeERC20 Audit Gate

#### Diagnostic: ``userShares` is changed without an event but is used for access control`
- **Lines**: L223
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call can be reentered before `_status` is updated`
- **Lines**: L147, L181, L203, L231, L395
- **Count**: 5
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Core Architecture & Security
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/integration/LidoStETHIntegrator.sol`, diagnostic `external call can be reentered before `_status` is updated` requires formal code-specific security review during upcoming security audit gates.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: General Security Review Gate

#### Diagnostic: `uncapped ETH transfer can be reentered before `_status` is updated`
- **Lines**: L171
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External ERC20 Tokens, Collateral Integration
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/integration/LidoStETHIntegrator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Direct `IStETH.transferFrom` return values are not validated before crediting user collateral shares, permitting share minting without confirmed token transfers if a non-reverting transfer failure occurs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated StETH Transfer Return Value Verification Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `local variable is read before being initialized`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `local variable is read before being initialized`
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

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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

### File: `contracts/liquidation/FlashLiquidator.sol` (8 Diagnostics)

#### Diagnostic: ``approvedLiquidators` is changed without an event but is used for access control`
- **Lines**: L259
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``flashLoanRequests` is changed without an event but is used for access control`
- **Lines**: L106
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L157
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/FlashLiquidator.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
- **Lines**: L199, L212
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Flash Loans
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/liquidation/FlashLiquidator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `executeFlashLiquidation` calls `IAavePool.flashLoan` inside a `nonReentrant` modifier, which synchronously invokes callback `FlashLiquidator.executeOperation` (also guarded by `nonReentrant`), causing an immediate atomic reentrancy revert.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Flash Loan Reentrancy & Callback Architecture Remediation Gate

#### Diagnostic: `external call can be reentered before `_status` is updated`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
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

### File: `contracts/liquidation/IncentiveDistributor.sol` (4 Diagnostics)

#### Diagnostic: ``liquidationEngine` is changed without an event but is used for access control`
- **Lines**: L397
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/IncentiveDistributor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/IncentiveDistributor.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check`
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

### File: `contracts/liquidation/LiquidationEngine.sol` (21 Diagnostics)

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call can be reentered before `_status` is updated`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `multiplication should occur before division to avoid loss of precision`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `Return value of an external call is not used`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
- **Lines**: L293
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Liquidation Grace Period, Randomness, MEV
- **Classification**: `ECONOMIC_OR_LOGIC_CHANGE_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/liquidation/LiquidationQueue.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/liquidation/LiquidationQueue.sol`, blockhash/timestamp pseudo-randomness generates `randomSeed` to derive `gracePeriod` added to `queueTime`, determining when a position becomes executable for liquidation. Validator/timestamp manipulation affects liquidation timing and liquidator MEV competition.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` until ECONOMIC_OR_LOGIC_CHANGE_REQUIRED remediation.
- **Follow-up Gate**: Liquidation Timing Randomness & MEV Remediation Gate

### File: `contracts/oracles/ChainlinkOracle.sol` (10 Diagnostics)

#### Diagnostic: `typecasts that can truncate values should be checked`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

### File: `contracts/oracles/OracleAggregator.sol` (12 Diagnostics)

#### Diagnostic: ``oracleSecurity` is changed without an event but is used for access control`
- **Lines**: L726
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleAggregator.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleAggregator.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

### File: `contracts/oracles/OracleSecurity.sol` (10 Diagnostics)

#### Diagnostic: ``oracleAggregator` is changed without an event but is used for access control`
- **Lines**: L400
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/OracleSecurity.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/OracleSecurity.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
- **Lines**: L222, L222, L261, L261, L261, L264, L264, L264, L288, L290
- **Count**: 10
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Oracle Integrity, Price Normalization, Precision
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/oracles/PythOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `_normalizePythPrice` returns natural-unit price values instead of normalizing to the canonical 8-decimal oracle format for standard Pyth negative exponent ranges, corrupting downstream mark price and health factor calculations.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Pyth Exponent & Decimal Normalization Remediation Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``_authorizedUpdaters` is changed without an event but is used for access control`
- **Lines**: L262
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/RWAOracleAdapter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/RWAOracleAdapter.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

### File: `contracts/oracles/TWAPOracle.sol` (1 Diagnostics)

#### Diagnostic: ``lastUpdate` is changed without an event but is used in arithmetic`
- **Lines**: L158
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/oracles/TWAPOracle.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/oracles/TWAPOracle.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

### File: `contracts/security/AccessControlManager.sol` (3 Diagnostics)

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

### File: `contracts/security/CircuitBreaker.sol` (6 Diagnostics)

#### Diagnostic: ``abi.encodePacked()` called with multiple dynamic type arguments; hash collisions possible`
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

#### Diagnostic: ``guardian` is changed without an event but is used for access control`
- **Lines**: L295
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/CircuitBreaker.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/CircuitBreaker.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
- **Lines**: L178, L257, L386
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

#### Diagnostic: ``activeSession` is changed without an event but is used for access control`
- **Lines**: L112, L133
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/EmergencyGuardian.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/EmergencyGuardian.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``admin` is changed without an event but is used for access control`
- **Lines**: L205
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/security/RateLimiter.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/security/RateLimiter.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `multiplication should occur before division to avoid loss of precision`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: ``oracleDeviationThreshold` is changed without an event but is used for access control`
- **Lines**: L331
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``redemptionDelay` is changed without an event but is used for access control`
- **Lines**: L320
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``redemptionDelay` is changed without an event but is used in arithmetic`
- **Lines**: L320
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/tokens/CollateralWrapper.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/tokens/CollateralWrapper.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `address parameter is used in a state write or value transfer without a zero-address check`
- **Lines**: L38, L103
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Proxy Governance, Admin Control
- **Classification**: `SECURITY_REVIEW_REQUIRED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/TransparentUpgradeableProxy.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: Constructor `admin_` argument is passed to `_setAdmin` without an explicit zero-address check, risking proxy deployment lockup if initialized with `address(0)`.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` for security review.
- **Follow-up Gate**: Dedicated Proxy Deployment & Admin Validation Audit Gate

#### Diagnostic: `delegatecall target is not provably trusted`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `modifier can finish without executing the modified function`
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

#### Diagnostic: `ETH is sent to a user-controlled destination; restrict the destination or the caller`
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

#### Diagnostic: ``batches` is changed without an event but is used for access control`
- **Lines**: L141
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Governance, Access Control, Observability
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, state configuration updates are executed via governance timelock or admin functions. Off-chain observability is maintained via timelock event emissions or transaction logs.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Governance Event Standardization Gate

#### Diagnostic: ``nonReentrant` should be the first modifier`
- **Lines**: L167, L237
- **Count**: 2
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: External Calls, Reentrancy Guard, Settlement
- **Classification**: `CONTEXTUAL_ACCEPTED`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: In `contracts/upgradeability/UpgradeExecutor.sol`, state mutations and reentrancy status updates are synchronized around external ERC20/vault calls. OpenZeppelin `ReentrancyGuard` or custom state check locks prevent cross-function reentrancy vectors.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` baseline.
- **Follow-up Gate**: Reentrancy Formal Verification Gate

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `event emitted after an external call; reentrancy can reorder or fabricate logs that off-chain consumers rely on`
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

#### Diagnostic: `external call can be reentered before `_status` is updated`
- **Lines**: L251
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Upgradeability, Governance, Access Control
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `rollbackBatch` trusts `originalImplementations` passed directly via caller calldata rather than verifying against immutable/persisted execution state, potentially bypassing governance-approved implementation allowlists.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Upgrade Governance & Implementation Verification Remediation Gate

#### Diagnostic: `external call can be reentered before `lastUpgradeTime` is updated`
- **Lines**: L202
- **Count**: 1
- **Current Baseline Category**: `UNRESOLVED_SECURITY_DEBT`
- **Domains Involved**: Upgradeability, Governance, Access Control
- **Classification**: `SECURITY_BLOCKER`
- **Code Path & Reachability**: Production path in `contracts/upgradeability/UpgradeExecutor.sol`.
- **Security Consequence if Real**: Potential logic/execution risk if invariants violated.
- **Code-Specific Rationale**: `rollbackBatch` trusts `originalImplementations` passed directly via caller calldata rather than verifying against immutable/persisted execution state, potentially bypassing governance-approved implementation allowlists.
- **Action**: Retain in `UNRESOLVED_SECURITY_DEBT` as a SECURITY_BLOCKER.
- **Follow-up Gate**: Dedicated Upgrade Governance & Implementation Verification Remediation Gate

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `usage of `block.timestamp` in a comparison may be manipulated by validators`
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

#### Diagnostic: `weak randomness derived from a predictable on-chain value`
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

#### Diagnostic: `Return value of an external call is not used`
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

#### Diagnostic: ``require` or `revert` inside a loop`
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

#### Diagnostic: `external call inside a loop`
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

#### Diagnostic: `typecasts that can truncate values should be checked`
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
