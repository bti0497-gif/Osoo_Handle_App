'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const APP_DATA_ROOT = process.env.OSOO_APP_DATA_PATH
  || path.join(process.env.APPDATA || process.env.LOCALAPPDATA || PROJECT_ROOT, 'Osoo_Handle_App');
const RUNTIME_CONFIG_DIR = path.join(APP_DATA_ROOT, 'config');
const IS_PACKAGED = String(process.env.OSOO_PACKAGED || '0') === '1';

function runtimeConfigPath(fileName) {
  return path.join(RUNTIME_CONFIG_DIR, fileName);
}

function resolveRuntimeConfigFile(fileName, developmentFallbacks = []) {
  const runtimePath = runtimeConfigPath(fileName);
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
  if (fs.existsSync(RUNTIME_CONFIG_DIR)) {
    const runtimeMatch = fs.readdirSync(RUNTIME_CONFIG_DIR)
      .find((name) => /^client_secret_.*\.json$/i.test(name));
    if (runtimeMatch) return path.join(RUNTIME_CONFIG_DIR, runtimeMatch);
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
  PROJECT_ROOT,
  RUNTIME_CONFIG_DIR,
  findOAuthClientSecretPath,
  getBigQueryServiceAccountPath,
  getFirebaseServiceAccountPath,
  getGoogleServiceAccountPath,
  loadRuntimeEnv,
  runtimeConfigPath,
};
