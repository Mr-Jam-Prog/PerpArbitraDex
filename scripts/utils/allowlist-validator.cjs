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

function getActiveNetworkName(networkNameOrHre) {
  if (typeof networkNameOrHre === "string" && networkNameOrHre.trim() !== "") {
    return networkNameOrHre.trim();
  }
  if (networkNameOrHre && typeof networkNameOrHre === "object") {
    if (networkNameOrHre.network && typeof networkNameOrHre.network.name === "string") {
      return networkNameOrHre.network.name;
    }
    if (typeof networkNameOrHre.name === "string") {
      return networkNameOrHre.name;
    }
  }
  if (process.env.HARDHAT_NETWORK && process.env.HARDHAT_NETWORK.trim() !== "") {
    return process.env.HARDHAT_NETWORK.trim();
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

function validateScriptExecution(scriptName, networkNameOrHre) {
  const allowlist = loadAllowlist();
  const activeNetwork = getActiveNetworkName(networkNameOrHre);

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
