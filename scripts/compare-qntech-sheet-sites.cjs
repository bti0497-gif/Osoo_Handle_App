#!/usr/bin/env node
'use strict';

const sitesSheetsService = require('../server/services/sitesSheetsService.cjs');
const { httpRequest, normalizeBaseUrl } = require('../server/services/qntechAuthService.cjs');
const { PROJECTS_QUERY } = require('../server/services/qntechWaterValueImportService.cjs');

const LOGIN_MUTATION = `mutation Login($userId: String!, $password: String!) {
  signIn(data: { userId: $userId, password: $password }) { id }
}`;
const ME_QUERY = `query Me { me { id name sites { id name address } } }`;
const ALIASES = { cheondeungsan: '천등산', hoengseong: '횡성' };

function createJar() {
  const cookies = new Map();
  return {
    add(headers) {
      for (const raw of (Array.isArray(headers) ? headers : headers ? [headers] : [])) {
        const pair = String(raw).split(';')[0];
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
      }
    },
    header() { return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '); },
  };
}

async function graphql(baseUrl, jar, query, variables, referer = '/') {
  const body = JSON.stringify({ query, variables });
  const response = await httpRequest(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Osoo-QnTECH/1.0',
      Origin: baseUrl,
      Referer: `${baseUrl}${referer}`,
      ...(jar.header() ? { Cookie: jar.header() } : {}),
    },
    body,
  });
  jar.add(response.headers['set-cookie']);
  const parsed = JSON.parse(response.body.toString('utf8'));
  if (response.statusCode >= 400 || parsed.errors?.length) {
    throw new Error(parsed.errors?.map((item) => item.message).join(' | ') || `status=${response.statusCode}`);
  }
  return parsed.data;
}

async function querySite(target, date) {
  const baseUrl = normalizeBaseUrl(target.water_analysis_url);
  const jar = createJar();
  const seed = await httpRequest(`${baseUrl}/login`, { headers: { 'User-Agent': 'Osoo-QnTECH/1.0' } });
  jar.add(seed.headers['set-cookie']);
  await graphql(baseUrl, jar, LOGIN_MUTATION, {
    userId: target.water_analysis_user_id,
    password: target.water_analysis_password,
  }, '/login');
  const me = (await graphql(baseUrl, jar, ME_QUERY, {}, '/')).me;
  const site = (me?.sites || []).find((item) => String(item.id) === String(target.qntech_site_id))
    || (me?.sites || [])[0];
  if (!site) throw new Error('접근 가능한 현장이 없습니다.');
  const data = await graphql(baseUrl, jar, PROJECTS_QUERY, {
    data: { siteId: Number(site.id), regDt: date },
  });
  return {
    configuredSiteName: target.site_name,
    qntechSite: { id: site.id, name: site.name },
    projects: (data?.selectProjectListByRegDt || []).map((project) => ({
      id: project.id,
      analysisProcess: project.analysisProcess,
      samples: (project.measurements || []).map((measurement) => ({
        sampleId: measurement?.sample?.id,
        sampleName: measurement?.sample?.name,
        itemName: measurement?.item?.name,
        ppm: measurement?.ppm,
      })),
    })),
  };
}

async function main() {
  const date = String(process.argv[2] || '').slice(0, 10);
  const needles = process.argv.slice(3).map((value) => ALIASES[value] || value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || needles.length === 0) throw new Error('날짜와 현장명이 필요합니다.');
  const sites = await sitesSheetsService.getSites();
  const targets = sites.filter((site) => (
    site?.is_active !== 0
    && needles.some((needle) => String(site.site_name || '').includes(needle))
    && site.water_analysis_user_id
    && site.water_analysis_password
  ));
  const results = [];
  for (const target of targets) {
    try {
      results.push(await querySite(target, date));
    } catch (error) {
      results.push({ configuredSiteName: target.site_name, error: error.message });
    }
  }
  console.log(JSON.stringify({ date, results }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
