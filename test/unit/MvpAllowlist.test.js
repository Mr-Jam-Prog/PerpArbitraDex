import { expect } from "chai";
import hre from "hardhat";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { loadAllowlist, validateContractDeployment, validateScriptExecution, getActiveNetworkName } = require("../../scripts/utils/allowlist-validator.cjs");

describe("🛡️ MVP Scope & Allowlist Validation", function () {
  let ethers, time, artifacts, loadFixture;
  before(async function () {
    const conn = await hre.network.getOrCreate();
    ethers = conn.ethers;
    time = conn.networkHelpers?.time;
    loadFixture = conn.networkHelpers?.loadFixture;
    artifacts = hre.artifacts;
  });

  let allowlist;

  before(function () {
    allowlist = loadAllowlist();
  });

  it("Should load allowlist correctly", function () {
    expect(allowlist).to.have.property("version");
    expect(allowlist).to.have.property("contracts");
    expect(allowlist).to.have.property("deploymentScripts");
  });

  it("Should contain valid statuses for all contracts", function () {
    const validStatuses = ["ENABLED_MVP", "TEST_ONLY", "QUARANTINED"];
    for (const [contract, status] of Object.entries(allowlist.contracts)) {
      expect(validStatuses).to.include(
        status,
        `Contract '${contract}' has invalid status '${status}'`
      );
    }
  });

  it("Should allow deployment of ENABLED_MVP contracts", function () {
    expect(validateContractDeployment("PerpEngine")).to.be.true;
    expect(validateContractDeployment("ProtocolConfig")).to.be.true;
    expect(validateContractDeployment("LiquidationEngine")).to.be.true;
  });

  it("Should reject deployment of QUARANTINED contracts", function () {
    expect(() => validateContractDeployment("FlashLiquidator")).to.throw(
      /QUARANTINED and forbidden from deployment/
    );
    expect(() => validateContractDeployment("AaveFlashLoanIntegrator")).to.throw(
      /QUARANTINED and forbidden from deployment/
    );
    expect(() => validateContractDeployment("AccountAbstractionAdapter")).to.throw(
      /QUARANTINED and forbidden from deployment/
    );
    expect(() => validateContractDeployment("TWAPOracle")).to.throw(
      /QUARANTINED and forbidden from deployment/
    );
  });

  it("Should reject deployment of TEST_ONLY contracts", function () {
    expect(() => validateContractDeployment("IncentiveDistributor")).to.throw(
      /marked TEST_ONLY and cannot be deployed in MVP/
    );
    expect(() => validateContractDeployment("PythOracle")).to.throw(
      /marked TEST_ONLY and cannot be deployed in MVP/
    );
    expect(() => validateContractDeployment("PerpDexToken")).to.throw(
      /marked TEST_ONLY and cannot be deployed in MVP/
    );
  });

  it("Should reject execution of QUARANTINED or TEST_ONLY scripts", function () {
    expect(() => validateScriptExecution("05_deploy_integrations.js", "arbitrumSepolia")).to.throw(
      /blocked from execution/
    );
    expect(() => validateScriptExecution("04_deploy_governance.js", "arbitrumSepolia")).to.throw(
      /blocked from execution/
    );
    expect(validateScriptExecution("01_deploy_core.js", "arbitrumSepolia")).to.be.true;
  });

  it("Should validate normal allowed script execution on intended target network or hardhat network", function () {
    expect(validateScriptExecution("01_deploy_core.js", "arbitrumSepolia")).to.be.true;
    expect(validateScriptExecution("01_deploy_core.js", "hardhat")).to.be.true;
    expect(validateScriptExecution("01_deploy_core.js", hre)).to.be.true;
  });

  it("Should reject wrong-network execution without relying on CommonJS require('hardhat')", function () {
    expect(() => validateScriptExecution("01_deploy_core.js", "mainnet")).to.throw(
      /Active network 'mainnet' does not match target network 'arbitrumSepolia'/
    );
    expect(() => validateScriptExecution("01_deploy_core.js", { network: { name: "mainnet" } })).to.throw(
      /Active network 'mainnet' does not match target network 'arbitrumSepolia'/
    );
    expect(() => validateScriptExecution("01_deploy_core.js", { name: "sepolia" })).to.throw(
      /Active network 'sepolia' does not match target network 'arbitrumSepolia'/
    );
  });

  it("Should resolve active network name under Hardhat 3 from string or HRE object without require('hardhat')", function () {
    expect(getActiveNetworkName("arbitrumSepolia")).to.equal("arbitrumSepolia");
    expect(getActiveNetworkName("hardhat")).to.equal("hardhat");
    expect(getActiveNetworkName(hre)).to.be.a("string");
    expect(getActiveNetworkName({ network: { name: "arbitrumSepolia" } })).to.equal("arbitrumSepolia");
  });
});
