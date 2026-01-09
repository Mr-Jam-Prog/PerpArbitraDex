class Hysteresis {
    constructor(windowMs, threshold) {
      this.windowMs = windowMs;
      this.threshold = threshold;
      this.history = new Map();
    }
    
    check(key, value) {
      const now = Date.now();
      const history = this.history.get(key) || [];
      
      // Ajouter la valeur actuelle
      history.push({ timestamp: now, value });
      
      // Nettoyer l'historique ancien
      const cutoff = now - this.windowMs;
      const recent = history.filter(h => h.timestamp > cutoff);
      
      // Mettre à jour l'historique
      this.history.set(key, recent);
      
      // Vérifier le seuil
      if (recent.length < this.threshold) {
        return false; // Pas assez de données
      }
      
      // Vérifier si les dernières valeurs sont toutes true
      const lastValues = recent.slice(-this.threshold).map(h => h.value);
      return lastValues.every(v => v === true);
    }
    
    clear(key) {
      this.history.delete(key);
    }
    
    clearAll() {
      this.history.clear();
    }
  }
  
  module.exports = Hysteresis;