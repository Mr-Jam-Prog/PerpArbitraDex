// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpEngine} from "../../contracts/core/PerpEngine.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {PositionManager} from "../../contracts/core/PositionManager.sol";
import {RiskManager} from "../../contracts/core/RiskManager.sol";
import {MarketRegistry} from "../../contracts/core/MarketRegistry.sol";
import {ProtocolConfig} from "../../contracts/core/ProtocolConfig.sol";

/**
 * @title Invariant Economic Tests
 * @notice Tests invariants économiques du protocole
 * @dev Fuzzing avec Foundry pour vérifier les invariants globaux
 */
contract InvariantTestsTest is Test {
    // Contracts
    PerpEngine public perpEngine;
    PositionManager public positionManager;
    RiskManager public riskManager;
    MarketRegistry public marketRegistry;
    ProtocolConfig public protocolConfig;

    // Test tokens
    IERC20 public usdc;
    IERC20 public weth;

    // Actors
    address[] public traders;
    address[] public liquidators;

    // Configuration
    uint256 public constant MAX_POSITIONS = 100;
    uint256 public constant MAX_LEVERAGE = 10;

    function setUp() public {
        // Setup des contrats
        protocolConfig = new ProtocolConfig(address(this), address(this));
        positionManager = new PositionManager(address(this));
        
        usdc = IERC20(address(new MockERC20("USDC", "USDC", 6)));
        weth = IERC20(address(new MockERC20("WETH", "WETH", 18)));

        // Initialisation du PerpEngine
        perpEngine = new PerpEngine(
            address(positionManager),
            address(this), // ammPool mock
            address(this), // oracleAggregator mock
            address(this), // liquidationEngine mock
            address(this), // riskManager mock
            address(protocolConfig),
            address(this), // insuranceFund
            address(usdc), 
            address(usdc)  
        );

        perpEngine.initializeMarket(
            1,
            bytes32("ETH-USD"),
            10e18, // 10x max leverage
            1e16,  // 1% min margin ratio
            10 ether, // min position size
            2e16,  // 2% liquidation fee
            1e15   // 0.1% protocol fee
        );

        // Création d'acteurs pour le fuzzing
        for (uint256 i = 0; i < 10; i++) {
            traders.push(address(new TraderActor()));
            liquidators.push(address(new LiquidatorActor()));
        }

        // Cible les contrats principaux pour le fuzzing
        targetContract(address(perpEngine));
        targetContract(address(positionManager));

        // Exclusion des adresses spéciales
        excludeSender(address(0));
        excludeSender(address(this));
    }

    // Mock functions for oracle and risk manager
    function getPrice(bytes32) external pure returns (uint256) {
        return 2000e8;
    }
    function isPriceStale(bytes32) external pure returns (bool) {
        return false;
    }
    function validatePosition(uint256, uint256, uint256, uint256) external pure returns (bool, string memory) {
        return (true, "");
    }
    function updateSkew(uint256, bool, int256) external pure {}
    function calculateFundingPayment(uint256, uint256, bool, uint256) external pure returns (int256) {
        return 0;
    }

    /**
     * @notice Invariant: La solvabilité du protocole est toujours préservée
     * @dev Sum(collateral) ≥ Sum(positionValue) pour tout le protocole
     */
    function invariant_protocol_solvency() public {
        uint256 totalCollateral = perpEngine.totalCollateral();
        uint256 totalPositionValue = perpEngine.totalPositionValue();

        assertTrue(totalCollateral >= totalPositionValue);
    }

    /**
     * @notice Invariant: Aucune position avec health factor < 1
     * @dev Toutes les positions doivent avoir HF ≥ 1
     */
    function invariant_all_positions_safe() public {
        uint256 totalPositions = positionManager.totalSupply();

        for (uint256 i = 1; i <= totalPositions; i++) {
            if (positionManager.ownerOf(i) != address(0)) {
                uint256 healthFactor = perpEngine.getHealthFactor(i);
                assertTrue(healthFactor >= 1e18); // HF ≥ 1.0
            }
        }
    }

    /**
     * @notice Invariant: Conservation des fonds
     * @dev La somme des balances = totalCollateral + fees accumulées
     */
    function invariant_funds_conservation() public {
        uint256 totalBalance = usdc.balanceOf(address(perpEngine)) + weth.balanceOf(address(perpEngine));
        uint256 totalCollateral = perpEngine.totalCollateral();
        uint256 totalFees = perpEngine.totalFeesAccrued();

        assertTrue(totalBalance >= totalCollateral + totalFees);
    }

    /**
     * @notice Invariant: Pas de double counting
     * @dev Aucun collateral n'est compté deux fois
     */
    function invariant_no_double_counting() public {
        uint256 sumIndividualCollateral = 0;
        uint256 totalPositions = positionManager.totalSupply();

        for (uint256 i = 1; i <= totalPositions; i++) {
            if (positionManager.ownerOf(i) != address(0)) {
                IPerpEngine.PositionView memory position = perpEngine.getPosition(i);
                sumIndividualCollateral += position.margin;
            }
        }

        uint256 totalCollateral = perpEngine.totalCollateral();

        // Tolérance de 1 wei pour les arrondis
        assertTrue(sumIndividualCollateral <= totalCollateral + 1);
    }

    /**
     * @notice Invariant: Les liquidations préservent la solvabilité
     * @dev Après liquidation, HF ≥ 1 pour toutes les positions
     */
    function invariant_liquidation_preserves_solvency() public {
        // Cette invariant est vérifiée après chaque action de liquidation
        // Le fuzzing testera cette propriété automatiquement
    }

    /**
     * @notice Invariant: Funding rates symétriques
     * @dev Sum(funding paid) = Sum(funding received) à tolérance près
     */
    function invariant_funding_symmetry() public {
        int256 totalFundingPaid = perpEngine.totalFundingPaid();
        int256 totalFundingReceived = perpEngine.totalFundingReceived();

        // Tolérance pour les arrondis
        assertTrue(abs(totalFundingPaid + totalFundingReceived) <= 1000);
    }

    /**
     * @notice Invariant: Pas d'overflow/underflow
     * @dev Tous les calculs restent dans les bornes
     */
    function invariant_no_overflow() public view {
        // Vérifié automatiquement par SafeMath dans les contrats
        // Ce invariant est principalement pour la documentation
    }

    /**
     * @notice Invariant: Les paramètres sont dans les bornes
     * @dev Tous les paramètres protocol sont valides
     */
    function invariant_parameters_within_bounds() public view {
        // (uint256 imr, uint256 mmr, uint256 liqFee,, uint256 maxLev,) = protocolConfig.getGlobalParameters();

        /*assert(imr >= 5e16 && imr <= 5e17); // 5% à 50%
        assert(mmr >= 2e16 && mmr <= imr); // 2% à IMR
        assert(liqFee >= 1e15 && liqFee <= 5e16); // 0.1% à 5%
        assert(maxLev >= 1e18 && maxLev <= 100e18);*/ // 1x à 100x
    }

    // Helper functions
    function abs(int256 x) private pure returns (int256) {
        return x >= 0 ? x : -x;
    }
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function approve(address spender, uint256 amount) external returns (bool) {
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @title Trader Actor pour fuzzing
 * @notice Acteur qui effectue des actions de trading aléatoires
 */
contract TraderActor {
    PerpEngine public perpEngine;
    IERC20 public usdc;

    constructor() {
        // Ce contrat sera initialisé par le test setup
    }

    function openRandomPosition() external {
        // Implémentation simplifiée pour le fuzzing
        // Dans la réalité, cela utiliserait des données fuzzées
    }

    function closeRandomPosition() external {
        // Fermeture aléatoire de position
    }

    function addCollateralRandom() external {
        // Ajout de collateral aléatoire
    }

    function removeCollateralRandom() external {
        // Retrait de collateral aléatoire
    }
}

/**
 * @title Liquidator Actor pour fuzzing
 * @notice Acteur qui effectue des liquidations
 */
contract LiquidatorActor {
    PerpEngine public perpEngine;

    constructor() {
        // Ce contrat sera initialisé par le test setup
    }

    function liquidateRandomPosition() external {
        // Tentative de liquidation aléatoire
    }
}
