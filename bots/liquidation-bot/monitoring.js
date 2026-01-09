/**
 * Module de monitoring pour le bot de liquidation
 * Version: 1.0.0
 * Mission: Collecter et exporter les métriques de performance
 * Compatible: Prometheus, Grafana, JSON logs
 */

const { Logger } = require('./utils/logging');
const { MetricsCollector } = require('./utils/metrics-collector');
const { AlertManager } = require('./utils/alert-manager');

class LiquidationMonitor {
  constructor(botInstance) {
    this.bot = botInstance;
    this.logger = new Logger('liquidation-monitor');
    this.metrics = new MetricsCollector();
    this.alerts = new AlertManager();
    
    // Configuration des seuils d'alerte
    this.config = {
      // Métriques
      METRICS_INTERVAL_MS: 60000, // 1 minute
      METRICS_RETENTION_DAYS: 7,
      
      // Alertes
      ALERT_ORACLE_STALE_SEC: 180,
      ALERT_RPC_ERRORS_PER_MIN: 10,
      ALERT_PROFIT_DROP_PERCENT: 50,
      ALERT_LIQUIDATION_FAILURE_RATE: 0.3, // 30%
      
      // Export
      EXPORT_PROMETHEUS: true,
      EXPORT_JSON: true,
      EXPORT_FILE: '/var/log/liquidation-metrics.json',
    };
    
    this.stats = {
      startTime: Date.now(),
      liquidations: {
        total: 0,
        successful: 0,
        failed: 0,
        profits: [],
      },
      errors: {
        rpc: 0,
        oracle: 0,
        execution: 0,
      },
      performance: {
        avgGasUsed: 0,
        avgProfit: 0,
        scanLatency: 0,
      },
    };
  }
  
  start() {
    this.logger.info('Démarrage du monitoring');
    
    // Collecte périodique des métriques
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.config.METRICS_INTERVAL_MS);
    
    // Export des métriques
    if (this.config.EXPORT_PROMETHEUS) {
      this.startPrometheusExporter();
    }
    
    if (this.config.EXPORT_JSON) {
      this.startJsonExporter();
    }
  }
  
  stop() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    this.logger.info('Monitoring arrêté');
    this.exportFinalReport();
  }
  
  async collectMetrics() {
    try {
      const timestamp = Date.now();
      
      // Collecte des métriques système
      const systemMetrics = await this.collectSystemMetrics();
      
      // Collecte des métriques bot
      const botMetrics = this.collectBotMetrics();
      
      // Collecte des métriques réseau
      const networkMetrics = await this.collectNetworkMetrics();
      
      // Fusionner les métriques
      const metrics = {
        timestamp,
        system: systemMetrics,
        bot: botMetrics,
        network: networkMetrics,
      };
      
      // Enregistrer
      this.metrics.record(metrics);
      
      // Vérifier les alertes
      await this.checkAlerts(metrics);
      
      // Journaliser
      this.logger.debug('Métriques collectées', { metrics: this.summarize(metrics) });
      
    } catch (error) {
      this.logger.error('Erreur lors de la collecte des métriques', { error: error.message });
    }
  }
  
  async collectSystemMetrics() {
    const os = require('os');
    
    return {
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: process.memoryUsage().heapUsed,
      },
      cpu: {
        load: os.loadavg(),
        cores: os.cpus().length,
      },
      uptime: {
        system: os.uptime(),
        process: process.uptime(),
      },
    };
  }
  
  collectBotMetrics() {
    if (!this.bot) {
      return {};
    }
    
    return {
      liquidations: {
        total: this.bot.liquidationCount || 0,
        active: this.bot.activeLiquidations?.size || 0,
        queue: this.bot.queue?.size() || 0,
      },
      profits: {
        total: this.bot.profitTotal || 0,
        last24h: this.calculate24hProfit(),
      },
      errors: this.bot.metrics?.getErrors() || {},
      circuitBreaker: this.bot.circuitBreaker?.isOpen() || false,
    };
  }
  
  async collectNetworkMetrics() {
    try {
      const provider = this.bot?.provider;
      if (!provider) {
        return {};
      }
      
      const [blockNumber, gasPrice, network] = await Promise.all([
        provider.getBlockNumber(),
        provider.getFeeData(),
        provider.getNetwork(),
      ]);
      
      return {
        block: blockNumber,
        gas: {
          price: gasPrice.gasPrice?.toString(),
          maxFeePerGas: gasPrice.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas?.toString(),
        },
        chainId: network.chainId,
      };
      
    } catch (error) {
      this.stats.errors.rpc++;
      return { error: error.message };
    }
  }
  
  async checkAlerts(metrics) {
    const alerts = [];
    
    // Alerte: Oracle stale
    const oracleAge = await this.checkOracleAge();
    if (oracleAge > this.config.ALERT_ORACLE_STALE_SEC) {
      alerts.push({
        level: 'CRITICAL',
        type: 'ORACLE_STALE',
        message: `Oracle stale for ${oracleAge} seconds`,
        timestamp: Date.now(),
      });
    }
    
    // Alerte: Erreurs RPC élevées
    const rpcErrorRate = this.calculateRpcErrorRate();
    if (rpcErrorRate > this.config.ALERT_RPC_ERRORS_PER_MIN) {
      alerts.push({
        level: 'WARNING',
        type: 'RPC_ERROR_RATE',
        message: `High RPC error rate: ${rpcErrorRate} errors/min`,
        timestamp: Date.now(),
      });
    }
    
    // Alerte: Drop de profitabilité
    const profitDrop = this.calculateProfitDrop();
    if (profitDrop > this.config.ALERT_PROFIT_DROP_PERCENT) {
      alerts.push({
        level: 'WARNING',
        type: 'PROFIT_DROP',
        message: `Profit drop of ${profitDrop}%`,
        timestamp: Date.now(),
      });
    }
    
    // Alerte: Taux d'échec élevé
    const failureRate = this.calculateFailureRate();
    if (failureRate > this.config.ALERT_LIQUIDATION_FAILURE_RATE) {
      alerts.push({
        level: 'CRITICAL',
        type: 'HIGH_FAILURE_RATE',
        message: `High liquidation failure rate: ${(failureRate * 100).toFixed(1)}%`,
        timestamp: Date.now(),
      });
    }
    
    // Envoyer les alertes
    if (alerts.length > 0) {
      await this.sendAlerts(alerts);
    }
  }
  
  async checkOracleAge() {
    try {
      const markets = await this.bot.client.getMarkets();
      let maxAge = 0;
      
      for (const market of markets.slice(0, 3)) {
        const age = await this.bot.client.getOracleAge(market.id);
        maxAge = Math.max(maxAge, age);
      }
      
      return maxAge;
      
    } catch (error) {
      return Infinity;
    }
  }
  
  calculateRpcErrorRate() {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const recentErrors = this.metrics.getErrorsInWindow(now - windowMs);
    return recentErrors.rpc / (windowMs / 60000); // erreurs par minute
  }
  
  calculateProfitDrop() {
    const recentProfits = this.metrics.getProfitsInWindow(Date.now() - 3600000); // 1 heure
    if (recentProfits.length < 2) return 0;
    
    const avgRecent = recentProfits.reduce((a, b) => a + b, 0) / recentProfits.length;
    const avgHistorical = this.stats.liquidations.profits.length > 0 ?
      this.stats.liquidations.profits.reduce((a, b) => a + b, 0) / this.stats.liquidations.profits.length : 0;
    
    if (avgHistorical === 0) return 0;
    
    return ((avgHistorical - avgRecent) / avgHistorical) * 100;
  }
  
  calculateFailureRate() {
    const total = this.stats.liquidations.total;
    const failed = this.stats.liquidations.failed;
    
    if (total === 0) return 0;
    
    return failed / total;
  }
  
  calculate24hProfit() {
    const now = Date.now();
    const dayAgo = now - 86400000;
    
    const recentProfits = this.metrics.getProfitsInWindow(dayAgo);
    return recentProfits.reduce((a, b) => a + b, 0);
  }
  
  async sendAlerts(alerts) {
    for (const alert of alerts) {
      // Envoyer via l'AlertManager
      await this.alerts.send(alert);
      
      // Journaliser
      this.logger[alert.level === 'CRITICAL' ? 'error' : 'warn']('Alerte déclenchée', alert);
      
      // Mettre à jour les stats
      this.stats.alerts = this.stats.alerts || [];
      this.stats.alerts.push(alert);
    }
  }
  
  startPrometheusExporter() {
    const express = require('express');
    const app = express();
    const port = process.env.PROMETHEUS_PORT || 9090;
    
    app.get('/metrics', async (req, res) => {
      try {
        const metrics = await this.generatePrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(metrics);
      } catch (error) {
        res.status(500).send(error.message);
      }
    });
    
    this.prometheusServer = app.listen(port, () => {
      this.logger.info(`Export Prometheus démarré sur le port ${port}`);
    });
  }
  
  async generatePrometheusMetrics() {
    const metrics = this.metrics.getAll();
    const lines = [];
    
    // Métriques de base
    lines.push('# HELP liquidation_bot_liquidations_total Total number of liquidations');
    lines.push('# TYPE liquidation_bot_liquidations_total counter');
    lines.push(`liquidation_bot_liquidations_total ${this.stats.liquidations.total}`);
    
    lines.push('# HELP liquidation_bot_profit_total Total profit in USD');
    lines.push('# TYPE liquidation_bot_profit_total gauge');
    lines.push(`liquidation_bot_profit_total ${this.stats.liquidations.profits.reduce((a, b) => a + b, 0)}`);
    
    lines.push('# HELP liquidation_bot_errors_total Total number of errors');
    lines.push('# TYPE liquidation_bot_errors_total counter');
    lines.push(`liquidation_bot_errors_total ${Object.values(this.stats.errors).reduce((a, b) => a + b, 0)}`);
    
    // Métriques système
    const system = metrics.system?.[metrics.system.length - 1];
    if (system) {
      lines.push('# HELP system_memory_used_bytes Memory used by the process');
      lines.push('# TYPE system_memory_used_bytes gauge');
      lines.push(`system_memory_used_bytes ${system.memory.used}`);
    }
    
    return lines.join('\n');
  }
  
  startJsonExporter() {
    const fs = require('fs').promises;
    
    this.jsonExportInterval = setInterval(async () => {
      try {
        const metrics = this.metrics.getAll();
        const summary = {
          timestamp: Date.now(),
          summary: this.summarize(metrics[metrics.length - 1]),
          stats: this.stats,
        };
        
        await fs.writeFile(
          this.config.EXPORT_FILE,
          JSON.stringify(summary, null, 2)
        );
        
      } catch (error) {
        this.logger.error('Erreur lors de l\'export JSON', { error: error.message });
      }
    }, 300000); // Toutes les 5 minutes
  }
  
  summarize(metrics) {
    if (!metrics) return {};
    
    return {
      timestamp: metrics.timestamp,
      liquidations: {
        total: metrics.bot?.liquidations?.total || 0,
        active: metrics.bot?.liquidations?.active || 0,
      },
      profit: metrics.bot?.profits?.total || 0,
      system: {
        memoryUsage: metrics.system ? 
          ((metrics.system.memory.used / metrics.system.memory.total) * 100).toFixed(1) + '%' : 'N/A',
      },
      network: {
        block: metrics.network?.block || 'N/A',
        gasPrice: metrics.network?.gas?.price ? 
          Number(ethers.formatUnits(metrics.network.gas.price, 'gwei')).toFixed(0) + ' gwei' : 'N/A',
      },
    };
  }
  
  exportFinalReport() {
    const report = {
      generatedAt: new Date().toISOString(),
      uptime: Date.now() - this.stats.startTime,
      stats: this.stats,
      metricsSummary: this.metrics.getSummary(),
    };
    
    this.logger.info('Rapport final', { report });
    
    // Sauvegarder le rapport
    const fs = require('fs');
    fs.writeFileSync(
      `/var/log/liquidation-report-${Date.now()}.json`,
      JSON.stringify(report, null, 2)
    );
  }
  
  recordLiquidation(result) {
    this.stats.liquidations.total++;
    
    if (result.success) {
      this.stats.liquidations.successful++;
      this.stats.liquidations.profits.push(result.profit || 0);
      
      // Mettre à jour la moyenne
      if (this.stats.liquidations.profits.length > 0) {
        this.stats.performance.avgProfit = 
          this.stats.liquidations.profits.reduce((a, b) => a + b, 0) / 
          this.stats.liquidations.profits.length;
      }
      
    } else {
      this.stats.liquidations.failed++;
      this.stats.errors.execution++;
    }
  }
  
  recordError(type, error) {
    this.stats.errors[type] = (this.stats.errors[type] || 0) + 1;
    
    this.logger.error(`Erreur enregistrée: ${type}`, { 
      error: error.message,
      count: this.stats.errors[type],
    });
  }
  
  getStatus() {
    return {
      timestamp: Date.now(),
      status: this.bot?.circuitBreaker?.isOpen() ? 'PAUSED' : 'RUNNING',
      stats: this.stats,
      metrics: this.metrics.getLatest(),
    };
  }
}

// Export pour usage standalone
if (require.main === module) {
  // Mode CLI pour interroger le monitoring
  const monitor = new LiquidationMonitor();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'status':
      console.log(JSON.stringify(monitor.getStatus(), null, 2));
      break;
      
    case 'metrics':
      monitor.collectMetrics().then(() => {
        console.log('Métriques collectées');
        process.exit(0);
      });
      break;
      
    case 'alerts':
      monitor.checkAlerts({}).then(() => {
        console.log('Vérification des alertes terminée');
        process.exit(0);
      });
      break;
      
    default:
      console.log('Usage: node monitoring.js [status|metrics|alerts]');
      process.exit(1);
  }
}

module.exports = LiquidationMonitor;