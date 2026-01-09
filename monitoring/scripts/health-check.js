#!/usr/bin/env node

/**
 * Health-check global du protocole PerpArbitraDEX
 * Version: 1.0.0
 * Mission: Vérifier la santé de tous les composants du protocole
 * Compatible: cron, CI/CD, monitoring
 */

const { ethers } = require('ethers');
const { PerpDexClient } = require('@perpdex/sdk');
const { Logger } = require('../utils/logging');

// Configuration
const config = {
  // Composants à vérifier
  CHECKS: {
    RPC: true,
    ORACLES: true,
    SUBGRAPH: true,
    BOTS: true,
    CONTRACTS: true,
    GOVERNANCE: true,
  },
  
  // Seuils
  ORACLE_MAX_AGE_SEC: 120,
  ORACLE_MAX_DEVIATION_BPS: 200,
  SUBGRAPH_MAX_BEHIND_BLOCKS: 100,
  BOT_MAX_INACTIVE_SEC: 300,
  
  // RPC
  RPC_URLS: process.env.RPC_URLS ? process.env.RPC_URLS.split(',') : [],
  SUBGRAPH_URL: process.env.SUBGRAPH_URL,
  
  // Bots
  BOT_STATUS_URLS: process.env.BOT_STATUS_URLS ? process.env.BOT_STATUS_URLS.split(',') : [],
  
  // Sortie
  EXIT_ON_CRITICAL: process.env.EXIT_ON_CRITICAL === 'true' || false,
  JSON_OUTPUT: process.env.JSON_OUTPUT === 'true' || false,
  VERBOSE: process.env.VERBOSE === 'true' || false,
};

class ProtocolHealthCheck {
  constructor() {
    this.logger = new Logger('health-check');
    this.client = null;
    
    // Résultats des checks
    this.results = {
      timestamp: Date.now(),
      status: 'UNKNOWN',
      checks: {},
      criticalIssues: [],
      warnings: [],
      duration: 0,
    };
    
    this.startTime = Date.now();
  }
  
  async run() {
    this.logger.info('Démarrage du health-check du protocole');
    
    try {
      // Initialiser le client
      await this.initializeClient();
      
      // Exécuter les checks
      await this.executeChecks();
      
      // Déterminer le statut global
      this.determineOverallStatus();
      
      // Calculer la durée
      this.results.duration = Date.now() - this.startTime;
      
      // Afficher les résultats
      this.reportResults();
      
      // Quitter avec le code approprié
      this.exitWithCode();
      
    } catch (error) {
      this.logger.error('Erreur fatale du health-check', { error: error.message });
      this.results.error = error.message;
      this.results.status = 'ERROR';
      this.reportResults();
      process.exit(2);
    }
  }
  
  async initializeClient() {
    if (config.RPC_URLS.length === 0) {
      throw new Error('Aucune URL RPC configurée');
    }
    
    // Créer un provider avec fallback
    const providers = config.RPC_URLS.map(url => 
      new ethers.JsonRpcProvider(url)
    );
    
    const provider = new ethers.FallbackProvider(providers, 1, {
      timeout: 10000,
      quorum: 1,
    });
    
    this.client = new PerpDexClient(provider);
    
    // Tester la connexion
    const block = await provider.getBlockNumber();
    if (!block || block === 0) {
      throw new Error('Impossible de se connecter à la blockchain');
    }
    
    this.logger.info('Client initialisé', { block });
  }
  
  async executeChecks() {
    const checks = [];
    
    // RPC
    if (config.CHECKS.RPC) {
      checks.push(this.checkRpc());
    }
    
    // Oracles
    if (config.CHECKS.ORACLES) {
      checks.push(this.checkOracles());
    }
    
    // Subgraph
    if (config.CHECKS.SUBGRAPH && config.SUBGRAPH_URL) {
      checks.push(this.checkSubgraph());
    }
    
    // Bots
    if (config.CHECKS.BOTS && config.BOT_STATUS_URLS.length > 0) {
      checks.push(this.checkBots());
    }
    
    // Contrats
    if (config.CHECKS.CONTRACTS) {
      checks.push(this.checkContracts());
    }
    
    // Gouvernance
    if (config.CHECKS.GOVERNANCE) {
      checks.push(this.checkGovernance());
    }
    
    // Exécuter les checks en parallèle
    const results = await Promise.allSettled(checks);
    
    // Traiter les résultats
    for (const result of results) {
      if (result.status === 'fulfilled') {
        this.results.checks[result.value.name] = result.value;
      } else {
        this.logger.error('Check échoué', { error: result.reason?.message });
        this.results.checks[result.reason?.name || 'unknown'] = {
          status: 'ERROR',
          error: result.reason?.message,
        };
      }
    }
  }
  
  async checkRpc() {
    const check = {
      name: 'rpc',
      status: 'UNKNOWN',
      details: {},
    };
    
    try {
      // Tester chaque endpoint RPC
      const endpoints = [];
      
      for (const url of config.RPC_URLS) {
        try {
          const provider = new ethers.JsonRpcProvider(url);
          const start = Date.now();
          const block = await provider.getBlockNumber();
          const latency = Date.now() - start;
          
          endpoints.push({
            url: this.maskUrl(url),
            status: block ? 'OK' : 'ERROR',
            block: block || 0,
            latency,
          });
          
        } catch (error) {
          endpoints.push({
            url: this.maskUrl(url),
            status: 'ERROR',
            error: error.message,
          });
        }
      }
      
      // Déterminer le statut
      const healthyEndpoints = endpoints.filter(e => e.status === 'OK');
      
      if (healthyEndpoints.length === 0) {
        check.status = 'CRITICAL';
        this.results.criticalIssues.push('Tous les endpoints RPC sont indisponibles');
      } else if (healthyEndpoints.length < config.RPC_URLS.length) {
        check.status = 'WARNING';
        this.results.warnings.push(`${config.RPC_URLS.length - healthyEndpoints.length} endpoint(s) RPC indisponible(s)`);
      } else {
        check.status = 'OK';
      }
      
      check.details = { endpoints };
      
    } catch (error) {
      check.status = 'ERROR';
      check.error = error.message;
      this.results.criticalIssues.push(`Check RPC échoué: ${error.message}`);
    }
    
    return check;
  }
  
  async checkOracles() {
    const check = {
      name: 'oracles',
      status: 'UNKNOWN',
      details: {
        markets: [],
        issues: [],
      },
    };
    
    try {
      // Récupérer tous les marchés
      const markets = await this.client.getMarkets();
      
      if (markets.length === 0) {
        check.status = 'WARNING';
        check.details.issues.push('Aucun marché trouvé');
        this.results.warnings.push('Aucun marché disponible');
        return check;
      }
      
      let criticalCount = 0;
      let warningCount = 0;
      
      // Vérifier chaque marché
      for (const market of markets) {
        const marketCheck = {
          marketId: market.id,
          status: 'UNKNOWN',
          issues: [],
        };
        
        try {
          // Vérifier l'âge de l'oracle
          const age = await this.client.getOracleAge(market.id);
          marketCheck.oracleAge = age;
          
          if (age > config.ORACLE_MAX_AGE_SEC) {
            marketCheck.status = 'CRITICAL';
            marketCheck.issues.push(`Oracle stale: ${age}s (max: ${config.ORACLE_MAX_AGE_SEC}s)`);
            criticalCount++;
          } else if (age > config.ORACLE_MAX_AGE_SEC * 0.8) {
            marketCheck.status = 'WARNING';
            marketCheck.issues.push(`Oracle vieillissant: ${age}s`);
            warningCount++;
          }
          
          // Vérifier la déviation
          const deviation = await this.client.getOracleDeviation(market.id);
          marketCheck.oracleDeviation = deviation;
          
          if (deviation > config.ORACLE_MAX_DEVIATION_BPS) {
            marketCheck.status = 'CRITICAL';
            marketCheck.issues.push(`Déviation élevée: ${deviation}bps (max: ${config.ORACLE_MAX_DEVIATION_BPS}bps)`);
            criticalCount++;
          } else if (deviation > config.ORACLE_MAX_DEVIATION_BPS * 0.7) {
            marketCheck.status = 'WARNING';
            marketCheck.issues.push(`Déviation modérée: ${deviation}bps`);
            warningCount++;
          }
          
          // Vérifier les sources
          const sources = await this.client.getOracleSources(market.id);
          marketCheck.sources = sources;
          
          const unavailableSources = sources.filter(s => !s.available);
          if (unavailableSources.length > 0) {
            if (unavailableSources.some(s => s.name === 'chainlink')) {
              marketCheck.status = marketCheck.status === 'UNKNOWN' ? 'WARNING' : marketCheck.status;
              marketCheck.issues.push(`${unavailableSources.length} source(s) indisponible(s)`);
              warningCount++;
            }
          }
          
          if (marketCheck.status === 'UNKNOWN') {
            marketCheck.status = 'OK';
          }
          
        } catch (error) {
          marketCheck.status = 'ERROR';
          marketCheck.error = error.message;
          marketCheck.issues.push(`Erreur vérification: ${error.message}`);
          criticalCount++;
        }
        
        check.details.markets.push(marketCheck);
      }
      
      // Déterminer le statut global
      if (criticalCount > 0) {
        check.status = 'CRITICAL';
        this.results.criticalIssues.push(`${criticalCount} marché(s) avec oracle critique`);
      } else if (warningCount > 0) {
        check.status = 'WARNING';
        this.results.warnings.push(`${warningCount} marché(s) avec oracle en warning`);
      } else {
        check.status = 'OK';
      }
      
    } catch (error) {
      check.status = 'ERROR';
      check.error = error.message;
      this.results.criticalIssues.push(`Check oracles échoué: ${error.message}`);
    }
    
    return check;
  }
  
  async checkSubgraph() {
    const check = {
      name: 'subgraph',
      status: 'UNKNOWN',
      details: {},
    };
    
    try {
      // Vérifier que le subgraph est synchro
      const query = `
        query {
          _meta {
            block {
              number
            }
            hasIndexingErrors
          }
        }
      `;
      
      const response = await fetch(config.SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (!data.data?._meta) {
        throw new Error('Réponse du subgraph invalide');
      }
      
      const meta = data.data._meta;
      const subgraphBlock = meta.block.number;
      
      // Récupérer le bloc actuel de la blockchain
      const currentBlock = await this.client.getBlockNumber();
      const blocksBehind = currentBlock - subgraphBlock;
      
      check.details = {
        subgraphBlock,
        currentBlock,
        blocksBehind,
        hasIndexingErrors: meta.hasIndexingErrors,
      };
      
      // Déterminer le statut
      if (meta.hasIndexingErrors) {
        check.status = 'CRITICAL';
        this.results.criticalIssues.push('Subgraph avec erreurs d\'indexation');
      } else if (blocksBehind > config.SUBGRAPH_MAX_BEHIND_BLOCKS) {
        check.status = 'WARNING';
        this.results.warnings.push(`Subgraph derrière de ${blocksBehind} blocs`);
      } else {
        check.status = 'OK';
      }
      
    } catch (error) {
      check.status = 'ERROR';
      check.error = error.message;
      this.results.warnings.push(`Check subgraph échoué: ${error.message}`);
    }
    
    return check;
  }
  
  async checkBots() {
    const check = {
      name: 'bots',
      status: 'UNKNOWN',
      details: {
        bots: [],
      },
    };
    
    try {
      let inactiveCount = 0;
      
      // Vérifier chaque bot
      for (const url of config.BOT_STATUS_URLS) {
        const botCheck = {
          url: this.maskUrl(url),
          status: 'UNKNOWN',
        };
        
        try {
          const response = await fetch(url, { timeout: 5000 });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          
          const data = await response.json();
          
          // Vérifier le statut du bot
          const lastActive = data.lastActive || data.timestamp || 0;
          const inactiveTime = Date.now() - lastActive;
          
          botCheck.lastActive = lastActive;
          botCheck.inactiveSeconds = Math.floor(inactiveTime / 1000);
          botCheck.data = data;
          
          if (inactiveTime > config.BOT_MAX_INACTIVE_SEC * 1000) {
            botCheck.status = 'WARNING';
            inactiveCount++;
            this.results.warnings.push(`Bot inactif: ${this.maskUrl(url)} (${botCheck.inactiveSeconds}s)`);
          } else {
            botCheck.status = 'OK';
          }
          
        } catch (error) {
          botCheck.status = 'ERROR';
          botCheck.error = error.message;
          inactiveCount++;
          this.results.warnings.push(`Bot inaccessible: ${this.maskUrl(url)} (${error.message})`);
        }
        
        check.details.bots.push(botCheck);
      }
      
      // Déterminer le statut global
      if (inactiveCount === config.BOT_STATUS_URLS.length) {
        check.status = 'CRITICAL';
        this.results.criticalIssues.push('Tous les bots sont inactifs');
      } else if (inactiveCount > 0) {
        check.status = 'WARNING';
      } else {
        check.status = 'OK';
      }
      
    } catch (error) {
      check.status = 'ERROR';
      check.error = error.message;
      this.results.warnings.push(`Check bots échoué: ${error.message}`);
    }
    
    return check;
  }
  
  async checkContracts() {
    const check = {
      name: 'contracts',
      status: 'UNKNOWN',
      details: {
        contracts: [],
      },
    };
    
    try {
      // Liste des contrats critiques à vérifier
      const criticalContracts = [
        { name: 'PerpEngine', getter: () => this.client.getEngineAddress() },
        { name: 'OracleAggregator', getter: () => this.client.getOracleAggregatorAddress() },
        { name: 'LiquidationEngine', getter: () => this.client.getLiquidationEngineAddress() },
        { name: 'RiskManager', getter: () => this.client.getRiskManagerAddress() },
        { name: 'ProtocolConfig', getter: () => this.client.getProtocolConfigAddress() },
      ];
      
      let errorCount = 0;
      
      // Vérifier chaque contrat
      for (const contract of criticalContracts) {
        const contractCheck = {
          name: contract.name,
          status: 'UNKNOWN',
        };
        
        try {
          const address = await contract.getter();
          
          if (!ethers.isAddress(address)) {
            throw new Error(`Adresse invalide: ${address}`);
          }
          
          // Vérifier que le contrat a du code
          const code = await this.client.provider.getCode(address);
          
          if (code === '0x' || code === '0x0') {
            throw new Error('Contrat non déployé ou détruit');
          }
          
          // Vérifier si le contrat est pausé
          const isPaused = await this.client.isContractPaused(address).catch(() => false);
          
          contractCheck.address = address;
          contractCheck.hasCode = true;
          contractCheck.isPaused = isPaused;
          contractCheck.status = 'OK';
          
          if (isPaused) {
            contractCheck.status = 'WARNING';
            this.results.warnings.push(`Contrat ${contract.name} est en pause`);
          }
          
        } catch (error) {
          contractCheck.status = 'ERROR';
          contractCheck.error = error.message;
          errorCount++;
          this.results.warnings.push(`Contrat ${contract.name} en erreur: ${error.message}`);
        }
        
        check.details.contracts.push(contractCheck);
      }
      
      // Déterminer le statut global
      if (errorCount === criticalContracts.length) {
        check.status = 'CRITICAL';
        this.results.criticalIssues.push('Tous les contrats critiques sont en erreur');
      } else if (errorCount > 0) {
        check.status = 'WARNING';
      } else {
        check.status = 'OK';
      }
      
    } catch (error) {
      check.status = 'ERROR';
      check.error = error.message;
      this.results.criticalIssues.push(`Check contrats échoué: ${error.message}`);
    }
    
    return check;
  }
  
  async checkGovernance() {
    const check = {
      name: 'governance',
      status: 'UNKNOWN',
      details: {},
    };
    
    try {
      // Vérifier le timelock
      const timelockAddress = await this.client.getTimelockAddress();
      const timelockCode = await this.client.provider.getCode(timelockAddress);
      
      if (timelockCode === '0x') {
        throw new Error('Timelock non déployé');
      }
      
      // Vérifier le governor
      const governorAddress = await this.client.getGovernorAddress();
      const governorCode = await this.client.provider.getCode(governorAddress);
      
      if (governorCode === '0x') {
        throw new Error('Governor non déployé');
      }
      
      // Vérifier les propositions actives
      const proposals = await this.client.getActiveProposals().catch(() => []);
      
      // Vérifier le token de gouvernance
      const tokenAddress = await this.client.getGovernanceTokenAddress();
      const tokenCode = await this.client.provider.getCode(tokenAddress);
      
      if (tokenCode === '0x') {
        throw new Error('Token de gouvernance non déployé');
      }
      
      check.details = {
        timelock: { address: timelockAddress, hasCode: timelockCode !== '0x' },
        governor: { address: governorAddress, hasCode: governorCode !== '0x' },
        governanceToken: { address: tokenAddress, hasCode: tokenCode !== '0x' },
        activeProposals: proposals.length,
      };
      
      // Vérifier s'il y a des propositions bloquées
      const blockedProposals = proposals.filter(p => p.state === 'DEFEATED' || p.state === 'EXPIRED');
      
      if (blockedProposals.length > 0) {
        check.status = 'WARNING';
        this.results.warnings.push(`${blockedProposals.length} proposition(s) bloquée(s)`);
      } else {
        check.status = 'OK';
      }
      
    } catch (error) {
      check.status = 'WARNING';
      check.error = error.message;
      this.results.warnings.push(`Check gouvernance échoué: ${error.message}`);
    }
    
    return check;
  }
  
  determineOverallStatus() {
    // Règles de décision
    const checks = Object.values(this.results.checks);
    
    // Si un check est CRITICAL, le statut global est CRITICAL
    const criticalChecks = checks.filter(c => c.status === 'CRITICAL');
    if (criticalChecks.length > 0) {
      this.results.status = 'CRITICAL';
      return;
    }
    
    // Si un check est ERROR, le statut global est ERROR
    const errorChecks = checks.filter(c => c.status === 'ERROR');
    if (errorChecks.length > 0) {
      this.results.status = 'ERROR';
      return;
    }
    
    // Si un check est WARNING, le statut global est WARNING
    const warningChecks = checks.filter(c => c.status === 'WARNING');
    if (warningChecks.length > 0) {
      this.results.status = 'WARNING';
      return;
    }
    
    // Si tous les checks sont OK, le statut global est OK
    const okChecks = checks.filter(c => c.status === 'OK');
    if (okChecks.length === checks.length) {
      this.results.status = 'OK';
      return;
    }
    
    // Sinon, UNKNOWN
    this.results.status = 'UNKNOWN';
  }
  
  reportResults() {
    if (config.JSON_OUTPUT) {
      console.log(JSON.stringify(this.results, null, 2));
      return;
    }
    
    // Format lisible pour les humains
    console.log('\n' + '='.repeat(80));
    console.log('PROTOCOL HEALTH CHECK');
    console.log('='.repeat(80));
    
    console.log(`\nTimestamp: ${new Date(this.results.timestamp).toISOString()}`);
    console.log(`Duration: ${this.results.duration}ms`);
    console.log(`Overall Status: ${this.formatStatus(this.results.status)}`);
    
    // Afficher les checks
    console.log('\n' + '-'.repeat(80));
    console.log('CHECKS:');
    console.log('-'.repeat(80));
    
    for (const [name, check] of Object.entries(this.results.checks)) {
      console.log(`\n${name.toUpperCase()}: ${this.formatStatus(check.status)}`);
      
      if (config.VERBOSE && check.details) {
        console.log('  Details:', JSON.stringify(check.details, null, 2));
      }
      
      if (check.error) {
        console.log(`  Error: ${check.error}`);
      }
    }
    
    // Afficher les issues critiques
    if (this.results.criticalIssues.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('CRITICAL ISSUES:');
      console.log('-'.repeat(80));
      this.results.criticalIssues.forEach(issue => {
        console.log(`❌ ${issue}`);
      });
    }
    
    // Afficher les warnings
    if (this.results.warnings.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('WARNINGS:');
      console.log('-'.repeat(80));
      this.results.warnings.forEach(warning => {
        console.log(`⚠️  ${warning}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
  }
  
  formatStatus(status) {
    const colors = {
      OK: '\x1b[32m',      // Vert
      WARNING: '\x1b[33m', // Jaune
      CRITICAL: '\x1b[31m',// Rouge
      ERROR: '\x1b[31m',   // Rouge
      UNKNOWN: '\x1b[90m', // Gris
    };
    
    const reset = '\x1b[0m';
    const color = colors[status] || colors.UNKNOWN;
    
    return `${color}${status}${reset}`;
  }
  
  maskUrl(url) {
    // Masquer les informations sensibles dans les URLs
    return url.replace(/\/\/(.*):(.*)@/, '//***:***@');
  }
  
  exitWithCode() {
    const exitCodes = {
      OK: 0,
      WARNING: 0,      // Warning n'est pas fatal
      UNKNOWN: 0,      // Unknown n'est pas fatal
      ERROR: 1,        // Error est fatal
      CRITICAL: config.EXIT_ON_CRITICAL ? 1 : 0,
    };
    
    const code = exitCodes[this.results.status] || 1;
    process.exit(code);
  }
}

// Point d'entrée
async function main() {
  const healthCheck = new ProtocolHealthCheck();
  await healthCheck.run();
}

// Gestion des arguments de ligne de commande
if (require.main === module) {
  // Parser les arguments
  const args = process.argv.slice(2);
  
  if (args.includes('--json')) {
    config.JSON_OUTPUT = true;
  }
  
  if (args.includes('--verbose')) {
    config.VERBOSE = true;
  }
  
  if (args.includes('--exit-on-critical')) {
    config.EXIT_ON_CRITICAL = true;
  }
  
  if (args.includes('--help')) {
    console.log(`
PerpArbitraDEX Protocol Health Check
Usage: node health-check.js [options]

Options:
  --json              Output results as JSON
  --verbose           Show detailed check information
  --exit-on-critical  Exit with code 1 if any critical issues found
  --help              Show this help message
    `);
    process.exit(0);
  }
  
  main();
}

module.exports = ProtocolHealthCheck;