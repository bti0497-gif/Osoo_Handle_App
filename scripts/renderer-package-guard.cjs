#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

function fail(message) {
  throw new Error(`[renderer-package-guard] ${message}`);
}

function assertRendererBuild(projectDir) {
  const distDir = path.join(projectDir, 'dist');
  const indexPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexPath)) fail(`missing renderer entry: ${indexPath}`);

  const html = fs.readFileSync(indexPath, 'utf8');
  const assetRefs = [...html.matchAll(/(?:src|href)=["']\.\/?assets\/([^"']+)["']/g)]
    .map((match) => match[1]);
  const jsRefs = assetRefs.filter((name) => name.endsWith('.js'));
  const cssRefs = assetRefs.filter((name) => name.endsWith('.css'));
  if (jsRefs.length === 0) fail('dist/index.html does not reference a JavaScript bundle');
  if (cssRefs.length === 0) fail('dist/index.html does not reference a CSS bundle');

  for (const asset of assetRefs) {
    const assetPath = path.join(distDir, 'assets', asset);
    if (!fs.existsSync(assetPath)) fail(`referenced renderer asset is missing: ${assetPath}`);
    if (fs.statSync(assetPath).size === 0) fail(`renderer asset is empty: ${assetPath}`);
  }

  return { indexPath, assetCount: assetRefs.length, jsCount: jsRefs.length, cssCount: cssRefs.length };
}

function assertPackagedRenderer(appOutDir) {
  const asarPath = path.join(appOutDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) fail(`packaged app.asar is missing: ${asarPath}`);
  const entries = new Set(asar.listPackage(asarPath).map((entry) => entry.replace(/\\/g, '/')));
  if (!entries.has('/dist/index.html')) fail('packaged app.asar is missing /dist/index.html');
  if (![...entries].some((entry) => /^\/dist\/assets\/.+\.js$/i.test(entry))) {
    fail('packaged app.asar contains no renderer JavaScript bundle');
  }
  if (![...entries].some((entry) => /^\/dist\/assets\/.+\.css$/i.test(entry))) {
    fail('packaged app.asar contains no renderer CSS bundle');
  }
  return { asarPath };
}

function ensureUpdaterConfig(appOutDir) {
  const updaterConfigPath = path.join(appOutDir, 'resources', 'app-update.yml');
  if (!fs.existsSync(updaterConfigPath)) {
    fs.writeFileSync(updaterConfigPath, [
      'owner: bti0497-gif',
      'repo: Osoo_Handle_App',
      'provider: github',
      'releaseType: release',
      'updaterCacheDirName: wastewater-treatment-plant-updater',
      '',
    ].join('\n'), 'utf8');
    console.log(`[renderer-package-guard] generated updater config: ${updaterConfigPath}`);
  }
  return updaterConfigPath;
}

async function beforePack(context) {
  const result = assertRendererBuild(context.appDir || process.cwd());
  console.log(`[renderer-package-guard] source renderer verified (${result.assetCount} assets)`);
}

async function afterPack(context) {
  const result = assertPackagedRenderer(context.appOutDir);
  const updaterConfigPath = ensureUpdaterConfig(context.appOutDir);
  console.log(`[renderer-package-guard] packaged renderer verified: ${result.asarPath}`);
  console.log(`[renderer-package-guard] updater config verified: ${updaterConfigPath}`);
}

if (require.main === module) {
  const result = assertRendererBuild(path.resolve(__dirname, '..'));
  console.log(`[renderer-package-guard] renderer build verified (${result.assetCount} assets)`);
}

module.exports = { assertRendererBuild, assertPackagedRenderer, ensureUpdaterConfig, beforePack, afterPack };
