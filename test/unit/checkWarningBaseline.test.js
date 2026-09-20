import { expect } from "chai";
import {
  parseWarningsFromText,
  compareWarnings,
  runWarningBaselineCheck,
  validateBaselineJustifications,
  parseJustificationCategory,
  getCoreGateSteps,
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

  describe("FAST_CHECK_WARNING_COLLECTION_DETERMINISTIC", () => {
    it("should ensure Hardhat and Forge warning compilation steps ALWAYS use --force regardless of FAST_CHECK", () => {
      process.env.FAST_CHECK = "1";
      const steps = getCoreGateSteps();
      delete process.env.FAST_CHECK;

      const hardhatStep = steps.find((s) => s.name === "compile:hardhat");
      const forgeStep = steps.find((s) => s.name === "compile:forge");

      expect(hardhatStep.cmd).to.include("--force");
      expect(forgeStep.cmd).to.include("--force");
      expect(hardhatStep.checkWarnings).to.be.true;
      expect(forgeStep.checkWarnings).to.be.true;
    });
  });

  describe("EXACT_CATEGORY_TOKEN_TEST", () => {
    it("should PASS for valid bracketed token [TEST_ONLY]", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "[TEST_ONLY] valid test justification" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(0);
      expect(parseJustificationCategory(entry[0].justification)).to.equal("TEST_ONLY");
    });

    it("should FAIL for [NOT_TEST_ONLY] unknown category token", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "[NOT_TEST_ONLY] explanation" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].reason).to.include("Unknown bracketed category token");
    });

    it("should FAIL for [TEST_ONLYISH] unknown category token", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "[TEST_ONLYISH] explanation" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].reason).to.include("Unknown bracketed category token");
    });

    it("should FAIL when category appears in prose without bracketed token", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "this prose mentions TEST_ONLY" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].reason).to.equal("Missing explicit bracketed category token");
    });

    it("should FAIL when bracketed category token is missing completely", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "explanation without category" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].reason).to.equal("Missing explicit bracketed category token");
    });

    it("should FAIL when bracketed category token is unknown", () => {
      const entry = [{ ...sampleFixtureEntry, justification: "[INVALID_CAT] explanation" }];
      const invalid = validateBaselineJustifications(entry);
      expect(invalid).to.have.lengthOf(1);
      expect(invalid[0].reason).to.equal("Unknown bracketed category token [INVALID_CAT]");
    });
  });

  describe("Real Child Process Failure Tests (W8 & W9 & Propagation)", () => {
    it("W8_REAL_CHILD_FAILURE — child process failure WITHOUT warnings fails closed", () => {
      const mockExecutor = (cmd, env, step) => {
        if (step.name === "compile:hardhat") {
          return { status: 1, stdout: "", stderr: "Fatal compilation error in solc" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const res = runWarningBaselineCheck(null, [sampleFixtureEntry], mockExecutor);
      expect(res.success).to.be.false;
      expect(res.status).to.equal(1);
      expect(res.step).to.equal("compile:hardhat");
      expect(res.reason).to.equal("Step compile:hardhat failed with status 1");
    });

    it("W9_REAL_CHILD_FAILURE_WITH_WARNINGS — child process failure WITH warnings present fails closed and is never converted to success", () => {
      const rawOutputWithWarning = `
Warning: Function state mutability can be restricted to pure
  --> contracts/core/PerpEngine.sol:15:5
Internal solc crash after warning emission
`;
      const mockExecutor = (cmd, env, step) => {
        if (step.name === "compile:hardhat") {
          return { status: 1, stdout: rawOutputWithWarning, stderr: "solc crashed with status 1" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const res = runWarningBaselineCheck(null, [sampleFixtureEntry], mockExecutor);
      expect(res.success).to.be.false;
      expect(res.status).to.equal(1);
      expect(res.step).to.equal("compile:hardhat");
      expect(res.reason).to.equal("Step compile:hardhat failed with status 1");
    });

    it("CHILD_ERROR_PROPAGATION — child process error is propagated and fails closed", () => {
      const spawnError = new Error("spawn ENOENT");
      const mockExecutor = (cmd, env, step) => {
        if (step.name === "install:frozen") {
          return { status: null, error: spawnError, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const res = runWarningBaselineCheck(null, [sampleFixtureEntry], mockExecutor);
      expect(res.success).to.be.false;
      expect(res.error).to.equal(spawnError);
      expect(res.reason).to.include("Step install:frozen process error");
    });

    it("CHILD_STATUS_PROPAGATION — nonzero status code is propagated and fails closed", () => {
      const mockExecutor = (cmd, env, step) => {
        if (step.name === "compile:forge") {
          return { status: 127, stdout: "", stderr: "forge: command not found" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const res = runWarningBaselineCheck(null, [sampleFixtureEntry], mockExecutor);
      expect(res.success).to.be.false;
      expect(res.code).to.equal(127);
      expect(res.status).to.equal(127);
      expect(res.reason).to.equal("Step compile:forge failed with status 127");
    });

    it("CHILD_SIGNAL_PROPAGATION — signal termination is propagated and fails closed", () => {
      const mockExecutor = (cmd, env, step) => {
        if (step.name === "test:unit") {
          return { status: null, signal: "SIGKILL", stdout: "", stderr: "Killed" };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const res = runWarningBaselineCheck(null, [sampleFixtureEntry], mockExecutor);
      expect(res.success).to.be.false;
      expect(res.signal).to.equal("SIGKILL");
      expect(res.reason).to.equal("Step test:unit terminated by signal SIGKILL");
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
    it("should validate that all 850 entries in warnings-baseline.json have valid justifications with exact category tokens", () => {
      const baseline = loadBaseline();
      expect(baseline).to.have.lengthOf(850);
      const invalid = validateBaselineJustifications(baseline);
      expect(invalid).to.have.lengthOf(0);
    });
  });
});
