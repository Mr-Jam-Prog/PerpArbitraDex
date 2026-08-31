const { expect } = require("chai");
const { loadAllowlist, validateContractDeployment, validateScriptExecution } = require("../../scripts/utils/allowlist-validator.cjs");

describe("🛡️ MVP Scope & Allowlist Validation", function () {
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
    expect(() => validateScriptExecution("05_deploy_integrations.js")).to.throw(
      /blocked from execution/
    );
    expect(() => validateScriptExecution("04_deploy_governance.js")).to.throw(
      /blocked from execution/
    );
    expect(validateScriptExecution("01_deploy_core.js")).to.be.true;
  });

  it("Should enforce network target check if active network differs from arbitrumSepolia", function () {
    const originalEnv = process.env.HARDHAT_NETWORK;
    try {
      process.env.HARDHAT_NETWORK = "mainnet";
      expect(() => validateScriptExecution("01_deploy_core.js")).to.throw(
        /Active network 'mainnet' does not match target network 'arbitrumSepolia'/
      );
    } finally {
      process.env.HARDHAT_NETWORK = originalEnv;
    }
  });
});
