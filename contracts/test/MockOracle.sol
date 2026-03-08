// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

/**
 * @title MockOracle
 * @notice Unified mock oracle supporting multiple interfaces (Chainlink, Pyth, TWAP, etc.)
 */
contract MockOracle {
    uint256 private _price;
    uint256 private _timestamp;
    uint256 private _confidence;
    bool private _valid = true;
    uint8 public decimals;
    string public description;
    bool private _shouldRevert;

    mapping(bytes32 => uint256) private _prices;
    mapping(string => uint256) private _symbolPrices;

    struct Observation {
        uint256 price;
        uint256 timestamp;
    }
    mapping(string => Observation[]) private _observations;

    constructor(string memory _description, uint8 _decimals) {
        description = _description;
        decimals = _decimals;
        _timestamp = block.timestamp;
    }

    modifier checkRevert() {
        require(!_shouldRevert, "MockOracle: forced revert");
        _;
    }

    // --- Mock control functions ---

    function setPrice(uint256 price) external {
        _price = price;
        _timestamp = block.timestamp;
    }

    // Fix for overloaded function ambiguity in ethers v6
    function setPriceForSymbol(string calldata symbol, uint256 price) external {
        _symbolPrices[symbol] = price;
        _price = price;
        _timestamp = block.timestamp;
    }

    function setFullPriceData(uint256 price, uint256 timestamp, uint256 confidence, bool valid) external {
        _price = price;
        _timestamp = timestamp;
        _confidence = confidence;
        _valid = valid;
    }

    function setShouldRevert(bool shouldRevert) external {
        _shouldRevert = shouldRevert;
    }

    function setTimestamp(uint256 timestamp) external {
        _timestamp = timestamp;
    }

    function addObservation(string calldata symbol, uint256 price, uint256 timestamp) external {
        _observations[symbol].push(Observation(price, timestamp));
    }

    // --- IOracleAggregator-like functions ---

    function getPrice(bytes32 feedId) external view checkRevert returns (uint256) {
        uint256 p = _prices[feedId];
        return p > 0 ? p : _price;
    }

    // Overload for string (market symbol)
    function getPrice(string calldata symbol) external view checkRevert returns (uint256) {
        // Simple TWAP logic for Mock if observations exist
        if (_observations[symbol].length >= 2) {
            Observation[] storage obs = _observations[symbol];
            uint256 firstTs = obs[0].timestamp;
            uint256 lastTs = obs[obs.length - 1].timestamp;
            require(block.timestamp - lastTs <= 1 hours, "StaleTWAP");

            uint256 weightedSum = 0;
            for (uint256 i = 0; i < obs.length - 1; i++) {
                uint256 duration = obs[i+1].timestamp - obs[i].timestamp;
                weightedSum += obs[i].price * duration;
            }
            return weightedSum / (lastTs - firstTs);
        }

        uint256 p = _symbolPrices[symbol];
        return p > 0 ? p : _price;
    }

    function isPriceStale(bytes32 /*feedId*/) external view checkRevert returns (bool) {
        return block.timestamp - _timestamp > 1 hours;
    }

    function getPriceData() external view checkRevert returns (bool valid, uint256 price, uint256 timestamp, uint256 confidence) {
        return (_valid, _price, _timestamp, _confidence);
    }

    // --- Chainlink-like functions (AggregatorV3Interface) ---

    function latestRoundData()
        external
        view
        checkRevert
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (1, int256(_price), _timestamp, _timestamp, 1);
    }

    // --- Pyth-like functions ---

    struct PythPrice {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceNoOlderThan(bytes32 /*id*/, uint256 age) external view checkRevert returns (PythPrice memory) {
        require(block.timestamp - _timestamp <= age, "MockOracle: stale price");
        return PythPrice(int64(int256(_price)), uint64(_confidence), -8, _timestamp);
    }

    // --- TWAP-like functions ---
    function getArithmeticMean(uint256 /*period*/) external view checkRevert returns (uint256) {
        return _price;
    }
}
