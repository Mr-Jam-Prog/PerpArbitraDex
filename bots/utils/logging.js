class Logger {
    constructor(module) {
      this.module = module;
    }
    
    info(message, data = {}) {
      this.log('INFO', message, data);
    }
    
    warn(message, data = {}) {
      this.log('WARN', message, data);
    }
    
    error(message, data = {}) {
      this.log('ERROR', message, data);
    }
    
    debug(message, data = {}) {
      if (process.env.DEBUG === 'true') {
        this.log('DEBUG', message, data);
      }
    }
    
    log(level, message, data) {
      const timestamp = new Date().toISOString();
      const logEntry = {
        timestamp,
        level,
        module: this.module,
        message,
        ...data,
      };
      
      console.log(JSON.stringify(logEntry));
      
      // Également écrire dans un fichier si nécessaire
      if (process.env.LOG_FILE) {
        const fs = require('fs');
        fs.appendFileSync(process.env.LOG_FILE, JSON.stringify(logEntry) + '\n');
      }
    }
  }
  
  class Metrics {
    constructor() {
      this.metrics = new Map();
    }
    
    update(values) {
      Object.entries(values).forEach(([key, value]) => {
        this.metrics.set(key, value);
      });
    }
    
    recordTrade(trade) {
      // Implémentation spécifique
    }
    
    recordLiquidation(liquidation) {
      // Implémentation spécifique
    }
    
    getMetrics() {
      return Object.fromEntries(this.metrics);
    }
  }
  
  module.exports = { Logger, Metrics };