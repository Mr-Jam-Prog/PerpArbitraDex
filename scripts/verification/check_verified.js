// @title: Vérification du statut de vérification des contrats
// @features: Vérification batch, génération de rapport, monitoring

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { AddressRegistry } = require("../utils/addresses");

class VerificationStatusChecker {
  constructor(network) {
    this.network = network;
    this.registry = new AddressRegistry(network);
    
    // Configuration des APIs d'explorer
    this.apis = {
      42161: { // Arbitrum
        url: "https://api.arbiscan.io/api",
        key: process.env.ARBISCAN_API_KEY
      },
      8453: { // Base
        url: "https://api.basescan.org/api",
        key: process.env.BASESCAN_API_KEY
      },
      10: { // Optimism
        url: "https://api-optimistic.etherscan.io/api",
        key: process.env.OPTIMISM_API_KEY
      }
    };
  }
  
  async checkAll() {
    console.log(`🔍 Vérification du statut des contrats sur ${this.network}`);
    
    const allAddresses = this.registry.getAllAddresses();
    const results = [];
    
    const contractEntries = Object.entries(allAddresses);
    console.log(`📋 ${contractEntries.length} contrats à vérifier`);
    
    for (const [name, address] of contractEntries) {
      if (name === 'timestamp' || name === 'network') continue;
      
      try {
        console.log(`   ${name}...`);
        const status = await this.checkContract(address);
        
        results.push({
          contract: name,
          address,
          ...status
        });
        
        // Pause pour éviter le rate limiting
        await this.delay(1000);
        
      } catch (error) {
        console.error(`   ❌ Erreur pour ${name}: ${error.message}`);
        results.push({
          contract: name,
          address,
          error: error.message,
          verified: false
        });
      }
    }
    
    // Génération du rapport
    await this.generateReport(results);
    
    return results;
  }
  
  async checkContract(address) {
    const networkId = await this.getNetworkId();
    const apiConfig = this.apis[networkId];
    
    if (!apiConfig || !apiConfig.key) {
      throw new Error(`Configuration API manquante pour le réseau ${networkId}`);
    }
    
    const params = {
      module: 'contract',
      action: 'getsourcecode',
      address: address,
      apikey: apiConfig.key
    };
    
    const response = await axios.get(apiConfig.url, { params });
    
    if (response.data.status !== '1') {
      throw new Error(`API error: ${response.data.message}`);
    }
    
    const result = response.data.result[0];
    
    const isVerified = result.SourceCode !== '';
    
    return {
      verified: isVerified,
      contractName: result.ContractName || 'Unknown',
      compilerVersion: result.CompilerVersion,
      optimizationUsed: result.OptimizationUsed === '1',
      optimizationRuns: result.Runs || '0',
      constructorArguments: result.ConstructorArguments,
      abi: result.ABI,
      proxy: result.Proxy === '1',
      implementation: result.Implementation || null
    };
  }
  
  async generateReport(results) {
    const timestamp = Date.now();
    const reportDir = path.join(__dirname, '../../verification-status');
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const verified = results.filter(r => r.verified && !r.error);
    const unverified = results.filter(r => !r.verified && !r.error);
    const errors = results.filter(r => r.error);
    
    // Rapport JSON
    const jsonReport = {
      network: this.network,
      timestamp,
      summary: {
        total: results.length,
        verified: verified.length,
        unverified: unverified.length,
        errors: errors.length
      },
      details: results
    };
    
    const jsonFile = path.join(reportDir, `status-${this.network}-${timestamp}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify(jsonReport, null, 2));
    
    // Rapport Markdown
    const mdFile = path.join(reportDir, `status-${this.network}-${timestamp}.md`);
    let markdown = `# Statut de Vérification - ${this.network}\n\n`;
    markdown += `**Date:** ${new Date(timestamp).toISOString()}\n\n`;
    
    markdown += `## Résumé\n\n`;
    markdown += `- **Total contrats:** ${results.length}\n`;
    markdown += `- **✅ Vérifiés:** ${verified.length}\n`;
    markdown += `- **❌ Non vérifiés:** ${unverified.length}\n`;
    markdown += `- **⚠️ Erreurs:** ${errors.length}\n\n`;
    
    markdown += `## Contrats Vérifiés\n\n`;
    if (verified.length > 0) {
      markdown += `| Contrat | Adresse | Compilateur | Optimisé |\n`;
      markdown += `|---------|---------|-------------|----------|\n`;
      verified.forEach(r => {
        markdown += `| ${r.contract} | \`${r.address}\` | ${r.compilerVersion} | ${r.optimizationUsed ? '✅' : '❌'} |\n`;
      });
    } else {
      markdown += `Aucun contrat vérifié\n\n`;
    }
    
    if (unverified.length > 0) {
      markdown += `\n## Contrats Non Vérifiés\n\n`;
      markdown += `| Contrat | Adresse |\n`;
      markdown += `|---------|---------|\n`;
      unverified.forEach(r => {
        markdown += `| ${r.contract} | \`${r.address}\` |\n`;
      });
    }
    
    if (errors.length > 0) {
      markdown += `\n## Erreurs\n\n`;
      markdown += `| Contrat | Adresse | Erreur |\n`;
      markdown += `|---------|---------|--------|\n`;
      errors.forEach(r => {
        markdown += `| ${r.contract} | \`${r.address}\` | ${r.error} |\n`;
      });
    }
    
    // Recommandations
    markdown += `\n## Recommandations\n\n`;
    
    if (unverified.length > 0) {
      markdown += `### Contrats à vérifier:\n\n`;
      unverified.forEach(r => {
        markdown += `- ${r.contract} (\`${r.address}\`)\n`;
      });
      markdown += `\nUtilisez la commande: \`npx hardhat run scripts/verification/verify_contract.js --network ${this.network} --contract=<NOM>\`\n`;
    }
    
    fs.writeFileSync(mdFile, markdown);
    
    console.log(`\n📊 Rapport généré:`);
    console.log(`   ✅ Vérifiés: ${verified.length}`);
    console.log(`   ❌ Non vérifiés: ${unverified.length}`);
    console.log(`   📄 JSON: ${jsonFile}`);
    console.log(`   📄 Markdown: ${mdFile}`);
    
    return { jsonFile, mdFile };
  }
  
  async getNetworkId() {
    // Implémentation simplifiée - en réalité, utilisez le provider
    const networkMap = {
      'arbitrum': 42161,
      'arbitrum-testnet': 421613,
      'base': 8453,
      'base-testnet': 84531,
      'optimism': 10,
      'optimism-testnet': 420
    };
    
    return networkMap[this.network] || 1;
  }
  
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Interface CLI
async function main() {
  const network = hre.network.name;
  const checker = new VerificationStatusChecker(network);
  
  await checker.checkAll();
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = VerificationStatusChecker;