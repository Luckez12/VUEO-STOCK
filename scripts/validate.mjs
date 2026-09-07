import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const fail = message => {
  console.error(`Validation failed: ${message}`);
  process.exit(1);
};

const readJson = relativePath => {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) fail(`Missing ${relativePath}`);
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
};

const manifest = readJson('manifest.json');
if (typeof manifest.name !== 'string' || !manifest.name.trim()) fail('manifest.name is required');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('manifest.version must use semantic versioning');
if (!Array.isArray(manifest.scrapers)) fail('manifest.scrapers must be an array');

const ids = new Set();
const requiredFields = [
  'id', 'name', 'description', 'version', 'author',
  'supportedTypes', 'filename', 'enabled'
];

for (const scraper of manifest.scrapers) {
  for (const field of requiredFields) {
    if (scraper[field] === undefined || scraper[field] === null) fail(`Provider is missing ${field}`);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(scraper.id)) fail(`Invalid provider id: ${scraper.id}`);
  if (ids.has(scraper.id)) fail(`Duplicate provider id: ${scraper.id}`);
  ids.add(scraper.id);

  if (!/^\d+\.\d+\.\d+$/.test(scraper.version)) fail(`Invalid version for ${scraper.id}`);
  if (!Array.isArray(scraper.supportedTypes) || scraper.supportedTypes.length === 0) {
    fail(`supportedTypes is required for ${scraper.id}`);
  }

  const allowedTypes = new Set(['movie', 'tv']);
  for (const type of scraper.supportedTypes) {
    if (!allowedTypes.has(type)) fail(`Unsupported media type ${type} in ${scraper.id}`);
  }

  if (!scraper.filename.startsWith('providers/') || !scraper.filename.endsWith('.js')) {
    fail(`Invalid filename for ${scraper.id}`);
  }

  const providerPath = path.join(root, scraper.filename);
  if (!fs.existsSync(providerPath)) fail(`Missing ${scraper.filename}`);

  const source = fs.readFileSync(providerPath, 'utf8');
  const moduleObject = { exports: {} };
  const sandbox = {
    module: moduleObject,
    exports: moduleObject.exports,
    require: () => ({}),
    console,
    Promise,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
  };

  try {
    vm.runInNewContext(source, sandbox, { filename: scraper.filename, timeout: 2000 });
  } catch (error) {
    fail(`Cannot load ${scraper.filename}: ${error.message}`);
  }

  if (typeof moduleObject.exports.getStreams !== 'function') {
    fail(`${scraper.filename} must export getStreams`);
  }
}

console.log(`Validated VUEO-STOCK with ${manifest.scrapers.length} provider(s).`);
