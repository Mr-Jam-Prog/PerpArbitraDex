const fs = require("fs");
const path = require("path");

const ALLOWLIST_PATH = path.join(__dirname, "../../config/mvp_allowlist.json");

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    throw new Error(`MVP Allowlist file not found at ${ALLOWLIST_PATH}`);
  }
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf8");
  return JSON.parse(raw);
}

function getActiveNetworkName() {
  if (process.env.HARDHAT_NETWORK) {
    return process.env.HARDHAT_NETWORK;
  }
  try {
    const hardhat = require("hardhat");
    if (hardhat && hardhat.network && hardhat.network.name) {
      return hardhat.network.name;
    }
  } catch (e) {
    // Hardhat might not be required in pure node test scripts
  }
  return process.env.NODE_ENV === "test" ? "arbitrumSepolia" : "unknown";
}

function validateContractDeployment(contractName) {
  const allowlist = loadAllowlist();
  const status = allowlist.contracts[contractName];

  if (!status) {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Contract '${contractName}' is not registered in mvp_allowlist.json`
    );
  }

  if (status === "QUARANTINED") {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Contract '${contractName}' is QUARANTINED and forbidden from deployment.`
    );
  }

  if (status === "TEST_ONLY") {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Contract '${contractName}' is marked TEST_ONLY and cannot be deployed in MVP.`
    );
  }

  if (status !== "ENABLED_MVP") {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Contract '${contractName}' has unknown status '${status}'.`
    );
  }

  return true;
}

function validateScriptExecution(scriptName) {
  const allowlist = loadAllowlist();
  const activeNetwork = getActiveNetworkName();

  if (allowlist.targetNetwork && activeNetwork !== allowlist.targetNetwork && activeNetwork !== "hardhat") {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Active network '${activeNetwork}' does not match target network '${allowlist.targetNetwork}' in mvp_allowlist.json`
    );
  }

  const status = allowlist.deploymentScripts[scriptName];

  if (!status) {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Script '${scriptName}' is not registered in mvp_allowlist.json`
    );
  }

  if (status === "QUARANTINED" || status === "TEST_ONLY") {
    throw new Error(
      `[MVP DEPLOYMENT BLOCKED] Script '${scriptName}' status is '${status}' and is blocked from execution.`
    );
  }

  return true;
}

module.exports = {
  loadAllowlist,
  getActiveNetworkName,
  validateContractDeployment,
  validateScriptExecution,
};
