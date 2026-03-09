// @title: Vérification avec arguments complexes et librairies
// @use-case: Contrats avec dépendances et configurations complexes

const { ethers, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function verifyWithComplexArgs(contractInfo) {
  const {
    name,
    address,
    constructorArgs = [],
    libraries = {},
    contractPath,
    force = false
  } = contractInfo;
  
  console.log(`🔍 Vérification complexe de: ${name}`);
  console.log(`📍 Adresse: ${address}`);
  
  // Configuration de la vérification
  const verifyConfig = {
    address,
    constructorArguments: constructorArgs,
    contract: contractPath || name
  };
  
  // Ajout des librairies si spécifiées
  if (Object.keys(libraries).length > 0) {
    verifyConfig.libraries = libraries;
    console.log(`📚 Librairies: ${JSON.stringify(libraries)}`);
  }
  
  console.log(`⚙️ Arguments: ${JSON.stringify(constructorArgs)}`);
  
  try {
    // Tentative de vérification
    await run("verify:verify", verifyConfig);
    
    console.log(`✅ ${name} vérifié avec succès!`);
    
    return {
      success: true,
      name,
      address,
      config: verifyConfig
    };
    
  } catch (error) {
    // Gestion des erreurs spécifiques
    const errorMsg = error.message.toLowerCase();
    
    if (errorMsg.includes("already verified")) {
      console.log(`ℹ️ ${name} est déjà vérifié`);
      return {
        success: true,
        alreadyVerified: true,
        name,
        address
      };
    }
    
    if (errorMsg.includes("failed to send") && force) {
      console.log(`⚠️ Échec d'envoi, tentative de vérification manuelle...`);
      await generateManualVerificationScript(contractInfo);
      return {
        success: false,
        manualScriptGenerated: true,
        name,
        address
      };
    }
    
    console.error(`❌ Erreur de vérification:`, error.message);
    
    // Log détaillé pour debugging
    await logVerificationError(contractInfo, error);
    
    return {
      success: false,
      error: error.message,
      name,
      address
    };
  }
}

async function generateManualVerificationScript(contractInfo) {
  const scriptDir = path.join(__dirname, '../../manual-verification');
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(scriptDir, { recursive: true });
  }
  
  const timestamp = Date.now();
  const scriptFile = path.join(scriptDir, `verify-${contractInfo.name}-${timestamp}.js`);
  
  const scriptContent = `
// Script de vérification manuelle pour ${contractInfo.name}
// Généré automatiquement le ${new Date().toISOString()}

const ethers = require("ethers");

async function main() {
  console.log("Vérification manuelle de ${contractInfo.name}");
  
  const contractAddress = "${contractInfo.address}";
  
  // Arguments du constructeur
  const constructorArguments = ${JSON.stringify(contractInfo.constructorArgs, null, 2)};
  
  // Librairies
  const libraries = ${JSON.stringify(contractInfo.libraries, null, 2)};
  
  console.log("\\n📋 Configuration:");
  console.log("Adresse:", contractAddress);
  console.log("Arguments:", constructorArguments);
  console.log("Librairies:", libraries);
  
  // Pour vérifier manuellement:
  // 1. Allez sur l'explorer (Arbiscan, Etherscan, etc.)
  // 2. Naviguez à l'adresse du contrat
  // 3. Cliquez sur "Verify and Publish"
  // 4. Remplissez les informations suivantes:
  //    - Contract Address: ${contractInfo.address}
  //    - Compiler Type: Solidity (Single file)
  //    - Compiler Version: (voir hardhat.config.js)
  //    - Open Source License Type: MIT
  //    - Constructor Arguments ABI-Encoded: ${encodeConstructorArgs(constructorArgs)}
  //    - Contract Code: Copiez le code source du contrat
}

function encodeConstructorArgs(args) {
  // Encodage ABI des arguments
  const abiCoder = new ethers.utils.AbiCoder();
  // Adaptez cette fonction selon votre contrat
  return "0x...";
}

main().catch(console.error);
`;
  
  fs.writeFileSync(scriptFile, scriptContent);
  console.log(`📝 Script de vérification manuelle généré: ${scriptFile}`);
}

async function logVerificationError(contractInfo, error) {
  const logDir = path.join(__dirname, '../../verification-logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const logFile = path.join(logDir, `error-${contractInfo.name}-${Date.now()}.json`);
  
  const errorLog = {
    timestamp: new Date().toISOString(),
    network: hre.network.name,
    contract: contractInfo,
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    environment: {
      nodeVersion: process.version,
      hardhatVersion: require('hardhat/package.json').version,
      ethersVersion: require('ethers/package.json').version
    }
  };
  
  fs.writeFileSync(logFile, JSON.stringify(errorLog, null, 2));
  console.log(`📄 Log d'erreur sauvegardé: ${logFile}`);
}

// Fonction pour encoder les arguments ABI
function encodeConstructorArgs(args, types = []) {
  const ethers = require("ethers");
  
  // Types par défaut pour les arguments communs
  const defaultTypes = args.map(arg => {
    if (typeof arg === 'string' && ethers.utils.isAddress(arg)) {
      return 'address';
    } else if (typeof arg === 'string') {
      return 'string';
    } else if (typeof arg === 'number' || typeof arg === 'bigint') {
      return 'uint256';
    } else if (Array.isArray(arg)) {
      return 'bytes';
    }
    return 'bytes';
  });
  
  const finalTypes = types.length > 0 ? types : defaultTypes;
  
  try {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(finalTypes, args);
    return encoded;
  } catch (error) {
    console.error('Erreur lors de l\'encodage des arguments:', error);
    return '0x';
  }
}

// Interface CLI
async function main() {
  const args = process.argv.slice(2);
  
  // Lecture du fichier de configuration
  const configFile = args.find(arg => arg.startsWith('--config='))?.split('=')[1];
  
  if (!configFile) {
    console.error('Usage: npx hardhat run scripts/verification/verify_with_args.js --network <network> --config=<configFile.json>');
    process.exit(1);
  }
  
  const configPath = path.resolve(process.cwd(), configFile);
  
  if (!fs.existsSync(configPath)) {
    console.error(`Fichier de configuration non trouvé: ${configPath}`);
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  console.log(`📁 Chargement de la configuration: ${configPath}`);
  console.log(`📋 ${config.contracts?.length || 1} contrat(s) à vérifier`);
  
  const results = [];
  
  if (config.contracts && Array.isArray(config.contracts)) {
    // Vérification multiple
    for (const contractInfo of config.contracts) {
      console.log(`\n--- Vérification de ${contractInfo.name} ---`);
      const result = await verifyWithComplexArgs(contractInfo);
      results.push(result);
      
      // Pause pour éviter le rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } else {
    // Vérification unique
    const result = await verifyWithComplexArgs(config);
    results.push(result);
  }
  
  // Résumé
  console.log('\n📊 Résumé des vérifications:');
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const alreadyVerified = results.filter(r => r.alreadyVerified).length;
  
  console.log(`✅ Succès: ${successful}`);
  console.log(`ℹ️ Déjà vérifiés: ${alreadyVerified}`);
  console.log(`❌ Échecs: ${failed}`);
  
  // Sauvegarde des résultats
  const resultsFile = path.join(
    path.dirname(configPath),
    `verification-results-${Date.now()}.json`
  );
  
  fs.writeFileSync(resultsFile, JSON.stringify({
    configFile,
    timestamp: new Date().toISOString(),
    network: hre.network.name,
    results
  }, null, 2));
  
  console.log(`📄 Résultats sauvegardés: ${resultsFile}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  verifyWithComplexArgs,
  encodeConstructorArgs,
  generateManualVerificationScript
};