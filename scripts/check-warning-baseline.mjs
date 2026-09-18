import { spawnSync } from "child_process";
import fs from "fs";

const BASELINE_FILE = "warnings-baseline.json";

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\([^B][B]/g, "");
}

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

function isFalsePositive(line) {
  const l = line.toLowerCase ? line.toLowerCase() : String(line).toLowerCase();
  if (/\b0 warnings?\b/.test(l)) return true;
  if (/warning count:\s*0\b/.test(l)) return true;
  if (l.includes("no warnings")) return true;
  if (l.includes("0 warning(s)")) return true;
  if (l.includes("no warning")) return true;
  return false;
}

function isKnownBenignSubmoduleNotice(line) {
  return /^Warning:\s*lib\/(forge-std|openzeppelin-contracts|solmate): expected [0-9a-f]{40}, found [0-9a-f]{40}/i.test(line.trim());
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

    if (isKnownBenignSubmoduleNotice(line)) {
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

export function runWarningBaselineCheck(customOutput = null) {
  const baselineEntries = loadBaseline();

  const unjustifiedBaseline = baselineEntries.filter(
    (b) => !b.justification || b.justification.trim().length === 0
  );
  if (unjustifiedBaseline.length > 0) {
    console.error(`❌ ${unjustifiedBaseline.length} baseline entries lack justification!`);
    return { success: false, code: 1, reason: "Unjustified baseline entries" };
  }

  let fullOutput = "";

  if (customOutput !== null) {
    fullOutput = customOutput;
  } else {
    console.log("=== Running Core Gate Steps and Checking Warnings ===");
    const env = {
      ...process.env,
      PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH || ""}`,
    };

    const steps = [
      { name: "install:frozen", cmd: "pnpm run install:frozen", checkWarnings: false },
      { name: "compile:hardhat", cmd: "pnpm exec hardhat compile --force", checkWarnings: true },
      { name: "check:contract-size", cmd: "node scripts/check-contract-size.mjs", checkWarnings: false },
      { name: "compile:forge", cmd: "forge build --force", checkWarnings: true },
      { name: "test:unit", cmd: "pnpm run test:unit", checkWarnings: false },
      { name: "test:forge", cmd: "forge test --offline --summary", checkWarnings: false },
      { name: "build:packages", cmd: "pnpm run build:packages", checkWarnings: false },
      { name: "test:math", cmd: "pnpm run test:math", checkWarnings: false },
    ];

    for (const step of steps) {
      console.log(`\n---> [STEP] ${step.name}`);
      const res = spawnSync(step.cmd, {
        shell: true,
        encoding: "utf-8",
        maxBuffer: 100 * 1024 * 1024,
        env,
      });

      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);

      if (step.checkWarnings) {
        fullOutput += (res.stdout || "") + "\n" + (res.stderr || "") + "\n";
      }

      if (res.error) {
        console.error(`\n❌ ERROR: Step ${step.name} child process error: ${res.error}`);
        return { success: false, code: 1, reason: `Step ${step.name} process error` };
      }
      if (res.status !== 0 && res.status !== null) {
        console.error(`\n❌ ERROR: Step ${step.name} failed with status code ${res.status}`);
        return { success: false, code: res.status, reason: `Step ${step.name} failed with status ${res.status}` };
      }
      if (res.signal) {
        console.error(`\n❌ ERROR: Step ${step.name} terminated by signal ${res.signal}`);
        return { success: false, code: 1, reason: `Step ${step.name} signal ${res.signal}` };
      }
    }
  }

  const actualWarnings = parseWarningsFromText(fullOutput);

  console.log(`\n=== Core Warning Baseline Gate Verification ===`);
  console.log(`Baseline contains ${baselineEntries.length} tolerated warnings.`);
  console.log(`Actual execution produced ${actualWarnings.length} unique warnings.`);

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

  let failed = false;

  if (unexpectedWarnings.length > 0) {
    console.error(`\n❌ ERROR: Found ${unexpectedWarnings.length} NEW or UNAPPROVED warnings!`);
    unexpectedWarnings.forEach((w) => {
      console.error(`  - [${w.file}:${w.line}:${w.column}] ${w.raw_warning}`);
    });
    failed = true;
  }

  if (unmatchedBaseline.length > 0) {
    console.error(
      `\n❌ ERROR: ${unmatchedBaseline.length} baseline warnings were NOT emitted during execution (stale baseline)!`
    );
    unmatchedBaseline.forEach((b) => {
      console.error(`  - [${b.file}:${b.line}:${b.column}] ${b.raw_warning}`);
    });
    failed = true;
  }

  if (failed) {
    console.error("\n❌ Core Warning Baseline Gate FAILED.");
    return { success: false, code: 1, reason: "Warning baseline mismatch" };
  }

  console.log("✅ Core Warning Baseline Gate PASSED: All warnings match tolerated baseline exactly with valid justifications.");
  return { success: true, code: 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runWarningBaselineCheck();
  if (!result.success) {
    process.exit(result.code || 1);
  }
}
