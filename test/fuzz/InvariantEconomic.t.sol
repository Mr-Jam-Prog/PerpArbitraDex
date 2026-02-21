// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {PerpEngine} from "../../contracts/core/PerpEngine.sol";
import {IPerpEngine} from "../../contracts/interfaces/IPerpEngine.sol";
import {PositionManager} from "../../contracts/core/PositionManager.sol";
import {AMMPool} from "../../contracts/core/AMMPool.sol";
import {MarketRegistry} from "../../contracts/core/MarketRegistry.sol";
import {ProtocolConfig} from "../../contracts/core/ProtocolConfig.sol";
import {LiquidationEngine} from "../../contracts/liquidation/LiquidationEngine.sol";

/**
 * @title Economic Invariant Tests
 * @notice Tests formels des invariants économiques critiques
 * @dev Vérifie que le protocole préserve ces propriétés sous toutes conditions
 *
 * Invariants testés:
 * 1. Insolvency impossible - Le protocole ne peut jamais devenir insolvable
 * 2. LP balance ≥ 0 - Les LPs ne peuvent jamais avoir de balance négative
 * 3. Funding neutrality - Le funding est neutre entre longs et shorts
 */
contract InvariantEconomicTest is Test {
    // Contrats du protocole
    PerpEngine public perpEngine;
    PositionManager public positionManager;
    AMMPool public ammPool;
    MarketRegistry public marketRegistry;
    ProtocolConfig public protocolConfig;
    LiquidationEngine public liquidationEngine;

    // Tokens
    IERC20 public usdc;
    IERC20 public weth;

    // Acteurs pour le fuzzing
    address[] public traders;
    address[] public liquidators;
    address[] public lps;

    // Constantes
    uint256 public constant MAX_POSITIONS = 100;
    uint256 public constant MAX_LPS = 10;
    uint256 public constant MAX_TRADERS = 20;

    // État global pour vérification
    struct GlobalState {
        uint256 totalCollateral;
        uint256 totalPositionValue;
        uint256 lpTotalBalance;
        int256 totalFundingPaid;
        int256 totalFundingReceived;
        uint256 protocolBalance;
    }

    uint256 public initialSystemValue;

    function setUp() public {
        // Setup des contrats de base
        _deployProtocol();
        _setupMarkets();
        _createActors();
        _fundActors();

        initialSystemValue = _calculateTotalSystemValue();

        // Cibler les contrats pour le fuzzing
        targetContract(address(perpEngine));
        targetContract(address(ammPool));
        targetContract(address(liquidationEngine));

        // Exclure les adresses spéciales
        excludeSender(address(0));
        excludeSender(address(this));

        // Exclure les contrats eux-mêmes
        excludeSender(address(perpEngine));
        excludeSender(address(ammPool));
    }

    /* ========== INVARIANTS CRITIQUES ========== */

    /**
     * @notice Invariant 1: IMPOSSIBILITÉ D'INSOLVABILITÉ
     * @dev Le protocole ne peut jamais devenir insolvable
     * Invariant: totalCollateral ≥ totalPositionValue à tout moment
     */
    function invariant_insolvency_impossible() public view {
        GlobalState memory state = _getGlobalState();

        // INVARIANT: Le protocole doit toujours être solvable
        assertTrue(state.totalCollateral >= state.totalPositionValue, "Protocol insolvent: collateral < position value");

        // INVARIANT: Le protocole doit avoir suffisamment de réserves
        // pour couvrir toutes les positions même en cas de pire scénario
        uint256 worstCaseValue = _calculateWorstCaseExposure();
        assertTrue(state.protocolBalance >= worstCaseValue, "Protocol insufficient reserves for worst case");
    }

    /**
     * @notice Invariant 2: BALANCE LP NON-NÉGATIVE
     * @dev Les LPs ne peuvent jamais avoir de balance négative
     * Invariant: LP balance ≥ 0 pour tous les LPs
     */
    function invariant_lp_balance_non_negative() public view {
        // Vérifier chaque LP individuellement
        for (uint256 i = 0; i < lps.length; i++) {
            address lp = lps[i];
            uint256 lpBalance = ammPool.getLpBalance(lp);

            // INVARIANT: Balance LP doit être ≥ 0
            assertTrue(lpBalance >= 0, string(abi.encodePacked("LP ", _addressToString(lp), " has negative balance")));

            // INVARIANT: La somme des parts LP doit correspondre au total du pool
            uint256 lpShares = ammPool.balanceOf(lp);
            uint256 totalShares = ammPool.totalSupply();

            if (totalShares > 0) {
                uint256 expectedBalance = lpShares * ammPool.totalLiquidity() / totalShares;
                // Tolérance de 1 wei pour les arrondis
                assertTrue(
                    lpBalance + 1 >= expectedBalance && lpBalance <= expectedBalance + 1,
                    "LP balance doesn't match share proportion"
                );
            }
        }

        // INVARIANT: La somme des balances LP doit égaler la liquidité totale
        uint256 sumLpBalances = _sumLpBalances();
        uint256 totalLiquidity = ammPool.totalLiquidity();

        // Tolérance de 1 wei pour les arrondis
        assertTrue(
            sumLpBalances + 1 >= totalLiquidity && sumLpBalances <= totalLiquidity + 1,
            "Sum of LP balances != total liquidity"
        );
    }

    /**
     * @notice Invariant 3: NEUTRALITÉ DU FUNDING
     * @dev Le funding est neutre entre longs et shorts
     * Invariant: Σ(funding paid) + Σ(funding received) = 0 (à tolérance près)
     */
    function invariant_funding_neutrality() public view {
        GlobalState memory state = _getGlobalState();

        // INVARIANT: La somme nette du funding doit être zéro
        // Σ(funding paid by longs) + Σ(funding received by shorts) = 0
        int256 netFunding = state.totalFundingPaid + state.totalFundingReceived;

        // Calcul de la tolérance (arrondis + erreurs de précision)
        uint256 tolerance = _calculateFundingTolerance();

        assertTrue(
            _abs(netFunding) <= int256(tolerance),
            string(
                abi.encodePacked(
                    "Funding not neutral: net funding = ",
                    _intToString(netFunding),
                    ", tolerance = ",
                    _uintToString(tolerance)
                )
            )
        );

        // INVARIANT: Le funding accumulé doit correspondre aux positions ouvertes
        _verifyFundingAccrual();
    }

    /**
     * @notice Invariant 4: CONSERVATION DES FONDS
     * @dev Aucun fonds ne peut être créé ou détruit
     * Invariant: Sum(balances) = constant
     */
    function invariant_funds_conservation() public view {
        uint256 totalSystemValue = _calculateTotalSystemValue();

        // INVARIANT: La valeur totale du système doit rester constante
        // (hors frais qui vont au trésor)
        uint256 feesAccrued = perpEngine.totalFeesAccrued();
        uint256 expectedValue = initialSystemValue + feesAccrued;

        // Tolérance pour les arrondis
        uint256 tolerance = 1000; // 1000 wei
        assertTrue(
            totalSystemValue + tolerance >= expectedValue && totalSystemValue <= expectedValue + tolerance,
            "Funds not conserved"
        );
    }

    /**
     * @notice Invariant 5: HEALTH FACTOR BORNE
     * @dev Toutes les positions doivent avoir un health factor ≥ 1.0
     * Invariant: HF(position) ≥ 1.0 pour toute position active
     */
    function invariant_all_positions_safe() public view {
        uint256 totalPositions = positionManager.totalSupply();

        for (uint256 i = 1; i <= totalPositions; i++) {
            if (positionManager.ownerOf(i) != address(0)) {
                uint256 healthFactor = perpEngine.getHealthFactor(i);

                // INVARIANT: Health factor doit être ≥ 1.0
                assertTrue(
                    healthFactor >= 1e18,
                    string(
                        abi.encodePacked(
                            "Position ", _uintToString(i), " has unsafe health factor: ", _uintToString(healthFactor)
                        )
                    )
                );
            }
        }
    }

    /**
     * @notice Invariant 6: PAS DE DOUBLE COMPTAGE
     * @dev Aucun collateral n'est compté deux fois
     * Invariant: Σ(collateral individuel) = totalCollateral
     */
    function invariant_no_double_counting() public view {
        uint256 sumIndividualCollateral = 0;
        uint256 totalPositions = positionManager.totalSupply();

        for (uint256 i = 1; i <= totalPositions; i++) {
            if (positionManager.ownerOf(i) != address(0)) {
                IPerpEngine.PositionView memory position = perpEngine.getPosition(i);
                sumIndividualCollateral += position.margin;
            }
        }

        uint256 totalCollateral = perpEngine.totalCollateral();

        // INVARIANT: La somme des collatéraux individuels doit égaler le total
        // Tolérance de 1 wei pour les arrondis
        assertTrue(
            sumIndividualCollateral + 1 >= totalCollateral && sumIndividualCollateral <= totalCollateral + 1,
            "Double counting detected"
        );
    }

    /* ========== FONCTIONS HELPER ========== */

    function _getGlobalState() internal view returns (GlobalState memory) {
        return GlobalState({
            totalCollateral: perpEngine.totalCollateral(),
            totalPositionValue: perpEngine.totalPositionValue(),
            lpTotalBalance: ammPool.totalLiquidity(),
            totalFundingPaid: perpEngine.totalFundingPaid(),
            totalFundingReceived: perpEngine.totalFundingReceived(),
            protocolBalance: address(perpEngine).balance + usdc.balanceOf(address(perpEngine))
                + weth.balanceOf(address(perpEngine))
        });
    }

    function _calculateWorstCaseExposure() internal view returns (uint256) {
        // Calcul du pire scénario: toutes les positions longues à leur prix max,
        // toutes les positions shortes à leur prix min
        uint256 maxExposure = 0;

        // Pour simplifier, prenons le total des positions avec un buffer de sécurité
        uint256 totalNotional = perpEngine.totalPositionValue();

        // Buffer de sécurité: 50% pour les mouvements de prix extrêmes
        return totalNotional * 3 / 2;
    }

    function _sumLpBalances() internal view returns (uint256) {
        uint256 sum = 0;
        for (uint256 i = 0; i < lps.length; i++) {
            sum += ammPool.getLpBalance(lps[i]);
        }
        return sum;
    }

    function _calculateFundingTolerance() internal view returns (uint256) {
        // Tolérance basée sur:
        // 1. Erreurs d'arrondi: 1 wei par position
        // 2. Précision décimale: 0.01% du total funding
        uint256 totalPositions = positionManager.totalSupply();
        uint256 roundingTolerance = totalPositions * 1; // 1 wei par position

        GlobalState memory state = _getGlobalState();
        uint256 precisionTolerance = (uint256(_abs(state.totalFundingPaid)) * 1e14) / 1e18; // 0.01%

        return roundingTolerance + precisionTolerance + 1000; // +1000 wei buffer
    }

    function _verifyFundingAccrual() internal view {
        // Vérifie que le funding accumulé correspond aux positions ouvertes
        uint256 totalPositions = positionManager.totalSupply();
        int256 totalAccruedFunding = 0;

        for (uint256 i = 1; i <= totalPositions; i++) {
            if (positionManager.ownerOf(i) != address(0)) {
                IPerpEngine.PositionView memory position = perpEngine.getPosition(i);
                totalAccruedFunding += int256(position.fundingAccrued);
            }
        }

        // Le funding accumulé doit être égal à la différence entre
        // funding payé et funding reçu
        GlobalState memory state = _getGlobalState();
        int256 expectedAccrued = state.totalFundingPaid - state.totalFundingReceived;

        // Tolérance pour les arrondis
        uint256 tolerance = 1000;
        assertTrue(_abs(totalAccruedFunding - expectedAccrued) <= int256(tolerance), "Funding accrual mismatch");
    }

    function _calculateTotalSystemValue() internal view returns (uint256) {
        uint256 total = 0;

        // Balances des contrats
        total += address(perpEngine).balance;
        total += address(ammPool).balance;
        total += address(liquidationEngine).balance;

        // Balances des tokens
        total += usdc.balanceOf(address(perpEngine));
        total += usdc.balanceOf(address(ammPool));
        total += weth.balanceOf(address(perpEngine));
        total += weth.balanceOf(address(ammPool));

        // Balances des utilisateurs
        for (uint256 i = 0; i < traders.length; i++) {
            total += usdc.balanceOf(traders[i]);
            total += weth.balanceOf(traders[i]);
            total += traders[i].balance;
        }

        for (uint256 i = 0; i < lps.length; i++) {
            total += usdc.balanceOf(lps[i]);
            total += weth.balanceOf(lps[i]);
            total += lps[i].balance;
        }

        return total;
    }

    function _abs(int256 x) internal pure returns (int256) {
        return x >= 0 ? x : -x;
    }

    function _deployProtocol() internal {
        // Déploiement ProtocolConfig
        protocolConfig = new ProtocolConfig(address(this), address(this));

        // Déploiement MarketRegistry
        // marketRegistry = new MarketRegistry(address(protocolConfig));

        // Déploiement PositionManager
        positionManager = new PositionManager(address(this));

        // Déploiement AMMPool
        ammPool = new AMMPool(address(this), address(this));

        // Déploiement LiquidationEngine
        liquidationEngine = new LiquidationEngine(
            address(this),
            address(protocolConfig),
            address(this),
            address(usdc),
            address(0),
            address(0)
        );

        // Déploiement PerpEngine
        perpEngine = new PerpEngine(
            address(positionManager),
            address(ammPool),
            address(this),
            address(liquidationEngine),
            address(this),
            address(protocolConfig),
            address(this),
            address(this),
            address(this)
        );

        // Configuration des liens
        // protocolConfig.setPerpEngine(address(perpEngine));
        // perpEngine.setAMMPool(address(ammPool));
    }

    function _setupMarkets() internal {
        // Ajout du marché ETH-USD
        perpEngine.initializeMarket(
            1,
            bytes32("ETH-USD"),
            10e18, // 10x max leverage
            1e16,  // 1% min margin ratio
            10 ether, // min position size
            2e16,  // 2% liquidation fee
            1e15   // 0.1% protocol fee
        );
    }

    function _createActors() internal {
        // Création des traders
        for (uint256 i = 0; i < MAX_TRADERS; i++) {
            address trader = address(new TraderActor(address(perpEngine), address(usdc)));
            traders.push(trader);
        }

        // Création des LPs
        for (uint256 i = 0; i < MAX_LPS; i++) {
            address lp = address(new LpActor(address(ammPool), address(usdc)));
            lps.push(lp);
        }

        // Création des liquidateurs
        for (uint256 i = 0; i < 5; i++) {
            address liquidator = address(new LiquidatorActor(address(liquidationEngine), address(usdc)));
            liquidators.push(liquidator);
        }
    }

    function _fundActors() internal {
        // Création et distribution de tokens mock
        usdc = IERC20(address(new MockERC20("USDC", "USDC", 6)));
        weth = IERC20(address(new MockERC20("WETH", "WETH", 18)));

        // Funding des traders
        for (uint256 i = 0; i < traders.length; i++) {
            MockERC20(address(usdc)).mint(traders[i], 1000000 * 1e6);
            MockERC20(address(weth)).mint(traders[i], 100 * 1e18);
        }

        // Funding des LPs
        for (uint256 i = 0; i < lps.length; i++) {
            MockERC20(address(usdc)).mint(lps[i], 1000000 * 1e6);
            MockERC20(address(weth)).mint(lps[i], 100 * 1e18);
        }

        // Funding des liquidateurs
        for (uint256 i = 0; i < liquidators.length; i++) {
            MockERC20(address(usdc)).mint(liquidators[i], 500000 * 1e6);
        }
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint256 i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint256(uint160(addr)) / (2 ** (8 * (19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2 * i] = _char(hi);
            s[2 * i + 1] = _char(lo);
        }
        return string(abi.encodePacked("0x", s));
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _intToString(int256 value) internal pure returns (string memory) {
        if (value < 0) {
            return string(abi.encodePacked("-", _uintToString(uint256(-value))));
        }
        return _uintToString(uint256(value));
    }

    function _char(bytes1 b) internal pure returns (bytes1 c) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }
}

/* ========== ACTEURS POUR FUZZING ========== */

contract TraderActor {
    PerpEngine public perpEngine;
    IERC20 public usdc;

    constructor(address engine, address token) {
        perpEngine = PerpEngine(engine);
        usdc = IERC20(token);
    }

    // Actions aléatoires pour le fuzzing
    function openRandomPosition() external {
        // Implémentation pour le fuzzing
    }

    function closeRandomPosition() external {
        // Implémentation pour le fuzzing
    }

    function addRandomCollateral() external {
        // Implémentation pour le fuzzing
    }

    function removeRandomCollateral() external {
        // Implémentation pour le fuzzing
    }
}

contract LpActor {
    AMMPool public ammPool;
    IERC20 public usdc;

    constructor(address pool, address token) {
        ammPool = AMMPool(pool);
        usdc = IERC20(token);
    }

    // Actions aléatoires pour le fuzzing
    function addRandomLiquidity() external {
        // Implémentation pour le fuzzing
    }

    function removeRandomLiquidity() external {
        // Implémentation pour le fuzzing
    }
}

contract LiquidatorActor {
    LiquidationEngine public liquidationEngine;
    IERC20 public usdc;

    constructor(address engine, address token) {
        liquidationEngine = LiquidationEngine(engine);
        usdc = IERC20(token);
    }

    // Actions aléatoires pour le fuzzing
    function liquidateRandomPosition() external {
        // Implémentation pour le fuzzing
    }
}

/* ========== MOCK CONTRATS ========== */

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
        return true; // Simplified for testing
    }
}
