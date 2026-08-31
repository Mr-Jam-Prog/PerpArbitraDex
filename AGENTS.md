# PerpArbitraDex contributor instructions

## 1. Directory Architecture

- `contracts/`: Solidity 0.8.19 protocol contracts.
- `packages/`: Workspace packages:
  - `packages/math/`: TypeScript math library (`@perpdex/math`).
  - `packages/sdk/`: TypeScript protocol SDK (`@perpdex/sdk`).
  - `packages/subgraph/`: Indexing subgraph schema & handlers.
- `frontend/`: Next.js frontend application.
- `bots/`: Keeper & liquidation bot implementations.
- `test/`: Hardhat & Foundry test suites:
  - `test/unit/`: Hardhat unit tests for core smart contracts.
  - `test/fuzz/`: Foundry property & invariant fuzz tests.
  - `test/fork/`: Fork integration tests (Known Blocked Gate).
  - `test/integration/`: End-to-end integration tests (Known Blocked Gate).

## 2. Standard Commands

- **Environment**: Node 20 LTS (`.nvmrc`), pnpm 9.15.5 (`packageManager`), Foundry v1.8.1 (pinned in CI).
- **Frozen Installation**: `pnpm run install:frozen`
- **Solidity Compilation**: `pnpm run compile` (Hardhat, then Foundry)
- **Unit Tests (Hardhat)**: `pnpm run test:unit`
- **Fuzz/Invariant Tests (Foundry)**: `pnpm run test:forge`
- **Math/SDK Typecheck and Build**: `pnpm run build:packages` (`tsc` performs both)
- **Deterministic Core Gate Verification**: `pnpm check:core`

## 3. Known Blocked Gates

The following non-core gates are explicitly tracked as **Known Blocked Gates** and excluded from `pnpm check:core`:
- **Frontend App (`frontend/`)**: no passing production-build gate is claimed; enable only after `pnpm --filter @perpdex/frontend build` passes.
- **Subgraph (`packages/subgraph/`)**: codegen/build is deferred until its schema and Core ABI are aligned.
- **Fork Tests (`test/fork/`)**: require pinned RPC/fork configuration and are not part of the deterministic offline test run.
- **Integration/Simulation Tests (`test/integration/`, `test/simulation/`)**: not included in the core Hardhat unit-test gate.

*Do not announce these components as green/passing until their respective gates are fully remediated.*

## 4. Numerical Precision Specs

Current conventions (verify against the relevant contract before changing calculations):
- **Amounts/notional/collateral/PnL/funding payments**: 18 decimals (`1e18`).
- **External oracle/market prices**: 8 decimals (`1e8`); `PositionMath` normalizes them to 18 decimals internally.
- **Health factors and most ratios**: 18 decimals (`1e18 = 100%`); `PositionMath` risk inputs use basis points (`1e4 = 100%`).
- **Time values**: seconds.
- **Sources of truth**: `ORACLE_DESIGN.md`, `RISK_MODEL.md`, `FUNDING_MODEL.md`, `LIQUIDATION_FLOW.md`, and the corresponding Solidity interfaces. If code and documentation disagree, report the mismatch; do not silently infer a conversion.

## 5. Strict Protocol Rules

1. **No Secrets**: Never commit private keys, `.env` secrets, seed phrases, or API keys.
2. **No Error Masking**: never use `continue-on-error`, `|| true`, swallowed exceptions, or equivalent masking on mandatory gates. Exit codes must dictate success.
3. **No Artifact Editing**: Never manually modify generated build artifacts (`dist/`, `artifacts/`, `out/`, `cache/`). Always edit source files and rebuild.
4. **No Logic Alteration**: Never alter trading, oracle, funding, or liquidation math logic during infrastructure/DevEx refactoring.

## 6. Required Final Report Format

When delivering task completions or pull requests, the final report **must** explicitly report:
- **Runtime Versions**: Exact Node.js and pnpm versions used.
- **Commands Executed**: exact verification commands and their exit codes.
- **Execution Durations**: approximate time for install and each core gate.
- **Test Metrics**: passing/failing/skipped counts per Hardhat and Foundry suite.
- **Known Blocked Gates**: Explicitly list any deferred/blocked non-core gates (e.g., frontend, subgraph, fork tests).
