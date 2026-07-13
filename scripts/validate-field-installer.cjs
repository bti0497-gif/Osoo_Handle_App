#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const projectRoot = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const outputDir = path.join(projectRoot, 'release', 'integrated-deployment');
const installerName = `Osoo.Handle.App.Integrated.Setup.${packageJson.version}.exe`;
const installerPath = path.join(outputDir, installerName);
const manifestPath = path.join(outputDir, 'field-installer-manifest.json');
const requiredConfigFiles = [
  '.env.local',
  'google-key.json',
  'bigquery-service-account.json',
  'firebase-service-account.json',
];

function fail(message) {
  console.error(`[Field Installer FAIL] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(installerPath)) fail(`Installer is missing: ${installerPath}`);
if (!fs.existsSync(manifestPath)) fail(`Deployment manifest is missing: ${manifestPath}`);

const manifestText = fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '');
const manifest = JSON.parse(manifestText);
const actualHash = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex').toUpperCase();
const actualSize = fs.statSync(installerPath).size;

if (manifest.version !== packageJson.version) fail('Manifest version does not match package.json.');
if (manifest.installerName !== installerName) fail('Manifest installer name does not match.');
if (String(manifest.sha256 || '').toUpperCase() !== actualHash) fail('Installer SHA256 does not match manifest.');
if (manifest.size !== actualSize) fail('Installer size does not match manifest.');
if (manifest.asarValidation !== true || manifest.nativeSqliteSmokeTest !== true) {
  fail('Packaged ASAR/native validation result is not recorded as passed.');
}
if (manifest.installTargets?.primary !== '%APPDATA%\\Osoo_Handle_App\\config') {
  fail('Primary runtime config install target is incorrect.');
}
if (manifest.installTargets?.legacy !== '%APPDATA%\\wastewater-treatment-plant\\config') {
  fail('Legacy runtime config install target is incorrect.');
}
for (const fileName of requiredConfigFiles) {
  if (!manifest.requiredConfigFiles?.includes(fileName)) {
    fail(`Required runtime config is missing from manifest: ${fileName}`);
  }
}

console.log(`[Field Installer PASS] ${installerPath}`);
console.log(`[Field Installer PASS] version=${manifest.version} size=${actualSize} sha256=${actualHash}`);
console.log('[Field Installer PASS] Both AppData config targets and all required credentials are declared.');
