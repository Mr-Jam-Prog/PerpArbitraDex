# Cadre de Périmètre du MVP (MVP Scope & Feature Matrix)

## 1. Vision Produit & Positionnement Institutionnel

Le produit cible **PerpArbitraDEX** est une infrastructure de dérivés perpétuels **permissionnée, déterministe et auditable**, conçue exclusivement pour des **opérateurs réglementés, market makers et fonds crypto / market-neutral**.

Il ne s'agit **pas** d'un DEX retail anonyme ou sans permission. Le protocole garantit un contrôle d'accès strict, la traçabilité complète des transactions, la ségrégation des rôles d'administration et la conformité avec les exigences de reporting institutionnel.

### Cible du Déploiement MVP
* **Réseau Cible :** Arbitrum Sepolia (Testnet).
* **Collatéral :** Quote unique (USDC / ERC20 Quote).
* **Architecture de Marché :** Marchés isolés.
* **Moteur d'Exécution :** PerpEngine v1.1 avec gestion explicite du bad debt, marges isolées et contrôle de skew.

---

## 2. Matrice des Fonctionnalités (Feature Matrix)

Chaque composant ou module du dépôt est classé dans l'un des trois statuts vérifiables suivants :

1. `ENABLED_MVP` : Composant testé, validé et autorisé pour le déploiement MVP sur Arbitrum Sepolia.
2. `TEST_ONLY` : Composant utile aux suites de tests unitaires, fuzzing ou simulations, mais **non déployé** en environnement réseau.
3. `QUARANTINED` : Module incomplet, factice, purement événementiel ou hors périmètre MVP. **Strictement interdit au déploiement production/testnet.**

### Matrice par Module

| Domaine | Composant / Smart Contract | Statut MVP | Description / Portée |
| :--- | :--- | :--- | :--- |
| **Core Protocol** | `PerpEngine.sol` | `ENABLED_MVP` | Moteur de trading (open, close, increase, decrease, margin management). |
| **Core Protocol** | `ProtocolConfig.sol` | `ENABLED_MVP` | Registre central des paramètres du protocole. |
| **Core Protocol** | `RiskManager.sol` | `ENABLED_MVP` | Validation des marges, leviers max et contrôle des risques. |
| **Core Protocol** | `MarketRegistry.sol` | `ENABLED_MVP` | Enregistrement et configuration des marchés isolés. |
| **Core Protocol** | `PositionManager.sol` | `ENABLED_MVP` | Gestion des positions sous forme de tokens NFT ERC-721. |
| **Core Protocol** | `AMMPool.sol` | `ENABLED_MVP` | Pool AMM vAMM/vLiquidity pour exécution et accumulation de funding. |
| **Liquidations** | `LiquidationEngine.sol` | `ENABLED_MVP` | Moteur de liquidation avec vérification stricte du health factor (`0 < HF < 1e18`). |
| **Liquidations** | `LiquidationQueue.sol` | `ENABLED_MVP` | Queue de liquidation ordonnée anti-MEV avec grace period. |
| **Liquidations** | `IncentiveDistributor.sol` | `TEST_ONLY` | Distribution d'incitations aux liquidateurs (nécessite validation finale). |
| **Liquidations** | `FlashLiquidator.sol` | `QUARANTINED` | Flash liquidation factice/non sécurisée. Strictement hors MVP. |
| **Oracles** | `OracleAggregator.sol` | `ENABLED_MVP` | Agrégateur multi-sources avec fallback et vérification Sequencer Uptime. |
| **Oracles** | `ChainlinkOracle.sol` | `ENABLED_MVP` | Adapter Chainlink primaire. |
| **Oracles** | `OracleSanityChecker.sol` | `ENABLED_MVP` | Vérificateur de bornes et déviation maximale. |
| **Oracles** | `OracleSecurity.sol` | `ENABLED_MVP` | Module de sécurité oracle et overrides d'urgence. |
| **Oracles** | `PythOracle.sol` | `TEST_ONLY` | Source oracle secondaire (utilisable en fallback sous condition). |
| **Oracles** | `TWAPOracle.sol` | `QUARANTINED` | Oracle TWAP factice / non connecté aux données réelles. |
| **Oracles** | `RWAOracleAdapter.sol` | `QUARANTINED` | Adaptateur RWA incomplet / simulatifs. |
| **Governance & Access** | `AccessControlManager.sol` | `ENABLED_MVP` | Gestion granulaire des rôles et permissions. |
| **Governance & Access** | `EmergencyGuardian.sol` | `ENABLED_MVP` | Interrupteur d'urgence et pause du protocole. |
| **Governance & Access** | `PausableController.sol` | `ENABLED_MVP` | Contrôleur de mise en pause partielle/totale. |
| **Governance & Access** | `RateLimiter.sol` | `ENABLED_MVP` | Limiteur de débit pour prévenir le spam et les attaques violentes. |
| **Governance & Access** | `CircuitBreaker.sol` | `ENABLED_MVP` | Coupe-circuit sur volatilité extrême. |
| **Governance & Access** | `Governance / Timelock` | `TEST_ONLY` | Contracts On-chain Governance (`Governor.sol`, `TimelockController.sol`). Admin via Multisig/Operator en MVP. |
| **Governance & Access** | `PerpDexToken.sol` / `VotingEscrow` | `TEST_ONLY` | Tokenomics et veTokens non requis pour le MVP institutionnel. |
| **Integrations** | `AaveFlashLoanIntegrator.sol` | `QUARANTINED` | Intégration Aave externe non validée pour MVP. |
| **Integrations** | `LidoStETHIntegrator.sol` | `QUARANTINED` | Intégration Liquid Staking Lido hors collatéral quote. |
| **Integrations** | `CrossChainMessenger.sol` | `QUARANTINED` | Pont cross-chain (LayerZero) hors périmètre Arbitrum Sepolia single-chain. |
| **Integrations** | `AccountAbstractionAdapter.sol`| `QUARANTINED` | Adaptateur ERC-4337 incomplet/simulatif. |
| **Tokens & Wrappers** | `CollateralWrapper.sol` | `ENABLED_MVP` | Wrapper et gestion du collatéral quote. |
| **Tokens & Wrappers** | `PerpDexLPToken.sol` | `ENABLED_MVP` | Token de part de LP Vault. |
| **Tokens & Wrappers** | `SyntheticAsset.sol` | `QUARANTINED` | Collateral synthétique complexe hors MVP quote unique. |
| **SDK & Tooling** | `@perpdex/sdk` | `ENABLED_MVP` | Client TS/JS pour intégration institutionnelle et bots. |
| **SDK & Tooling** | `@perpdex/math` | `ENABLED_MVP` | Bibliothèque de calculs financiers et de risque. |
| **Bots & Operations**| `bots/` | `TEST_ONLY` | Bots de liquidation / arbitrage avec stratégies abstraites/factices. |
| **Mocks** | `contracts/test/Mock*.sol` | `TEST_ONLY` | Mocks d'oracles, tokens et pools pour la suite de tests. |

---

## 3. Quarantaine Explicite & Interdictions de Déploiement

Afin d'empêcher tout déploiement accidentel d'un composant incomplet ou dangereux, les modules suivants sont **explicitement isolés et bloqués** dans la configuration de déploiement :

1. **Intégrations Externes (`contracts/integration/`) :**
   * `AccountAbstractionAdapter.sol`
   * `AaveFlashLoanIntegrator.sol`
   * `LidoStETHIntegrator.sol`
   * `CrossChainMessenger.sol`
2. **Mécanismes Factices de Liquidation :**
   * `FlashLiquidator.sol` (simulation de flash loan / flash liquidation sans validation économique).
3. **Oracles Factices ou Incomplets :**
   * `TWAPOracle.sol` (TWAP factice sans source cumulative solide).
   * `RWAOracleAdapter.sol` (adaptateur sans vérification d'authenticité off-chain).
4. **Composants Événementiels / Simulés :**
   * Tout contrat ou script dont l'unique comportement est d'émettre un événement sans exécuter de véritable transfert ou modification d'état financier.

---

## 4. Feuille de Route & Tracker des Issues (Roadmap Post-MVP)

Chaque composant `QUARANTINED` fait l'objet d'un ticket de suivi requis avant toute réévaluation :

* **[ISSUE-INT-01] Intégration ERC-4337 (Account Abstraction) :**
  * *Condition de sortie de quarantaine :* Implémentation du Bundler et validation Paymaster en environnement de test avec signature EIP-712.
* **[ISSUE-INT-02] Cross-Chain Messaging (LayerZero) :**
  * *Condition de sortie de quarantaine :* Test d'endurance d'état partagé multi-chain et audit de sécurité des messages inter-chaines.
* **[ISSUE-LIQ-01] Flash Liquidations Aave/Uniswap :**
  * *Condition de sortie de quarantaine :* Intégration d'un callback reentrancy-safe vérifié et liquidation atomique sans risque pour la trésorerie.
* **[ISSUE-ORC-01] TWAP / RWA Oracle Engine :**
  * *Condition de sortie de quarantaine :* Agrégation cumulative d'observations TWAP décentralisées et connecteur proof-of-reserve pour RWA.
