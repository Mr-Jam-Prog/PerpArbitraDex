#!/usr/bin/env node

/**
 * Bot d'arbitrage cross-market PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Détecter et exécuter des arbitrages delta-neutral
 * Critères: Zero risk net, dry-run par défaut, MEV-aware
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger, Metrics } = require('./utils/logging');
const { CircuitBreaker } = require('./utils/circuit-breaker');
const { GasOptimizer } = require('./utils/gas-optimizer');

// Configuration
const config = {
  // Environnement
  DRY_RUN: process.env.DRY_RUN === 'true' || true,
  NETWORK: process.env.NETWORK || 'arbitrum',
  
  // Seuils
  MIN_PROFIT_USD: parseFloat(process.env.ARBITRAGE_MIN_PROFIT_USD) || 50,
  MAX_SLIPPAGE_BPS: parseFloat(process.env.MAX_SLIPPAGE_BPS) || 50, // 0.5%
  PRICE_DEVIATION_THRESHOLD_BPS: 100, // 1%
  
  // Limitations
  MAX_POSITION_SIZE_USD: 10000,
  MAX_TRADES_PER_BLOCK: 1,
  
  // RPC
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  
  // Sécurité
  ORACLE_DEVIATION_MAX_BPS: 200, // 2%
  POSITION_TIMEOUT_MINUTES: 5, // Aucune position overnight
};

class ArbitrageBot {
  constructor() {
    this.logger = new Logger('arbitrage-bot');
    this.metrics = new Metrics();
    this.circuitBreaker = new CircuitBreaker();
    this.gasOptimizer = new GasOptimizer();
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.lastTradeBlock = 0;
    this.activePositions = new Set();
    this.profitTotal = 0;
    
    this.logger.info('ArbitrageBot initialisé', { config });
  }
  
  createProvider() {
    const providers = config.RPC_URLS.map(url => 
      new ethers.JsonRpcProvider(url)
    );
    
    // Fallback provider avec timeout
    return new ethers.FallbackProvider(providers, 1, {
      timeout: 10000,
      quorum: 1,
    });
  }
  
  async start() {
    this.logger.info('Démarrage du bot d\'arbitrage');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // Boucle principale
    while (true) {
      try {
        await this.iteration();
        await this.delay(5000); // 5 secondes entre les itérations
      } catch (error) {
        this.logger.error('Erreur dans l\'itération', { error: error.message });
        await this.delay(30000); // Backoff en cas d'erreur
      }
    }
  }
  
  async iteration() {
    if (!await this.circuitBreaker.isOpen()) {
      await this.scanAndExecute();
    }
    
    // Nettoyage des positions expirées
    await this.cleanupPositions();
  }
  
  async scanAndExecute() {
    // Récupérer les marchés disponibles
    const markets = await this.client.getMarkets();
    
    for (const market of markets) {
      try {
        const opportunity = await this.findArbitrageOpportunity(market);
        
        if (opportunity) {
          await this.executeArbitrage(opportunity);
        }
      } catch (error) {
        this.logger.error(`Erreur sur le marché ${market.id}`, { error: error.message });
      }
    }
  }
  
  async findArbitrageOpportunity(market) {
    // Récupérer les prix
    const [oraclePrice, perpPrice] = await Promise.all([
      this.client.getOraclePrice(market.id),
      this.client.getPerpPrice(market.id),
    ]);
    
    // Vérifier la validité de l'oracle
    const oracleValid = await this.validateOracle(oraclePrice, market.id);
    if (!oracleValid) {
      this.logger.warn('Oracle invalide', { market: market.id });
      return null;
    }
    
    // Calculer la déviation
    const deviation = this.calculateDeviation(oraclePrice, perpPrice);
    
    if (deviation.absBps < config.PRICE_DEVIATION_THRESHOLD_BPS) {
      return null; // Pas d'opportunité
    }
    
    // Vérifier la liquidité
    const liquidity = await this.client.getLiquidity(market.id);
    if (liquidity.available < config.MIN_PROFIT_USD * 2) {
      return null; // Liquidité insuffisante
    }
    
    // Calculer le trade optimal
    const trade = await this.calculateOptimalTrade(market, deviation);
    
    // Simuler le trade
    const simulation = await this.simulateTrade(trade);
    
    if (!simulation.success || simulation.profitUsd < config.MIN_PROFIT_USD) {
      return null; // Pas profitable
    }
    
    // Vérifier le slippage
    const slippage = this.calculateSlippage(trade, simulation);
    if (slippage.bps > config.MAX_SLIPPAGE_BPS) {
      this.logger.warn('Slippage trop élevé', { slippage: slippage.bps });
      return null;
    }
    
    return {
      market,
      trade,
      simulation,
      deviation,
      timestamp: Date.now(),
    };
  }
  
  async executeArbitrage(opportunity) {
    const { market, trade, simulation } = opportunity;
    
    this.logger.info('Exécution d\'arbitrage', {
      market: market.id,
      size: trade.size,
      expectedProfit: simulation.profitUsd,
    });
    
    // Vérifier les contraintes de sécurité
    if (!await this.validateExecutionConstraints()) {
      this.logger.warn('Contraintes de sécurité non respectées');
      return;
    }
    
    // Dry-run mode
    if (config.DRY_RUN) {
      this.logger.info('DRY-RUN: Arbitrage non exécuté', {
        market: market.id,
        profit: simulation.profitUsd,
      });
      return;
    }
    
    // Optimiser le gas
    const gasParams = await this.gasOptimizer.getOptimalGas();
    
    try {
      // Exécuter le trade
      const tx = await this.client.executeArbitrage(
        market.id,
        trade.direction,
        trade.size,
        {
          maxSlippageBps: config.MAX_SLIPPAGE_BPS,
          ...gasParams,
        }
      );
      
      // Attendre la confirmation
      const receipt = await tx.wait();
      
      this.logger.info('Arbitrage exécuté', {
        txHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        profit: simulation.profitUsd,
      });
      
      // Mettre à jour les métriques
      this.metrics.recordTrade({
        type: 'arbitrage',
        profit: simulation.profitUsd,
        market: market.id,
        timestamp: Date.now(),
      });
      
      // Enregistrer la position
      this.activePositions.add({
        market: market.id,
        entryTime: Date.now(),
        size: trade.size,
        txHash: receipt.hash,
      });
      
      this.lastTradeBlock = receipt.blockNumber;
      
    } catch (error) {
      this.logger.error('Échec de l\'exécution', { error: error.message });
      this.circuitBreaker.trigger();
    }
  }
  
  async calculateOptimalTrade(market, deviation) {
    // Calculer la taille optimale en fonction de la liquidité
    const liquidity = await this.client.getLiquidity(market.id);
    
    // Limiter à 10% de la liquidité disponible
    const maxSize = Math.min(
      liquidity.available * 0.1,
      config.MAX_POSITION_SIZE_USD
    );
    
    // Calculer la taille basée sur la déviation
    const baseSize = (deviation.absBps / 100) * 1000; // $1000 par 1% de déviation
    
    const size = Math.min(baseSize, maxSize);
    
    return {
      direction: deviation.positive ? 'short' : 'long',
      size,
      marketId: market.id,
    };
  }
  
  async simulateTrade(trade) {
    // Simulation via static call
    try {
      const result = await this.client.simulateTrade(
        trade.marketId,
        trade.direction,
        trade.size
      );
      
      return {
        success: true,
        profitUsd: result.profit,
        gasEstimate: result.gasEstimate,
        priceImpact: result.priceImpact,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
  
  calculateDeviation(oraclePrice, perpPrice) {
    const deviation = (perpPrice - oraclePrice) / oraclePrice * 10000; // BPS
    return {
      bps: deviation,
      absBps: Math.abs(deviation),
      positive: deviation > 0,
    };
  }
  
  calculateSlippage(trade, simulation) {
    // Calcul basique du slippage
    const expectedPrice = trade.size / simulation.priceImpact;
    const actualPrice = trade.size / simulation.priceImpact; // À remplacer par le prix réel
    
    const slippage = Math.abs(expectedPrice - actualPrice) / expectedPrice * 10000;
    return { bps: slippage };
  }
  
  async validateOracle(price, marketId) {
    // Vérifier les bornes
    if (price <= 0 || price > 1e15) { // $0 à $1,000,000
      return false;
    }
    
    // Vérifier la déviation entre oracles
    const oracleDeviation = await this.client.getOracleDeviation(marketId);
    if (oracleDeviation > config.ORACLE_DEVIATION_MAX_BPS) {
      return false;
    }
    
    // Vérifier le temps de mise à jour
    const oracleAge = await this.client.getOracleAge(marketId);
    if (oracleAge > 120) { // 2 minutes
      return false;
    }
    
    return true;
  }
  
  async validateExecutionConstraints() {
    // Vérifier qu'on ne trade pas plus d'une fois par bloc
    const currentBlock = await this.provider.getBlockNumber();
    if (currentBlock === this.lastTradeBlock) {
      return false;
    }
    
    // Vérifier le nombre de positions actives
    if (this.activePositions.size >= 10) {
      return false;
    }
    
    // Vérifier le circuit breaker
    if (await this.circuitBreaker.isOpen()) {
      return false;
    }
    
    return true;
  }
  
  async cleanupPositions() {
    const now = Date.now();
    const timeout = config.POSITION_TIMEOUT_MINUTES * 60 * 1000;
    
    for (const position of this.activePositions) {
      if (now - position.entryTime > timeout) {
        this.logger.warn('Position expirée', { position });
        // Fermer la position (à implémenter)
        this.activePositions.delete(position);
      }
    }
  }
  
  async performHealthChecks() {
    const checks = [
      this.checkRpcConnection(),
      this.checkOracleStatus(),
      this.checkContractAccess(),
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
  
  async checkOracleStatus() {
    const markets = await this.client.getMarkets();
    for (const market of markets.slice(0, 3)) { // Vérifier seulement 3 marchés
      const valid = await this.validateOracle(
        await this.client.getOraclePrice(market.id),
        market.id
      );
      if (!valid) {
        throw new Error(`Oracle invalid for market ${market.id}`);
      }
    }
  }
  
  async checkContractAccess() {
    // Vérifier l'accès aux contrats principaux
    const engineAddress = await this.client.getEngineAddress();
    if (!ethers.isAddress(engineAddress)) {
      throw new Error('Invalid engine address');
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Point d'entrée
async function main() {
  const bot = new ArbitrageBot();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    bot.logger.info('Arrêt propre du bot');
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    bot.logger.info('Arrêt par signal TERM');
    process.exit(0);
  });
  
  // Gestion des erreurs non capturées
  process.on('uncaughtException', (error) => {
    bot.logger.error('Uncaught exception', { error: error.message });
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    bot.logger.error('Unhandled rejection', { reason: reason?.message });
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
    // Mode simulation seulement
    const bot = new ArbitrageBot();
    bot.scanAndExecute().then(() => {
      console.log('Simulation terminée');
      process.exit(0);
    });
  } else {
    main();
  }
}

module.exports = ArbitrageBot;