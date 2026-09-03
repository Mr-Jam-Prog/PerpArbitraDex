import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcAbiPath = path.join(__dirname, '../src/abi/PerpEngine.json');
const distAbiPath = path.join(__dirname, '../dist/abi/PerpEngine.json');

if (!fs.existsSync(srcAbiPath)) {
  console.error(`SDK source ABI file missing at ${srcAbiPath}`);
  process.exit(1);
}

if (!fs.existsSync(distAbiPath)) {
  console.error(`SDK dist ABI file missing at ${distAbiPath}. Run pnpm --filter @perpdex/sdk run build.`);
  process.exit(1);
}

const srcContent = JSON.parse(fs.readFileSync(srcAbiPath, 'utf8'));
const distContent = JSON.parse(fs.readFileSync(distAbiPath, 'utf8'));

const srcAbiString = JSON.stringify(srcContent.abi);
const distAbiString = JSON.stringify(distContent.abi);

if (srcAbiString !== distAbiString) {
  console.error(
    'SDK dist ABI is stale. Run "pnpm --filter @perpdex/sdk run build" and commit regenerated tracked dist files.'
  );
  process.exit(1);
}

console.log('SDK dist ABI is in 100% exact parity with SDK source ABI.');
