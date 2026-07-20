#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { createAuthenticatedClient, invalidateQntechSessionCache } = require('../server/services/qntechAuthService.cjs');
const { PROJECTS_QUERY } = require('../server/services/qntechWaterValueImportService.cjs');

const dbPath = process.argv[2];
const date = String(process.argv[3] || '').slice(0, 10);
const needles = process.argv.slice(4);
const outputArgIndex = needles.findIndex((value) => value === '--output');
const outputPath = outputArgIndex >= 0 ? needles[outputArgIndex + 1] : '';
if (outputArgIndex >= 0) needles.splice(outputArgIndex, 2);
const useSheets = needles.includes('--sheets');
if (useSheets) needles.splice(needles.indexOf('--sheets'), 1);
const NEEDLE_ALIASES = {
  cheondeungsan: '\uCC9C\uB4F1\uC0B0',
  hoengseong: '\uD6A1\uC131',
};
for (let index = 0; index < needles.length; index += 1) {
  needles[index] = NEEDLE_ALIASES[needles[index]] || needles[index];
}

if (!dbPath || !/^\d{4}-\d{2}-\d{2}$/.test(date) || needles.length === 0) {
  console.error('usage: compare-qntech-site-samples.cjs <db-path> <YYYY-MM-DD> <site-name>...');
  process.exit(2);
}

async function main() {
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({ status: 'started' }), 'utf8');
  const db = new Database(path.resolve(dbPath));
  try {
    if (useSheets) {
      const sitesSheetsService = require('../server/services/sitesSheetsService.cjs');
      const sheetSites = await sitesSheetsService.getSites();
      if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({ status: 'sites-loaded', siteCount: sheetSites.length }), 'utf8');
      const targets = sheetSites.filter((site) => (
        site?.is_active !== 0
        && needles.some((needle) => String(site.site_name || '').includes(needle))
        && site.water_analysis_user_id
        && site.water_analysis_password
      ));
      if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({
        status: 'targets-selected',
        targets: targets.map((target) => target.site_name),
      }), 'utf8');
      const result = [];
      for (const target of targets) {
        db.prepare(`
          UPDATE web_app_credentials
          SET service_url = ?, user_id = ?, password = ?
          WHERE service_key = 'water_analysis_app'
        `).run(
          target.water_analysis_url || 'https://eco.qntech.co.kr',
          target.water_analysis_user_id,
          target.water_analysis_password
        );
        db.prepare(`
          UPDATE app_settings
          SET site_id = ?, site_name = ?, qntech_site_id = ?
          WHERE id = 1
        `).run(target.id || '', target.site_name || '', target.qntech_site_id || '');
        invalidateQntechSessionCache('comparison target changed');
        if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({ status: 'authenticating', target: target.site_name }), 'utf8');
        const client = await createAuthenticatedClient(db);
        if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({ status: 'authenticated', target: target.site_name }), 'utf8');
        const site = (client.me?.sites || []).find((item) => String(item.id) === String(target.qntech_site_id))
          || (client.me?.sites || [])[0];
        if (!site) continue;
        const response = await client.graphqlRequest(PROJECTS_QUERY, {
          data: { siteId: Number(site.id), regDt: date },
        }, '/');
        const projects = response?.selectProjectListByRegDt || [];
        result.push({
          configuredSiteName: target.site_name,
          site: { id: site.id, name: site.name },
          date,
          projects: projects.map((project) => ({
            id: project.id,
            analysisProcess: project.analysisProcess,
            note: project.note,
            measurements: (project.measurements || []).map((measurement) => ({
              sampleId: measurement?.sample?.id,
              sampleName: measurement?.sample?.name,
              itemName: measurement?.item?.name,
              ppm: measurement?.ppm,
            })),
          })),
        });
      }
      const output = JSON.stringify({ matchedSiteCount: result.length, result }, null, 2);
      if (outputPath) fs.writeFileSync(path.resolve(outputPath), output, 'utf8');
      else console.log(output);
      return;
    }

    const client = await createAuthenticatedClient(db);
    const sites = Array.isArray(client.me?.sites) ? client.me.sites : [];
    const selected = sites.filter((site) => needles.some((needle) => String(site.name || '').includes(needle)));
    const result = [];

    for (const site of selected) {
      const response = await client.graphqlRequest(PROJECTS_QUERY, {
        data: { siteId: Number(site.id), regDt: date },
      }, '/');
      const projects = response?.selectProjectListByRegDt || [];
      result.push({
        site: { id: site.id, name: site.name },
        date,
        projects: projects.map((project) => ({
          id: project.id,
          analysisProcess: project.analysisProcess,
          note: project.note,
          measurements: (project.measurements || []).map((measurement) => ({
            sampleId: measurement?.sample?.id,
            sampleName: measurement?.sample?.name,
            itemName: measurement?.item?.name,
            ppm: measurement?.ppm,
          })),
        })),
      });
    }

    const output = JSON.stringify({
      matchedSiteCount: selected.length,
      availableSites: sites.map((site) => ({ id: site.id, name: site.name })),
      result,
    }, null, 2);
    if (outputPath) fs.writeFileSync(path.resolve(outputPath), output, 'utf8');
    else console.log(output);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error.stack || error.message;
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), JSON.stringify({ error: message }, null, 2), 'utf8');
  else console.error(message);
  process.exit(1);
});
