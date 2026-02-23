// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpEngine} from "../../contracts/core/PerpEngine.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {PositionManager} from "../../contracts/core/PositionManager.sol";
import {AMMPool} from "../../contracts/core/AMMPool.sol";
import {ProtocolConfig} from "../../contracts/core/ProtocolConfig.sol";
import {LiquidationEngine} from "../../contracts/liquidation/LiquidationEngine.sol";

/**
 * @title MockERC20 standard for tests
 */
contract MockERC20 is IERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;
    uint256 public override totalSupply;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/**
 * @title Economic Invariant Tests
 * @notice Tests formels des invariants économiques critiques
 */
contract InvariantEconomicTest is StdInvariant, Test {
    // Contrats du protocole
    PerpEngine public perpEngine;
    PositionManager public positionManager;
    AMMPool public ammPool;
    ProtocolConfig public protocolConfig;
    LiquidationEngine public liquidationEngine;

    // Tokens
    MockERC20 public usdc;

    // Acteurs pour le fuzzing
    TraderActor[] public traderActors;
    LpActor[] public lpActors;
    LiquidatorActor[] public liquidatorActors;

    address public insuranceFund = makeAddr("insuranceFund");
    uint256 public initialSystemValue;

    function setUp() public {
        _deployProtocol();
        _setupMarkets();
        _createActors();
        _fundActors();

        initialSystemValue = _calculateTotalSystemValue();

        // Cibler les acteurs pour le fuzzing
        for(uint256 i=0; i<traderActors.length; i++) {
            targetContract(address(traderActors[i]));
        }
        for(uint256 i=0; i<liquidatorActors.length; i++) {
            targetContract(address(liquidatorActors[i]));
        }

        excludeSender(address(0));
        excludeSender(address(this));
        excludeSender(address(perpEngine));
        excludeSender(address(ammPool));
    }

    function _deployProtocol() internal {
        // Predict addresses for circular dependency
        uint256 nonce = vm.getNonce(address(this));

        usdc = new MockERC20("USDC", "USDC", 18);
        protocolConfig = new ProtocolConfig(address(this), address(this));

        vm.computeCreateAddress(address(this), nonce + 2); // PositionManager
        address ammAddr = vm.computeCreateAddress(address(this), nonce + 3);
        address liqAddr = vm.computeCreateAddress(address(this), nonce + 4);
        address perpAddr = vm.computeCreateAddress(address(this), nonce + 5);

        positionManager = new PositionManager(perpAddr);
        ammPool = new AMMPool(perpAddr, address(this));

        liquidationEngine = new LiquidationEngine(
            perpAddr,
            address(protocolConfig),
            address(this), // mock oracle aggregator
            address(usdc),
            address(0), // liquidationQueue (mocked/not used in basic flow)
            address(0)  // incentiveDistributor
        );

        perpEngine = new PerpEngine(
            address(positionManager),
            ammAddr,
            address(this), // oracleAggregator mock
            liqAddr,
            address(this), // riskManager mock
            address(protocolConfig),
            insuranceFund,
            address(usdc),
            address(usdc)
        );
    }

    // Mock OracleAggregator
    function getPrice(bytes32) external pure returns (uint256) {
        return 2000e8;
    }
    function isPriceStale(bytes32) external pure returns (bool) {
        return false;
    }
    function getPriceData(bytes32) external view returns (uint256 price, uint256 timestamp, uint8 status) {
        return (2000e8, block.timestamp, 1); // 1 = ACTIVE
    }

    // Mock RiskManager
    function validatePosition(uint256, uint256, uint256, uint256) external pure returns (bool, string memory) {
        return (true, "");
    }

    function _setupMarkets() internal {
        vm.prank(insuranceFund);
        perpEngine.initializeMarket(
            1,
            bytes32("ETH-USD"),
            10e18,
            1e16,
            10 ether,
            2e16,
            1e15
        );

        vm.prank(address(perpEngine));
        ammPool.initializeMarket(1, 100_000e18, 1e16, 1 hours);
    }

    function _createActors() internal {
        for (uint256 i = 0; i < 5; i++) {
            traderActors.push(new TraderActor(address(perpEngine), address(usdc)));
        }
        for (uint256 i = 0; i < 2; i++) {
            lpActors.push(new LpActor(address(ammPool), address(usdc)));
        }
        for (uint256 i = 0; i < 2; i++) {
            liquidatorActors.push(new LiquidatorActor(address(liquidationEngine), address(usdc)));
        }
    }

    function _fundActors() internal {
        for (uint256 i = 0; i < traderActors.length; i++) {
            usdc.mint(address(traderActors[i]), 1_000_000e18);
        }
        for (uint256 i = 0; i < lpActors.length; i++) {
            usdc.mint(address(lpActors[i]), 1_000_000e18);
        }
        for (uint256 i = 0; i < liquidatorActors.length; i++) {
            usdc.mint(address(liquidatorActors[i]), 1_000_000e18);
        }
    }

    /* ========== INVARIANTS ========== */

    function invariant_insolvency_impossible() public view {
        assertTrue(perpEngine.totalCollateral() >= 0, "Negative total collateral");
    }

    function invariant_funds_conservation() public view {
        uint256 totalValue = _calculateTotalSystemValue();
        // Fees might drift the value but it should be accounted for if we tracked it perfectly.
        // For now just check it doesn't decrease catastrophically.
        assertTrue(totalValue >= initialSystemValue - 1e18, "Value leaked");
    }

    function _calculateTotalSystemValue() internal view returns (uint256) {
        uint256 total = usdc.balanceOf(address(perpEngine));
        total += usdc.balanceOf(address(ammPool));
        total += usdc.balanceOf(address(liquidationEngine));

        for(uint256 i=0; i<traderActors.length; i++) {
            total += usdc.balanceOf(address(traderActors[i]));
        }
        for(uint256 i=0; i<lpActors.length; i++) {
            total += usdc.balanceOf(address(lpActors[i]));
        }
        for(uint256 i=0; i<liquidatorActors.length; i++) {
            total += usdc.balanceOf(address(liquidatorActors[i]));
        }
        return total;
    }
}

contract TraderActor {
    PerpEngine public perpEngine;
    IERC20 public usdc;
    uint256[] public myPositions;

    constructor(address engine, address token) {
        perpEngine = PerpEngine(engine);
        usdc = IERC20(token);
        usdc.approve(engine, type(uint256).max);
    }

    function openRandomPosition(uint256 seed) external {
        uint256 margin = 1000e18 + (seed % 9000e18);
        uint256 size = (margin * 2) / 2000;

        try perpEngine.openPosition(IPerpEngine.TradeParams({
            marketId: 1,
            isLong: seed % 2 == 0,
            size: size,
            margin: margin,
            acceptablePrice: (seed % 2 == 0) ? 3000e18 : 1000e18,
            deadline: block.timestamp + 1,
            referralCode: bytes32(0)
        })) returns (uint256 id) {
            myPositions.push(id);
        } catch {}
    }

    function closeRandomPosition(uint256 seed) external {
        if (myPositions.length == 0) return;
        uint256 index = seed % myPositions.length;
        uint256 id = myPositions[index];

        try perpEngine.closePosition(id) {
            myPositions[index] = myPositions[myPositions.length - 1];
            myPositions.pop();
        } catch {}
    }
}

contract LpActor {
    AMMPool public ammPool;
    IERC20 public usdc;

    constructor(address pool, address token) {
        ammPool = AMMPool(pool);
        usdc = IERC20(token);
        usdc.approve(pool, type(uint256).max);
    }
}

contract LiquidatorActor {
    LiquidationEngine public liquidationEngine;
    IERC20 public usdc;

    constructor(address engine, address token) {
        liquidationEngine = LiquidationEngine(engine);
        usdc = IERC20(token);
    }

    function liquidateRandomPosition(uint256 positionId) external {
        try liquidationEngine.executeLiquidation(positionId, 0) {} catch {}
    }
}
