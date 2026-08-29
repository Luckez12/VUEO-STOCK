import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = relativePath => {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing file: ${relativePath}`);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
};

const registry = readJson('registry.json');
if (registry.schemaVersion !== 1) throw new Error('registry.json schemaVersion must be 1');
if (!Array.isArray(registry.providers)) throw new Error('registry.json providers must be an array');

const ids = new Set();
for (const item of registry.providers) {
  if (!item.id || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
    throw new Error(`Invalid provider id: ${item.id}`);
  }
  if (ids.has(item.id)) throw new Error(`Duplicate provider id: ${item.id}`);
  ids.add(item.id);

  const manifest = readJson(item.manifest);
  if (manifest.id !== item.id) throw new Error(`Manifest id mismatch for ${item.id}`);
  if (manifest.version !== item.version) throw new Error(`Version mismatch for ${item.id}`);

  const entryPath = path.join(root, item.entry);
  if (!fs.existsSync(entryPath)) throw new Error(`Missing provider entry: ${item.entry}`);
  const source = fs.readFileSync(entryPath, 'utf8');
  if (!source.includes('export default')) throw new Error(`Provider ${item.id} must export default`);
}

console.log(`Validated ${registry.providers.length} provider(s).`);
