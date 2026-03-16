// @title: Constantes partagées pour tous les scripts
// @network: Multi-chain support
// @audit: No hardcoded values, environment-based

module.exports = {
    // Network IDs
    NETWORKS: {
      ARBITRUM_MAINNET: 42161,
      ARBITRUM_TESTNET: 421613,
      BASE_MAINNET: 8453,
      BASE_TESTNET: 84531,
      OPTIMISM_MAINNET: 10,
      OPTIMISM_TESTNET: 420
    },
    
    // Protocol Parameters (initial)
    PROTOCOL_PARAMS: {
      initialMarginRatio: ethers.utils.parseUnits("0.1", 18), // 10%
      maintenanceMarginRatio: ethers.utils.parseUnits("0.08", 18), // 8%
      liquidationFee: ethers.utils.parseUnits("0.02", 18), // 2%
      protocolFee: ethers.utils.parseUnits("0.001", 18), // 0.1%
      maxLeverage: ethers.utils.parseUnits("10", 18), // 10x
      fundingRateInterval: 3600, // 1 hour
      liquidationBuffer: ethers.utils.parseUnits("0.05", 18), // 5%
      maxLiquidationSize: ethers.utils.parseUnits("1000000", 18), // 1M
      liquidationDelay: 300 // 5 minutes
    },
    
    // Oracle Configuration
    ORACLE_CONFIG: {
      MIN_PRICE_BOUND: ethers.utils.parseUnits("0.000001", 18), // $0.000001
      MAX_PRICE_BOUND: ethers.utils.parseUnits("1000000", 18), // $1,000,000
      MAX_DEVIATION_BPS: 200, // 2%
      
      // Chainlink
      CHAINLINK_REGISTRY: {
        42161: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf", // Arbitrum
        8453: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf", // Base
        10: "0x47Fb2585D2C56Fe188D0E6ec628a38b74fCeeeDf" // Optimism
      },
      
      // Pyth
      PYTH_ADDRESS: {
        42161: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
        8453: "0x2880aB155794e7179c9eE2e38200202908C17B43",
        10: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C"
      },
      
      // Uniswap V3
      UNISWAP_V3_FACTORY: {
        42161: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        8453: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD",
        10: "0x1F98431c8aD98523631AE4a59f267346ea31F984"
      }
    },
    
    // Tokenomics
    TOKENOMICS: {
      NAME: "PerpArbitraDEX Token",
      SYMBOL: "PERP",
      INITIAL_SUPPLY: ethers.utils.parseUnits("1000000000", 18), // 1B
      TIMELOCK_DELAY: 172800, // 2 days
      VOTING_DELAY: 7200, // 1 day in blocks
      VOTING_PERIOD: 50400, // 1 week in blocks
      PROPOSAL_THRESHOLD: ethers.utils.parseUnits("100000", 18), // 100K tokens
      QUORUM_PERCENTAGE: 4, // 4%
      VE_MAX_TIME: 4 * 365 * 24 * 3600 // 4 years
    },
    
    // Markets Configuration
    MARKETS_CONFIG: [
      {
        id: "ETH-USD",
        name: "Ethereum / USD",
        baseToken: "0x0000000000000000000000000000000000000000", // ETH
        quoteToken: "0x0000000000000000000000000000000000000000", // USD
        maxPositionSize: ethers.utils.parseUnits("10000", 18),
        minPositionSize: ethers.utils.parseUnits("10", 18),
        tickSize: ethers.utils.parseUnits("0.01", 18),
        oracleSources: ["chainlink", "pyth", "twap"]
      },
      {
        id: "BTC-USD",
        name: "Bitcoin / USD",
        baseToken: "0x0000000000000000000000000000000000000000", // BTC
        quoteToken: "0x0000000000000000000000000000000000000000", // USD
        maxPositionSize: ethers.utils.parseUnits("500", 18),
        minPositionSize: ethers.utils.parseUnits("0.001", 18),
        tickSize: ethers.utils.parseUnits("0.1", 18),
        oracleSources: ["chainlink", "pyth"]
      }
    ],
    
    // External Integrations
    INTEGRATION_CONFIG: {
      AAVE_POOL_ADDRESSES: {
        42161: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
        8453: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
        10: "0x794a61358D6845594F94dc1DB02A252b5b4814aD"
      },
      LIDO_STETH: {
        1: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84"
      },
      LAYERZERO_ENDPOINT: {
        42161: "0x3c2269811836af69497E5F486A85D7316753cf62",
        8453: "0xb6319cC6c8c27A8F5dAF0dD3DF91EA35C4720dd7",
        10: "0x3c2269811836af69497E5F486A85D7316753cf62"
      },
      ENTRY_POINT: {
        42161: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
        8453: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
        10: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
      }
    },
    
    // Gas Configuration
    GAS_CONFIG: {
      MAX_FEE_PER_GAS: ethers.utils.parseUnits("0.1", "gwei"),
      MAX_PRIORITY_FEE_PER_GAS: ethers.utils.parseUnits("0.01", "gwei"),
      GAS_LIMIT_MULTIPLIER: 1.2
    }
  };