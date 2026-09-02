import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '../../..');
const artifactPath = path.join(
  repoRoot,
  'artifacts/contracts/core/PerpEngine.sol/PerpEngine.json'
);

const sdkAbiPath = path.join(__dirname, '../src/abi/PerpEngine.json');
const sdkAbiV1Path = path.join(__dirname, '../src/abi/v1/PerpEngine.json');

if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found at ${artifactPath}. Run pnpm run compile:hardhat first.`);
  process.exit(1);
}

const artifactContent = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const hardhatAbiString = JSON.stringify(artifactContent.abi);

let isStale = false;

for (const targetPath of [sdkAbiPath, sdkAbiV1Path]) {
  if (!fs.existsSync(targetPath)) {
    console.error(`SDK ABI file missing at ${targetPath}`);
    isStale = true;
    continue;
  }

  const sdkContent = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const sdkAbiString = JSON.stringify(sdkContent.abi);

  if (sdkAbiString !== hardhatAbiString) {
    console.error(`PerpEngine SDK ABI at ${targetPath} is stale relative to compiled Hardhat artifact.`);
    isStale = true;
  }
}

if (isStale) {
  console.error('Run "pnpm --filter @perpdex/sdk run sync:abi" to update the SDK ABI.');
  process.exit(1);
}

console.log('PerpEngine SDK ABI is in 100% exact parity with compiled Hardhat artifact.');
