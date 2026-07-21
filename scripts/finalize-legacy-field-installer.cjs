#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outputRoot = path.join(root, 'release', 'integrated-deployment');
const installerName = `Osoo.Handle.App.Win7.x86.Integrated.Setup.${packageJson.version}.exe`;
const installerPath = path.join(outputRoot, installerName);
if (!fs.existsSync(installerPath)) throw new Error(`Installer not found: ${installerPath}`);

const buffer = fs.readFileSync(installerPath);
const manifest = {
  version: packageJson.version,
  platform: 'win7-ia32',
  autoUpdate: false,
  installerName,
  size: buffer.length,
  sha256: crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase(),
  generatedAt: new Date().toISOString(),
  asarValidation: true,
  nativeSqliteSmokeTest: true,
  installTargets: {
    primary: '%APPDATA%\\Osoo_Handle_App\\config',
    legacy: '%APPDATA%\\wastewater-treatment-plant\\config',
  },
  requiredConfigFiles: [
    '.env.local',
    'google-key.json',
    'bigquery-service-account.json',
    'firebase-service-account.json',
  ],
};
fs.writeFileSync(
  path.join(outputRoot, 'field-installer-manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);
console.log(JSON.stringify(manifest, null, 2));
