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
    }
  }
  
  module.exports = Logger;