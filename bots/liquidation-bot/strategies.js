/**
 * Stratégies de liquidation modulaires pour PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Fournir différentes stratégies de liquidation
 * Interface: execute(), estimateProfit(), isEligible()
 */

const { ethers } = require('ethers');
const { Logger } = require('./utils/logging');

class LiquidationStrategy {
  constructor(name, client, config) {
    this.name = name;
    this.client = client;
    this.config = config;
    this.logger = new Logger(`strategy-${name}`);
  }
  
  async isEligible(position) {
    throw new Error('Method not implemented');
  }
  
  async estimateProfit(position) {
    throw new Error('Method not implemented');
  }
  
  async execute(position, options = {}) {
    throw new Error('Method not implemented');
  }
  
  async simulate(position) {
    try {
      // Simulation via static call
      const result = await this.client.simulateLiquidation(
        position.id,
        this.name,
        position.size
      );
      
      return {
        success: true,
        profit: result.profit,
        gasEstimate: result.gasEstimate,
        collateralRecovered: result.collateralRecovered,
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// ==================== STRATÉGIES CONCRÈTES ====================

class DirectLiquidationStrategy extends LiquidationStrategy {
  constructor(client, config) {
    super('directLiquidation', client, config);
  }
  
  async isEligible(position) {
    // Vérifier que la position est liquidable
    const healthFactor = await this.client.getHealthFactor(position.id);
    if (healthFactor >= this.config.HEALTH_FACTOR_THRESHOLD) {
      return false;
    }
    
    // Vérifier que le collateral est suffisant
    const collateral = await this.client.getCollateral(position.id);
    if (collateral <= 0) {
      return false;
    }
    
    return true;
  }
  
  async estimateProfit(position) {
    try {
      const simulation = await this.simulate(position);
      
      if (!simulation.success) {
        return 0;
      }
      
      // Calculer le profit net (frais - gas)
      const gasPrice = await this.client.getGasPrice();
      const gasCost = simulation.gasEstimate * gasPrice;
      
      const profit = Number(ethers.formatEther(
        simulation.profit - gasCost
      ));
      
      return Math.max(0, profit);
      
    } catch (error) {
      this.logger.debug('Erreur d\'estimation de profit', { error: error.message });
      return 0;
    }
  }
  
  async execute(position, options = {}) {
    this.logger.info('Exécution de liquidation directe', { positionId: position.id });
    
    return await this.client.liquidatePosition(
      position.id,
      {
        gasLimit: options.gasLimit || 500000,
        maxFeePerGas: options.maxFeePerGas,
        maxPriorityFeePerGas: options.maxPriorityFeePerGas,
      }
    );
  }
}

class FlashLoanLiquidationStrategy extends LiquidationStrategy {
  constructor(client, config) {
    super('flashLoanLiquidation', client, config);
    this.aaveAdapter = this.client.getAaveAdapter();
  }
  
  async isEligible(position) {
    // Vérifier les conditions de base
    if (!await super.isEligible(position)) {
      return false;
    }
    
    // Vérifier que flash loans sont activés
    if (!this.config.FLASH_LOAN_ENABLED) {
      return false;
    }
    
    // Vérifier que le montant est suffisant pour justifier un flash loan
    const collateral = await this.client.getCollateral(position.id);
    const minAmount = ethers.parseEther('100'); // Min $100 pour flash loan
    
    if (collateral < minAmount) {
      return false;
    }
    
    // Vérifier la disponibilité du flash loan
    const flashLoanAvailable = await this.aaveAdapter.isFlashLoanAvailable(
      position.collateralToken,
      collateral
    );
    
    return flashLoanAvailable;
  }
  
  async estimateProfit(position) {
    try {
      const simulation = await this.simulate(position);
      
      if (!simulation.success) {
        return 0;
      }
      
      // Inclure les frais de flash loan
      const flashLoanFee = await this.aaveAdapter.getFlashLoanFee(
        position.collateralToken,
        simulation.collateralRecovered
      );
      
      const gasPrice = await this.client.getGasPrice();
      const gasCost = simulation.gasEstimate * gasPrice;
      
      const totalCost = gasCost + flashLoanFee;
      const profit = Number(ethers.formatEther(
        simulation.profit - totalCost
      ));
      
      return Math.max(0, profit);
      
    } catch (error) {
      this.logger.debug('Erreur d\'estimation de profit (flash loan)', { error: error.message });
      return 0;
    }
  }
  
  async execute(position, options = {}) {
    this.logger.info('Exécution de liquidation avec flash loan', { positionId: position.id });
    
    // Préparer les paramètres du flash loan
    const tokens = [position.collateralToken];
    const amounts = [position.collateral];
    
    // Encoder les données pour la callback
    const callbackData = ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint256'],
      [position.user, position.id]
    );
    
    // Exécuter le flash loan
    return await this.aaveAdapter.flashLoan(
      tokens,
      amounts,
      callbackData,
      {
        gasLimit: options.gasLimit || 1000000, // Plus de gas pour flash loan
        maxFeePerGas: options.maxFeePerGas,
        maxPriorityFeePerGas: options.maxPriorityFeePerGas,
      }
    );
  }
}

class PartialLiquidationStrategy extends LiquidationStrategy {
  constructor(client, config) {
    super('partialLiquidation', client, config);
  }
  
  async isEligible(position) {
    // Vérifier que la position est éligible pour liquidation partielle
    const healthFactor = await this.client.getHealthFactor(position.id);
    
    // Liquidation partielle pour health factor légèrement sous le seuil
    if (healthFactor < 0.8 || healthFactor >= 1.0) {
      return false;
    }
    
    // Vérifier que la position est assez grande
    const size = await this.client.getPositionSize(position.id);
    const minSize = ethers.parseEther('1000'); // Min $1000 pour liquidation partielle
    
    if (size < minSize) {
      return false;
    }
    
    return true;
  }
  
  async estimateProfit(position) {
    try {
      // Calculer le montant à liquider partiellement
      const healthFactor = await this.client.getHealthFactor(position.id);
      const deficit = 1.0 - healthFactor;
      
      // Liquider seulement le nécessaire pour ramener HF > 1
      const size = await this.client.getPositionSize(position.id);
      const amountToLiquidate = size * deficit;
      
      // Simuler la liquidation partielle
      const simulation = await this.client.simulatePartialLiquidation(
        position.id,
        amountToLiquidate
      );
      
      if (!simulation.success) {
        return 0;
      }
      
      const gasPrice = await this.client.getGasPrice();
      const gasCost = simulation.gasEstimate * gasPrice;
      
      const profit = Number(ethers.formatEther(
        simulation.profit - gasCost
      ));
      
      return Math.max(0, profit);
      
    } catch (error) {
      this.logger.debug('Erreur d\'estimation de profit (partial)', { error: error.message });
      return 0;
    }
  }
  
  async execute(position, options = {}) {
    this.logger.info('Exécution de liquidation partielle', { positionId: position.id });
    
    // Calculer le montant à liquider
    const healthFactor = await this.client.getHealthFactor(position.id);
    const deficit = 1.0 - healthFactor;
    const size = await this.client.getPositionSize(position.id);
    const amountToLiquidate = size * deficit;
    
    // Exécuter la liquidation partielle
    return await this.client.liquidatePositionPartially(
      position.id,
      amountToLiquidate,
      {
        gasLimit: options.gasLimit || 600000,
        maxFeePerGas: options.maxFeePerGas,
        maxPriorityFeePerGas: options.maxPriorityFeePerGas,
      }
    );
  }
}

class MEVResistantLiquidationStrategy extends LiquidationStrategy {
  constructor(client, config) {
    super('mevResistantLiquidation', client, config);
    this.delayedExecutions = new Map();
  }
  
  async isEligible(position) {
    // Vérifier les conditions de base
    if (!await super.isEligible(position)) {
      return false;
    }
    
    // Vérifier que la position n'est pas déjà en cours de liquidation
    if (this.delayedExecutions.has(position.id)) {
      return false;
    }
    
    // Vérifier que le profit potentiel justifie la stratégie MEV-resistant
    const estimatedProfit = await this.estimateProfit(position);
    if (estimatedProfit < this.config.MIN_LIQ_PROFIT_USD * 2) {
      return false; // Nécessite plus de profit pour justifier le délai
    }
    
    return true;
  }
  
  async estimateProfit(position) {
    // Estimation basique - similaire à direct liquidation
    const directStrategy = new DirectLiquidationStrategy(this.client, this.config);
    return await directStrategy.estimateProfit(position);
  }
  
  async execute(position, options = {}) {
    this.logger.info('Planification de liquidation MEV-resistant', { positionId: position.id });
    
    // Calculer un délai aléatoire
    const delay = Math.floor(
      Math.random() * (this.config.MAX_DELAY_MS - this.config.MIN_DELAY_MS) + 
      this.config.MIN_DELAY_MS
    );
    
    // Planifier l'exécution
    const executionTime = Date.now() + delay;
    
    this.delayedExecutions.set(position.id, {
      position,
      executionTime,
      scheduled: false,
    });
    
    // Retourner une promesse pour l'exécution différée
    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          this.logger.info('Exécution différée de liquidation', { positionId: position.id });
          
          // Vérifier que la position est toujours liquidable
          const isEligible = await this.isEligible(position);
          if (!isEligible) {
            this.delayedExecutions.delete(position.id);
            reject(new Error('Position no longer eligible'));
            return;
          }
          
          // Exécuter avec la stratégie directe
          const directStrategy = new DirectLiquidationStrategy(this.client, this.config);
          const tx = await directStrategy.execute(position, options);
          
          this.delayedExecutions.delete(position.id);
          resolve(tx);
          
        } catch (error) {
          this.delayedExecutions.delete(position.id);
          reject(error);
        }
      }, delay);
    });
  }
}

// ==================== FACTORY ET EXPORTS ====================

class StrategyFactory {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.strategies = new Map();
    
    this.registerStrategies();
  }
  
  registerStrategies() {
    // Enregistrer toutes les stratégies disponibles
    this.strategies.set('direct', new DirectLiquidationStrategy(this.client, this.config));
    this.strategies.set('flashLoan', new FlashLoanLiquidationStrategy(this.client, this.config));
    this.strategies.set('partial', new PartialLiquidationStrategy(this.client, this.config));
    this.strategies.set('mevResistant', new MEVResistantLiquidationStrategy(this.client, this.config));
  }
  
  getStrategy(name) {
    return this.strategies.get(name);
  }
  
  getAllStrategies() {
    return Array.from(this.strategies.values());
  }
  
  async evaluateAll(position) {
    const evaluations = [];
    
    for (const strategy of this.strategies.values()) {
      try {
        const isEligible = await strategy.isEligible(position);
        
        if (isEligible) {
          const estimatedProfit = await strategy.estimateProfit(position);
          
          evaluations.push({
            strategy: strategy.name,
            isEligible: true,
            estimatedProfit,
            instance: strategy,
          });
        }
      } catch (error) {
        // Ignorer les erreurs d'évaluation
      }
    }
    
    // Trier par profit estimé (décroissant)
    return evaluations.sort((a, b) => b.estimatedProfit - a.estimatedProfit);
  }
}

// Exports
module.exports = {
  LiquidationStrategy,
  DirectLiquidationStrategy,
  FlashLoanLiquidationStrategy,
  PartialLiquidationStrategy,
  MEVResistantLiquidationStrategy,
  StrategyFactory,
  
  // Export par défaut pour rétro-compatibilité
  default: {
    directLiquidation: DirectLiquidationStrategy,
    flashLoanLiquidation: FlashLoanLiquidationStrategy,
    partialLiquidation: PartialLiquidationStrategy,
    mevResistantLiquidation: MEVResistantLiquidationStrategy,
  }
};