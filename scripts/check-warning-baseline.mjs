import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

const BASELINE_FILE = "warnings-baseline.json";

function logDirect(msg) {
  fs.writeSync(1, msg + "\n");
}

export const VALID_CATEGORIES = [
  "THIRD_PARTY_PINNED",
  "TEST_ONLY",
  "MOCK_ONLY",
  "LEGACY_QUARANTINED",
  "PRODUCTION_WARNING_DEBT",
  "UNRESOLVED_SECURITY_DEBT",
  "TOOLCHAIN_ENVIRONMENT",
];

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\([^B][B]/g, "");
}

export function loadBaseline(filePath = BASELINE_FILE) {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Baseline file ${filePath} does not exist!`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
}

function normalizePath(p) {
  if (!p) return "";
  return p.replace(/^(\.\/)+/, "").replace(/\\/g, "/");
}

function isFalsePositive(line) {
  const l = line.toLowerCase ? line.toLowerCase() : String(line).toLowerCase();
  if (/\b0 warnings?\b/.test(l)) return true;
  if (/warning count:\s*0\b/.test(l)) return true;
  if (l.includes("no warnings")) return true;
  if (l.includes("0 warning(s)")) return true;
  if (l.includes("no warning")) return true;
  return false;
}

export function parseWarningsFromText(rawText) {
  const cleanText = stripAnsi(rawText);
  const lines = cleanText.split("\n");
  const warnings = [];
  let currentWarn = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (isFalsePositive(line)) {
      continue;
    }

    if (
      line.startsWith("Warning:") ||
      line.startsWith("Warning (") ||
      /^warning\[.*\]:/.test(line) ||
      /\bDeprecationWarning\b/.test(line) ||
      /\bExperimentalWarning\b/.test(line)
    ) {
      if (currentWarn) {
        warnings.push(currentWarn);
      }
      currentWarn = { warning: line, file: "", line: 0, column: 0 };
    } else if (currentWarn && !currentWarn.file && (line.includes("-->") || line.includes("╭▸") || line.includes("┌─"))) {
      const match = line.match(/(?:-->|╭▸|┌─)\s*(?:\.\/)?([^:]+):(\d+):(\d+)/);
      if (match) {
        currentWarn.file = normalizePath(match[1]);
        currentWarn.line = parseInt(match[2], 10);
        currentWarn.column = parseInt(match[3], 10);
      }
    }
  }

  if (currentWarn) {
    warnings.push(currentWarn);
  }

  const parsedList = warnings.map((w) => {
    let msg = w.warning;
    if (msg.includes(":")) {
      msg = msg.split(":").slice(1).join(":").trim();
    } else if (msg.includes(")") && msg.includes("(")) {
      msg = msg.split(")").slice(1).join(")").trim();
    }
    return {
      file: normalizePath(w.file),
      line: w.line,
      column: w.column,
      message: msg,
      raw_warning: w.warning,
    };
  });

  const uniqueList = [];
  const seenKeys = new Set();
  for (const item of parsedList) {
    const key = `${item.file}:${item.line}:${item.column}:${item.message}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueList.push(item);
    }
  }
  return uniqueList;
}

export function compareWarnings(actualWarnings, baselineEntries) {
  const unmatchedBaseline = [...baselineEntries];
  const unexpectedWarnings = [];

  for (const actual of actualWarnings) {
    const normFile = normalizePath(actual.file);
    const matchIdx = unmatchedBaseline.findIndex((b) => {
      const bFile = normalizePath(b.file);
      if (normFile) {
        return (
          bFile === normFile &&
          b.line === actual.line &&
          b.column === actual.column &&
          (b.message === actual.message || b.raw_warning === actual.raw_warning)
        );
      } else {
        return (
          !bFile &&
          b.line === 0 &&
          b.column === 0 &&
          (b.message === actual.message || b.raw_warning === actual.raw_warning)
        );
      }
    });

    if (matchIdx !== -1) {
      unmatchedBaseline.splice(matchIdx, 1);
    } else {
      unexpectedWarnings.push(actual);
    }
  }

  return {
    unexpectedWarnings,
    unmatchedBaseline,
    success: unexpectedWarnings.length === 0 && unmatchedBaseline.length === 0,
  };
}

export function validateBaselineJustifications(baselineEntries) {
  const invalid = [];

  for (let i = 0; i < baselineEntries.length; i++) {
    const b = baselineEntries[i];
    const j = b.justification ? b.justification.trim() : "";

    if (!j) {
      invalid.push({ index: i, entry: b, reason: "Missing justification" });
      continue;
    }

    if (j.toLowerCase().includes("required for baseline gate")) {
      invalid.push({ index: i, entry: b, reason: "Generic circular justification" });
      continue;
    }

    const hasValidCategory = VALID_CATEGORIES.some((cat) => j.includes(cat));
    if (!hasValidCategory) {
      invalid.push({ index: i, entry: b, reason: "Missing valid category classification" });
    }
  }

  return invalid;
}

export function runWarningBaselineCheck(customOutput = null, customBaseline = null) {
  const baselineEntries = customBaseline !== null ? customBaseline : loadBaseline();

  const invalidJustifications = validateBaselineJustifications(baselineEntries);
  if (invalidJustifications.length > 0) {
    logDirect(`❌ ${invalidJustifications.length} baseline entries have invalid justifications!`);
    invalidJustifications.slice(0, 5).forEach((inv) => {
      logDirect(`  - Entry [${inv.entry.file}:${inv.entry.line}:${inv.entry.column}]: ${inv.reason}`);
    });
    return {
      success: false,
      code: 1,
      reason: "Invalid baseline justifications",
      invalidJustifications,
    };
  }

  let fullOutput = "";

  if (customOutput !== null) {
    fullOutput = customOutput;
  } else {
    logDirect("=== Running Core Gate Steps and Checking Warnings ===");
    const env = {
      ...process.env,
      PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH || ""}`,
    };

    const forceFlag = process.env.FAST_CHECK ? "" : " --force";

    const steps = [
      { name: "install:frozen", cmd: "pnpm run install:frozen", checkWarnings: false },
      { name: "compile:hardhat", cmd: `pnpm exec hardhat compile${forceFlag}`, checkWarnings: true },
      { name: "check:contract-size", cmd: "node scripts/check-contract-size.mjs", checkWarnings: false },
      { name: "compile:forge", cmd: `forge build${forceFlag}`, checkWarnings: true },
      { name: "test:unit", cmd: "pnpm run test:unit", checkWarnings: false },
      { name: "test:forge", cmd: "forge test --offline --summary", checkWarnings: false },
      { name: "build:packages", cmd: "pnpm run build:packages", checkWarnings: false },
      { name: "test:math", cmd: "pnpm run test:math", checkWarnings: false },
    ];

    for (const step of steps) {
      logDirect(`\n---> [STEP START] ${step.name}`);
      const t0 = Date.now();
      const res = spawnSync(step.cmd, {
        shell: true,
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
        env,
      });
      logDirect(`---> [STEP END] ${step.name} in ${(Date.now() - t0) / 1000}s, status: ${res.status}`);

      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);

      if (step.checkWarnings) {
        fullOutput += (res.stdout || "") + "\n" + (res.stderr || "") + "\n";
      }

      if (res.error) {
        logDirect(`\n❌ ERROR: Step ${step.name} child process error: ${res.error}`);
        return { success: false, code: 1, reason: `Step ${step.name} process error` };
      }
      if (res.status !== 0 && res.status !== null) {
        logDirect(`\n❌ ERROR: Step ${step.name} failed with status code ${res.status}`);
        return { success: false, code: res.status, reason: `Step ${step.name} failed with status ${res.status}` };
      }
      if (res.signal) {
        logDirect(`\n❌ ERROR: Step ${step.name} terminated by signal ${res.signal}`);
        return { success: false, code: 1, reason: `Step ${step.name} signal ${res.signal}` };
      }
    }
  }

  const actualWarnings = parseWarningsFromText(fullOutput);

  logDirect(`\n=== Core Warning Baseline Gate Verification ===`);
  logDirect(`Baseline contains ${baselineEntries.length} tolerated warnings.`);
  logDirect(`Actual execution produced ${actualWarnings.length} unique warnings.`);

  const comparison = compareWarnings(actualWarnings, baselineEntries);

  if (comparison.unexpectedWarnings.length > 0) {
    logDirect(`\n❌ ERROR: Found ${comparison.unexpectedWarnings.length} NEW or UNAPPROVED warnings!`);
    comparison.unexpectedWarnings.forEach((w) => {
      logDirect(`  - [${w.file}:${w.line}:${w.column}] ${w.raw_warning}`);
    });
  }

  if (comparison.unmatchedBaseline.length > 0) {
    logDirect(
      `\n❌ ERROR: ${comparison.unmatchedBaseline.length} baseline warnings were NOT emitted during execution (stale baseline)!`
    );
    comparison.unmatchedBaseline.forEach((b) => {
      logDirect(`  - [${b.file}:${b.line}:${b.column}] ${b.raw_warning}`);
    });
  }

  if (!comparison.success) {
    logDirect("\n❌ Core Warning Baseline Gate FAILED.");
    return {
      success: false,
      code: 1,
      reason: "Warning baseline mismatch",
      unexpectedWarnings: comparison.unexpectedWarnings,
      unmatchedBaseline: comparison.unmatchedBaseline,
    };
  }

  logDirect("✅ Core Warning Baseline Gate PASSED: All warnings match tolerated baseline exactly with valid justifications.");
  return {
    success: true,
    code: 0,
    unexpectedWarnings: comparison.unexpectedWarnings,
    unmatchedBaseline: comparison.unmatchedBaseline,
  };
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const result = runWarningBaselineCheck();
  if (!result.success) {
    process.exit(result.code || 1);
  }
}
