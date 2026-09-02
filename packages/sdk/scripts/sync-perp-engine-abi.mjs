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
  console.error(`Artifact not found at ${artifactPath}. Please run hardhat compile first.`);
  process.exit(1);
}

const artifactContent = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
if (!artifactContent.abi) {
  console.error(`No ABI found in artifact ${artifactPath}`);
  process.exit(1);
}

const formattedJson = JSON.stringify({ abi: artifactContent.abi }, null, 2) + '\n';

fs.mkdirSync(path.dirname(sdkAbiPath), { recursive: true });
fs.mkdirSync(path.dirname(sdkAbiV1Path), { recursive: true });

fs.writeFileSync(sdkAbiPath, formattedJson, 'utf8');
fs.writeFileSync(sdkAbiV1Path, formattedJson, 'utf8');

console.log('Successfully synchronized PerpEngine SDK ABI from compiled Hardhat artifact.');
