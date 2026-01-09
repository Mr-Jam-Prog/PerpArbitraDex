#!/usr/bin/env node

/**
 * Système d'alertes liquidation temps réel pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Détecter et alerter sur les événements de liquidation critiques
 * Sources: Events on-chain, subgraph, WebSocket
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger } = require('../utils/logging');
const { AlertManager } = require('../utils/alert-manager');
const { EventTracker } = require('../utils/event-tracker');

// Configuration
const config = {
  // Alertes
  LIQUIDATION_ALERT_THRESHOLD_USD: parseFloat(process.env.LIQUIDATION_ALERT_THRESHOLD_USD) || 100000,
  CASCADE_THRESHOLD_COUNT: parseInt(process.env.CASCADE_THRESHOLD_COUNT) || 10,
  CASCADE_TIME_WINDOW_MS: 60000, // 1 minute
  LIQUIDATOR_DOMINANCE_THRESHOLD: 0.5, // 50%
  
  // Déduplication
  ALERT_DEDUPLICATION_WINDOW_MS: 300000, // 5 minutes
  ALERT_THROTTLING_MS: 60000, // 1 minute entre alertes similaires
  
  // Sources
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  SUBGRAPH_URL: process.env.SUBGRAPH_URL,
  WEBSOCKET_ENABLED: process.env.WEBSOCKET_ENABLED === 'true' || true,
  
  // Monitoring
  POLL_INTERVAL_MS: 10000, // 10 secondes
  EVENT_BACKFILL_BLOCKS: 100,
  
  // Sécurité
  ORACLE_VALIDATION_REQUIRED: true,
  PAUSE_ON_ORACLE_INVALID: true,
};

class LiquidationAlerts {
  constructor() {
    this.logger = new Logger('liquidation-alerts');
    this.alertManager = new AlertManager();
    this.eventTracker = new EventTracker();
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.lastAlertTime = new Map(); // Pour le throttling
    this.alertHistory = []; // Pour la déduplication
    this.cascadeWindow = [];
    this.liquidatorStats = new Map();
    this.paused = false;
    
    this.logger.info('LiquidationAlerts initialisé', { config });
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
    this.logger.info('Démarrage du système d\'alertes liquidation');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // S'abonner aux événements
    await this.setupEventListeners();
    
    // Boucle de monitoring
    while (true) {
      try {
        if (!this.paused) {
          await this.monitor();
        }
        await this.delay(config.POLL_INTERVAL_MS);
      } catch (error) {
        this.logger.error('Erreur dans la boucle de monitoring', { error: error.message });
        await this.delay(30000); // Backoff en cas d'erreur
      }
    }
  }
  
  async setupEventListeners() {
    // Écoute des événements on-chain
    const liquidationEngine = await this.client.getLiquidationEngineContract();
    
    // Événement: LiquidationExecuted
    liquidationEngine.on('LiquidationExecuted', async (
      positionId,
      liquidator,
      size,
      collateral,
      fee,
      timestamp,
      event
    ) => {
      try {
        await this.handleLiquidationEvent({
          positionId,
          liquidator,
          size,
          collateral,
          fee,
          timestamp,
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
        });
      } catch (error) {
        this.logger.error('Erreur traitement événement liquidation', { error: error.message });
      }
    });
    
    // Fallback: Polling via subgraph
    if (config.SUBGRAPH_URL) {
      this.setupSubgraphPolling();
    }
    
    this.logger.info('Écouteurs d\'événements configurés');
  }
  
  async handleLiquidationEvent(event) {
    this.logger.debug('Événement liquidation reçu', {
      positionId: event.positionId,
      liquidator: event.liquidator,
      size: event.size.toString(),
    });
    
    // Vérifier la validité de l'oracle
    if (config.ORACLE_VALIDATION_REQUIRED) {
      const oracleValid = await this.validateOracleForLiquidation(event);
      if (!oracleValid) {
        this.logger.warn('Oracle invalide pour liquidation, pause des alertes');
        if (config.PAUSE_ON_ORACLE_INVALID) {
          this.paused = true;
          await this.alertManager.send({
            type: 'ORACLE_INVALID_PAUSE',
            severity: 'CRITICAL',
            message: 'Alertes liquidation suspendues - oracle invalide',
            timestamp: Date.now(),
            data: { event },
          });
        }
        return;
      }
    }
    
    // Convertir les valeurs
    const sizeUsd = await this.convertToUSD(event.size, event.positionId);
    const feeUsd = await this.convertToUSD(event.fee, event.positionId);
    
    // Mettre à jour les statistiques
    this.updateLiquidatorStats(event.liquidator, sizeUsd);
    this.updateCascadeWindow(event);
    
    // Vérifier les conditions d'alerte
    await this.checkAlertConditions({
      ...event,
      sizeUsd,
      feeUsd,
    });
    
    // Enregistrer l'événement
    this.eventTracker.record({
      type: 'liquidation',
      ...event,
      sizeUsd,
      feeUsd,
      timestamp: Date.now(),
    });
  }
  
  async checkAlertConditions(event) {
    const alerts = [];
    
    // 1. Alerte: Liquidation de grande taille
    if (event.sizeUsd >= config.LIQUIDATION_ALERT_THRESHOLD_USD) {
      alerts.push({
        type: 'LIQUIDATION_LARGE',
        severity: 'HIGH',
        message: `Liquidation de grande taille détectée: $${event.sizeUsd.toLocaleString()}`,
        data: {
          positionId: event.positionId,
          liquidator: event.liquidator,
          sizeUsd: event.sizeUsd,
          feeUsd: event.feeUsd,
          txHash: event.txHash,
          blockNumber: event.blockNumber,
        },
      });
    }
    
    // 2. Alerte: Rafale de liquidations (cascade)
    if (this.isCascadeDetected()) {
      alerts.push({
        type: 'LIQUIDATION_CASCADE',
        severity: 'CRITICAL',
        message: `Rafale de liquidations détectée: ${this.cascadeWindow.length} en ${config.CASCADE_TIME_WINDOW_MS / 1000}s`,
        data: {
          count: this.cascadeWindow.length,
          windowMs: config.CASCADE_TIME_WINDOW_MS,
          totalSizeUsd: this.cascadeWindow.reduce((sum, e) => sum + e.sizeUsd, 0),
          liquidators: [...new Set(this.cascadeWindow.map(e => e.liquidator))],
        },
      });
    }
    
    // 3. Alerte: Dominance d'un liquidateur
    const dominantLiquidator = this.getDominantLiquidator();
    if (dominantLiquidator && dominantLiquidator.dominance > config.LIQUIDATOR_DOMINANCE_THRESHOLD) {
      alerts.push({
        type: 'LIQUIDATOR_DOMINANCE',
        severity: 'MEDIUM',
        message: `Liquidateur dominant: ${dominantLiquidator.address} (${(dominantLiquidator.dominance * 100).toFixed(1)}%)`,
        data: {
          liquidator: dominantLiquidator.address,
          dominance: dominantLiquidator.dominance,
          totalLiquidatedUsd: dominantLiquidator.totalUsd,
          liquidationCount: dominantLiquidator.count,
        },
      });
    }
    
    // 4. Alerte: Échec de liquidation (via événements séparés ou monitoring)
    // (À implémenter avec des sources supplémentaires)
    
    // Envoyer les alertes
    for (const alert of alerts) {
      await this.sendAlert(alert);
    }
  }
  
  async sendAlert(alert) {
    // Vérifier la déduplication
    const alertHash = this.generateAlertHash(alert);
    if (this.isDuplicateAlert(alertHash)) {
      this.logger.debug('Alerte dupliquée ignorée', { alertHash });
      return;
    }
    
    // Vérifier le throttling
    const lastAlertTime = this.lastAlertTime.get(alert.type);
    const now = Date.now();
    
    if (lastAlertTime && (now - lastAlertTime < config.ALERT_THROTTLING_MS)) {
      this.logger.debug('Alerte throttlée', { type: alert.type, lastAlertTime });
      return;
    }
    
    // Construire l'objet alerte complet
    const fullAlert = {
      ...alert,
      timestamp: Date.now(),
      protocol: 'PerpArbitraDEX',
      alertId: alertHash,
      deduplicationKey: alertHash,
    };
    
    // Envoyer via AlertManager
    await this.alertManager.send(fullAlert);
    
    // Mettre à jour l'état
    this.lastAlertTime.set(alert.type, now);
    this.alertHistory.push({
      alertId: alertHash,
      type: alert.type,
      timestamp: now,
      data: alert.data,
    });
    
    // Nettoyer l'historique ancien
    this.cleanupAlertHistory();
    
    this.logger.info('Alerte envoyée', fullAlert);
  }
  
  async validateOracleForLiquidation(event) {
    try {
      // Récupérer le marché depuis la position
      const marketId = await this.client.getMarketForPosition(event.positionId);
      
      // Vérifier l'oracle
      const oracleAge = await this.client.getOracleAge(marketId);
      if (oracleAge > 120) { // 2 minutes
        return false;
      }
      
      // Vérifier la déviation
      const deviation = await this.client.getOracleDeviation(marketId);
      if (deviation > 200) { // 2%
        return false;
      }
      
      return true;
      
    } catch (error) {
      this.logger.error('Erreur validation oracle', { error: error.message });
      return false;
    }
  }
  
  async convertToUSD(amount, positionId) {
    try {
      // Récupérer le token et le prix
      const token = await this.client.getCollateralToken(positionId);
      const price = await this.client.getOraclePriceForToken(token);
      
      return Number(ethers.formatEther(amount)) * price;
      
    } catch (error) {
      this.logger.error('Erreur conversion USD', { error: error.message });
      return 0;
    }
  }
  
  updateLiquidatorStats(liquidator, sizeUsd) {
    const stats = this.liquidatorStats.get(liquidator) || {
      address: liquidator,
      totalUsd: 0,
      count: 0,
      lastActive: Date.now(),
    };
    
    stats.totalUsd += sizeUsd;
    stats.count++;
    stats.lastActive = Date.now();
    
    this.liquidatorStats.set(liquidator, stats);
    
    // Nettoyer les liquidateurs inactifs
    this.cleanupLiquidatorStats();
  }
  
  updateCascadeWindow(event) {
    const now = Date.now();
    
    // Ajouter l'événement
    this.cascadeWindow.push({
      ...event,
      timestamp: now,
    });
    
    // Supprimer les événements hors de la fenêtre
    const cutoff = now - config.CASCADE_TIME_WINDOW_MS;
    this.cascadeWindow = this.cascadeWindow.filter(e => e.timestamp > cutoff);
  }
  
  isCascadeDetected() {
    return this.cascadeWindow.length >= config.CASCADE_THRESHOLD_COUNT;
  }
  
  getDominantLiquidator() {
    let totalUsd = 0;
    const liquidators = Array.from(this.liquidatorStats.values());
    
    if (liquidators.length === 0) {
      return null;
    }
    
    // Calculer le total USD
    liquidators.forEach(l => totalUsd += l.totalUsd);
    
    if (totalUsd === 0) {
      return null;
    }
    
    // Trouver le liquidateur dominant
    const dominant = liquidators.reduce((max, l) => 
      l.totalUsd > max.totalUsd ? l : max
    );
    
    const dominance = dominant.totalUsd / totalUsd;
    
    return {
      ...dominant,
      dominance,
    };
  }
  
  generateAlertHash(alert) {
    // Générer un hash unique pour l'alerte
    const data = JSON.stringify({
      type: alert.type,
      data: alert.data,
      timestamp: Math.floor(Date.now() / 60000), // Par minute pour le throttling
    });
    
    return ethers.keccak256(ethers.toUtf8Bytes(data)).slice(0, 16);
  }
  
  isDuplicateAlert(alertHash) {
    const cutoff = Date.now() - config.ALERT_DEDUPLICATION_WINDOW_MS;
    
    return this.alertHistory.some(
      alert => alert.alertId === alertHash && alert.timestamp > cutoff
    );
  }
  
  cleanupAlertHistory() {
    const cutoff = Date.now() - config.ALERT_DEDUPLICATION_WINDOW_MS;
    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > cutoff);
  }
  
  cleanupLiquidatorStats() {
    const cutoff = Date.now() - 86400000; // 24 heures
    
    for (const [address, stats] of this.liquidatorStats.entries()) {
      if (stats.lastActive < cutoff) {
        this.liquidatorStats.delete(address);
      }
    }
  }
  
  async monitor() {
    // Monitoring additionnel (polling, vérifications de santé, etc.)
    // Cette méthode peut être étendue pour des vérifications périodiques
    
    // Vérifier l'état des sources de données
    await this.checkDataSources();
    
    // Vérifier les statistiques globales
    await this.checkGlobalStats();
  }
  
  async checkDataSources() {
    const checks = [
      this.checkRpcConnection(),
      this.checkSubgraphStatus(),
      this.checkOracleHealth(),
    ];
    
    const results = await Promise.allSettled(checks);
    
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      await this.alertManager.send({
        type: 'DATA_SOURCE_DEGRADED',
        severity: 'MEDIUM',
        message: `${failures.length} source(s) de données dégradée(s)`,
        timestamp: Date.now(),
        data: { failures: failures.map(f => f.reason?.message || 'Unknown') },
      });
    }
  }
  
  async checkGlobalStats() {
    // Calculer les statistiques globales sur les liquidations
    const now = Date.now();
    const hourAgo = now - 3600000;
    
    const recentEvents = this.eventTracker.getEventsSince('liquidation', hourAgo);
    
    const totalUsd = recentEvents.reduce((sum, e) => sum + e.sizeUsd, 0);
    const liquidatorCount = new Set(recentEvents.map(e => e.liquidator)).size;
    
    // Alerte si activité anormale
    if (recentEvents.length > 100) {
      await this.sendAlert({
        type: 'HIGH_LIQUIDATION_VOLUME',
        severity: 'MEDIUM',
        message: `Volume élevé de liquidations: ${recentEvents.length} en 1h ($${totalUsd.toLocaleString()})`,
        data: {
          count: recentEvents.length,
          totalUsd,
          liquidatorCount,
          periodMs: 3600000,
        },
      });
    }
  }
  
  async checkRpcConnection() {
    const block = await this.provider.getBlockNumber();
    if (!block || block === 0) {
      throw new Error('RPC connection failed');
    }
  }
  
  async checkSubgraphStatus() {
    if (!config.SUBGRAPH_URL) {
      return;
    }
    
    const response = await fetch(config.SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ _meta { block { number } } }',
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Subgraph response: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.data?._meta?.block?.number) {
      throw new Error('Subgraph metadata missing');
    }
  }
  
  async checkOracleHealth() {
    const markets = await this.client.getMarkets();
    
    for (const market of markets.slice(0, 3)) {
      const valid = await this.validateOracleForMarket(market.id);
      if (!valid) {
        throw new Error(`Oracle unhealthy for market ${market.id}`);
      }
    }
  }
  
  async validateOracleForMarket(marketId) {
    const oracleAge = await this.client.getOracleAge(marketId);
    return oracleAge <= 120; // 2 minutes max
  }
  
  async performHealthChecks() {
    this.logger.info('Exécution des health checks');
    
    try {
      await this.checkDataSources();
      this.logger.info('Health checks réussis');
    } catch (error) {
      this.logger.error('Health checks échoués', { error: error.message });
      process.exit(1);
    }
  }
  
  setupSubgraphPolling() {
    // Polling périodique du subgraph pour les événements manqués
    setInterval(async () => {
      try {
        await this.pollSubgraphForEvents();
      } catch (error) {
        this.logger.error('Erreur polling subgraph', { error: error.message });
      }
    }, config.POLL_INTERVAL_MS);
  }
  
  async pollSubgraphForEvents() {
    const query = `
      query LiquidationEvents($lastBlock: BigInt!) {
        liquidationExecutedEvents(
          where: { blockNumber_gt: $lastBlock }
          orderBy: blockNumber
          orderDirection: asc
          first: 100
        ) {
          id
          positionId
          liquidator
          size
          collateral
          fee
          timestamp
          transactionHash
          blockNumber
        }
      }
    `;
    
    const lastBlock = this.eventTracker.getLastProcessedBlock() || 0;
    
    const response = await fetch(config.SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { lastBlock },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Subgraph query failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.data?.liquidationExecutedEvents) {
      for (const event of data.data.liquidationExecutedEvents) {
        await this.handleLiquidationEvent({
          positionId: event.positionId,
          liquidator: event.liquidator,
          size: ethers.parseEther(event.size),
          collateral: ethers.parseEther(event.collateral),
          fee: ethers.parseEther(event.fee),
          timestamp: parseInt(event.timestamp),
          txHash: event.transactionHash,
          blockNumber: parseInt(event.blockNumber),
        });
      }
      
      // Mettre à jour le dernier bloc traité
      if (data.data.liquidationExecutedEvents.length > 0) {
        const lastEvent = data.data.liquidationExecutedEvents[data.data.liquidationExecutedEvents.length - 1];
        this.eventTracker.setLastProcessedBlock(parseInt(lastEvent.blockNumber));
      }
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Point d'entrée
async function main() {
  const alerts = new LiquidationAlerts();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    alerts.logger.info('Arrêt propre du système d\'alertes');
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
    alerts.logger.error('Système d\'alertes crashé', { error: error.message });
    process.exit(1);
  }
}

// Exécution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--simulate')) {
    // Mode simulation
    const alerts = new LiquidationAlerts();
    
    // Simuler quelques événements
    const mockEvents = [
      {
        positionId: '0x123...',
        liquidator: '0xabc...',
        size: ethers.parseEther('100000'),
        collateral: ethers.parseEther('10000'),
        fee: ethers.parseEther('500'),
        timestamp: Date.now(),
        txHash: '0x456...',
        blockNumber: 10000000,
      },
    ];
    
    mockEvents.forEach(async (event) => {
      await alerts.handleLiquidationEvent(event);
    });
    
    console.log('Simulation terminée');
    process.exit(0);
    
  } else {
    main();
  }
}

module.exports = LiquidationAlerts;