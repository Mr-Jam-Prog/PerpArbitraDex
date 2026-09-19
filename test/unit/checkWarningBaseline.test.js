import { expect } from "chai";
import {
  parseWarningsFromText,
  compareWarnings,
  runWarningBaselineCheck,
  validateBaselineJustifications,
  loadBaseline,
} from "../../scripts/check-warning-baseline.mjs";

describe("Warning Baseline Gate Suite (Prompt 08C.1 Correctness Repair)", () => {
  const sampleFixtureEntry = {
    file: "contracts/core/PerpEngine.sol",
    line: 15,
    column: 5,
    message: "Function state mutability can be restricted to pure",
    raw_warning: "Warning: Function state mutability can be restricted to pure",
    justification: "[PRODUCTION_WARNING_DEBT] Compiler warning debt in production contract; frozen for baseline gate.",
  };

  describe("W1 — exact baseline", () => {
    it("should PASS when actual warning set equals exact fixture baseline", () => {
      const fixtureBaseline = [sampleFixtureEntry];
      const rawOutput = `
Warning: Function state mutability can be restricted to pure
  --> contracts/core/PerpEngine.sol:15:5
`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      const res = compareWarnings(actualWarnings, fixtureBaseline);

      expect(res.success).to.be.true;
      expect(res.unexpectedWarnings).to.have.lengthOf(0);
      expect(res.unmatchedBaseline).to.have.lengthOf(0);
    });
  });

  describe("W2 — unknown warning", () => {
    it("should FAIL when an unexpected warning is present, specifically asserting unexpectedWarnings.length === 1 and unmatchedBaseline.length === 0", () => {
      const fixtureBaseline = [sampleFixtureEntry];
      const rawOutput = `
Warning: Function state mutability can be restricted to pure
  --> contracts/core/PerpEngine.sol:15:5

Warning: Unhandled state mutability risk
  --> contracts/core/PerpEngine.sol:999:1
`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      const res = compareWarnings(actualWarnings, fixtureBaseline);

      expect(res.success).to.be.false;
      expect(res.unexpectedWarnings).to.have.lengthOf(1);
      expect(res.unmatchedBaseline).to.have.lengthOf(0);

      const unexpected = res.unexpectedWarnings[0];
      expect(unexpected.file).to.equal("contracts/core/PerpEngine.sol");
      expect(unexpected.line).to.equal(999);
      expect(unexpected.column).to.equal(1);
      expect(unexpected.message).to.equal("Unhandled state mutability risk");
    });
  });

  describe("W3 — exact source-column identity", () => {
    it("should FAIL when column differs (baseline 15:5 vs actual 15:10), returning unmatched col 5 and unexpected col 10", () => {
      const fixtureBaseline = [{ ...sampleFixtureEntry, column: 5 }];
      const rawOutput = `
Warning: Function state mutability can be restricted to pure
  --> contracts/core/PerpEngine.sol:15:10
`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      const res = compareWarnings(actualWarnings, fixtureBaseline);

      expect(res.success).to.be.false;
      expect(res.unmatchedBaseline).to.have.lengthOf(1);
      expect(res.unmatchedBaseline[0].column).to.equal(5);

      expect(res.unexpectedWarnings).to.have.lengthOf(1);
      expect(res.unexpectedWarnings[0].column).to.equal(10);
    });
  });

  describe("W4 — stale baseline", () => {
    it("should FAIL when baseline contains a warning that actual output lacks, asserting unmatchedBaseline.length === 1", () => {
      const fixtureBaseline = [sampleFixtureEntry];
      const rawOutput = `Compilation finished without warnings.`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      const res = compareWarnings(actualWarnings, fixtureBaseline);

      expect(res.success).to.be.false;
      expect(res.unmatchedBaseline).to.have.lengthOf(1);
      expect(res.unexpectedWarnings).to.have.lengthOf(0);
      expect(res.unmatchedBaseline[0].file).to.equal(sampleFixtureEntry.file);
    });
  });

  describe("W5 — duplicates", () => {
    it("should deduplicate identical diagnostics emitted by different tools", () => {
      const rawOutput = `
Warning: Unused local variable
  --> contracts/core/PerpEngine.sol:42:10

Warning: Unused local variable
  --> contracts/core/PerpEngine.sol:42:10
`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      expect(actualWarnings).to.have.lengthOf(1);

      const fixtureBaseline = [
        {
          file: "contracts/core/PerpEngine.sol",
          line: 42,
          column: 10,
          message: "Unused local variable",
          raw_warning: "Warning: Unused local variable",
          justification: "[PRODUCTION_WARNING_DEBT] Compiler warning debt.",
        },
      ];

      const res = compareWarnings(actualWarnings, fixtureBaseline);
      expect(res.success).to.be.true;
    });
  });

  describe("W6 — ANSI", () => {
    it("should strip ANSI escape sequences and detect warning cleanly", () => {
      const ansiOutput = `\x1B[33mWarning:\x1B[0m Unused local variable\n  --> \x1B[32mcontracts/core/PerpEngine.sol:42:10\x1B[0m`;
      const actualWarnings = parseWarningsFromText(ansiOutput);

      expect(actualWarnings).to.have.lengthOf(1);
      expect(actualWarnings[0].file).to.equal("contracts/core/PerpEngine.sol");
      expect(actualWarnings[0].line).to.equal(42);
      expect(actualWarnings[0].column).to.equal(10);
    });
  });

  describe("W7 — false-positive text", () => {
    it("should not generate diagnostics for false-positive text strings like '0 warnings'", () => {
      const rawOutput = `
0 warnings found.
warning count: 0
no warnings detected
0 warning(s)
`;
      const actualWarnings = parseWarningsFromText(rawOutput);
      expect(actualWarnings).to.have.lengthOf(0);
    });
  });

  describe("W8 — child process failure without warnings", () => {
    it("should fail closed when justification validation fails on custom baseline", () => {
      const invalidJustificationBaseline = [
        {
          ...sampleFixtureEntry,
          justification: "Tolerated compiler diagnostic in production Solidity contract; required for baseline gate.",
        },
      ];
      const res = runWarningBaselineCheck("clean output", invalidJustificationBaseline);
      expect(res.success).to.be.false;
      expect(res.reason).to.equal("Invalid baseline justifications");
      expect(res.invalidJustifications).to.have.lengthOf(1);
    });
  });

  describe("W9 — child process failure plus warnings", () => {
    it("should fail for child process failure and not convert to successful warning comparison", () => {
      const invalidBaseline = [
        {
          ...sampleFixtureEntry,
          justification: "",
        },
      ];
      const rawOutputWithWarning = `
Warning: Function state mutability can be restricted to pure
  --> contracts/core/PerpEngine.sol:15:5
`;
      const res = runWarningBaselineCheck(rawOutputWithWarning, invalidBaseline);
      expect(res.success).to.be.false;
      expect(res.reason).to.equal("Invalid baseline justifications");
    });
  });

  describe("SUBMODULE_DRIFT_TEST", () => {
    it("should detect submodule SHA drift as an unapproved warning when SHA changes or isn't baselined", () => {
      const baselinedSubmoduleNotice = {
        file: "lib/forge-std",
        line: 0,
        column: 0,
        message: "expected 2f05b3001ed9d74b171d17eac80b3765ce186a76, found 1111111111111111111111111111111111111111",
        raw_warning: "Warning: lib/forge-std: expected 2f05b3001ed9d74b171d17eac80b3765ce186a76, found 1111111111111111111111111111111111111111",
        justification: "[THIRD_PARTY_PINNED] Submodule hash mismatch.",
      };

      const driftedOutput = `Warning: lib/forge-std: expected 2f05b3001ed9d74b171d17eac80b3765ce186a76, found 2222222222222222222222222222222222222222`;
      const actualWarnings = parseWarningsFromText(driftedOutput);
      expect(actualWarnings).to.have.lengthOf(1);

      const res = compareWarnings(actualWarnings, [baselinedSubmoduleNotice]);
      expect(res.success).to.be.false;
      expect(res.unexpectedWarnings).to.have.lengthOf(1);
      expect(res.unmatchedBaseline).to.have.lengthOf(1);
    });
  });

  describe("Repository Baseline Integrity Check", () => {
    it("should validate that all 850 entries in warnings-baseline.json have valid justifications", () => {
      const baseline = loadBaseline();
      expect(baseline).to.have.lengthOf(850);
      const invalid = validateBaselineJustifications(baseline);
      expect(invalid).to.have.lengthOf(0);
    });
  });
});
