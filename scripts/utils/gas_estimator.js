// @title: Estimation gas optimisée pour L2
// @optimization: Batch calls, gas price prediction
// @fallback: Network-specific strategies

const { ethers } = require("hardhat");
const { GAS_CONFIG } = require("./constants");

class GasEstimator {
  constructor() {
    this.provider = ethers.provider;
    this.history = [];
    this.maxHistory = 100;
  }
  
  async estimateTransaction(transaction) {
    try {
      // 1. Estimation de base
      const gasLimit = await this.provider.estimateGas(transaction);
      
      // 2. Multiplicateur de sécurité
      const safeGasLimit = Math.floor(gasLimit.toNumber() * GAS_CONFIG.GAS_LIMIT_MULTIPLIER);
      
      // 3. Prix du gas (optimisé pour L2)
      const feeData = await this.getOptimizedFeeData();
      
      // 4. Coût total estimé
      const estimatedCost = feeData.maxFeePerGas.mul(safeGasLimit);
      
      this.recordEstimation({
        gasLimit: safeGasLimit,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        estimatedCost
      });
      
      return {
        gasLimit: safeGasLimit,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
        estimatedCost: estimatedCost.toString()
      };
    } catch (error) {
      console.error("Gas estimation failed:", error.message);
      return this.getFallbackEstimation();
    }
  }
  
  async getOptimizedFeeData() {
    const network = await this.provider.getNetwork();
    
    // Stratégies spécifiques par réseau
    switch (network.chainId) {
      case 42161: // Arbitrum
        return await this.getArbitrumFeeData();
      case 8453: // Base
        return await this.getBaseFeeData();
      case 10: // Optimism
        return await this.getOptimismFeeData();
      default:
        return await this.getDefaultFeeData();
    }
  }
  
  async getArbitrumFeeData() {
    // Arbitrum utilise un modèle de prix du gas différent
    const gasPrice = await this.provider.getGasPrice();
    
    // Arbitrum recommande maxFeePerGas = gasPrice, maxPriorityFeePerGas = 0
    return {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: ethers.BigNumber.from(0)
    };
  }
  
  async getBaseFeeData() {
    // Base (Optimism Bedrock) - similaire à Ethereum
    const feeData = await this.provider.getFeeData();
    
    return {
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice || GAS_CONFIG.MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || GAS_CONFIG.MAX_PRIORITY_FEE_PER_GAS
    };
  }
  
  async getOptimismFeeData() {
    // Optimism - fees fixes + L1 security fee
    const gasPrice = await this.provider.getGasPrice();
    
    return {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: ethers.BigNumber.from(0)
    };
  }
  
  async getDefaultFeeData() {
    const feeData = await this.provider.getFeeData();
    
    return {
      maxFeePerGas: feeData.maxFeePerGas || GAS_CONFIG.MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || GAS_CONFIG.MAX_PRIORITY_FEE_PER_GAS
    };
  }
  
  getFallbackEstimation() {
    // Estimation de fallback sécuritaire
    return {
      gasLimit: 1000000, // 1M gas
      maxFeePerGas: GAS_CONFIG.MAX_FEE_PER_GAS,
      maxPriorityFeePerGas: GAS_CONFIG.MAX_PRIORITY_FEE_PER_GAS,
      estimatedCost: GAS_CONFIG.MAX_FEE_PER_GAS.mul(1000000).toString()
    };
  }
  
  recordEstimation(estimation) {
    this.history.push({
      ...estimation,
      timestamp: Date.now()
    });
    
    // Garder seulement les N dernières estimations
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }
  
  getEstimationStats() {
    if (this.history.length === 0) return null;
    
    const costs = this.history.map(h => parseFloat(ethers.utils.formatEther(h.estimatedCost)));
    
    return {
      averageCost: costs.reduce((a, b) => a + b, 0) / costs.length,
      minCost: Math.min(...costs),
      maxCost: Math.max(...costs),
      totalEstimations: this.history.length
    };
  }
  
  // Utilitaires pour batch transactions
  async estimateBatch(transactions) {
    const estimations = [];
    let totalCost = ethers.BigNumber.from(0);
    
    for (const tx of transactions) {
      const estimation = await this.estimateTransaction(tx);
      estimations.push(estimation);
      totalCost = totalCost.add(estimation.estimatedCost);
    }
    
    return {
      estimations,
      totalCost: totalCost.toString(),
      averageCost: totalCost.div(estimations.length).toString()
    };
  }
}

module.exports = GasEstimator;