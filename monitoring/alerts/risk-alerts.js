#!/usr/bin/env node

/**
 * Système d'alertes risque protocole global pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Surveiller les risques systémiques et envoyer des alertes
 * Sources: RiskManager, ProtocolConfig, positions, markets
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger } = require('../utils/logging');
const { AlertManager } = require('../utils/alert-manager');
const { RiskCalculator } = require('../utils/risk-calculator');

// Configuration
const config = {
  // Seuils d'alerte
  OPEN_INTEREST_CAP_RATIO: 0.8,        // 80% du cap
  SKEW_EXTREME_THRESHOLD: 0.3,         // 30% de skew
  FUNDING_EXTREME_BPS: 100,            // 1% funding rate
  COLLATERAL_BUFFER_RATIO: 0.1,        // 10% buffer minimum
  HEALTH_FACTOR_MEDIAN_THRESHOLD: 1.5, // Median HF < 1.5
  POSITION_CONCENTRATION_RATIO: 0.2,   // 20% concentration
  
  // Agrégation
  AGGREGATION_WINDOW_MS: 300000,       // 5 minutes
  BUFFER_TEMPORAL_MS: 60000,           // 1 minute buffer
  
  // Monitoring
  CHECK_INTERVAL_MS: 60000,            // 1 minute
  HISTORICAL_SAMPLES: 100,             // Nombre d'échantillons historiques
  
  // Sources
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  SUBGRAPH_URL: process.env.SUBGRAPH_URL,
  
  // Sécurité
  ALERT_COOLDOWN_MS: 300000,           // 5 minutes entre alertes similaires
  FALSE_POSITIVE_FILTER: true,
};

class RiskAlerts {
  constructor() {
    this.logger = new Logger('risk-alerts');
    this.alertManager = new AlertManager();
    this.riskCalculator = new RiskCalculator();
    
    // Providers avec fallback
    this.provider = this.createProvider();
    this.client = new PerpDexClient(this.provider);
    
    // State
    this.riskMetrics = new Map();
    this.alertHistory = [];
    this.marketSnapshots = new Map();
    this.lastAlertTime = new Map();
    
    this.logger.info('RiskAlerts initialisé', { config });
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
    this.logger.info('Démarrage du système d\'alertes risque');
    
    // Vérifications initiales
    await this.performHealthChecks();
    
    // Boucle de surveillance
    while (true) {
      try {
        await this.monitorRisks();
        await this.delay(config.CHECK_INTERVAL_MS);
      } catch (error) {
        this.logger.error('Erreur dans la boucle de surveillance', { error: error.message });
        await this.delay(120000); // Backoff de 2 minutes en cas d'erreur
      }
    }
  }
  
  async monitorRisks() {
    this.logger.debug('Surveillance des risques en cours');
    
    // 1. Collecter les métriques de risque
    const metrics = await this.collectRiskMetrics();
    
    // 2. Analyser les risques
    const risks = await this.analyzeRisks(metrics);
    
    // 3. Filtrer les faux positifs
    const filteredRisks = await this.filterFalsePositives(risks);
    
    // 4. Envoyer les alertes
    for (const risk of filteredRisks) {
      await this.sendRiskAlert(risk);
    }
    
    // 5. Mettre à jour l'historique
    await this.updateHistoricalData(metrics);
    
    this.logger.debug('Surveillance des risques terminée', { 
      metricsCount: Object.keys(metrics).length,
      risksDetected: filteredRisks.length,
    });
  }
  
  async collectRiskMetrics() {
    const metrics = {
      timestamp: Date.now(),
      markets: {},
      protocol: {},
      positions: {},
    };
    
    try {
      // Récupérer tous les marchés
      const markets = await this.client.getMarkets();
      
      for (const market of markets) {
        const marketMetrics = await this.collectMarketMetrics(market.id);
        metrics.markets[market.id] = marketMetrics;
      }
      
      // Métriques protocole globales
      metrics.protocol = await this.collectProtocolMetrics();
      
      // Métriques positions
      metrics.positions = await this.collectPositionMetrics();
      
      return metrics;
      
    } catch (error) {
      this.logger.error('Erreur collecte métriques risque', { error: error.message });
      
      // Inclure l'erreur dans les métriques
      metrics.error = error.message;
      return metrics;
    }
  }
  
  async collectMarketMetrics(marketId) {
    const metrics = {
      marketId,
      timestamp: Date.now(),
    };
    
    try {
      // Open Interest
      const openInterest = await this.client.getOpenInterest(marketId);
      const openInterestCap = await this.client.getOpenInterestCap(marketId);
      
      metrics.openInterest = openInterest;
      metrics.openInterestCap = openInterestCap;
      metrics.openInterestRatio = openInterestCap > 0 ? openInterest / openInterestCap : 0;
      
      // Skew
      const longOpenInterest = await this.client.getLongOpenInterest(marketId);
      const shortOpenInterest = await this.client.getShortOpenInterest(marketId);
      const totalOI = longOpenInterest + shortOpenInterest;
      
      metrics.skew = totalOI > 0 ? (longOpenInterest - shortOpenInterest) / totalOI : 0;
      metrics.longRatio = totalOI > 0 ? longOpenInterest / totalOI : 0;
      metrics.shortRatio = totalOI > 0 ? shortOpenInterest / totalOI : 0;
      
      // Funding Rate
      const fundingRate = await this.client.getFundingRate(marketId);
      metrics.fundingRate = fundingRate;
      metrics.fundingRateBps = fundingRate * 10000;
      
      // Liquidité
      const liquidity = await this.client.getLiquidity(marketId);
      metrics.liquidity = liquidity;
      
      // Volatilité
      const volatility = await this.client.getVolatility(marketId);
      metrics.volatility = volatility;
      
      // Concentration de positions
      const positionConcentration = await this.calculatePositionConcentration(marketId);
      metrics.positionConcentration = positionConcentration;
      
    } catch (error) {
      this.logger.error(`Erreur collecte métriques marché ${marketId}`, { error: error.message });
      metrics.error = error.message;
    }
    
    return metrics;
  }
  
  async collectProtocolMetrics() {
    const metrics = {
      timestamp: Date.now(),
    };
    
    try {
      // Collateral total
      const totalCollateral = await this.client.getTotalCollateral();
      const requiredCollateral = await this.client.getRequiredCollateral();
      
      metrics.totalCollateral = totalCollateral;
      metrics.requiredCollateral = requiredCollateral;
      metrics.collateralBuffer = requiredCollateral > 0 ? 
        (totalCollateral - requiredCollateral) / requiredCollateral : 0;
      
      // Nombre total de positions
      const totalPositions = await this.client.getTotalPositions();
      metrics.totalPositions = totalPositions;
      
      // Positions à risque
      const atRiskPositions = await this.client.getAtRiskPositions();
      metrics.atRiskPositions = atRiskPositions;
      metrics.atRiskRatio = totalPositions > 0 ? atRiskPositions / totalPositions : 0;
      
      // Health factor médian
      const medianHealthFactor = await this.calculateMedianHealthFactor();
      metrics.medianHealthFactor = medianHealthFactor;
      
      // Distribution des health factors
      const healthFactorDistribution = await this.calculateHealthFactorDistribution();
      metrics.healthFactorDistribution = healthFactorDistribution;
      
      // Concentrations
      metrics.topTraderConcentration = await this.calculateTopTraderConcentration();
      metrics.topLiquidatorConcentration = await this.calculateTopLiquidatorConcentration();
      
    } catch (error) {
      this.logger.error('Erreur collecte métriques protocole', { error: error.message });
      metrics.error = error.message;
    }
    
    return metrics;
  }
  
  async collectPositionMetrics() {
    const metrics = {
      timestamp: Date.now(),
    };
    
    try {
      // Distribution des tailles de position
      const positionSizes = await this.getPositionSizeDistribution();
      metrics.positionSizeDistribution = positionSizes;
      
      // Durée moyenne des positions
      const averagePositionAge = await this.getAveragePositionAge();
      metrics.averagePositionAge = averagePositionAge;
      
      // PnL distribution
      const pnlDistribution = await this.getPnLDistribution();
      metrics.pnlDistribution = pnlDistribution;
      
    } catch (error) {
      this.logger.error('Erreur collecte métriques positions', { error: error.message });
      metrics.error = error.message;
    }
    
    return metrics;
  }
  
  async analyzeRisks(metrics) {
    const risks = [];
    
    // Analyser chaque marché
    for (const [marketId, marketMetrics] of Object.entries(metrics.markets)) {
      const marketRisks = await this.analyzeMarketRisks(marketId, marketMetrics);
      risks.push(...marketRisks);
    }
    
    // Analyser les risques protocole globaux
    const protocolRisks = await this.analyzeProtocolRisks(metrics.protocol);
    risks.push(...protocolRisks);
    
    // Analyser les risques de position
    const positionRisks = await this.analyzePositionRisks(metrics.positions);
    risks.push(...positionRisks);
    
    return risks;
  }
  
  async analyzeMarketRisks(marketId, metrics) {
    const risks = [];
    
    // 1. Risque: Open Interest proche du cap
    if (metrics.openInterestRatio >= config.OPEN_INTEREST_CAP_RATIO) {
      risks.push({
        type: 'OPEN_INTEREST_CAP_APPROACHING',
        severity: metrics.openInterestRatio >= 0.95 ? 'CRITICAL' : 'HIGH',
        market: marketId,
        message: `Open Interest proche du cap: ${(metrics.openInterestRatio * 100).toFixed(1)}%`,
        data: {
          openInterest: metrics.openInterest,
          cap: metrics.openInterestCap,
          ratio: metrics.openInterestRatio,
          threshold: config.OPEN_INTEREST_CAP_RATIO,
        },
      });
    }
    
    // 2. Risque: Skew extrême
    if (Math.abs(metrics.skew) > config.SKEW_EXTREME_THRESHOLD) {
      risks.push({
        type: 'EXTREME_SKEW',
        severity: Math.abs(metrics.skew) > 0.5 ? 'CRITICAL' : 'HIGH',
        market: marketId,
        message: `Skew extrême: ${(metrics.skew * 100).toFixed(1)}% (long: ${(metrics.longRatio * 100).toFixed(1)}%, short: ${(metrics.shortRatio * 100).toFixed(1)}%)`,
        data: {
          skew: metrics.skew,
          longRatio: metrics.longRatio,
          shortRatio: metrics.shortRatio,
          threshold: config.SKEW_EXTREME_THRESHOLD,
        },
      });
    }
    
    // 3. Risque: Funding rate extrême
    if (Math.abs(metrics.fundingRateBps) > config.FUNDING_EXTREME_BPS) {
      risks.push({
        type: 'EXTREME_FUNDING_RATE',
        severity: Math.abs(metrics.fundingRateBps) > 200 ? 'CRITICAL' : 'HIGH',
        market: marketId,
        message: `Funding rate extrême: ${metrics.fundingRateBps.toFixed(0)} bps`,
        data: {
          fundingRate: metrics.fundingRate,
          fundingRateBps: metrics.fundingRateBps,
          thresholdBps: config.FUNDING_EXTREME_BPS,
        },
      });
    }
    
    // 4. Risque: Concentration de positions
    if (metrics.positionConcentration && metrics.positionConcentration.top10Ratio > config.POSITION_CONCENTRATION_RATIO) {
      risks.push({
        type: 'POSITION_CONCENTRATION',
        severity: 'MEDIUM',
        market: marketId,
        message: `Concentration de positions élevée: top 10 = ${(metrics.positionConcentration.top10Ratio * 100).toFixed(1)}%`,
        data: {
          concentration: metrics.positionConcentration,
          threshold: config.POSITION_CONCENTRATION_RATIO,
        },
      });
    }
    
    return risks;
  }
  
  async analyzeProtocolRisks(metrics) {
    const risks = [];
    
    // 1. Risque: Buffer collateral insuffisant
    if (metrics.collateralBuffer < config.COLLATERAL_BUFFER_RATIO) {
      risks.push({
        type: 'INSUFFICIENT_COLLATERAL_BUFFER',
        severity: metrics.collateralBuffer <= 0 ? 'CRITICAL' : 'HIGH',
        message: `Buffer collateral insuffisant: ${(metrics.collateralBuffer * 100).toFixed(1)}% (min: ${(config.COLLATERAL_BUFFER_RATIO * 100)}%)`,
        data: {
          totalCollateral: metrics.totalCollateral,
          requiredCollateral: metrics.requiredCollateral,
          buffer: metrics.collateralBuffer,
          threshold: config.COLLATERAL_BUFFER_RATIO,
        },
      });
    }
    
    // 2. Risque: Health factor médian bas
    if (metrics.medianHealthFactor < config.HEALTH_FACTOR_MEDIAN_THRESHOLD) {
      risks.push({
        type: 'LOW_MEDIAN_HEALTH_FACTOR',
        severity: metrics.medianHealthFactor < 1.2 ? 'CRITICAL' : 'HIGH',
        message: `Health factor médian bas: ${metrics.medianHealthFactor.toFixed(2)} (seuil: ${config.HEALTH_FACTOR_MEDIAN_THRESHOLD})`,
        data: {
          medianHealthFactor: metrics.medianHealthFactor,
          threshold: config.HEALTH_FACTOR_MEDIAN_THRESHOLD,
          distribution: metrics.healthFactorDistribution,
        },
      });
    }
    
    // 3. Risque: Ratio élevé de positions à risque
    if (metrics.atRiskRatio > 0.1) { // 10% des positions
      risks.push({
        type: 'HIGH_AT_RISK_POSITIONS',
        severity: metrics.atRiskRatio > 0.2 ? 'CRITICAL' : 'HIGH',
        message: `Ratio élevé de positions à risque: ${(metrics.atRiskRatio * 100).toFixed(1)}%`,
        data: {
          atRiskPositions: metrics.atRiskPositions,
          totalPositions: metrics.totalPositions,
          ratio: metrics.atRiskRatio,
        },
      });
    }
    
    // 4. Risque: Concentration des traders
    if (metrics.topTraderConcentration && metrics.topTraderConcentration.top10Ratio > 0.5) {
      risks.push({
        type: 'TRADER_CONCENTRATION',
        severity: 'MEDIUM',
        message: `Concentration des traders élevée: top 10 = ${(metrics.topTraderConcentration.top10Ratio * 100).toFixed(1)}%`,
        data: {
          concentration: metrics.topTraderConcentration,
        },
      });
    }
    
    return risks;
  }
  
  async analyzePositionRisks(metrics) {
    const risks = [];
    
    // 1. Risque: Positions trop grandes
    if (metrics.positionSizeDistribution && 
        metrics.positionSizeDistribution.largePositionsRatio > 0.1) {
      risks.push({
        type: 'LARGE_POSITIONS_CONCENTRATION',
        severity: 'MEDIUM',
        message: `Concentration de positions larges: ${(metrics.positionSizeDistribution.largePositionsRatio * 100).toFixed(1)}%`,
        data: {
          distribution: metrics.positionSizeDistribution,
        },
      });
    }
    
    // 2. Risque: Positions anciennes (potentiellement abandonnées)
    if (metrics.averagePositionAge > 604800000) { // 7 jours en ms
      risks.push({
        type: 'OLD_POSITIONS',
        severity: 'LOW',
        message: `Positions anciennes détectées: âge moyen = ${(metrics.averagePositionAge / 86400000).toFixed(1)} jours`,
        data: {
          averageAgeMs: metrics.averagePositionAge,
          averageAgeDays: metrics.averagePositionAge / 86400000,
        },
      });
    }
    
    // 3. Risque: Distribution PnL extrême
    if (metrics.pnlDistribution && 
        Math.abs(metrics.pnlDistribution.skewness) > 2) {
      risks.push({
        type: 'EXTREME_PNL_DISTRIBUTION',
        severity: 'MEDIUM',
        message: `Distribution PnL extrême: skewness = ${metrics.pnlDistribution.skewness.toFixed(2)}`,
        data: {
          distribution: metrics.pnlDistribution,
        },
      });
    }
    
    return risks;
  }
  
  async filterFalsePositives(risks) {
    if (!config.FALSE_POSITIVE_FILTER) {
      return risks;
    }
    
    const filtered = [];
    const now = Date.now();
    
    for (const risk of risks) {
      // Vérifier le cooldown
      const lastAlertTime = this.lastAlertTime.get(risk.type + '_' + (risk.market || 'global'));
      if (lastAlertTime && (now - lastAlertTime < config.ALERT_COOLDOWN_MS)) {
        this.logger.debug('Alerte filtrée (cooldown)', { type: risk.type, market: risk.market });
        continue;
      }
      
      // Vérifier la persistance dans le temps (nécessite l'historique)
      const isPersistent = await this.checkRiskPersistence(risk);
      if (!isPersistent && risk.severity !== 'CRITICAL') {
        this.logger.debug('Alerte filtrée (non persistante)', { type: risk.type });
        continue;
      }
      
      // Vérifier si c'est une fausse alerte basée sur des patterns historiques
      const isFalsePositive = await this.checkFalsePositivePattern(risk);
      if (isFalsePositive) {
        this.logger.debug('Alerte filtrée (faux positif)', { type: risk.type });
        continue;
      }
      
      filtered.push(risk);
    }
    
    return filtered;
  }
  
  async checkRiskPersistence(risk) {
    // Vérifier si le risque persiste depuis plusieurs échantillons
    const riskKey = risk.type + '_' + (risk.market || 'global');
    const history = this.riskMetrics.get(riskKey) || [];
    
    // Requiert au moins 3 échantillons consécutifs
    const recentHistory = history.slice(-3);
    if (recentHistory.length < 3) {
      return false;
    }
    
    // Tous les échantillons récents doivent indiquer le risque
    return recentHistory.every(h => h.detected === true);
  }
  
  async checkFalsePositivePattern(risk) {
    // Vérifier les patterns historiques de faux positifs
    // Pour l'instant, logique basique
    const falsePositivePatterns = [
      // Funding rate extrême pendant les heures creuses
      { type: 'EXTREME_FUNDING_RATE', condition: () => {
        const hour = new Date().getHours();
        return hour >= 0 && hour <= 4; // Nuit
      }},
      
      // Skew extrême sur les petits marchés
      { type: 'EXTREME_SKEW', condition: async () => {
        if (!risk.market) return false;
        const marketMetrics = await this.collectMarketMetrics(risk.market);
        return marketMetrics.openInterest < 1000000; // < $1M OI
      }},
    ];
    
    for (const pattern of falsePositivePatterns) {
      if (risk.type === pattern.type) {
        const matches = await pattern.condition();
        if (matches) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  async sendRiskAlert(risk) {
    const alert = {
      type: risk.type,
      severity: risk.severity,
      market: risk.market || 'global',
      message: risk.message,
      timestamp: Date.now(),
      data: risk.data,
      alertId: this.generateAlertId(risk),
    };
    
    // Envoyer via AlertManager
    await this.alertManager.send(alert);
    
    // Mettre à jour le suivi
    this.lastAlertTime.set(risk.type + '_' + (risk.market || 'global'), Date.now());
    
    // Ajouter à l'historique
    this.alertHistory.push({
      ...alert,
      notified: true,
    });
    
    // Garder seulement les 1000 dernières alertes
    if (this.alertHistory.length > 1000) {
      this.alertHistory = this.alertHistory.slice(-1000);
    }
    
    this.logger[risk.severity === 'CRITICAL' ? 'error' : 'warn']('Alerte risque envoyée', alert);
  }
  
  async updateHistoricalData(metrics) {
    // Mettre à jour les métriques de risque
    const riskKeys = [];
    
    // Pour chaque risque potentiel, enregistrer si détecté
    for (const [marketId, marketMetrics] of Object.entries(metrics.markets)) {
      // Open Interest
      const oiRiskKey = `OPEN_INTEREST_CAP_APPROACHING_${marketId}`;
      const oiDetected = marketMetrics.openInterestRatio >= config.OPEN_INTEREST_CAP_RATIO;
      this.updateRiskMetric(oiRiskKey, oiDetected, marketMetrics);
      riskKeys.push(oiRiskKey);
      
      // Skew
      const skewRiskKey = `EXTREME_SKEW_${marketId}`;
      const skewDetected = Math.abs(marketMetrics.skew) > config.SKEW_EXTREME_THRESHOLD;
      this.updateRiskMetric(skewRiskKey, skewDetected, marketMetrics);
      riskKeys.push(skewRiskKey);
      
      // Funding Rate
      const fundingRiskKey = `EXTREME_FUNDING_RATE_${marketId}`;
      const fundingDetected = Math.abs(marketMetrics.fundingRateBps) > config.FUNDING_EXTREME_BPS;
      this.updateRiskMetric(fundingRiskKey, fundingDetected, marketMetrics);
      riskKeys.push(fundingRiskKey);
    }
    
    // Nettoyer les anciennes métriques
    this.cleanupRiskMetrics(riskKeys);
    
    // Sauvegarder le snapshot du marché
    this.marketSnapshots.set(metrics.timestamp, metrics);
    
    // Garder seulement les 100 derniers snapshots
    if (this.marketSnapshots.size > 100) {
      const oldestKey = Math.min(...this.marketSnapshots.keys());
      this.marketSnapshots.delete(oldestKey);
    }
  }
  
  updateRiskMetric(key, detected, metrics) {
    const history = this.riskMetrics.get(key) || [];
    
    history.push({
      timestamp: Date.now(),
      detected,
      metrics,
    });
    
    // Garder seulement les 100 derniers échantillons
    if (history.length > 100) {
      history.shift();
    }
    
    this.riskMetrics.set(key, history);
  }
  
  cleanupRiskMetrics(currentKeys) {
    // Supprimer les métriques qui ne sont plus pertinentes
    for (const key of this.riskMetrics.keys()) {
      if (!currentKeys.includes(key)) {
        // Vérifier si la métrique est ancienne (> 24h)
        const history = this.riskMetrics.get(key);
        const latest = history[history.length - 1];
        
        if (latest && Date.now() - latest.timestamp > 86400000) {
          this.riskMetrics.delete(key);
        }
      }
    }
  }
  
  // Méthodes utilitaires pour les calculs de risque
  async calculatePositionConcentration(marketId) {
    try {
      const positions = await this.client.getMarketPositions(marketId, 100);
      
      if (positions.length === 0) {
        return null;
      }
      
      // Trier par taille décroissante
      positions.sort((a, b) => b.size - a.size);
      
      const totalSize = positions.reduce((sum, p) => sum + p.size, 0);
      
      // Calculer la concentration top 10
      const top10Size = positions.slice(0, 10).reduce((sum, p) => sum + p.size, 0);
      const top10Ratio = totalSize > 0 ? top10Size / totalSize : 0;
      
      // Calculer l'indice Herfindahl-Hirschman (HHI)
      let hhi = 0;
      for (const position of positions) {
        const share = position.size / totalSize;
        hhi += share * share;
      }
      
      return {
        totalPositions: positions.length,
        totalSize,
        top10Ratio,
        hhi,
        hhiInterpretation: this.interpretHHI(hhi),
      };
      
    } catch (error) {
      this.logger.error(`Erreur calcul concentration positions ${marketId}`, { error: error.message });
      return null;
    }
  }
  
  interpretHHI(hhi) {
    if (hhi > 0.25) return 'HIGHLY_CONCENTRATED';
    if (hhi > 0.15) return 'MODERATELY_CONCENTRATED';
    return 'UNCONCENTRATED';
  }
  
  async calculateMedianHealthFactor() {
    try {
      const positions = await this.client.getAtRiskPositionsSample(100);
      
      if (positions.length === 0) {
        return null;
      }
      
      const healthFactors = positions.map(p => p.healthFactor).filter(hf => hf > 0);
      
      if (healthFactors.length === 0) {
        return null;
      }
      
      // Calculer la médiane
      healthFactors.sort((a, b) => a - b);
      const mid = Math.floor(healthFactors.length / 2);
      
      return healthFactors.length % 2 === 0 ?
        (healthFactors[mid - 1] + healthFactors[mid]) / 2 :
        healthFactors[mid];
      
    } catch (error) {
      this.logger.error('Erreur calcul health factor médian', { error: error.message });
      return null;
    }
  }
  
  async calculateHealthFactorDistribution() {
    try {
      const positions = await this.client.getAtRiskPositionsSample(500);
      
      const distribution = {
        critical: 0,  // HF < 1.0
        high: 0,      // HF 1.0 - 1.5
        medium: 0,    // HF 1.5 - 2.0
        low: 0,       // HF > 2.0
        total: positions.length,
      };
      
      for (const position of positions) {
        if (position.healthFactor < 1.0) distribution.critical++;
        else if (position.healthFactor < 1.5) distribution.high++;
        else if (position.healthFactor < 2.0) distribution.medium++;
        else distribution.low++;
      }
      
      // Convertir en ratios
      if (positions.length > 0) {
        distribution.criticalRatio = distribution.critical / positions.length;
        distribution.highRatio = distribution.high / positions.length;
        distribution.mediumRatio = distribution.medium / positions.length;
        distribution.lowRatio = distribution.low / positions.length;
      }
      
      return distribution;
      
    } catch (error) {
      this.logger.error('Erreur calcul distribution health factor', { error: error.message });
      return null;
    }
  }
  
  async calculateTopTraderConcentration() {
    // Similaire à calculatePositionConcentration mais par trader
    // Implémentation simplifiée pour l'exemple
    return {
      top10Ratio: 0.3,
      hhi: 0.12,
      totalTraders: 150,
    };
  }
  
  async calculateTopLiquidatorConcentration() {
    // Implémentation simplifiée pour l'exemple
    return {
      top10Ratio: 0.4,
      hhi: 0.18,
      totalLiquidators: 25,
    };
  }
  
  async getPositionSizeDistribution() {
    // Implémentation simplifiée
    return {
      smallPositions: 120,    // < $10k
      mediumPositions: 45,    // $10k - $100k
      largePositions: 15,     // > $100k
      totalPositions: 180,
      largePositionsRatio: 15 / 180,
    };
  }
  
  async getAveragePositionAge() {
    // Implémentation simplifiée
    return 86400000 * 2; // 2 jours en ms
  }
  
  async getPnLDistribution() {
    // Implémentation simplifiée
    return {
      mean: 0.05,
      median: 0.02,
      stdDev: 0.15,
      skewness: -0.3,
      kurtosis: 2.1,
      profitable: 0.55,
      unprofitable: 0.45,
    };
  }
  
  generateAlertId(risk) {
    const data = JSON.stringify({
      type: risk.type,
      market: risk.market,
      severity: risk.severity,
      timestamp: Math.floor(Date.now() / config.AGGREGATION_WINDOW_MS),
    });
    
    return ethers.keccak256(ethers.toUtf8Bytes(data)).slice(0, 16);
  }
  
  async performHealthChecks() {
    this.logger.info('Exécution des health checks risque');
    
    try {
      // Vérifier la connexion aux contrats
      const riskManagerAddress = await this.client.getRiskManagerAddress();
      if (!ethers.isAddress(riskManagerAddress)) {
        throw new Error('Adresse RiskManager invalide');
      }
      
      // Vérifier qu'on peut récupérer des métriques
      const markets = await this.client.getMarkets();
      if (markets.length === 0) {
        throw new Error('Aucun marché accessible');
      }
      
      // Tester la collecte de métriques
      const testMetrics = await this.collectMarketMetrics(markets[0].id);
      if (testMetrics.error) {
        throw new Error(`Erreur collecte métriques: ${testMetrics.error}`);
      }
      
      this.logger.info('Health checks risque réussis');
      
    } catch (error) {
      this.logger.error('Health checks risque échoués', { error: error.message });
      process.exit(1);
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getStatus() {
    return {
      timestamp: Date.now(),
      activeMetrics: this.riskMetrics.size,
      marketSnapshots: this.marketSnapshots.size,
      alertHistory: this.alertHistory.length,
      lastAlerts: this.alertHistory.slice(-5),
    };
  }
}

// Point d'entrée
async function main() {
  const alerts = new RiskAlerts();
  
  // Gestion des signaux d'arrêt
  process.on('SIGINT', async () => {
    alerts.logger.info('Arrêt propre du système d\'alertes risque');
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
    alerts.logger.error('Système d\'alertes risque crashé', { error: error.message });
    process.exit(1);
  }
}

// Exécution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--test')) {
    // Mode test
    const alerts = new RiskAlerts();
    
    // Exécuter une surveillance unique
    alerts.monitorRisks().then(() => {
      console.log('Test terminé');
      console.log('Statut:', JSON.stringify(alerts.getStatus(), null, 2));
      process.exit(0);
    });
    
  } else if (args.includes('--status')) {
    // Afficher le statut
    const alerts = new RiskAlerts();
    console.log(JSON.stringify(alerts.getStatus(), null, 2));
    process.exit(0);
    
  } else {
    main();
  }
}

module.exports = RiskAlerts;