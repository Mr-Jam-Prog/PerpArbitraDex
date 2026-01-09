// @title: Vérification individuelle d'un contrat avec options avancées
// @usage: npx hardhat run scripts/verification/verify_contract.js --network arbitrum --contract PerpEngine

const { ethers, run } = require("hardhat");
const { AddressRegistry } = require("../utils/addresses");

async function verifyContract(contractName, options = {}) {
  console.log(`🔍 Vérification du contrat: ${contractName}`);
  
  const registry = new AddressRegistry(hre.network.name);
  const allAddresses = registry.getAllAddresses();
  
  const address = allAddresses[contractName];
  if (!address) {
    throw new Error(`Contrat ${contractName} non trouvé dans les déploiements`);
  }
  
  const config = {
    address,
    constructorArguments: options.constructorArgs || [],
    contract: options.contractPath || contractName,
    libraries: options.libraries || {}
  };
  
  console.log(`📋 Configuration:`);
  console.log(`   Adresse: ${address}`);
  console.log(`   Arguments: ${JSON.stringify(config.constructorArguments)}`);
  console.log(`   Chemin: ${config.contract}`);
  
  if (Object.keys(config.libraries).length > 0) {
    console.log(`   Librairies: ${JSON.stringify(config.libraries)}`);
  }
  
  try {
    console.log(`🚀 Lancement de la vérification...`);
    
    await run("verify:verify", config);
    
    console.log(`✅ ${contractName} vérifié avec succès!`);
    
    // Génération du lien explorer
    const network = await ethers.provider.getNetwork();
    let explorerUrl;
    
    switch (network.chainId) {
      case 42161: // Arbitrum
        explorerUrl = `https://arbiscan.io/address/${address}#code`;
        break;
      case 8453: // Base
        explorerUrl = `https://basescan.org/address/${address}#code`;
        break;
      case 10: // Optimism
        explorerUrl = `https://optimistic.etherscan.io/address/${address}#code`;
        break;
      default:
        explorerUrl = `Explorer non disponible pour chainId ${network.chainId}`;
    }
    
    console.log(`🔗 Lien: ${explorerUrl}`);
    
    return {
      success: true,
      address,
      explorerUrl,
      contractName
    };
    
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log(`ℹ️ ${contractName} est déjà vérifié`);
      return {
        success: true,
        address,
        alreadyVerified: true,
        contractName
      };
    }
    
    console.error(`❌ Échec de la vérification: ${error.message}`);
    
    return {
      success: false,
      address,
      error: error.message,
      contractName
    };
  }
}

// Interface ligne de commande
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const contractName = args.find(arg => arg.startsWith('--contract='))?.split('=')[1];
  const constructorArgs = args.find(arg => arg.startsWith('--args='))?.split('=')[1];
  const contractPath = args.find(arg => arg.startsWith('--path='))?.split('=')[1];
  
  if (!contractName) {
    console.error('Usage: npx hardhat run scripts/verification/verify_contract.js --network <network> --contract=<contractName> [--args=<constructorArgs>] [--path=<contractPath>]');
    process.exit(1);
  }
  
  const options = {};
  
  if (constructorArgs) {
    try {
      options.constructorArgs = JSON.parse(constructorArgs);
    } catch (e) {
      console.error('Erreur de parsing des arguments:', e.message);
      process.exit(1);
    }
  }
  
  if (contractPath) {
    options.contractPath = contractPath;
  }
  
  const result = await verifyContract(contractName, options);
  
  if (!result.success && !result.alreadyVerified) {
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

module.exports = { verifyContract };