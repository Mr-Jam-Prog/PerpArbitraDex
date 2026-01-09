// @title: Registry dynamique des adresses déployées
// @persistence: JSON file avec versioning
// @network: Multi-network support

const fs = require('fs');
const path = require('path');

class AddressRegistry {
  constructor(network) {
    this.network = network;
    this.filePath = path.join(__dirname, `../../deployments/${network}.json`);
    this.load();
  }
  
  load() {
    if (fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } else {
      this.data = {
        network: this.network,
        deployments: {},
        configurations: {},
        upgrades: [],
        timestamp: Date.now()
      };
    }
  }
  
  save() {
    this.data.timestamp = Date.now();
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
  
  addDeployment(category, addresses) {
    if (!this.data.deployments[category]) {
      this.data.deployments[category] = [];
    }
    
    this.data.deployments[category].push({
      ...addresses,
      deployedAt: Date.now(),
      blockNumber: ethers.provider.blockNumber
    });
    
    this.save();
  }
  
  getDeployment(category) {
    const deployments = this.data.deployments[category];
    if (!deployments || deployments.length === 0) {
      return null;
    }
    
    // Retourne le dernier déploiement
    return deployments[deployments.length - 1];
  }
  
  getContractAddress(name) {
    // Recherche dans toutes les catégories
    for (const category in this.data.deployments) {
      const deployment = this.getDeployment(category);
      if (deployment && deployment[name]) {
        return deployment[name];
      }
    }
    return null;
  }
  
  addUpgrade(upgradeData) {
    this.data.upgrades.push({
      ...upgradeData,
      timestamp: Date.now()
    });
    this.save();
  }
  
  getUpgrade(proposalId) {
    return this.data.upgrades.find(u => u.id === proposalId);
  }
  
  updateUpgradeStatus(proposalId, status) {
    const upgrade = this.getUpgrade(proposalId);
    if (upgrade) {
      upgrade.status = status;
      upgrade.updatedAt = Date.now();
      this.save();
    }
  }
  
  // Méthodes utilitaires
  getAllAddresses() {
    const addresses = {};
    for (const category in this.data.deployments) {
      const deployment = this.getDeployment(category);
      Object.assign(addresses, deployment);
    }
    return addresses;
  }
  
  getDeploymentHistory() {
    return this.data.deployments;
  }
  
  // Export pour d'autres scripts
  exportForFrontend() {
    return {
      addresses: this.getAllAddresses(),
      network: this.network,
      timestamp: this.data.timestamp
    };
  }
}

module.exports = AddressRegistry;