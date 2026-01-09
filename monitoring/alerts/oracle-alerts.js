#!/usr/bin/env node

/**
 * Système d'alertes oracle multi-niveaux pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Surveiller la santé des oracles et alerter sur les anomalies
 * Sources: OracleAggregator, OracleSanityChecker, sources multiples
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger } = require('../utils/logging');
const { AlertManager } = require('../utils/alert-manager');
const { Hysteresis } = require('../utils/hysteresis');

// Configuration
const config = {
  // Seuils d'alerte (en basis points)
  DEVIATION_WARNING_BPS: 100,   // 1% → WARNING
  DEVIATION_CRITICAL_BPS: 200,  // 2% → CRITICAL
  DEVIATION_MAX_BPS: 500,       // 5% → PANIC
  
  // Temps
  STALE_THRESHOLD_SEC: 120,     // 2 minutes
  FALLBACK_ACTIVATION_SEC: 180, // 3 minutes
  CHECK_INTERVAL_MS: 30000,     // 30 secondes
  
  // Hystérésis (éviter le flapping)
  HYSTERESIS_WINDOW_MS: 300000, // 5 minutes
  HYSTERESIS_THRESHOLD: 3,      // 3 échantillons consécutifs
  
  // Sources
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  ORACLE_SOURCES: ['chainlink', 'pyth', 'twap'], // Sources à surveiller
  
  // Alertes
  ENABLE_SLACK: process.env.ENABLE_SLACK === 'true',
  ENABLE_PAGERDUTY: process.env.ENABLE_PAGERDUTY === 'true',
  ENABLE_EMAIL: process.env.ENABLE_EMAIL === 'true',
};

class OracleAlerts {
  constructor() {
    this.logger = new Logger('oracle-alerts');
    this.alertManager = new AlertManager();
    this.hysteresis = new Hysteresis(config.HYSTERESIS_WINDOW_MS, config.HYSTERESIS_THRESHOLD);
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.marketStates = new Map();
    this.sourceStatus = new Map();
    this.activeAlerts = new Map();
    this.fallbackHistory = [];
    
    // Niveaux d'alerte
    this.ALERT_LEVELS = {
      INFO: { level: 0, name: 'INFO', color: '#3498db' },
      WARNING: { level: 1, name: 'WARNING', color: '#f39c12' },
      CRITICAL: { level: 2, name: 'CRITICAL', color: '#e74c3c' },
    };
    
    this.logger.info('OracleAlerts initialisé', { config });
  }
  
  createProvider() {
    const providers = config.RPC_URLS.map(url => 
      new ethers.JsonRpcProvider(url)
    );
    
    return new ethers.FallbackProvider(providers, 1, {
      timeout: 10000,
      quorum: 1,
    });
  }
  
  async start() {
    this.logger.info('Démarrage du système d\'alertes oracle');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // Boucle de surveillance
    while (true) {
      try {
        await this.monitorOracles();
        await this.delay(config.CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error('Erreur dans la boucle de surveillance', { error: error.message });
        await this.delay(60000); // Backoff en cas d'erreur
      }
    }
  }
  
  async monitorOracles() {
    this.logger.debug('Surveillance des oracles en cours');
    
    // Récupérer tous les marchés
    const markets = await this.client.getMarkets();
    
    for (const market of markets) {
      try {
        await this.checkMarketOracle(market.id);
      } catch (error) {
        this.logger.error(`Erreur surveillance oracle marché ${market.id}`, { error: error.message });
      }
    }
    
    // Vérifier l'état des sources
    await this.checkOracleSources();
    
    // Vérifier l'utilisation du fallback
    await this.checkFallbackUsage();
    
    // Nettoyer les alertes résolues
    await this.cleanupResolvedAlerts();
  }
  
  async checkMarketOracle(marketId) {
    const state = await this.getOracleState(marketId);
    
    // Appliquer l'hystérésis
    const hysteresisKey = `market_${marketId}`;
    const shouldAlert = this.hysteresis.check(hysteresisKey, state.issues.length > 0);
    
    if (!shouldAlert && state.issues.length > 0) {
      this.logger.debug('Alerte supprimée par hystérésis', { marketId, issues: state.issues });
      return;
    }
    
    // Vérifier les problèmes et envoyer des alertes
    for (const issue of state.issues) {
      await this.evaluateAndSendAlert(marketId, issue, state);
    }
    
    // Mettre à jour l'état
    this.marketStates.set(marketId, state);
  }
  
  async getOracleState(marketId) {
    const state = {
      marketId,
      timestamp: Date.now(),
      issues: [],
      metrics: {},
    };
    
    try {
      // 1. Vérifier l'âge de l'oracle
      const age = await this.client.getOracleAge(marketId);
      state.metrics.age = age;
      
      if (age > config.STALE_THRESHOLD_SEC) {
        state.issues.push({
          type: 'ORACLE_STALE',
          level: age > config.FALLBACK_ACTIVATION_SEC ? 'CRITICAL' : 'WARNING',
          message: `Oracle stale: ${age}s (seuil: ${config.STALE_THRESHOLD_SEC}s)`,
          data: { age, threshold: config.STALE_THRESHOLD_SEC },
        });
      }
      
      // 2. Vérifier la déviation entre sources
      const deviation = await this.client.getOracleDeviation(marketId);
      state.metrics.deviation = deviation;
      
      if (deviation > 0) {
        if (deviation > config.DEVIATION_MAX_BPS) {
          state.issues.push({
            type: 'ORACLE_DEVIATION',
            level: 'CRITICAL',
            message: `Déviation oracle extrême: ${deviation} bps (max: ${config.DEVIATION_MAX_BPS})`,
            data: { deviation, max: config.DEVIATION_MAX_BPS },
          });
        } else if (deviation > config.DEVIATION_CRITICAL_BPS) {
          state.issues.push({
            type: 'ORACLE_DEVIATION',
            level: 'CRITICAL',
            message: `Déviation oracle critique: ${deviation} bps`,
            data: { deviation, threshold: config.DEVIATION_CRITICAL_BPS },
          });
        } else if (deviation > config.DEVIATION_WARNING_BPS) {
          state.issues.push({
            type: 'ORACLE_DEVIATION',
            level: 'WARNING',
            message: `Déviation oracle élevée: ${deviation} bps`,
            data: { deviation, threshold: config.DEVIATION_WARNING_BPS },
          });
        }
      }
      
      // 3. Vérifier les prix individuels des sources
      const sourcePrices = await this.client.getOracleSourcePrices(marketId);
      state.metrics.sourcePrices = sourcePrices;
      
      // Vérifier les sources indisponibles
      const unavailableSources = Object.entries(sourcePrices)
        .filter(([_, price]) => price === 0 || price === null)
        .map(([source]) => source);
      
      if (unavailableSources.length > 0) {
        state.issues.push({
          type: 'ORACLE_SOURCE_UNAVAILABLE',
          level: unavailableSources.includes('chainlink') ? 'WARNING' : 'INFO',
          message: `Source(s) oracle indisponible(s): ${unavailableSources.join(', ')}`,
          data: { unavailableSources, sourcePrices },
        });
      }
      
      // 4. Vérifier les bornes de prix via OracleSanityChecker
      const sanityCheck = await this.client.checkOracleSanity(marketId);
      state.metrics.sanityCheck = sanityCheck;
      
      if (!sanityCheck.valid) {
        state.issues.push({
          type: 'ORACLE_SANITY_CHECK_FAILED',
          level: 'CRITICAL',
          message: `Sanity check échoué: ${sanityCheck.reason}`,
          data: sanityCheck,
        });
      }
      
      // 5. Vérifier l'utilisation du fallback
      const isUsingFallback = await this.client.isOracleUsingFallback(marketId);
      state.metrics.usingFallback = isUsingFallback;
      
      if (isUsingFallback) {
        state.issues.push({
          type: 'ORACLE_FALLBACK_ACTIVE',
          level: 'INFO',
          message: 'Oracle en mode fallback',
          data: { fallbackSource: await this.client.getActiveFallbackSource(marketId) },
        });
      }
      
    } catch (error) {
      this.logger.error(`Erreur récupération état oracle ${marketId}`, { error: error.message });
      state.issues.push({
        type: 'ORACLE_STATE_FETCH_FAILED',
        level: 'CRITICAL',
        message: `Impossible de récupérer l'état de l'oracle: ${error.message}`,
        data: { error: error.message },
      });
    }
    
    return state;
  }
  
  async evaluateAndSendAlert(marketId, issue, state) {
    // Générer une clé unique pour cette alerte
    const alertKey = `${marketId}_${issue.type}`;
    
    // Vérifier si une alerte similaire est déjà active
    const existingAlert = this.activeAlerts.get(alertKey);
    
    if (existingAlert) {
      // Mettre à jour l'alerte existante si nécessaire
      if (this.shouldUpdateAlert(existingAlert, issue)) {
        await this.updateAlert(alertKey, marketId, issue, state);
      }
      return;
    }
    
    // Créer une nouvelle alerte
    await this.createAlert(alertKey, marketId, issue, state);
  }
  
  async createAlert(alertKey, marketId, issue, state) {
    const alert = {
      type: issue.type,
      level: this.ALERT_LEVELS[issue.level] || this.ALERT_LEVELS.INFO,
      market: marketId,
      message: issue.message,
      timestamp: Date.now(),
      data: {
        ...issue.data,
        marketId,
        state: {
          age: state.metrics.age,
          deviation: state.metrics.deviation,
          usingFallback: state.metrics.usingFallback,
        },
      },
      alertKey,
      status: 'ACTIVE',
    };
    
    // Envoyer l'alerte
    await this.alertManager.send(alert);
    
    // Enregistrer comme active
    this.activeAlerts.set(alertKey, {
      ...alert,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      updateCount: 1,
    });
    
    this.logger[issue.level === 'CRITICAL' ? 'error' : 'warn']('Alerte oracle créée', alert);
  }
  
  async updateAlert(alertKey, marketId, issue, state) {
    const existing = this.activeAlerts.get(alertKey);
    
    if (!existing) {
      return;
    }
    
    const updatedAlert = {
      ...existing,
      level: this.ALERT_LEVELS[issue.level] || existing.level,
      message: issue.message,
      lastUpdated: Date.now(),
      updateCount: existing.updateCount + 1,
      data: {
        ...existing.data,
        ...issue.data,
        state: {
          age: state.metrics.age,
          deviation: state.metrics.deviation,
          usingFallback: state.metrics.usingFallback,
        },
      },
    };
    
    // Envoyer la mise à jour (seulement si le niveau a changé ou après un certain temps)
    if (issue.level !== existing.level.name || 
        Date.now() - existing.lastUpdated > 300000) { // 5 minutes
      await this.alertManager.send({
        ...updatedAlert,
        type: `${issue.type}_UPDATE`,
        message: `[UPDATE] ${issue.message} (update #${updatedAlert.updateCount})`,
      });
    }
    
    // Mettre à jour l'état
    this.activeAlerts.set(alertKey, updatedAlert);
  }
  
  shouldUpdateAlert(existingAlert, newIssue) {
    // Mettre à jour si:
    // 1. Le niveau d'alerte a changé
    // 2. L'alerte est ancienne (plus de 5 minutes)
    // 3. Les données ont significativement changé
    
    const levelChanged = existingAlert.level.name !== newIssue.level;
    const isOld = Date.now() - existingAlert.lastUpdated > 300000;
    
    return levelChanged || isOld;
  }
  
  async checkOracleSources() {
    for (const source of config.ORACLE_SOURCES) {
      try {
        const status = await this.client.getOracleSourceStatus(source);
        this.sourceStatus.set(source, status);
        
        if (!status.available) {
          await this.handleSourceUnavailable(source, status);
        }
      } catch (error) {
        this.logger.error(`Erreur vérification source ${source}`, { error: error.message });
        await this.handleSourceError(source, error);
      }
    }
  }
  
  async handleSourceUnavailable(source, status) {
    const alertKey = `source_${source}_unavailable`;
    
    if (!this.activeAlerts.has(alertKey)) {
      await this.alertManager.send({
        type: 'ORACLE_SOURCE_UNAVAILABLE',
        level: source === 'chainlink' ? this.ALERT_LEVELS.WARNING : this.ALERT_LEVELS.INFO,
        message: `Source oracle ${source} indisponible`,
        timestamp: Date.now(),
        data: { source, status },
      });
      
      this.activeAlerts.set(alertKey, {
        type: 'ORACLE_SOURCE_UNAVAILABLE',
        source,
        createdAt: Date.now(),
        status: 'ACTIVE',
      });
    }
  }
  
  async handleSourceError(source, error) {
    const alertKey = `source_${source}_error`;
    
    if (!this.activeAlerts.has(alertKey)) {
      await this.alertManager.send({
        type: 'ORACLE_SOURCE_ERROR',
        level: this.ALERT_LEVELS.WARNING,
        message: `Erreur source oracle ${source}: ${error.message}`,
        timestamp: Date.now(),
        data: { source, error: error.message },
      });
      
      this.activeAlerts.set(alertKey, {
        type: 'ORACLE_SOURCE_ERROR',
        source,
        createdAt: Date.now(),
        status: 'ACTIVE',
      });
    }
  }
  
  async checkFallbackUsage() {
    const markets = await this.client.getMarkets();
    let fallbackCount = 0;
    
    for (const market of markets) {
      try {
        const usingFallback = await this.client.isOracleUsingFallback(market.id);
        if (usingFallback) {
          fallbackCount++;
        }
      } catch (error) {
        // Ignorer les erreurs individuelles
      }
    }
    
    // Enregistrer dans l'historique
    this.fallbackHistory.push({
      timestamp: Date.now(),
      count: fallbackCount,
      totalMarkets: markets.length,
    });
    
    // Garder seulement les 100 derniers échantillons
    if (this.fallbackHistory.length > 100) {
      this.fallbackHistory = this.fallbackHistory.slice(-100);
    }
    
    // Alerte si trop de marchés utilisent le fallback
    if (fallbackCount > 0 && fallbackCount >= markets.length * 0.5) { // 50% des marchés
      const alertKey = 'widespread_fallback_usage';
      
      if (!this.activeAlerts.has(alertKey)) {
        await this.alertManager.send({
          type: 'WIDESPREAD_FALLBACK_USAGE',
          level: this.ALERT_LEVELS.CRITICAL,
          message: `Utilisation généralisée du fallback: ${fallbackCount}/${markets.length} marchés`,
          timestamp: Date.now(),
          data: {
            fallbackCount,
            totalMarkets: markets.length,
            percentage: (fallbackCount / markets.length * 100).toFixed(1),
          },
        });
        
        this.activeAlerts.set(alertKey, {
          type: 'WIDESPREAD_FALLBACK_USAGE',
          createdAt: Date.now(),
          status: 'ACTIVE',
        });
      }
    }
  }
  
  async cleanupResolvedAlerts() {
    const now = Date.now();
    const resolvedAlerts = [];
    
    for (const [alertKey, alert] of this.activeAlerts.entries()) {
      // Marquer comme résolu si:
      // 1. C'est une alerte de source et la source est revenue
      // 2. L'alerte est trop ancienne (24h) et n'a pas été mise à jour
      
      const isOld = now - alert.lastUpdated > 86400000; // 24 heures
      const isSourceAlert = alertKey.startsWith('source_');
      
      if (isOld) {
        resolvedAlerts.push(alertKey);
        
        // Envoyer une alerte de résolution
        await this.alertManager.send({
          type: `${alert.type}_RESOLVED`,
          level: this.ALERT_LEVELS.INFO,
          message: `Alerte ${alert.type} résolue (inactive depuis 24h)`,
          timestamp: now,
          data: {
            originalAlert: alert,
            resolutionReason: 'inactive_24h',
          },
        });
      } else if (isSourceAlert) {
        // Vérifier si la source est revenue
        const source = alert.source;
        const status = this.sourceStatus.get(source);
        
        if (status && status.available) {
          resolvedAlerts.push(alertKey);
          
          await this.alertManager.send({
            type: 'ORACLE_SOURCE_RECOVERED',
            level: this.ALERT_LEVELS.INFO,
            message: `Source oracle ${source} récupérée`,
            timestamp: now,
            data: { source, status },
          });
        }
      }
    }
    
    // Supprimer les alertes résolues
    resolvedAlerts.forEach(key => this.activeAlerts.delete(key));
    
    if (resolvedAlerts.length > 0) {
      this.logger.info(`Alertes résolues: ${resolvedAlerts.length}`, { resolvedAlerts });
    }
  }
  
  async performHealthChecks() {
    this.logger.info('Exécution des health checks oracle');
    
    try {
      // Vérifier la connexion aux contrats oracle
      const oracleAddress = await this.client.getOracleAggregatorAddress();
      if (!ethers.isAddress(oracleAddress)) {
        throw new Error('Adresse oracle invalide');
      }
      
      // Vérifier qu'au moins un marché est accessible
      const markets = await this.client.getMarkets();
      if (markets.length === 0) {
        throw new Error('Aucun marché accessible');
      }
      
      // Tester un marché
      const testMarket = markets[0];
      const state = await this.getOracleState(testMarket.id);
      
      if (state.issues.some(i => i.level === 'CRITICAL')) {
        throw new Error(`Oracle critique sur le marché ${testMarket.id}`);
      }
      
      this.logger.info('Health checks oracle réussis');
      
    } catch (error) {
      this.logger.error('Health checks oracle échoués', { error: error.message });
      
      // Envoyer une alerte critique
      await this.alertManager.send({
        type: 'ORACLE_HEALTH_CHECK_FAILED',
        level: this.ALERT_LEVELS.CRITICAL,
        message: `Health checks oracle échoués: ${error.message}`,
        timestamp: Date.now(),
        data: { error: error.message },
      });
      
      process.exit(1);
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getStatus() {
    return {
      timestamp: Date.now(),
      activeAlerts: Array.from(this.activeAlerts.values()),
      marketCount: this.marketStates.size,
      sourceStatus: Object.fromEntries(this.sourceStatus),
      fallbackUsage: this.fallbackHistory[this.fallbackHistory.length - 1],
    };
  }
}

// Point d'entrée
async function main() {
  const alerts = new OracleAlerts();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    alerts.logger.info('Arrêt propre du système d\'alertes oracle');
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    alerts.logger.info('Arrêt par signal TERM');
    process.exit(0);
  });
  
  // Gestion des erreurs
  process.on('uncaughtException', (error) => {
    alerts.logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
  });
  
  try {
    await alerts.start();
  } catch (error) {
    alerts.logger.error('Système d\'alertes oracle crashé', { error: error.message });
    process.exit(1);
  }
}

// Exécution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    // Mode dry-run
    const alerts = new OracleAlerts();
    
    // Simuler une vérification
    alerts.monitorOracles().then(() => {
      console.log('Dry-run terminé');
      console.log('État:', JSON.stringify(alerts.getStatus(), null, 2));
      process.exit(0);
    });
    
  } else if (args.includes('--status')) {
    // Afficher le statut
    const alerts = new OracleAlerts();
    console.log(JSON.stringify(alerts.getStatus(), null, 2));
    process.exit(0);
    
  } else {
    main();
  }
}

module.exports = OracleAlerts;