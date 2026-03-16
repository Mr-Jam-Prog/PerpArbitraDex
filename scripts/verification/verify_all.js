// @title: Vérification automatique de tous les contrats sur l'explorer
// @features: Support multi-explorer (Etherscan, Arbiscan, Basescan)
// @batch: Vérification en parallèle avec gestion des erreurs
// @audit: Preuves de vérification sauvegardées

const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { AddressRegistry } = require("../utils/addresses");
const { NETWORKS } = require("../utils/constants");

class ContractVerifier {
  constructor(network) {
    this.network = network;
    this.registry = new AddressRegistry(network);
    this.verificationResults = [];
    this.failedVerifications = [];
    
    // Mapping réseau -> explorer API
    this.explorerConfig = {
      42161: { // Arbitrum Mainnet
        apiUrl: "https://api.arbiscan.io/api",
        apiKey: process.env.ARBISCAN_API_KEY,
        explorerUrl: "https://arbiscan.io/address"
      },
      421613: { // Arbitrum Goerli
        apiUrl: "https://api-goerli.arbiscan.io/api",
        apiKey: process.env.ARBISCAN_API_KEY,
        explorerUrl: "https://goerli.arbiscan.io/address"
      },
      8453: { // Base Mainnet
        apiUrl: "https://api.basescan.org/api",
        apiKey: process.env.BASESCAN_API_KEY,
        explorerUrl: "https://basescan.org/address"
      },
      84531: { // Base Goerli
        apiUrl: "https://api-goerli.basescan.org/api",
        apiKey: process.env.BASESCAN_API_KEY,
        explorerUrl: "https://goerli.basescan.org/address"
      },
      10: { // Optimism Mainnet
        apiUrl: "https://api-optimistic.etherscan.io/api",
        apiKey: process.env.OPTIMISM_API_KEY,
        explorerUrl: "https://optimistic.etherscan.io/address"
      },
      420: { // Optimism Goerli
        apiUrl: "https://api-goerli-optimistic.etherscan.io/api",
        apiKey: process.env.OPTIMISM_API_KEY,
        explorerUrl: "https://goerli-optimistic.etherscan.io/address"
      }
    };
  }

  async verifyAll() {
    console.log(`🔍 Début de la vérification sur ${this.network}`);
    
    const allAddresses = this.registry.getAllAddresses();
    const deployments = this.registry.getDeploymentHistory();
    
    let total = 0;
    let success = 0;
    let failed = 0;
    
    // 1. Vérification des implémentations (proxies UUPS)
    console.log("📋 Vérification des implémentations...");
    
    for (const [category, deploymentList] of Object.entries(deployments)) {
      for (const deployment of deploymentList) {
        for (const [contractName, address] of Object.entries(deployment)) {
          if (contractName === 'timestamp' || contractName === 'blockNumber' || contractName === 'deployedAt') {
            continue;
          }
          
          total++;
          
          try {
            console.log(`\n🔹 Vérification ${contractName} (${address})...`);
            
            const result = await this.verifyContract(contractName, address);
            
            if (result.success) {
              success++;
              this.verificationResults.push({
                contract: contractName,
                address,
                status: 'verified',
                explorerUrl: result.explorerUrl,
                timestamp: Date.now()
              });
              console.log(`✅ ${contractName} vérifié: ${result.explorerUrl}`);
            } else {
              failed++;
              this.failedVerifications.push({
                contract: contractName,
                address,
                error: result.error,
                timestamp: Date.now()
              });
              console.log(`❌ Échec vérification ${contractName}: ${result.error}`);
            }
            
            // Pause pour éviter le rate limiting
            await this.delay(2000);
            
          } catch (error) {
            failed++;
            console.error(`⚠️ Erreur lors de la vérification de ${contractName}:`, error.message);
          }
        }
      }
    }
    
    // 2. Vérification des proxies (si applicable)
    console.log("\n📋 Vérification des proxies...");
    await this.verifyProxies();
    
    // 3. Sauvegarde des résultats
    await this.saveVerificationResults();
    
    console.log(`\n🎯 Vérification terminée:`);
    console.log(`   ✅ Succès: ${success}`);
    console.log(`   ❌ Échecs: ${failed}`);
    console.log(`   📊 Total: ${total}`);
    
    if (this.failedVerifications.length > 0) {
      console.log("\n📋 Contrats en échec:");
      this.failedVerifications.forEach(f => {
        console.log(`   - ${f.contract}: ${f.error}`);
      });
    }
    
    return {
      total,
      success,
      failed,
      results: this.verificationResults,
      failures: this.failedVerifications
    };
  }

  async verifyContract(contractName, address) {
    try {
      let constructorArguments = [];
      let contractPath = "";
      
      // Déterminer les arguments de constructeur basés sur le nom du contrat
      const config = this.getContractVerificationConfig(contractName);
      
      if (config) {
        constructorArguments = config.constructorArgs || [];
        contractPath = config.contractPath || contractName;
      }
      
      console.log(`   Args: ${JSON.stringify(constructorArguments)}`);
      
      // Exécution de la vérification via Hardhat
      await run("verify:verify", {
        address: address,
        constructorArguments: constructorArguments,
        contract: contractPath
      });
      
      // Génération de l'URL d'explorer
      const networkId = await ethers.provider.getNetwork().then(n => n.chainId);
      const explorer = this.explorerConfig[networkId];
      const explorerUrl = `${explorer.explorerUrl}/${address}#code`;
      
      return {
        success: true,
        explorerUrl,
        contractName,
        address
      };
      
    } catch (error) {
      // Gestion des erreurs courantes
      let errorMessage = error.message;
      
      if (errorMessage.includes("Already Verified")) {
        errorMessage = "Déjà vérifié";
        const networkId = await ethers.provider.getNetwork().then(n => n.chainId);
        const explorer = this.explorerConfig[networkId];
        const explorerUrl = `${explorer.explorerUrl}/${address}#code`;
        
        return {
          success: true,
          explorerUrl,
          contractName,
          address,
          note: "Already verified"
        };
      }
      
      if (errorMessage.includes("Failed to send contract verification request")) {
        errorMessage = "Échec de l'envoi de la requête";
      }
      
      return {
        success: false,
        error: errorMessage,
        contractName,
        address
      };
    }
  }

  async verifyProxies() {
    console.log("🔗 Vérification des relations proxy/implémentation...");
    
    const allAddresses = this.registry.getAllAddresses();
    const proxyContracts = [
      'ProtocolConfig',
      'MarketRegistry',
      'PositionManager',
      'PerpEngine',
      'RiskManager',
      'OracleAggregator',
      'LiquidationEngine',
      'VotingEscrow',
      'Treasury'
    ];
    
    for (const contractName of proxyContracts) {
      const address = allAddresses[contractName];
      if (!address) continue;
      
      try {
        // Vérification via le plugin OpenZeppelin Upgrades
        await run("verify:verify", {
          address: address,
          constructorArguments: [],
          contract: "contracts/upgradeability/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy"
        });
        
        console.log(`✅ Proxy ${contractName} vérifié`);
        
        // Vérification de l'implémentation
        const implementation = await ethers.provider.send(
          "eth_getStorageAt",
          [address, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"]
        );
        
        const implAddress = "0x" + implementation.slice(26);
        
        this.verificationResults.push({
          contract: `${contractName} (Proxy)`,
          address,
          implementation: implAddress,
          status: 'verified',
          timestamp: Date.now()
        });
        
      } catch (error) {
        if (!error.message.includes("Already Verified")) {
          console.log(`⚠️ Proxy ${contractName} non vérifié: ${error.message}`);
        }
      }
      
      await this.delay(1000);
    }
  }

  getContractVerificationConfig(contractName) {
    // Configuration spécifique pour chaque contrat
    const configs = {
      'ProtocolConfig': {
        constructorArgs: [],
        contractPath: 'contracts/core/ProtocolConfig.sol:ProtocolConfig'
      },
      'MarketRegistry': {
        constructorArgs: [],
        contractPath: 'contracts/core/MarketRegistry.sol:MarketRegistry'
      },
      'PositionManager': {
        constructorArgs: ["PerpArbitraDEX Positions", "PERP-POS"],
        contractPath: 'contracts/core/PositionManager.sol:PositionManager'
      },
      'PerpEngine': {
        constructorArgs: [],
        contractPath: 'contracts/core/PerpEngine.sol:PerpEngine'
      },
      'RiskManager': {
        constructorArgs: [],
        contractPath: 'contracts/core/RiskManager.sol:RiskManager'
      },
      'OracleAggregator': {
        constructorArgs: [],
        contractPath: 'contracts/oracles/OracleAggregator.sol:OracleAggregator'
      },
      'OracleSanityChecker': {
        constructorArgs: [],
        contractPath: 'contracts/oracles/OracleSanityChecker.sol:OracleSanityChecker'
      },
      'ChainlinkOracle': {
        constructorArgs: [],
        contractPath: 'contracts/oracles/ChainlinkOracle.sol:ChainlinkOracle'
      },
      'LiquidationEngine': {
        constructorArgs: [],
        contractPath: 'contracts/liquidation/LiquidationEngine.sol:LiquidationEngine'
      },
      'LiquidationQueue': {
        constructorArgs: [],
        contractPath: 'contracts/liquidation/LiquidationQueue.sol:LiquidationQueue'
      },
      'IncentiveDistributor': {
        constructorArgs: [],
        contractPath: 'contracts/liquidation/IncentiveDistributor.sol:IncentiveDistributor'
      },
      'PerpDexToken': {
        constructorArgs: ["PerpArbitraDEX Token", "PERP", ethers.utils.parseUnits("1000000000", 18)],
        contractPath: 'contracts/governance/PerpDexToken.sol:PerpDexToken'
      },
      'TimelockController': {
        constructorArgs: [172800, [], [], ethers.constants.AddressZero],
        contractPath: '@openzeppelin/contracts/governance/TimelockController.sol:TimelockController'
      },
      'Governor': {
        constructorArgs: [],
        contractPath: 'contracts/governance/Governor.sol:Governor'
      },
      'VotingEscrow': {
        constructorArgs: [],
        contractPath: 'contracts/governance/VotingEscrow.sol:VotingEscrow'
      },
      'Treasury': {
        constructorArgs: [],
        contractPath: 'contracts/governance/Treasury.sol:Treasury'
      },
      'FeeDistributor': {
        constructorArgs: [],
        contractPath: 'contracts/governance/FeeDistributor.sol:FeeDistributor'
      },
      'EmergencyGuardian': {
        constructorArgs: [],
        contractPath: 'contracts/security/EmergencyGuardian.sol:EmergencyGuardian'
      }
    };
    
    return configs[contractName] || null;
  }

  async saveVerificationResults() {
    const resultsDir = path.join(__dirname, '../../verification-results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    const timestamp = Date.now();
    const resultsFile = path.join(resultsDir, `${this.network}-${timestamp}.json`);
    
    const report = {
      network: this.network,
      timestamp,
      totalVerified: this.verificationResults.length,
      totalFailed: this.failedVerifications.length,
      results: this.verificationResults,
      failures: this.failedVerifications,
      explorerConfig: this.explorerConfig
    };
    
    fs.writeFileSync(resultsFile, JSON.stringify(report, null, 2));
    
    // Sauvegarde également dans le registry
    this.registry.data.verifications = this.registry.data.verifications || [];
    this.registry.data.verifications.push({
      timestamp,
      resultsFile: path.basename(resultsFile),
      summary: {
        verified: this.verificationResults.length,
        failed: this.failedVerifications.length
      }
    });
    this.registry.save();
    
    console.log(`📄 Rapport de vérification sauvegardé: ${resultsFile}`);
    
    // Génération d'un rapport markdown
    await this.generateMarkdownReport(resultsFile);
    
    return resultsFile;
  }

  async generateMarkdownReport(resultsFile) {
    const markdownFile = resultsFile.replace('.json', '.md');
    
    let markdown = `# Rapport de Vérification - ${this.network}\n\n`;
    markdown += `**Date:** ${new Date().toISOString()}\n\n`;
    
    markdown += `## Résumé\n\n`;
    markdown += `- ✅ Contrats vérifiés: ${this.verificationResults.length}\n`;
    markdown += `- ❌ Contrats en échec: ${this.failedVerifications.length}\n\n`;
    
    markdown += `## Contrats Vérifiés\n\n`;
    markdown += `| Contrat | Adresse | Explorer |\n`;
    markdown += `|---------|---------|----------|\n`;
    
    for (const result of this.verificationResults) {
      const explorerLink = result.explorerUrl 
        ? `[🔗](${result.explorerUrl})`
        : 'N/A';
      markdown += `| ${result.contract} | \`${result.address}\` | ${explorerLink} |\n`;
    }
    
    if (this.failedVerifications.length > 0) {
      markdown += `\n## Échecs de Vérification\n\n`;
      markdown += `| Contrat | Adresse | Erreur |\n`;
      markdown += `|---------|---------|--------|\n`;
      
      for (const failure of this.failedVerifications) {
        markdown += `| ${failure.contract} | \`${failure.address}\` | ${failure.error} |\n`;
      }
    }
    
    // Configuration de l'explorer
    const networkId = await ethers.provider.getNetwork().then(n => n.chainId);
    const explorer = this.explorerConfig[networkId];
    
    markdown += `\n## Configuration\n\n`;
    markdown += `- **Réseau:** ${this.network} (Chain ID: ${networkId})\n`;
    markdown += `- **Explorer:** ${explorer.explorerUrl.replace('/address', '')}\n`;
    markdown += `- **API:** ${explorer.apiUrl}\n`;
    
    fs.writeFileSync(markdownFile, markdown);
    console.log(`📋 Rapport markdown généré: ${markdownFile}`);
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async verifySingle(contractName) {
    console.log(`🔍 Vérification de ${contractName} uniquement...`);
    
    const allAddresses = this.registry.getAllAddresses();
    const address = allAddresses[contractName];
    
    if (!address) {
      throw new Error(`Contrat ${contractName} non trouvé dans les déploiements`);
    }
    
    const result = await this.verifyContract(contractName, address);
    
    if (result.success) {
      console.log(`✅ ${contractName} vérifié avec succès`);
      console.log(`   🔗 ${result.explorerUrl}`);
    } else {
      console.log(`❌ Échec de la vérification: ${result.error}`);
    }
    
    return result;
  }

  async checkVerificationStatus(address) {
    const networkId = await ethers.provider.getNetwork().then(n => n.chainId);
    const explorer = this.explorerConfig[networkId];
    
    if (!explorer || !explorer.apiKey) {
      throw new Error("Configuration explorer manquante");
    }
    
    const url = `${explorer.apiUrl}?module=contract&action=getsourcecode&address=${address}&apikey=${explorer.apiKey}`;
    
    try {
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status === "1" && data.result[0].SourceCode) {
        return {
          verified: true,
          contractName: data.result[0].ContractName,
          compilerVersion: data.result[0].CompilerVersion,
          optimizationUsed: data.result[0].OptimizationUsed,
          runs: data.result[0].Runs,
          constructorArguments: data.result[0].ConstructorArguments
        };
      } else {
        return {
          verified: false,
          message: data.result[0].ABI === "Contract source code not verified"
        };
      }
    } catch (error) {
      throw new Error(`Erreur lors de la vérification du statut: ${error.message}`);
    }
  }

  async batchVerify(contractNames) {
    console.log(`🔍 Vérification par batch de ${contractNames.length} contrats...`);
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const contractName of contractNames) {
      try {
        const result = await this.verifySingle(contractName);
        if (result.success) {
          results.success.push(contractName);
        } else {
          results.failed.push({
            contract: contractName,
            error: result.error
          });
        }
        
        // Pause entre les vérifications
        await this.delay(1500);
        
      } catch (error) {
        results.failed.push({
          contract: contractName,
          error: error.message
        });
      }
    }
    
    console.log(`\n🎯 Batch vérification terminée:`);
    console.log(`   ✅ Succès: ${results.success.length}`);
    console.log(`   ❌ Échecs: ${results.failed.length}`);
    
    return results;
  }
}

// Fonction principale
async function main() {
  const args = process.argv.slice(2);
  const network = hre.network.name;
  
  const verifier = new ContractVerifier(network);
  
  // Options de ligne de commande
  const contractName = args.find(arg => arg.startsWith('--contract='))?.split('=')[1];
  const batch = args.find(arg => arg.startsWith('--batch='))?.split('=')[1];
  const check = args.find(arg => arg === '--check');
  const address = args.find(arg => arg.startsWith('--address='))?.split('=')[1];
  
  if (contractName) {
    // Vérification d'un seul contrat
    await verifier.verifySingle(contractName);
    
  } else if (batch) {
    // Vérification par batch
    const contracts = batch.split(',');
    await verifier.batchVerify(contracts);
    
  } else if (check && address) {
    // Vérification du statut
    const status = await verifier.checkVerificationStatus(address);
    console.log('Statut de vérification:', status);
    
  } else if (check) {
    // Vérification du statut de tous les contrats
    const allAddresses = verifier.registry.getAllAddresses();
    console.log('Statut de vérification de tous les contrats:');
    
    for (const [name, addr] of Object.entries(allAddresses)) {
      try {
        const status = await verifier.checkVerificationStatus(addr);
        console.log(`${name}: ${status.verified ? '✅ Vérifié' : '❌ Non vérifié'}`);
        await verifier.delay(500);
      } catch (error) {
        console.log(`${name}: ❌ Erreur: ${error.message}`);
      }
    }
    
  } else {
    // Vérification complète
    await verifier.verifyAll();
  }
}

// Exécution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('❌ Erreur lors de la vérification:', error);
      process.exit(1);
    });
}

module.exports = ContractVerifier;