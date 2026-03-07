# Frontend & SDK Consistency Report

Following the stabilization of the smart contracts (v1.1.0), this report identifies discrepancies in the Frontend and SDK integrations.

## 1. Smart Contract vs. Frontend ABI Mismatch (Critical)

The `frontend/src/utils/contracts.js` file contains hardcoded string ABIs that are outdated (Version 1.0.0).

| Feature | Contract (v1.1.0) | Frontend ABI (v1.0.0) | Status |
| :--- | :--- | :--- | :--- |
| **openPosition** | Takes `TradeParams` struct. | Takes `(string, uint256, uint256, bool)`. | **Breaking** |
| **getPosition** | Returns `PositionView` struct (14 fields). | Returns tuple (6 fields). | **Breaking** |
| **Market IDs** | Uses `uint256 marketId`. | Uses `string market` (symbol). | **Inconsistent** |
| **Ethers.js** | Version 6. | Version 5. | **Warning** |

### Impact
The frontend will fail to parse transaction receipts and view call results due to incorrect function selectors and return data decoding.

---

## 2. SDK Integration Status

The `@perpdex/sdk` is better aligned but still requires updates to match the stabilized `OracleAggregator` logic.

- **Oracle Decimals:** The SDK correctly assumes 8-decimal oracles but should use the `OracleAggregator.getPriceData()` status field to prevent displaying stale prices.
- **Error Handling:** The SDK should be updated to catch the new `Custom Errors` proposed in the optimization plan.

---

## 3. Recommended Fixes

### A. Sync Frontend ABIs
Replace the hardcoded strings in `frontend/src/utils/contracts.js` with JSON imports from the SDK's `abi/v1/` directory.

### B. Standardize Identifiers
Ensure the frontend maps market symbols (e.g., "ETH-USD") to `marketId` (uint256) before calling the engine, using the `MarketRegistry`.

### C. Decimal Precision
Frontend `usePositions.js` uses `formatUnits(..., 6)` for collateral. This must be updated to use the actual `quoteToken` decimals (standardized to 18 in the core protocol).

---

## 4. Security Note
Directly calling `contracts.perpEngine.getPosition` in a loop in `usePositions.js` is inefficient and creates high RPC load. The Frontend should prioritize the **Subgraph** or use the **Batch View** functions implemented in `IPositionViewer`.
