# ADR-000: Modèle de Permissionnement Institutionnel (Institutional Permissioning Framework)

* **Statut :** PROPOSÉ / BLOQUÉ (Locked pending Task 13B implementation)
* **Date :** 2026-08-31
* **Auteurs :** Équipe Core Architecture & Compliance
* **Périmètre :** Invariant de sécurité & contrôle d'accès sur smart contracts core, API et interfaces.

---

## 1. Contexte & Motivation

PerpArbitraDEX cible les opérateurs réglementés et les fonds institutionnels (market-neutral, market makers, hedge funds). Pour répondre aux exigences de conformité et d'auditabilité, le protocole ne peut pas fonctionner comme une interface anonyme ou sans permission.

L'objectif de cet ADR est de formaliser la spécification technique du permissionnement institutionnel **sans inventer ni coder en dur de règles juridiques** dans les smart contracts Solidity. Les politiques de conformité (KYC/AML, juridictions admises, conservation légale) doivent être gérées sous forme de paramètres et d'adaptateurs externes validés par le conseil juridique de l'opérateur.

---

## 2. Décision d'Architecture & Capacités Techniques

Le système de permissionnement repose sur les piliers techniques suivants :

### 2.1 Rôles Institutionnels
Le protocole définit 5 rôles distincts via `AccessControlManager.sol` :
1. `OPERATOR_ROLE` : Gestionnaire de la plateforme (configuration des marchés, gestion des paramètres de risque, pause d'urgence).
2. `TRADER_ROLE` : Acteurs autorisés à ouvrir/fermer/modifier des positions de trading sur les marchés isolés.
3. `LP_ROLE` : Apporteurs de liquidité autorisés à déposer/retirer du collatéral dans les LP Vaults.
4. `LIQUIDATOR_ROLE` : Liquidateurs enregistrés et autorisés à exécuter des liquidations sur la queue de liquidation.
5. `AUDITOR_ROLE` : Compte en lecture seule disposant d'accès privilégiés d'inspection d'état et d'export des journaux d'audit.

### 2.2 Controle par Allowlist (Allowlisted Wallets & Entities)
* Seules les adresses explicitement autorisées dans la matrice de permission (ou vérifiées via un adaptateur KYC/AML d'opérateur) peuvent interagir avec les méthodes restreintes.
* La vérification de l'allowlist est appliquée au niveau smart contract via des modifiers (`onlyAllowlistedTrader`, `onlyAllowlistedLP`, etc.).

### 2.3 Suspension de Compte (Account Freeze / Halt)
* L'opérateur disposera de la capacité technique de suspendre temporairement un compte (`freezeAccount(address account)`).
* Un compte suspendu ne peut plus ouvrir de nouvelle position ni augmenter son levier. Les opérations de fermeture et de réduction de risque restent soumises aux politiques configurées par l'opérateur.

### 2.4 Limites d'Exposition par Compte & par Marché
* Configuration dynamique de plafonds par compte (`maxNotionalPerAccount`) et par marché (`maxNotionalPerMarket`, `maxSkewLimit`).
* Rejet automatique par `RiskManager` en cas de dépassement.

### 2.5 Séparation Stricte des Droits Administration (Segregation of Duties)
* Séparation absolue entre la gestion des clés d'urgence (`EmergencyGuardian`), la modification des oracles (`OracleSecurity`), la configuration des paramètres de risque (`RiskManager`) et la gestion des rôles (`AccessControlManager`).
* Interdiction des comptes EOA administrateur unique en production : transition obligatoire vers un Multisig institutionnel / TimelockController.

### 2.6 Événements d'Audit Complet & Exportation de Données
* Émission systématique d'événements enrichis (`AccountFrozen`, `RoleGranted`, `RoleRevoked`, `RiskLimitUpdated`, `TradeExecutedWithKYC`, etc.).
* Indexation complète des événements pour extraction et export vers les outils de comptabilité/audit institutionnels.

### 2.7 Paramétrage Juridique Externe (Adapters & Parameters)
* **Pas de constantes juridiques dans Solidity :** Aucune règle relative aux pays sous sanction, codes KYC ou durées de rétention légale ne sera codée en dur dans le code Solidity.
* Ces règles sont encapsulées dans un adaptateur configurable (`IKYCVerifierAdapter`), mis à jour et validé par le conseil juridique de l'opérateur.

---

## 3. Matrice des Points d'Entrée à Contrôler (Prompt 13B Audit Target)

Tous les points d'entrée smart contracts suivants devront intégrer les vérifications de rôle et de permission lors de la réalisation de la **Tâche 13B** :

| Smart Contract | Méthode / Entrypoint | Rôle Requis | Contrôle à Implémenter (Tâche 13B) |
| :--- | :--- | :--- | :--- |
| `PerpEngine.sol` | `openPosition` | `TRADER_ROLE` | Allowlist, Account Freeze check, Limit check. |
| `PerpEngine.sol` | `closePosition` | `TRADER_ROLE` | Allowlist, Account Freeze check. |
| `PerpEngine.sol` | `increasePosition` | `TRADER_ROLE` | Allowlist, Account Freeze check, Limit check. |
| `PerpEngine.sol` | `decreasePosition` | `TRADER_ROLE` | Allowlist, Account Freeze check. |
| `PerpEngine.sol` | `addMargin` | `TRADER_ROLE` | Allowlist, Account Freeze check. |
| `PerpEngine.sol` | `removeMargin` | `TRADER_ROLE` | Allowlist, Account Freeze check. |
| `PerpEngine.sol` | `liquidatePosition` | `LIQUIDATOR_ROLE` | Allowlist Liquidator check. |
| `AMMPool.sol` | `deposit` / `mint` | `LP_ROLE` | Allowlist LP check. |
| `AMMPool.sol` | `withdraw` / `burn` | `LP_ROLE` | Allowlist LP check. |
| `LiquidationEngine.sol` | `executeBatchLiquidation` | `LIQUIDATOR_ROLE` | Allowlist Liquidator check. |
| `LiquidationEngine.sol` | `processQueue` | `LIQUIDATOR_ROLE` | Allowlist Liquidator check. |
| `ProtocolConfig.sol` | `setGlobalParameters` | `OPERATOR_ROLE` | Operator Role check. |
| `MarketRegistry.sol` | `addMarket` / `updateMarket` | `OPERATOR_ROLE` | Operator Role check. |
| `RiskManager.sol` | `setAccountRiskParameters` | `OPERATOR_ROLE` | Operator Role check. |
| `EmergencyGuardian.sol` | `pauseProtocol` / `unpauseProtocol`| `OPERATOR_ROLE` | Emergency Guardian Role check. |

---

## 4. Statut de Verrouillage de la Release Institutionnelle

> **AVERTISSEMENT DE SÉCURITÉ ET STATUT DE RELEASE :**
>
> La release institutionnelle (`INSTITUTIONAL_RELEASE`) est **EXPLICITEMENT BLOQUÉE** (`STATUS: LOCKED_PENDING_TASK_13B`).
>
> Aucune version de production ni déploiement institutionnel ne sera autorisé tant que :
> 1. Les modifiers de contrôle d'accès de la matrice ci-dessus n'auront pas été implémentés dans la Tâche 13B.
> 2. La suite complète de tests de permissionnement institutionnel n'aura pas été exécutée et validée à 100%.
