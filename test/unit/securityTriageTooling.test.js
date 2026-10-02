import { expect } from "chai";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

describe("08D-R1 Security Triage Tooling Self-Tests & Negative Fixtures", function () {
  this.timeout(60000);

  it("should successfully extract AST symbols and discover receive/fallback and concrete entrypoints", function () {
    const output = execSync("python3 scripts/security/08d/extract_solidity_ast.py", {
      encoding: "utf-8",
      env: { ...process.env, SKIP_FORCE_COMPILE: "1" }
    });
    expect(output).to.include("Extracted");

    const symbolTable = JSON.parse(fs.readFileSync("docs/security/08D_SYMBOL_TABLE.json", "utf-8"));
    expect(symbolTable.length).to.be.above(0);

    const receiveMatches = symbolTable.filter((s) => s.kind === "receive");
    expect(receiveMatches.length).to.be.above(0);

    const internalMatches = symbolTable.filter((s) => s.visibility === "internal");
    expect(internalMatches.length).to.be.above(0);
  });

  it("should build function audit matrix and report static test evidence with structured proof objects", function () {
    execSync("python3 scripts/security/08d/build_function_audit.py", {
      env: { ...process.env, SKIP_FORCE_COMPILE: "1" }
    });
    const auditMatrix = JSON.parse(fs.readFileSync("docs/security/08D_FUNCTION_AUDIT.json", "utf-8"));
    expect(auditMatrix.length).to.be.above(0);

    const wrapEth = auditMatrix.find((a) => a.contract === "LidoStETHIntegrator" && a.function === "wrapETH");
    expect(wrapEth).to.exist;
    expect(wrapEth.test_coverage).to.not.equal("COVERED_IN_UNIT_OR_FUZZ");

    const provedFunction = auditMatrix.find((a) => a.test_evidence_object !== null);
    expect(provedFunction).to.exist;
    expect(provedFunction.test_evidence_object).to.have.property("source_location");
  });

  it("should scan global audit candidate rules and exclude native ETH transfers from token transfer rules", function () {
    execSync("python3 scripts/security/08d/semantic_rule_scanner.py");
    const ruleScan = JSON.parse(fs.readFileSync("docs/security/08D_GLOBAL_AUDIT_RULES.json", "utf-8"));
    expect(ruleScan.candidate_matches).to.exist;

    const uncheckedRuleMatches = ruleScan.candidate_matches.filter((m) => m.rule_id === "RULE_UNCHECKED_EXTERNAL_TOKEN_CALL");
    // Verify native ETH transfers are not included as token transfers
    const nativeEthMatches = uncheckedRuleMatches.filter((m) => m.code_snippet.includes("payable("));
    expect(nativeEthMatches.length).to.equal(0);
  });

  it("should validate canonical 08D ledgers with 0 errors via validate_08d_ledgers.py", function () {
    const res = execSync("python3 scripts/security/08d/validate_08d_ledgers.py", { encoding: "utf-8" });
    expect(res).to.include("Validation PASSED with 0 errors");
  });

  describe("Negative Test Fixtures for Validator", function () {
    const tmpDir = "test/tmp_fixtures";

    beforeEach(() => {
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.copyFileSync("warnings-baseline.json", path.join(tmpDir, "baseline.json"));
      fs.copyFileSync("docs/security/08D_FINDINGS_LEDGER.json", path.join(tmpDir, "ledger.json"));
      fs.copyFileSync("docs/security/08D_ROOT_FINDINGS.json", path.join(tmpDir, "roots.json"));
      fs.copyFileSync("docs/security/08D_FUNCTION_AUDIT.json", path.join(tmpDir, "audit.json"));
      fs.copyFileSync("docs/security/08D_SYMBOL_TABLE.json", path.join(tmpDir, "symbols.json"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should fail validation if an unsupported safety claim is used on non-blocker classification without evidence refs", function () {
      const ledger = JSON.parse(fs.readFileSync(path.join(tmpDir, "ledger.json"), "utf-8"));
      ledger[0].classification = "CONTEXTUAL_ACCEPTED";
      ledger[0].code_specific_rationale = "This diagnostic is protected by nonReentrant and operates safely.";
      ledger[0].safety_claims = [];
      ledger[0].evidence_refs = [];
      fs.writeFileSync(path.join(tmpDir, "ledger.json"), JSON.stringify(ledger, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if test evidence is claimed without a proof object", function () {
      const audit = JSON.parse(fs.readFileSync(path.join(tmpDir, "audit.json"), "utf-8"));
      audit[0].test_coverage = "STATIC_REFERENCE_EXACT_CONTRACT_FUNCTION";
      audit[0].test_evidence_object = null;
      fs.writeFileSync(path.join(tmpDir, "audit.json"), JSON.stringify(audit, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if a root finding lacks machine-resolvable evidence", function () {
      const roots = JSON.parse(fs.readFileSync(path.join(tmpDir, "roots.json"), "utf-8"));
      roots[0].diagnostic_ids = [];
      roots[0].semantic_evidence = [];
      fs.writeFileSync(path.join(tmpDir, "roots.json"), JSON.stringify(roots, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if an unknown symbol is present in root findings", function () {
      const roots = JSON.parse(fs.readFileSync(path.join(tmpDir, "roots.json"), "utf-8"));
      roots[0].affected_symbols.push("NonExistentContract.nonExistentFunction(uint256)");
      fs.writeFileSync(path.join(tmpDir, "roots.json"), JSON.stringify(roots, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if duplicate diagnostic IDs are present in findings ledger", function () {
      const ledger = JSON.parse(fs.readFileSync(path.join(tmpDir, "ledger.json"), "utf-8"));
      ledger.push(ledger[0]);
      fs.writeFileSync(path.join(tmpDir, "ledger.json"), JSON.stringify(ledger, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if a generic rationale template is used", function () {
      const ledger = JSON.parse(fs.readFileSync(path.join(tmpDir, "ledger.json"), "utf-8"));
      ledger[0].code_specific_rationale = "required for baseline gate justification text";
      fs.writeFileSync(path.join(tmpDir, "ledger.json"), JSON.stringify(ledger, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if AST concrete entrypoint set differs from audit concrete entrypoint set", function () {
      const audit = JSON.parse(fs.readFileSync(path.join(tmpDir, "audit.json"), "utf-8"));
      audit.push({
        function_id: "InjectedContract.fakeEntry:100",
        file: "contracts/fake/InjectedContract.sol",
        contract: "InjectedContract",
        function: "fakeEntry",
        canonical_signature: "InjectedContract.fakeEntry()",
        visibility: "external",
        kind: "function",
        authorization: "NONE",
        inputs_used: "FULL",
        state_reads: { value: "NO", variables: [] },
        state_writes: { value: "NO", variables: [] },
        asset_inflow: { value: "NO", evidence: [] },
        asset_outflow: { value: "NO", evidence: [] },
        external_calls: { value: "NO", evidence: [] },
        callbacks: "NO",
        reentrancy_model: "NONE",
        oracle_dependence: "NO",
        price_units: "N/A",
        token_decimals: "N/A",
        time_dependence: "NO",
        nonce_replay_model: "N/A",
        cross_chain_auth: "N/A",
        event_observability: "NO_EVENT_EMITTED",
        return_value_semantics: "VOID",
        fail_open_or_fail_closed: "FAIL_OPEN_OR_NO_CHECK",
        no_op_or_stub: "NO",
        hardcoded_runtime_value: "NO",
        test_coverage: "NO_TEST_EVIDENCE",
        reachability: "EXTERNAL_DIRECT",
        reachable_from: ["InjectedContract.fakeEntry()"]
      });
      fs.writeFileSync(path.join(tmpDir, "audit.json"), JSON.stringify(audit, null, 2));

      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); from validate_08d_ledgers import validate_ledgers; validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });

    it("should fail validation if a declared check is not implemented in the validator", function () {
      try {
        execSync(`python3 -c "import sys; sys.path.insert(0, 'scripts/security/08d'); import validate_08d_ledgers; validate_08d_ledgers.DECLARED_CHECKS.append('FAKE_UNIMPLEMENTED_CHECK'); validate_08d_ledgers.validate_ledgers('${tmpDir}/baseline.json', '${tmpDir}/ledger.json', '${tmpDir}/roots.json', '${tmpDir}/audit.json', '${tmpDir}/symbols.json')"`);
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err.message).to.include("Command failed");
      }
    });
  });
});
