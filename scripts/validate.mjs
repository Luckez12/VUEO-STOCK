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
const filenames = new Set();
const providerDir = path.join(root, 'providers');
const actualProviderFiles = fs.existsSync(providerDir)
  ? fs.readdirSync(providerDir)
      .filter(name => name.endsWith('.js') && name !== '_template.js')
      .map(name => `providers/${name}`)
      .sort()
  : [];

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

  if (filenames.has(scraper.filename)) {
    fail(`Duplicate provider filename: ${scraper.filename}`);
  }
  filenames.add(scraper.filename);

  const providerPath = path.join(root, scraper.filename);
  if (!fs.existsSync(providerPath)) fail(`Missing ${scraper.filename}`);

  const source = fs.readFileSync(providerPath, 'utf8');

  if (!source.includes('VUEO_TITLE_PROFILE_V1')) {
    fail(`${scraper.filename} is missing the repo-wide TMDB title profile marker`);
  }

  if (
    scraper.id === 'hdhub4u' &&
    /function\s+fetchWithTimeout\s*\([^)]*\)\s*\{[\s\S]*?fetchWithTimeout\s*\(\s*url\s*,\s*options\s*\|\|\s*\{\}\s*\)/.test(source)
  ) {
    fail('HDHub4u fetchWithTimeout must call native fetch, not itself');
  }

  if (scraper.id === 'hdhub4u' && (source.includes('?.') || source.includes('??'))) {
    fail('HDHub4u must avoid optional chaining/nullish coalescing for embedded QuickJS compatibility');
  }

  if (scraper.id === '4khdhub') {
    if (!source.includes('FOURK_MEMORY_SCOPE_GUARD_V1')) {
      fail('4KHDHub is missing the memory-scope guard marker');
    }
    if (!source.includes('extractCandidateUrlsFromHtml')) {
      fail('4KHDHub must parse host candidates into plain values before nested extraction');
    }
    if (/tasks\.push\(buildTask\(/.test(source)) {
      fail('4KHDHub must not eagerly start host tasks while a Cheerio DOM is still in scope');
    }
  }
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
    clearTimeout,
    Buffer,
    process: { env: {} },
    fetch: globalThis.fetch,
    atob: globalThis.atob,
    btoa: globalThis.btoa
  };

  // React Native style provider compatibility.
  // Some existing Nuvio-compatible providers reference global/globalThis.
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  try {
    vm.runInNewContext(source, sandbox, {
      filename: scraper.filename,
      timeout: 2000
    });
  } catch (error) {
    fail(`Cannot load ${scraper.filename}: ${error.message}`);
  }

  if (typeof moduleObject.exports.getStreams !== 'function') {
    fail(`${scraper.filename} must export getStreams`);
  }
}

const manifestFiles = [...filenames].sort();

for (const providerFile of actualProviderFiles) {
  if (!filenames.has(providerFile)) {
    fail(`Provider file is not listed in manifest: ${providerFile}`);
  }
}

for (const manifestFile of manifestFiles) {
  if (!actualProviderFiles.includes(manifestFile)) {
    fail(`Manifest references missing provider file: ${manifestFile}`);
  }
}

console.log(`Validated VUEO-STOCK with ${manifest.scrapers.length} provider(s).`);
