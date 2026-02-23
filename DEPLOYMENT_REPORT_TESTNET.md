# PerpArbitraDEX Testnet Deployment Report

This report documents the core protocol deployment on the local testnet (Anvil simulation), providing addresses and initial parameters for SDK/frontend integration.

## 1. Contract Addresses

| Contract | Address |
|----------|---------|
| **PerpEngine** | `0x0DCd1Bf9A1b36cE34237eEaFef220932846BCD82` |
| **AMMPool** | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| **OracleAggregator** | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| **ProtocolConfig** | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| **QuoteToken (Mock USDC)** | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| **PositionManager** | `0xa513E6E4b8f2a923D98304ec87F64353C4D5C853` |
| **LiquidationEngine** | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` |
| **RiskManager** | `0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0` |
| **MarketRegistry** | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| **OracleSecurity** | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |
| **OracleSanityChecker** | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |

## 2. Initial Parameters (Conservative)

### Global Protocol Parameters
- **Max Leverage:** 10x
- **Liquidation Penalty:** 5%
- **Protocol Fee:** 0.1%
- **Funding Interval:** 1 hour

### Active Markets

#### ETH-USD (Market ID: 1)
- **Min Position Size:** 0.1 ETH
- **Min Margin Ratio:** 2%
- **OI Cap:** 100,000 USD

#### BTC-USD (Market ID: 2)
- **Min Position Size:** 0.01 BTC
- **Min Margin Ratio:** 2%
- **OI Cap:** 100,000 USD

## 3. ABI Versioning
Final ABIs for this deployment are available in `packages/sdk/src/abi/v1/`.

## 4. Reproducible Script
Deployment was executed using `script/DeployCore.s.sol`.
Command: `forge script script/DeployCore.s.sol:DeployCore --rpc-url <RPC_URL> --broadcast --via-ir`
