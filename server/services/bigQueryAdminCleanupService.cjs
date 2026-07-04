const { getBigQueryClient, DATASET_ID } = require('./bigQueryClientService.cjs');
const { recordDiagnostic } = require('./diagnosticLogService.cjs');
const { appDataPath } = require('../database.cjs');

const OPERATIONAL_TABLES = [
  'flow_readings',
  'medicine_logs',
  'qntech_water_quality',
  'kit_logs',
];

function normalize(value) {
  return String(value || '').trim();
}

function getCurrentSiteScope(db) {
  const row = db.prepare('SELECT site_id, site_name FROM app_settings WHERE id = 1').get() || {};
  const siteId = normalize(row.site_id);
  const siteName = normalize(row.site_name);

  if (!siteId && !siteName) {
    const error = new Error('현재 앱에 설정된 현장이 없어 BigQuery 데이터를 삭제할 수 없습니다.');
    error.statusCode = 400;
    throw error;
  }

  return { siteId, siteName };
}

function quoteTable(tableName) {
  return `\`${DATASET_ID}.${String(tableName).replace(/`/g, '')}\``;
}

async function queryCount(bq, tableName, siteId, siteName) {
  const [rows] = await bq.query({
    query: `
      SELECT COUNT(1) AS row_count
      FROM ${quoteTable(tableName)}
      WHERE
        (@siteId != '' AND site_id = @siteId)
        OR (@siteName != '' AND site_name = @siteName)
    `,
    params: { siteId, siteName },
  });
  return Number(rows?.[0]?.row_count || 0);
}

async function deleteRows(bq, tableName, siteId, siteName) {
  await bq.query({
    query: `
      DELETE FROM ${quoteTable(tableName)}
      WHERE
        (@siteId != '' AND site_id = @siteId)
        OR (@siteName != '' AND site_name = @siteName)
    `,
    params: { siteId, siteName },
  });
}

async function clearOperationalBigQueryDataForCurrentSite(db, { confirmed = false } = {}) {
  if (!confirmed) {
    const error = new Error('삭제 확인 값이 없어 작업을 중단했습니다.');
    error.statusCode = 400;
    throw error;
  }

  const bq = getBigQueryClient();
  if (!bq) {
    const error = new Error('BigQuery 클라이언트를 초기화할 수 없습니다.');
    error.statusCode = 503;
    throw error;
  }

  const { siteId, siteName } = getCurrentSiteScope(db);
  const results = {};

  for (const tableName of OPERATIONAL_TABLES) {
    try {
      const countBefore = await queryCount(bq, tableName, siteId, siteName);
      if (countBefore > 0) {
        await deleteRows(bq, tableName, siteId, siteName);
      }
      results[tableName] = {
        success: true,
        deletedCount: countBefore,
      };
    } catch (err) {
      const message = String(err.message || err);
      const notFound = /Not found|404/i.test(message);
      results[tableName] = {
        success: notFound,
        skipped: notFound,
        deletedCount: 0,
        error: notFound ? 'table-not-found' : message,
      };
      if (!notFound) {
        throw err;
      }
    }
  }

  const totalDeleted = Object.values(results).reduce((sum, row) => sum + Number(row.deletedCount || 0), 0);
  recordDiagnostic(db, appDataPath, {
    level: 'warn',
    area: 'bigquery',
    action: 'admin-clear-operational-data',
    result: 'ok',
    message: `admin cleared BigQuery operational data for ${siteName || siteId}: ${totalDeleted} rows`,
    details: { siteId, siteName, totalDeleted, results },
  });

  return {
    siteId,
    siteName,
    tables: OPERATIONAL_TABLES,
    results,
    totalDeleted,
  };
}

module.exports = {
  OPERATIONAL_TABLES,
  clearOperationalBigQueryDataForCurrentSite,
};
