import { expect } from "chai";
import { parseWarningsFromText, runWarningBaselineCheck } from "../../scripts/check-warning-baseline.mjs";

describe("Warning Baseline Gate Suite (Prompt 08C P1 & P2 Gates)", () => {
  it("should parse clean warnings and ignore false-positive '0 warnings' lines", () => {
    const rawOutput = `
Warning: Function state mutability can be restricted to pure
  --> contracts/test/MockRiskManager.sol:15:5

0 warnings found.
warning count: 0
no warnings
`;
    const parsed = parseWarningsFromText(rawOutput);
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].file).to.equal("contracts/test/MockRiskManager.sol");
    expect(parsed[0].line).to.equal(15);
    expect(parsed[0].column).to.equal(5);
    expect(parsed[0].message).to.equal("Function state mutability can be restricted to pure");
  });

  it("should strip ANSI escape sequences from warning logs", () => {
    const ansiOutput = `\x1B[33mWarning:\x1B[0m Unused local variable\n  --> \x1B[32mcontracts/core/PerpEngine.sol:42:10\x1B[0m`;
    const parsed = parseWarningsFromText(ansiOutput);
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0].file).to.equal("contracts/core/PerpEngine.sol");
    expect(parsed[0].line).to.equal(42);
  });

  it("should deduplicate equivalent warnings across different tools", () => {
    const duplicateOutput = `
Warning: Unused local variable
  --> contracts/core/PerpEngine.sol:42:10

Warning: Unused local variable
  --> contracts/core/PerpEngine.sol:42:10
`;
    const parsed = parseWarningsFromText(duplicateOutput);
    expect(parsed).to.have.lengthOf(1);
  });

  it("should fail when an unknown/unapproved warning appears", () => {
    const unknownWarningOutput = `
Warning: Unhandled state mutability risk
  --> contracts/core/PerpEngine.sol:999:1
`;
    const res = runWarningBaselineCheck(unknownWarningOutput);
    expect(res.success).to.be.false;
  });

  it("should fail when child process output is missing expected baseline warnings (stale baseline)", () => {
    const emptyOutput = `Compilation finished without output.`;
    const res = runWarningBaselineCheck(emptyOutput);
    expect(res.success).to.be.false;
  });

  it("sentinel check: confirming unknown warning fails gate before clean run", () => {
    const mockOutputWithUnknown = `
Warning: Sentinel unknown warning for testing gate failure
  --> contracts/test/SentinelContract.sol:123:45
`;
    const res = runWarningBaselineCheck(mockOutputWithUnknown);
    expect(res.success).to.be.false;
    expect(res.reason).to.equal("Warning baseline mismatch");
  });

  it("should enforce exact column matching and NOT treat warnings at different columns as interchangeable", () => {
    const warnCol5 = `
Warning: Function state mutability can be restricted to pure
  --> contracts/test/MockRiskManager.sol:15:5
`;
    const warnCol10 = `
Warning: Function state mutability can be restricted to pure
  --> contracts/test/MockRiskManager.sol:15:10
`;
    const parsedCol5 = parseWarningsFromText(warnCol5);
    const parsedCol10 = parseWarningsFromText(warnCol10);

    expect(parsedCol5[0].column).to.equal(5);
    expect(parsedCol10[0].column).to.equal(10);
    expect(parsedCol5[0].column).to.not.equal(parsedCol10[0].column);

    // Simulated check where output has col 10 but baseline entry has col 5
    const mockOutput = warnCol10;
    const res = runWarningBaselineCheck(mockOutput);
    expect(res.success).to.be.false;
    expect(res.reason).to.equal("Warning baseline mismatch");
  });
});
