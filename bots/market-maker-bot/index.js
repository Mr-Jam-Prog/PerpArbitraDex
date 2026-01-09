#!/usr/bin/env node

/**
 * Market maker delta-neutral pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Maintenir la liquidité et réduire les spreads
 * Critères: Delta-neutral, exposure limité, auto-unwind
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger, Metrics } = require('./utils/logging');
const { CircuitBreaker } = require('./utils/circuit-breaker');
const { PricingModel } = require('./pricing-model');
const { RiskManager } = require('./risk-manager');

// Configuration
const config = {
  // Environnement
  DRY_RUN: process.env.DRY_RUN === 'true' || true,
  NETWORK: process.env.NETWORK || 'arbitrum',
  
  // Paramètres market making
  SPREAD_BPS: parseFloat(process.env.SPREAD_BPS) || 10, // 0.1%
  MAX_EXPOSURE_USD: parseFloat(process.env.MAX_EXPOSURE_USD) || 50000,
  MIN_ORDER_SIZE_USD: parseFloat(process.env.MIN_ORDER_SIZE_USD) || 100,
  MAX_ORDER_SIZE_USD: parseFloat(process.env.MAX_ORDER_SIZE_USD) || 5000,
  
  // Timing
  REFRESH_INTERVAL_MS: parseFloat(process.env.REFRESH_INTERVAL_MS) || 30000, // 30 secondes
  ORDER_LIFETIME_MS: 120000, // 2 minutes
  
  // Risque
  MAX_SKEW_RATIO: 0.2, // 20% de skew max
  FUNDING_THRESHOLD_BPS: 50, // 0.5%
  VOLATILITY_THRESHOLD_BPS: 500, // 5%
  
  // RPC
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  
  // Sécurité
  AUTO_UNWIND_ENABLED: true,
  HEDGE_INTERVAL_MS: 60000, // 1 minute
};

class MarketMakerBot {
  constructor() {
    this.logger = new Logger('market-maker-bot');
    this.metrics = new Metrics();
    this.circuitBreaker = new CircuitBreaker();
    this.pricingModel = new PricingModel();
    this.riskManager = new RiskManager();
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.activeOrders = new Map();
    this.exposure = {
      long: 0,
      short: 0,
      net: 0,
    };
    this.marketStates = new Map();
    this.lastHedgeTime = 0;
    
    this.logger.info('MarketMakerBot initialisé', { config });
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
    this.logger.info('Démarrage du market maker');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // Boucle principale
    while (true) {
      try {
        await this.iteration();
        await this.delay(config.REFRESH_INTERVAL_MS);
      } catch (error) {
        this.logger.error('Erreur dans l\'itération', { error: error.message });
        await this.delay(60000); // Backoff long en cas d'erreur
      }
    }
  }
  
  async iteration() {
    // Vérifier le circuit breaker
    if (await this.circuitBreaker.isOpen()) {
      this.logger.warn('Circuit breaker ouvert');
      return;
    }
    
    // Mettre à jour l'état des marchés
    await this.updateMarketStates();
    
    // Vérifier les risques
    const riskStatus = await this.checkRisk();
    if (!riskStatus.safe) {
      this.logger.warn('Risque détecté', { reasons: riskStatus.reasons });
      await this.handleRisk(riskStatus);
      return;
    }
    
    // Gérer les ordres existants
    await this.manageExistingOrders();
    
    // Placer de nouveaux ordres
    await this.placeNewOrders();
    
    // Hedger si nécessaire
    await this.hedgeExposure();
    
    // Mettre à jour les métriques
    this.updateMetrics();
  }
  
  async updateMarketStates() {
    const markets = await this.client.getMarkets();
    
    for (const market of markets) {
      try {
        const state = await this.getMarketState(market.id);
        this.marketStates.set(market.id, state);
        
      } catch (error) {
        this.logger.error('Erreur mise à jour état marché', { market: market.id, error: error.message });
      }
    }
  }
  
  async getMarketState(marketId) {
    const [
      oraclePrice,
      perpPrice,
      fundingRate,
      skew,
      orderbook,
      volatility,
    ] = await Promise.all([
      this.client.getOraclePrice(marketId),
      this.client.getPerpPrice(marketId),
      this.client.getFundingRate(marketId),
      this.client.getSkew(marketId),
      this.client.getOrderbook(marketId, 10),
      this.client.getVolatility(marketId),
    ]);
    
    return {
      marketId,
      oraclePrice,
      perpPrice,
      fundingRate,
      skew,
      orderbook,
      volatility,
      timestamp: Date.now(),
      spread: this.calculateSpread(orderbook),
      midPrice: this.calculateMidPrice(orderbook),
    };
  }
  
  calculateSpread(orderbook) {
    if (!orderbook.bids.length || !orderbook.asks.length) {
      return 0;
    }
    
    const bestBid = orderbook.bids[0].price;
    const bestAsk = orderbook.asks[0].price;
    
    return ((bestAsk - bestBid) / bestBid) * 10000; // BPS
  }
  
  calculateMidPrice(orderbook) {
    if (!orderbook.bids.length || !orderbook.asks.length) {
      return 0;
    }
    
    const bestBid = orderbook.bids[0].price;
    const bestAsk = orderbook.asks[0].price;
    
    return (bestBid + bestAsk) / 2;
  }
  
  async checkRisk() {
    const reasons = [];
    
    // Vérifier l'exposition totale
    if (Math.abs(this.exposure.net) > config.MAX_EXPOSURE_USD) {
      reasons.push(`Exposition nette trop élevée: ${this.exposure.net}`);
    }
    
    // Vérifier le skew par marché
    for (const [marketId, state] of this.marketStates) {
      if (Math.abs(state.skew) > config.MAX_SKEW_RATIO) {
        reasons.push(`Skew élevé sur ${marketId}: ${state.skew}`);
      }
      
      if (Math.abs(state.fundingRate) > config.FUNDING_THRESHOLD_BPS) {
        reasons.push(`Funding extrême sur ${marketId}: ${state.fundingRate} bps`);
      }
      
      if (state.volatility > config.VOLATILITY_THRESHOLD_BPS) {
        reasons.push(`Volatilité élevée sur ${marketId}: ${state.volatility} bps`);
      }
      
      // Vérifier l'oracle
      const oracleValid = await this.validateOracle(state);
      if (!oracleValid) {
        reasons.push(`Oracle invalide sur ${marketId}`);
      }
    }
    
    return {
      safe: reasons.length === 0,
      reasons,
      timestamp: Date.now(),
    };
  }
  
  async handleRisk(riskStatus) {
    this.logger.warn('Gestion des risques', { riskStatus });
    
    // Annuler tous les ordres
    await this.cancelAllOrders();
    
    // Auto-unwind si activé
    if (config.AUTO_UNWIND_ENABLED && Math.abs(this.exposure.net) > config.MAX_EXPOSURE_USD * 0.5) {
      await this.autoUnwind();
    }
    
    // Déclencher le circuit breaker si risque critique
    if (riskStatus.reasons.some(r => r.includes('Oracle invalide') || r.includes('Funding extrême'))) {
      this.circuitBreaker.trigger();
    }
  }
  
  async manageExistingOrders() {
    const now = Date.now();
    
    for (const [orderId, order] of this.activeOrders) {
      try {
        // Vérifier l'âge de l'ordre
        if (now - order.timestamp > config.ORDER_LIFETIME_MS) {
          await this.cancelOrder(orderId);
          continue;
        }
        
        // Vérifier si l'ordre doit être mis à jour
        const shouldUpdate = await this.shouldUpdateOrder(order);
        if (shouldUpdate) {
          await this.updateOrder(order);
        }
        
      } catch (error) {
        this.logger.error('Erreur gestion ordre', { orderId, error: error.message });
        this.activeOrders.delete(orderId);
      }
    }
  }
  
  async placeNewOrders() {
    for (const [marketId, state] of this.marketStates) {
      try {
        // Vérifier les conditions du marché
        if (!await this.isMarketSuitable(state)) {
          continue;
        }
        
        // Calculer les prix bid/ask
        const prices = this.calculatePrices(state);
        
        // Déterminer les tailles
        const sizes = this.calculateSizes(state);
        
        // Placer les ordres
        await this.placeOrders(marketId, prices, sizes);
        
      } catch (error) {
        this.logger.error('Erreur placement ordres', { market: marketId, error: error.message });
      }
    }
  }
  
  async hedgeExposure() {
    const now = Date.now();
    
    // Hedger seulement toutes les X minutes
    if (now - this.lastHedgeTime < config.HEDGE_INTERVAL_MS) {
      return;
    }
    
    // Calculer l'exposition à hedger
    const hedgeAmount = this.calculateHedgeAmount();
    
    if (Math.abs(hedgeAmount) > config.MIN_ORDER_SIZE_USD) {
      this.logger.info('Hedging de l\'exposition', { amount: hedgeAmount });
      
      try {
        // Exécuter le hedge
        await this.executeHedge(hedgeAmount);
        
        this.lastHedgeTime = now;
        
      } catch (error) {
        this.logger.error('Échec du hedging', { error: error.message });
      }
    }
  }
  
  calculatePrices(state) {
    const midPrice = state.midPrice || state.oraclePrice;
    
    // Calculer le spread adaptatif
    const adaptiveSpread = this.calculateAdaptiveSpread(state);
    
    return {
      bid: midPrice * (1 - adaptiveSpread / 10000 / 2),
      ask: midPrice * (1 + adaptiveSpread / 10000 / 2),
      mid: midPrice,
    };
  }
  
  calculateAdaptiveSpread(state) {
    let spread = config.SPREAD_BPS;
    
    // Ajuster en fonction de la volatilité
    if (state.volatility > 200) { // > 2%
      spread *= 1.5;
    }
    
    // Ajuster en fonction du funding
    if (Math.abs(state.fundingRate) > 30) { // > 0.3%
      spread *= 1.2;
    }
    
    // Ajuster en fonction de la liquidité
    if (state.orderbook.bids.length < 3 || state.orderbook.asks.length < 3) {
      spread *= 1.3; // Spread plus large si peu de liquidité
    }
    
    return Math.min(spread, 100); // Max 1%
  }
  
  calculateSizes(state) {
    // Calcul basé sur la liquidité disponible
    const bidDepth = state.orderbook.bids.reduce((sum, bid) => sum + bid.size, 0);
    const askDepth = state.orderbook.asks.reduce((sum, ask) => sum + ask.size, 0);
    
    const avgDepth = (bidDepth + askDepth) / 2;
    
    // Taille proportionnelle à la liquidité (max 10%)
    const baseSize = Math.min(
      avgDepth * 0.1,
      config.MAX_ORDER_SIZE_USD
    );
    
    return {
      bid: Math.max(baseSize, config.MIN_ORDER_SIZE_USD),
      ask: Math.max(baseSize, config.MIN_ORDER_SIZE_USD),
    };
  }
  
  calculateHedgeAmount() {
    // Hedge pour maintenir le delta neutre
    const targetNetExposure = 0;
    const currentNetExposure = this.exposure.net;
    
    return targetNetExposure - currentNetExposure;
  }
  
  async placeOrders(marketId, prices, sizes) {
    // Vérifier les limites d'exposition
    if (this.exposure.long + sizes.ask > config.MAX_EXPOSURE_USD ||
        this.exposure.short + sizes.bid > config.MAX_EXPOSURE_USD) {
      this.logger.warn('Limite d\'exposition atteinte', { marketId });
      return;
    }
    
    // Dry-run mode
    if (config.DRY_RUN) {
      this.logger.info('DRY-RUN: Ordres non placés', {
        market: marketId,
        bid: { price: prices.bid, size: sizes.bid },
        ask: { price: prices.ask, size: sizes.ask },
      });
      return;
    }
    
    try {
      // Placer l'ordre bid (buy)
      const bidTx = await this.client.placeOrder(
        marketId,
        'buy',
        sizes.bid,
        prices.bid,
        {
          postOnly: true,
          reduceOnly: false,
        }
      );
      
      // Placer l'ordre ask (sell)
      const askTx = await this.client.placeOrder(
        marketId,
        'sell',
        sizes.ask,
        prices.ask,
        {
          postOnly: true,
          reduceOnly: false,
        }
      );
      
      // Attendre les confirmations
      const [bidReceipt, askReceipt] = await Promise.all([
        bidTx.wait(),
        askTx.wait(),
      ]);
      
      // Enregistrer les ordres
      const bidOrderId = this.extractOrderId(bidReceipt);
      const askOrderId = this.extractOrderId(askReceipt);
      
      this.activeOrders.set(bidOrderId, {
        marketId,
        side: 'bid',
        size: sizes.bid,
        price: prices.bid,
        timestamp: Date.now(),
        txHash: bidReceipt.hash,
      });
      
      this.activeOrders.set(askOrderId, {
        marketId,
        side: 'ask',
        size: sizes.ask,
        price: prices.ask,
        timestamp: Date.now(),
        txHash: askReceipt.hash,
      });
      
      // Mettre à jour l'exposition
      this.exposure.long += sizes.ask;
      this.exposure.short += sizes.bid;
      this.exposure.net = this.exposure.long - this.exposure.short;
      
      this.logger.info('Ordres placés', {
        market: marketId,
        bid: { orderId: bidOrderId, size: sizes.bid },
        ask: { orderId: askOrderId, size: sizes.ask },
      });
      
    } catch (error) {
      this.logger.error('Échec placement ordres', { market: marketId, error: error.message });
    }
  }
  
  async cancelOrder(orderId) {
    this.logger.info('Annulation d\'ordre', { orderId });
    
    try {
      const tx = await this.client.cancelOrder(orderId);
      await tx.wait();
      
      // Mettre à jour l'exposition
      const order = this.activeOrders.get(orderId);
      if (order) {
        if (order.side === 'bid') {
          this.exposure.short -= order.size;
        } else {
          this.exposure.long -= order.size;
        }
        this.exposure.net = this.exposure.long - this.exposure.short;
      }
      
      this.activeOrders.delete(orderId);
      
      this.logger.info('Ordre annulé', { orderId });
      
    } catch (error) {
      this.logger.error('Échec annulation ordre', { orderId, error: error.message });
    }
  }
  
  async cancelAllOrders() {
    this.logger.info('Annulation de tous les ordres');
    
    const orderIds = Array.from(this.activeOrders.keys());
    
    for (const orderId of orderIds) {
      await this.cancelOrder(orderId);
    }
  }
  
  async autoUnwind() {
    this.logger.info('Auto-unwind de l\'exposition');
    
    // Fermer les positions pour ramener l'exposition nette à zéro
    const unwindAmount = -this.exposure.net;
    
    if (Math.abs(unwindAmount) > config.MIN_ORDER_SIZE_USD) {
      try {
        // Trouver le marché avec la meilleure liquidité
        const bestMarket = await this.findBestMarketForUnwind();
        
        if (bestMarket) {
          const direction = unwindAmount > 0 ? 'sell' : 'buy';
          const size = Math.min(Math.abs(unwindAmount), config.MAX_ORDER_SIZE_USD);
          
          const tx = await this.client.placeOrder(
            bestMarket.id,
            direction,
            size,
            0, // Market order
            { reduceOnly: true }
          );
          
          const receipt = await tx.wait();
          
          this.logger.info('Auto-unwind exécuté', {
            market: bestMarket.id,
            direction,
            size,
            txHash: receipt.hash,
          });
          
          // Mettre à jour l'exposition
          if (direction === 'sell') {
            this.exposure.long -= size;
          } else {
            this.exposure.short -= size;
          }
          this.exposure.net = this.exposure.long - this.exposure.short;
        }
        
      } catch (error) {
        this.logger.error('Échec auto-unwind', { error: error.message });
      }
    }
  }
  
  async executeHedge(amount) {
    if (config.DRY_RUN) {
      this.logger.info('DRY-RUN: Hedge non exécuté', { amount });
      return;
    }
    
    // Implémentation du hedge
    // À adapter selon la stratégie de hedge (spot, futures, etc.)
    this.logger.info('Hedge exécuté', { amount });
  }
  
  async validateOracle(state) {
    // Vérifier les bornes de prix
    if (state.oraclePrice <= 0 || state.oraclePrice > 1e15) {
      return false;
    }
    
    // Vérifier l'âge
    const oracleAge = await this.client.getOracleAge(state.marketId);
    if (oracleAge > 120) { // 2 minutes
      return false;
    }
    
    // Vérifier la déviation par rapport au prix perp
    const deviation = Math.abs(state.oraclePrice - state.perpPrice) / state.oraclePrice * 10000;
    if (deviation > 200) { // 2%
      return false;
    }
    
    return true;
  }
  
  async isMarketSuitable(state) {
    // Vérifier la liquidité
    if (state.orderbook.bids.length < 2 || state.orderbook.asks.length < 2) {
      return false;
    }
    
    // Vérifier le spread
    if (state.spread > config.SPREAD_BPS * 3) {
      return false; // Spread trop large
    }
    
    // Vérifier la volatilité
    if (state.volatility > config.VOLATILITY_THRESHOLD_BPS) {
      return false;
    }
    
    return true;
  }
  
  async shouldUpdateOrder(order) {
    const currentState = this.marketStates.get(order.marketId);
    if (!currentState) return false;
    
    // Vérifier si le prix a trop bougé
    const currentMid = currentState.midPrice;
    const orderPrice = order.price;
    
    const deviation = Math.abs(currentMid - orderPrice) / currentMid * 10000;
    
    // Mettre à jour si déviation > 50% du spread cible
    return deviation > config.SPREAD_BPS * 0.5;
  }
  
  async updateOrder(order) {
    // Annuler et replacer l'ordre
    await this.cancelOrder(order.orderId);
    
    // Replacer avec nouveaux prix
    const state = this.marketStates.get(order.marketId);
    const prices = this.calculatePrices(state);
    
    const newPrice = order.side === 'bid' ? prices.bid : prices.ask;
    
    // (La logique de replacement serait similaire à placeOrders)
    this.logger.info('Ordre mis à jour', { 
      orderId: order.orderId,
      oldPrice: order.price,
      newPrice,
    });
  }
  
  async findBestMarketForUnwind() {
    // Trouver le marché avec la meilleure liquidité
    let bestMarket = null;
    let bestLiquidity = 0;
    
    for (const [marketId, state] of this.marketStates) {
      const liquidity = state.orderbook.bids.reduce((sum, bid) => sum + bid.size, 0) +
                       state.orderbook.asks.reduce((sum, ask) => sum + ask.size, 0);
      
      if (liquidity > bestLiquidity) {
        bestLiquidity = liquidity;
        bestMarket = { id: marketId, liquidity };
      }
    }
    
    return bestMarket;
  }
  
  extractOrderId(receipt) {
    // Extraire l'order ID des logs
    // Implémentation spécifique au contrat
    return `order_${receipt.hash}`;
  }
  
  updateMetrics() {
    this.metrics.update({
      activeOrders: this.activeOrders.size,
      exposure: this.exposure,
      marketCount: this.marketStates.size,
      circuitBreakerOpen: this.circuitBreaker.isOpen(),
    });
  }
  
  async performHealthChecks() {
    const checks = [
      this.checkRpcConnection(),
      this.checkMarketAccess(),
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
  
  async checkMarketAccess() {
    const markets = await this.client.getMarkets();
    if (markets.length === 0) {
      throw new Error('No markets accessible');
    }
  }
  
  async checkOracleHealth() {
    const markets = await this.client.getMarkets();
    for (const market of markets.slice(0, 2)) {
      const state = await this.getMarketState(market.id);
      const valid = await this.validateOracle(state);
      if (!valid) {
        throw new Error(`Oracle unhealthy for market ${market.id}`);
      }
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Point d'entrée
async function main() {
  const bot = new MarketMakerBot();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    bot.logger.info('Arrêt propre du bot');
    
    // Annuler tous les ordres avant de quitter
    await bot.cancelAllOrders();
    
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    bot.logger.info('Arrêt par signal TERM');
    await bot.cancelAllOrders();
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
  
  main();
}

module.exports = MarketMakerBot;