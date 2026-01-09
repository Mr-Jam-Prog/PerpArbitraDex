class CircuitBreaker {
    constructor() {
      this.open = false;
      this.lastTrigger = 0;
      this.cooldown = 60000; // 1 minute
    }
    
    trigger() {
      this.open = true;
      this.lastTrigger = Date.now();
      
      // Auto-reset après cooldown
      setTimeout(() => {
        this.open = false;
      }, this.cooldown);
    }
    
    isOpen() {
      // Vérifier si le circuit breaker est encore ouvert
      if (this.open && Date.now() - this.lastTrigger > this.cooldown) {
        this.open = false;
      }
      return this.open;
    }
    
    reset() {
      this.open = false;
      this.lastTrigger = 0;
    }
  }
  
  module.exports = CircuitBreaker;