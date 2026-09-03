import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EIP170_LIMIT = 24576; // Runtime bytecode limit (bytes)
const EIP3860_LIMIT = 49152; // Initcode limit (bytes)
const TARGET_BYTES = 24000;

function checkContractSize(contractName, relativeArtifactPath) {
  const artifactPath = path.resolve(__dirname, "..", relativeArtifactPath);
  if (!fs.existsSync(artifactPath)) {
    console.error(`❌ ERROR: Mandatory artifact for ${contractName} not found at ${artifactPath}. Fail-closed!`);
    return { name: contractName, exists: false, runtimeBytes: 0, initcodeBytes: 0, ok: false };
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  // 1. EIP-170 Runtime Bytecode Check
  const deployedBytecode = artifact.deployedBytecode || "";
  const runtimeHex = deployedBytecode.startsWith("0x")
    ? deployedBytecode.slice(2)
    : deployedBytecode;
  const runtimeBytes = runtimeHex.length / 2;
  const runtimeHeadroom = EIP170_LIMIT - runtimeBytes;

  // 2. EIP-3860 Initcode Check
  const bytecode = artifact.bytecode || "";
  const initcodeHex = bytecode.startsWith("0x")
    ? bytecode.slice(2)
    : bytecode;
  const initcodeBytes = initcodeHex.length / 2;
  const initcodeHeadroom = EIP3860_LIMIT - initcodeBytes;

  console.log(`--- ${contractName} ---`);
  console.log(`  Runtime size: ${runtimeBytes} bytes (EIP-170 limit: ${EIP170_LIMIT}, headroom: ${runtimeHeadroom} bytes)`);
  console.log(`  Initcode size: ${initcodeBytes} bytes (EIP-3860 limit: ${EIP3860_LIMIT}, headroom: ${initcodeHeadroom} bytes)`);

  let ok = true;

  if (runtimeBytes > EIP170_LIMIT) {
    console.error(
      `  ❌ ERROR: Runtime size (${runtimeBytes} bytes) exceeds EIP-170 limit (${EIP170_LIMIT} bytes) by ${
        runtimeBytes - EIP170_LIMIT
      } bytes!`
    );
    ok = false;
  } else if (runtimeBytes > TARGET_BYTES) {
    console.warn(
      `  ⚠️ WARNING: Runtime size (${runtimeBytes} bytes) exceeds safety target (${TARGET_BYTES} bytes). Remaining headroom: ${runtimeHeadroom} bytes.`
    );
  } else {
    console.log(`  ✅ SUCCESS: Runtime size is within safety target (${TARGET_BYTES} bytes).`);
  }

  if (initcodeBytes > EIP3860_LIMIT) {
    console.error(
      `  ❌ ERROR: Initcode size (${initcodeBytes} bytes) exceeds EIP-3860 limit (${EIP3860_LIMIT} bytes) by ${
        initcodeBytes - EIP3860_LIMIT
      } bytes!`
    );
    ok = false;
  } else {
    console.log(`  ✅ SUCCESS: Initcode size is within EIP-3860 limit (${EIP3860_LIMIT} bytes).`);
  }

  return { name: contractName, exists: true, runtimeBytes, initcodeBytes, ok };
}

console.log("=== Checking EIP-170 & EIP-3860 Contract Sizes ===");
const perpEngineResult = checkContractSize(
  "PerpEngine",
  "artifacts/contracts/core/PerpEngine.sol/PerpEngine.json"
);

const viewerResult = checkContractSize(
  "PerpEngineViewer",
  "artifacts/contracts/view/PerpEngineViewer.sol/PerpEngineViewer.json"
);

if (!perpEngineResult.ok || !viewerResult.ok) {
  process.exit(1);
}
