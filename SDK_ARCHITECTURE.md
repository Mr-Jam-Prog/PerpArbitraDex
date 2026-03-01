# PerpArbitraDEX SDK Modular Architecture

The SDK is designed to be the single source of truth for the frontend, abstracting all blockchain complexity and financial math.

## 1. Modular Structure

### 1.1 Core Client (`PerpDexClient`)
- **Role:** Main entry point. Manages provider/signer connection and contract instances.
- **Modules:**
    - `TradingModule`: `openPosition`, `closePosition`, `addMargin`, etc.
    - `ViewModule`: `getPosition`, `getMarket`, `getTraderHistory`.
    - `PreviewModule`: Pure view helpers for UI feedback (PnL, Liq Price).

### 1.2 Math Module (`@perpdex/math`)
- **Role:** Mirror of on-chain `PositionMath.sol` in TypeScript.
- **Rule:** NEVER implement financial logic in the frontend components. Always use this module or contract calls.
- **Includes:** PnL calculations, Health Factor derived logic, unit conversions (18 decimals).

### 1.3 Subgraph Adapter
- **Role:** High-performance data fetching for history and lists.
- **Fallback:** Transparently falls back to multicall/contract-queries if Subgraph is delayed.

## 2. Integration Best Practices for Frontend

- **Zero-Logic Components:** Components should only display data provided by the SDK and trigger SDK methods.
- **Decimal Management:** Use `bigint` for all calculations; format to string only at the final display layer.
- **Transaction Flow:**
    1. `sdk.previewOpenPosition(params)` -> returns PnL/LiqPrice preview.
    2. `sdk.estimateGas(params)` -> returns gas fees.
    3. `sdk.openPosition(params)` -> returns transaction object.

## 3. ABI Versioning
- ABIs are stored in `src/abi/` and versioned with the SDK package.
- Breaking contract changes MUST trigger an SDK minor version bump.

## 4. Key Helpers Specification

| Helper | Input | Output | Description |
|--------|-------|--------|-------------|
| `previewPnL` | `positionId`, `price` | `BigInt` (Quote) | Estimated profit/loss including funding. |
| `previewFunding` | `positionId` | `BigInt` (Quote) | Accrued funding since last update. |
| `previewLiqPrice` | `size`, `margin`, `isLong` | `BigInt` | Target price for liquidation. |
| `getAvailableMargin` | `positionId` | `BigInt` | Max margin withdrawable without liquidation. |
| `getMaxAdditionalSize` | `positionId`, `margin` | `BigInt` | Max size increase allowed by leverage. |
