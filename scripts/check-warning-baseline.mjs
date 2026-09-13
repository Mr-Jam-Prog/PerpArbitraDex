import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const BASELINE_FILE = "warnings-baseline.json";

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`❌ Baseline file ${BASELINE_FILE} does not exist!`);
    process.exit(1);
  }
  const raw = fs.readFileSync(BASELINE_FILE, "utf-8");
  return JSON.parse(raw);
}

function normalizePath(p) {
  return p.replace(/^(\.\/)+/, "").replace(/\\/g, "/");
}

function parseOutputFromCmd(cmd) {
  const res = spawnSync(cmd, { shell: true, encoding: "utf-8" });
  const combined = (res.stdout || "") + "\n" + (res.stderr || "");

  const lines = combined.split("\n");
  const warnings = [];
  let currentWarn = null;

  for (const line of lines) {
    if (line.startsWith("Warning:") || line.startsWith("Warning (")) {
      if (currentWarn) {
        warnings.push(currentWarn);
      }
      currentWarn = { warning: line.trim(), file: "", line: 0 };
    } else if (currentWarn && line.includes("-->")) {
      const match = line.match(/-->\s*(?:\.\/)?([^:]+):(\d+):(\d+)/);
      if (match) {
        currentWarn.file = normalizePath(match[1]);
        currentWarn.line = parseInt(match[2], 10);
      }
    }
  }
  if (currentWarn) {
    warnings.push(currentWarn);
  }

  return warnings.map((w) => {
    let msg = w.warning;
    if (msg.includes(":")) {
      msg = msg.split(":").slice(1).join(":").trim();
    } else if (msg.includes(")") && msg.includes("(")) {
      msg = msg.split(")").slice(1).join(")").trim();
    }
    return {
      file: normalizePath(w.file),
      line: w.line,
      message: msg,
      raw_warning: w.warning,
    };
  });
}

function main() {
  console.log("=== Checking Core Warning Baseline ===");

  const baselineEntries = loadBaseline();
  const actualWarnings = parseOutputFromCmd("pnpm exec hardhat compile --force");

  console.log(`Baseline contains ${baselineEntries.length} tolerated warnings.`);
  console.log(`Actual compilation produced ${actualWarnings.length} warnings.`);

  // Validate every entry in baseline has non-empty justification
  const unjustifiedBaseline = baselineEntries.filter(
    (b) => !b.justification || b.justification.trim().length === 0
  );
  if (unjustifiedBaseline.length > 0) {
    console.error(`❌ ${unjustifiedBaseline.length} baseline entries lack justification!`);
    process.exit(1);
  }

  // Check matching
  const unmatchedBaseline = [...baselineEntries];
  const unexpectedWarnings = [];

  for (const actual of actualWarnings) {
    const normFile = normalizePath(actual.file);
    const matchIdx = unmatchedBaseline.findIndex((b) => {
      const bFile = normalizePath(b.file);
      return (
        bFile === normFile &&
        (b.line === actual.line || Math.abs(b.line - actual.line) <= 2) &&
        (b.message === actual.message || b.raw_warning === actual.raw_warning)
      );
    });

    if (matchIdx !== -1) {
      unmatchedBaseline.splice(matchIdx, 1);
    } else {
      unexpectedWarnings.push(actual);
    }
  }

  let failed = false;

  if (unexpectedWarnings.length > 0) {
    console.error(`\n❌ ERROR: Found ${unexpectedWarnings.length} NEW or UNAPPROVED warnings!`);
    unexpectedWarnings.forEach((w) => {
      console.error(`  - [${w.file}:${w.line}] ${w.raw_warning}`);
    });
    failed = true;
  }

  if (unmatchedBaseline.length > 0) {
    console.error(
      `\n❌ ERROR: ${unmatchedBaseline.length} baseline warnings were NOT emitted during compilation (stale baseline)!`
    );
    unmatchedBaseline.forEach((b) => {
      console.error(`  - [${b.file}:${b.line}] ${b.raw_warning}`);
    });
    failed = true;
  }

  if (failed) {
    console.error("\n❌ Core Warning Baseline Gate FAILED.");
    process.exit(1);
  }

  console.log("✅ Core Warning Baseline Gate PASSED: All warnings match tolerated baseline exactly with valid justifications.");
}

main();
