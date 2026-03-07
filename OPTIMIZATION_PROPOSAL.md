# PerpArbitraDex Optimization & Architectural Refinement Proposal

This document outlines prioritized optimizations to reduce gas costs, improve scalability, and enhance protocol robustness.

## 1. Storage Optimization (Struct Packing)

On Arbitrum, L2 execution is cheap, but storage slots and calldata are the primary cost drivers. Packing structs can save ~20k gas per slot saved during initialization.

### A. IPerpEngine.Position (Critical)
*   **Current State:** Uses 11 slots.
*   **Optimization:** Pack trader and status into 1 slot. Reduce timestamps.
*   **Target State:** 8 slots.
    ```solidity
    struct Position {
        address trader;      // 20 bytes
        uint32 marketId;     // 4 bytes
        bool isLong;         // 1 byte
        bool isActive;       // 1 byte
        // 6 bytes padding left in this slot

        uint256 size;
        uint256 margin;
        uint256 entryPrice;
        uint256 leverage;
        uint256 lastFundingAccrued; // uint48?
        uint48 openTime;     // 6 bytes
        uint48 lastUpdated;  // 6 bytes
    }
    ```

### B. AMMPool.MarketConfig
*   **Optimization:** Pack bool and interval.
    ```solidity
    struct MarketConfig {
        uint256 skewScale;
        uint256 maxFundingRate;
        uint48 fundingInterval;
        bool isActive;
    }
    ```

---

## 2. Architectural Refinements

### A. Remove Linear Loops in Admin Functions (High Priority)
Functions like `updateProtocolFee` iterate up to 100 times.
*   **Risk:** Reaching the block gas limit if markets grow, or wasting gas on inactive markets.
*   **Proposal:** Implement a "Global vs Local" parameter pattern in `ProtocolConfig.sol`.
    ```solidity
    // In PerpEngine.sol
    uint256 marketFee = _markets[marketId].protocolFeeRatio;
    if (marketFee == 0) {
        marketFee = configRegistry.getProtocolConfig().protocolFeeRatio;
    }
    ```
*   Allows updating the global fee in **1 transaction (1 SSTORE)** instead of a loop.

### B. Scalable Position Indexing
The `_traderPositions` mapping stores an array of all position IDs for a trader.
*   **Current Issue:** `getPositionCount` and transfers (in `PositionManager`) check every position in the engine using `try/catch`. This is extremely expensive.
*   **Proposal:**
    *   Maintain a `uint256 activeCount` per trader.
    *   Only check active status when viewing/transferring if strictly necessary.
    *   Rely on the SDK for heavy view logic instead of on-chain loops.

---

## 3. Gas Optimizations (Solidity Patterns)

### A. Calldata vs Memory
*   Ensure all external functions use `calldata` for structs and arrays (e.g., `TradeParams`). This avoids the cost of copying data to memory.

### B. Redundant Accrual Prevention
*   In `PerpEngine`, `_accrueFunding` is called before almost every state change.
*   If multiple actions (e.g., `addMargin` then `increasePosition`) happen in the same block, the second accrual is redundant because `timeElapsed` will be 0.
*   **Proposal:** Add a check at the start of `_accrueFunding`:
    ```solidity
    if (block.timestamp == _fundingStates[marketId].lastFundingTime) return;
    ```

### C. Access Control (Custom Errors)
*   Replace `require(..., "String error message")` with `if (...) revert CustomError()`.
*   This reduces contract bytecode size and saves deployment costs + small execution gas.

---

## 4. Implementation Roadmap

1.  **Phase 1 (Packing):** Implement struct packing in `IPerpEngine` and `IAMMPool`. (Requires migration of existing tests).
2.  **Phase 2 (Global Params):** Refactor `ProtocolConfig` to support global defaults.
3.  **Phase 3 (L2 Tuning):** Enable `--via-ir` and optimize `calldata` usage for the `OracleAggregator`.
