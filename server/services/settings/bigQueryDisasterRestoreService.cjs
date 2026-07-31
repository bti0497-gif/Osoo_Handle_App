'use strict';

const fs = require('fs');
const path = require('path');
const { inspectOperationalData, restoreOperationalData } = require('../bigQueryRestoreService.cjs');

const ALLOWED_TABLES = new Set([
  'flow_readings',
  'medicine_logs',
  'kit_logs',
  'qntech_water_quality',
  'operation_status_logs',
]);

function normalizePayload(payload = {}) {
  const startDate = String(payload.startDate || '').slice(0, 10);
  const endDate = String(payload.endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    const error = new Error('복원 시작일과 종료일을 올바르게 입력해 주세요.');
    error.statusCode = 400;
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error('복원 시작일은 종료일보다 늦을 수 없습니다.');
    error.statusCode = 400;
    throw error;
  }
  const tables = (Array.isArray(payload.tables) ? payload.tables : [])
    .filter((table) => ALLOWED_TABLES.has(table));
  if (!tables.length) {
    const error = new Error('복원할 자료를 하나 이상 선택해 주세요.');
    error.statusCode = 400;
    throw error;
  }
  return { startDate, endDate, tables };
}

function getCurrentSite(db, siteId = '') {
  const configured = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  const selectedSiteId = String(siteId || configured.site_id || '').trim();
  if (!selectedSiteId) {
    const error = new Error('현재 현장의 site_id가 설정되지 않았습니다.');
    error.statusCode = 400;
    throw error;
  }
  const site = db.prepare('SELECT id, site_name FROM sites WHERE id = ? LIMIT 1').get(selectedSiteId);
  return {
    siteId: selectedSiteId,
    siteName: String(site?.site_name || configured.site_name || '').trim(),
  };
}

async function inspectBigQueryRestore(db, payload = {}) {
  return inspectOperationalData(db, {
    ...normalizePayload(payload),
    ...getCurrentSite(db, payload.siteId),
  });
}

async function applyBigQueryRestore(db, appDataPath, payload = {}) {
  const options = { ...normalizePayload(payload), ...getCurrentSite(db, payload.siteId) };
  if (String(payload.confirmation || '') !== 'BIGQUERY_RESTORE') {
    const error = new Error('BigQuery 복원 확인값이 올바르지 않습니다.');
    error.statusCode = 400;
    throw error;
  }

  const backupDir = path.join(appDataPath, 'backups', 'bigquery-restore');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `osoo-before-bigquery-restore-${stamp}.db`);
  await db.backup(backupPath);

  const result = await restoreOperationalData(db, options);
  const failures = Object.entries(result.result || {}).filter(([, item]) => !item?.success);
  if (!result.success || failures.length) {
    const error = new Error(
      failures.map(([table, item]) => `${table}: ${item.error || '복원 실패'}`).join(', ')
      || 'BigQuery 자료 복원에 실패했습니다.'
    );
    error.statusCode = 500;
    error.details = { backupPath, result };
    throw error;
  }
  return { ...result, backupPath, siteId: options.siteId, siteName: options.siteName };
}

module.exports = { inspectBigQueryRestore, applyBigQueryRestore };
