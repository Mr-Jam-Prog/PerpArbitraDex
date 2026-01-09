#!/usr/bin/env node

/**
 * Bot de liquidation MEV-aware pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Scanner et liquider les positions à risque
 * Critères: Anti front-running, flash loan fallback, circuit breaker
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger, Metrics } = require('./utils/logging');
const { CircuitBreaker } = require('./utils/circuit-breaker');
const { GasOptimizer } = require('./utils/gas-optimizer');
const { LiquidationQueue } = require('./strategies/queue');
const strategies = require('./strategies');

// Configuration
const config = {
  // Environnement
  DRY_RUN: process.env.DRY_RUN === 'true' || false,
  NETWORK: process.env.NETWORK || 'arbitrum',
  
  // Seuils
  MIN_LIQ_PROFIT_USD: parseFloat(process.env.MIN_LIQ_PROFIT_USD) || 20,
  MAX_GAS_GWEI: parseFloat(process.env.MAX_GAS_GWEI) || 100,
  HEALTH_FACTOR_THRESHOLD: 1.0,
  
  // Stratégies
  FLASH_LOAN_ENABLED: process.env.FLASH_LOAN_ENABLED === 'true' || true,
  DIRECT_LIQUIDATION_ENABLED: true,
  PARTIAL_LIQUIDATION_ENABLED: true,
  
  // Anti-MEV
  RANDOM_DELAY_MIN_MS: 100,
  RANDOM_DELAY_MAX_MS: 2000,
  MAX_RETRIES: 3,
  
  // Scanning
  SCAN_INTERVAL_MS: 10000, // 10 secondes
  BATCH_SIZE: 50,
  
  // RPC
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  
  // Sécurité
  ORACLE_STALE_THRESHOLD_SEC: 120,
  MAX_POSITIONS_PER_ITERATION: 5,
};

class LiquidationBot {
  constructor() {
    this.logger = new Logger('liquidation-bot');
    this.metrics = new Metrics();
    this.circuitBreaker = new CircuitBreaker();
    this.gasOptimizer = new GasOptimizer();
    this.queue = new LiquidationQueue();
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.activeLiquidations = new Map();
    this.profitTotal = 0;
    this.liquidationCount = 0;
    this.lastScanTime = 0;
    
    this.logger.info('LiquidationBot initialisé', { config });
  }
  
  createProvider() {
    const providers = config.RPC_URLS.map(url => 
      new ethers.JsonRpcProvider(url)
    );
    
    return new ethers.FallbackProvider(providers, 1, {
      timeout: 15000, // Timeout plus long pour liquidations
      quorum: 1,
    });
  }
  
  async start() {
    this.logger.info('Démarrage du bot de liquidation');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // Boucle principale
    while (true) {
      try {
        await this.iteration();
        await this.delay(config.SCAN_INTERVAL_MS);
      } catch (error) {
        this.logger.error('Erreur dans l\'itération', { error: error.message });
        await this.delay(30000); // Backoff plus long en cas d'erreur
      }
    }
  }
  
  async iteration() {
    // Vérifier le circuit breaker
    if (await this.circuitBreaker.isOpen()) {
      this.logger.warn('Circuit breaker ouvert');
      return;
    }
    
    // Scanner les positions
    const positions = await this.scanLiquidatablePositions();
    
    // Ajouter à la queue
    this.queue.addBatch(positions);
    
    // Traiter la queue
    await this.processQueue();
    
    // Nettoyer les liquidations terminées
    this.cleanupActiveLiquidations();
    
    // Mettre à jour les métriques
    this.updateMetrics();
  }
  
  async scanLiquidatablePositions() {
    const now = Date.now();
    
    // Rate limiting du scanning
    if (now - this.lastScanTime < config.SCAN_INTERVAL_MS) {
      return [];
    }
    
    this.logger.debug('Scanning des positions liquidables');
    
    try {
      // Méthode 1: Via subgraph (rapide)
      let positions = await this.scanViaSubgraph();
      
      // Fallback: Via RPC si subgraph échoue
      if (positions.length === 0) {
        positions = await this.scanViaRpc();
      }
      
      // Filtrer les positions
      const filtered = await this.filterPositions(positions);
      
      this.lastScanTime = now;
      this.logger.debug(`Trouvé ${filtered.length} positions liquidables`);
      
      return filtered;
      
    } catch (error) {
      this.logger.error('Erreur lors du scanning', { error: error.message });
      return [];
    }
  }
  
  async scanViaSubgraph() {
    try {
      // Requête GraphQL pour les positions avec health factor < 1
      const query = `
        query LiquidatablePositions {
          positions(where: { healthFactor_lt: "${config.HEALTH_FACTOR_THRESHOLD}" }) {
            id
            user
            market
            size
            collateral
            healthFactor
            lastUpdated
          }
        }
      `;
      
      const response = await this.client.querySubgraph(query);
      return response.data.positions || [];
      
    } catch (error) {
      this.logger.warn('Subgraph scanning failed', { error: error.message });
      return [];
    }
  }
  
  async scanViaRpc() {
    // Scanning via events RPC (plus lent mais fiable)
    const positions = [];
    
    // Implémentation basique - à compléter avec la logique réelle
    // Pour l'exemple, retourne un tableau vide
    return positions;
  }
  
  async filterPositions(positions) {
    const filtered = [];
    
    for (const position of positions.slice(0, config.BATCH_SIZE)) {
      try {
        // Vérifier la validité de l'oracle
        const oracleValid = await this.validateOracle(position.market);
        if (!oracleValid) {
          continue;
        }
        
        // Vérifier que la position est toujours liquidable
        const currentHF = await this.client.getHealthFactor(position.id);
        if (currentHF >= config.HEALTH_FACTOR_THRESHOLD) {
          continue;
        }
        
        // Vérifier l'âge de la position
        const positionAge = Date.now() - position.lastUpdated * 1000;
        if (positionAge > 3600000) { // 1 heure
          continue; // Position trop ancienne
        }
        
        // Évaluer les stratégies
        const eligibleStrategies = await this.evaluateStrategies(position);
        if (eligibleStrategies.length === 0) {
          continue;
        }
        
        filtered.push({
          ...position,
          eligibleStrategies,
          timestamp: Date.now(),
        });
        
      } catch (error) {
        this.logger.debug('Erreur lors du filtrage', { positionId: position.id, error: error.message });
      }
    }
    
    return filtered;
  }
  
  async processQueue() {
    let processed = 0;
    
    while (processed < config.MAX_POSITIONS_PER_ITERATION) {
      const position = this.queue.getNext();
      if (!position) break;
      
      try {
        await this.executeLiquidation(position);
        processed++;
        
        // Délai aléatoire entre les liquidations (anti-MEV)
        await this.randomDelay();
        
      } catch (error) {
        this.logger.error('Erreur lors de la liquidation', {
          positionId: position.id,
          error: error.message,
        });
        
        // Réessayer plus tard
        position.retries = (position.retries || 0) + 1;
        if (position.retries < config.MAX_RETRIES) {
          this.queue.retry(position);
        }
      }
    }
  }
  
  async executeLiquidation(position) {
    this.logger.info('Exécution de liquidation', {
      positionId: position.id,
      healthFactor: position.healthFactor,
      strategies: position.eligibleStrategies.length,
    });
    
    // Choisir la meilleure stratégie
    const strategy = await this.selectOptimalStrategy(position);
    
    // Dry-run mode
    if (config.DRY_RUN) {
      this.logger.info('DRY-RUN: Liquidation non exécutée', {
        positionId: position.id,
        strategy: strategy.name,
        estimatedProfit: strategy.estimatedProfit,
      });
      return;
    }
    
    // Vérifier le prix du gas
    const gasPrice = await this.provider.getFeeData();
    if (gasPrice.gasPrice > ethers.parseUnits(config.MAX_GAS_GWEI.toString(), 'gwei')) {
      this.logger.warn('Gas price trop élevé', { gasPrice: gasPrice.gasPrice.toString() });
      return;
    }
    
    // Exécuter la liquidation
    try {
      const tx = await strategy.execute(position, {
        gasPrice: gasPrice.gasPrice,
      });
      
      // Attendre la confirmation
      const receipt = await tx.wait();
      
      // Calculer le profit réel
      const profit = await this.calculateActualProfit(position, receipt);
      
      this.logger.info('Liquidation réussie', {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        profit: profit,
        strategy: strategy.name,
      });
      
      // Mettre à jour les métriques
      this.metrics.recordLiquidation({
        positionId: position.id,
        profit,
        strategy: strategy.name,
        gasUsed: receipt.gasUsed.toString(),
        timestamp: Date.now(),
      });
      
      this.liquidationCount++;
      this.profitTotal += profit;
      
      // Marquer comme active pour monitoring
      this.activeLiquidations.set(position.id, {
        position,
        txHash: receipt.hash,
        startTime: Date.now(),
        strategy: strategy.name,
      });
      
    } catch (error) {
      this.logger.error('Échec de la liquidation', {
        positionId: position.id,
        error: error.message,
      });
      
      // Déclencher le circuit breaker en cas d'erreur critique
      if (error.message.includes('insufficient') || error.message.includes('revert')) {
        this.circuitBreaker.trigger();
      }
      
      throw error;
    }
  }
  
  async evaluateStrategies(position) {
    const eligible = [];
    
    // Évaluer chaque stratégie disponible
    for (const strategy of Object.values(strategies)) {
      try {
        const isEligible = await strategy.isEligible(position);
        if (isEligible) {
          const estimatedProfit = await strategy.estimateProfit(position);
          
          if (estimatedProfit >= config.MIN_LIQ_PROFIT_USD) {
            eligible.push({
              name: strategy.name,
              estimatedProfit,
              execute: strategy.execute.bind(strategy),
            });
          }
        }
      } catch (error) {
        this.logger.debug('Erreur d\'évaluation de stratégie', {
          strategy: strategy.name,
          error: error.message,
        });
      }
    }
    
    // Trier par profit estimé (décroissant)
    return eligible.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
  }
  
  async selectOptimalStrategy(position) {
    if (position.eligibleStrategies.length === 0) {
      throw new Error('Aucune stratégie disponible');
    }
    
    // Prioriser les stratégies avec flash loan si activé
    if (config.FLASH_LOAN_ENABLED) {
      const flashLoanStrategy = position.eligibleStrategies.find(
        s => s.name === 'flashLoanLiquidation'
      );
      
      if (flashLoanStrategy && flashLoanStrategy.estimatedProfit > config.MIN_LIQ_PROFIT_USD * 2) {
        return flashLoanStrategy;
      }
    }
    
    // Sinon, prendre la plus profitable
    return position.eligibleStrategies[0];
  }
  
  async calculateActualProfit(position, receipt) {
    // Calcul basique du profit
    // À compléter avec la logique réelle de calcul des frais de liquidation
    const liquidationFee = await this.client.getLiquidationFee(position.id);
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    
    const profit = Number(ethers.formatEther(liquidationFee - gasCost));
    return profit;
  }
  
  async validateOracle(marketId) {
    try {
      // Vérifier l'âge de l'oracle
      const oracleAge = await this.client.getOracleAge(marketId);
      if (oracleAge > config.ORACLE_STALE_THRESHOLD_SEC) {
        return false;
      }
      
      // Vérifier la déviation entre sources
      const deviation = await this.client.getOracleDeviation(marketId);
      if (deviation > 500) { // 5% de déviation max
        return false;
      }
      
      return true;
      
    } catch (error) {
      this.logger.warn('Validation oracle échouée', { marketId, error: error.message });
      return false;
    }
  }
  
  cleanupActiveLiquidations() {
    const now = Date.now();
    const timeout = 600000; // 10 minutes
    
    for (const [positionId, liquidation] of this.activeLiquidations.entries()) {
      if (now - liquidation.startTime > timeout) {
        this.activeLiquidations.delete(positionId);
        this.logger.warn('Liquidation expirée', { positionId });
      }
    }
  }
  
  updateMetrics() {
    this.metrics.update({
      activeLiquidations: this.activeLiquidations.size,
      totalLiquidations: this.liquidationCount,
      totalProfit: this.profitTotal,
      queueSize: this.queue.size(),
      circuitBreakerOpen: this.circuitBreaker.isOpen(),
    });
  }
  
  async performHealthChecks() {
    const checks = [
      this.checkRpcConnection(),
      this.checkLiquidationEngine(),
      this.checkOracleHealth(),
    ];
    
    const results = await Promise.allSettled(checks);
    
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      throw new Error(`Health checks failed: ${failures.length} failures`);
    }
    
    this.logger.info('Health checks passed');
  }
  
  async checkRpcConnection() {
    const block = await this.provider.getBlockNumber();
    if (!block || block === 0) {
      throw new Error('RPC connection failed');
    }
  }
  
  async checkLiquidationEngine() {
    const address = await this.client.getLiquidationEngineAddress();
    if (!ethers.isAddress(address)) {
      throw new Error('Invalid liquidation engine address');
    }
    
    // Vérifier que le contrat est accessible
    const code = await this.provider.getCode(address);
    if (code === '0x') {
      throw new Error('Liquidation engine not deployed');
    }
  }
  
  async checkOracleHealth() {
    const markets = await this.client.getMarkets();
    for (const market of markets.slice(0, 2)) {
      const valid = await this.validateOracle(market.id);
      if (!valid) {
        throw new Error(`Oracle unhealthy for market ${market.id}`);
      }
    }
  }
  
  async randomDelay() {
    const delay = Math.random() * 
      (config.RANDOM_DELAY_MAX_MS - config.RANDOM_DELAY_MIN_MS) + 
      config.RANDOM_DELAY_MIN_MS;
    
    await this.delay(delay);
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Point d'entrée
async function main() {
  const bot = new LiquidationBot();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    bot.logger.info('Arrêt propre du bot');
    await bot.metrics.flush();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    bot.logger.info('Arrêt par signal TERM');
    await bot.metrics.flush();
    process.exit(0);
  });
  
  // Gestion des erreurs
  process.on('uncaughtException', (error) => {
    bot.logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
  });
  
  try {
    await bot.start();
  } catch (error) {
    bot.logger.error('Bot crashed', { error: error.message });
    process.exit(1);
  }
}

// Exécution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    process.env.DRY_RUN = 'true';
  }
  
  if (args.includes('--simulate')) {
    // Mode simulation
    const bot = new LiquidationBot();
    
    // Scanner seulement
    bot.scanLiquidatablePositions().then(positions => {
      console.log(`Positions liquidables trouvées: ${positions.length}`);
      
      positions.forEach(pos => {
        console.log(`- ${pos.id}: HF=${pos.healthFactor}, Profit estimé=${pos.eligibleStrategies[0]?.estimatedProfit || 0}`);
      });
      
      process.exit(0);
    });
    
  } else {
    main();
  }
}

module.exports = LiquidationBot;