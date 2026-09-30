import { expect } from "chai";
import { execSync } from "child_process";
import fs from "fs";

describe("08D-R1 Security Triage Tooling Self-Tests", function () {
  this.timeout(60000);

  it("should successfully extract AST symbols and discover receive/fallback and concrete entrypoints", function () {
    const output = execSync("python3 scripts/security/08d/extract_solidity_ast.py", { encoding: "utf-8" });
    expect(output).to.include("Extracted");

    const symbolTable = JSON.parse(fs.readFileSync("docs/security/08D_SYMBOL_TABLE.json", "utf-8"));
    expect(symbolTable.length).to.be.above(0);

    const receiveMatches = symbolTable.filter((s) => s.kind === "receive");
    expect(receiveMatches.length).to.be.above(0);

    const internalMatches = symbolTable.filter((s) => s.visibility === "internal");
    expect(internalMatches.length).to.be.above(0);
  });

  it("should build function audit matrix and report static test evidence without universal coverage assumption", function () {
    execSync("python3 scripts/security/08d/build_function_audit.py");
    const auditMatrix = JSON.parse(fs.readFileSync("docs/security/08D_FUNCTION_AUDIT.json", "utf-8"));
    expect(auditMatrix.length).to.be.above(0);

    const wrapEth = auditMatrix.find((a) => a.contract === "LidoStETHIntegrator" && a.function === "wrapETH");
    expect(wrapEth).to.exist;
    expect(wrapEth.test_coverage).to.not.equal("COVERED_IN_UNIT_OR_FUZZ");
  });

  it("should classify checked token transfers as FALSE_POSITIVE in rule scanner", function () {
    execSync("python3 scripts/security/08d/semantic_rule_scanner.py");
    const ruleScan = JSON.parse(fs.readFileSync("docs/security/08D_GLOBAL_AUDIT_RULES.json", "utf-8"));
    expect(ruleScan.candidate_matches).to.exist;

    const uncheckedRuleMatches = ruleScan.candidate_matches.filter((m) => m.rule_id === "RULE_UNCHECKED_EXTERNAL_TOKEN_CALL");
    const falsePositives = uncheckedRuleMatches.filter((m) => m.verification_status === "FALSE_POSITIVE");
    expect(falsePositives.length).to.be.above(0);
  });

  it("should validate canonical 08D ledgers with 0 errors via validate_08d_ledgers.py", function () {
    const res = execSync("python3 scripts/security/08d/validate_08d_ledgers.py", { encoding: "utf-8" });
    expect(res).to.include("Validation PASSED with 0 errors");
  });
});
