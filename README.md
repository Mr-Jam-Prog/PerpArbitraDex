# PerpArbitraDEX - Infrastructure Institutionnelle de Dérivés Perpétuels

> **Statut Factuel du Dépôt (Mise à jour : 31 août 2026)**
> * **Stade de Développement :** Prototype / Pre-MVP Testnet.
> * **Audit de Sécurité :** NON AUDITÉ (Aucun audit externe réalisé).
> * **Réseaux Cibles :** Testnet uniquement (Arbitrum Sepolia).
> * **Gestion des Fonds :** AUCUN FONDS RÉEL (Uniquement des tokens testnet / mock quote assets).
> * **Condition de Release Institutionnelle :** Bloquée en attente de l'implémentation et de la validation des permissions (Tâche 13B).

---

## 1. Description du Projet

**PerpArbitraDEX** est une infrastructure déterministe de trading de dérivés perpétuels sur Layer-2 EVM (Arbitrum Sepolia), développée spécifiquement pour des **opérateurs institutionnels réglementés, market makers et fonds crypto market-neutral**.

Le protocole propose une architecture à **collaboration isolée avec collatéral quote unique**, un moteur de liquidation anti-MEV avec queue ordonnée et grace period, ainsi qu'une agrégation d'oracles sécurisée avec vérification d'uptime du Sequencer L2.

---

## 2. Piles Technologiques & Outils

* **Smart Contracts :** Solidity `^0.8.19` (Framework Hardhat & Foundry/Forge).
* **SDK & Math :** Packages TypeScript `@perpdex/sdk` (v1.1.0) et `@perpdex/math` (v1.0.0).
* **Package Manager :** `pnpm` (Workspace mono-repo).

---

## 3. Guide de Démarrage & Exécution des Tests

### Prérequis
* Node.js `^20.0.0` ou v22.x
* `pnpm` `>=9.15.5`
* `foundry` / `forge` (optionnel mais requis pour les tests de fuzzing)

### Installation
```bash
pnpm install --frozen-lockfile
```

### Compilation des Smart Contracts
```bash
# Compilation Hardhat
pnpm run compile:hardhat

# Compilation Forge (si foundry installé)
pnpm run compile:forge
```

### Exécution de la Suite de Validation Core
Pour exécuter la vérification globale du protocole (unit tests, forge tests, et build des packages SDK/Math) :
```bash
pnpm check:core
```

---

## 4. Périmètre du MVP & Autorisations de Déploiement

Le périmètre du MVP est strictement encadré par `docs/MVP_SCOPE.md` et `config/mvp_allowlist.json`.

Tout déploiement incluant un module classé `QUARANTINED` (ex: `AaveFlashLoanIntegrator`, `AccountAbstractionAdapter`, `FlashLiquidator`, `TWAPOracle`, `CrossChainMessenger`) ou `TEST_ONLY` échouera automatiquement.

---

## 5. Documentation Obligatoire & ADR

* [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) : Périmètre fonctionnel MVP & Matrice des composants.
* [docs/ADR-000-INSTITUTIONAL-PERMISSIONING.md](docs/ADR-000-INSTITUTIONAL-PERMISSIONING.md) : Modèle de permissionnement et matrice des points d'entrée (Tâche 13B).
* [LIQUIDATION_FLOW.md](LIQUIDATION_FLOW.md) : Processus de liquidation à 2 étapes & résistance MEV.
* [RISK_MODEL.md](RISK_MODEL.md) : Modèle de risque & marges dynamiques.
