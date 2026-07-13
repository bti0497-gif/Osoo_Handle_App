'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
// Release contract: runtime credentials always live under this canonical AppData
// directory. Do not derive this from Electron's userData path because that path
// follows the package/product name and can change between releases.
const APP_DATA_ROOT = path.join(
  process.env.APPDATA || process.env.LOCALAPPDATA || PROJECT_ROOT,
  'Osoo_Handle_App'
);
const RUNTIME_CONFIG_DIR = path.join(APP_DATA_ROOT, 'config');
const LEGACY_RUNTIME_CONFIG_DIR = path.join(
  process.env.APPDATA || process.env.LOCALAPPDATA || PROJECT_ROOT,
  'wastewater-treatment-plant',
  'config'
);
const IS_PACKAGED = String(process.env.OSOO_PACKAGED || '0') === '1';

function runtimeConfigPath(fileName) {
  return path.join(RUNTIME_CONFIG_DIR, fileName);
}

function resolveRuntimeConfigFile(fileName, developmentFallbacks = []) {
  const runtimePath = runtimeConfigPath(fileName);
  if (fs.existsSync(runtimePath)) return runtimePath;

  const legacyPath = path.join(LEGACY_RUNTIME_CONFIG_DIR, fileName);
  if (fs.existsSync(legacyPath)) return legacyPath;

  if (fs.existsSync(runtimePath) || IS_PACKAGED) return runtimePath;
  return developmentFallbacks.find((candidate) => candidate && fs.existsSync(candidate)) || runtimePath;
}

function loadRuntimeEnv() {
  const envPath = resolveRuntimeConfigFile('.env.local', [
    path.join(PROJECT_ROOT, '.env.local'),
  ]);
  return { ...dotenv.config({ path: envPath, quiet: true }), envPath };
}

function getGoogleServiceAccountPath() {
  return resolveRuntimeConfigFile('google-key.json', [
    path.join(PROJECT_ROOT, 'server', 'config', 'google-key.json'),
  ]);
}

function getBigQueryServiceAccountPath() {
  return resolveRuntimeConfigFile('bigquery-service-account.json', [
    path.join(PROJECT_ROOT, 'server', 'config', 'work-jindan-194620a46d59.json'),
  ]);
}

function getFirebaseServiceAccountPath() {
  return resolveRuntimeConfigFile('firebase-service-account.json', [
    path.join(PROJECT_ROOT, 'server', 'config', 'firebase-service-account.json'),
  ]);
}

function findOAuthClientSecretPath() {
  for (const dir of [RUNTIME_CONFIG_DIR, LEGACY_RUNTIME_CONFIG_DIR]) {
    if (!fs.existsSync(dir)) continue;
    const runtimeMatch = fs.readdirSync(dir)
      .find((name) => /^client_secret_.*\.json$/i.test(name));
    if (runtimeMatch) return path.join(dir, runtimeMatch);
  }
  if (IS_PACKAGED) return '';
  try {
    const developmentMatch = fs.readdirSync(PROJECT_ROOT)
      .find((name) => /^client_secret_.*\.json$/i.test(name));
    return developmentMatch ? path.join(PROJECT_ROOT, developmentMatch) : '';
  } catch (_) {
    return '';
  }
}

module.exports = {
  APP_DATA_ROOT,
  IS_PACKAGED,
  LEGACY_RUNTIME_CONFIG_DIR,
  PROJECT_ROOT,
  RUNTIME_CONFIG_DIR,
  findOAuthClientSecretPath,
  getBigQueryServiceAccountPath,
  getFirebaseServiceAccountPath,
  getGoogleServiceAccountPath,
  loadRuntimeEnv,
  runtimeConfigPath,
};
