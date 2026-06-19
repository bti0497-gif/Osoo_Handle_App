'use strict';

/**
 * bigQueryClientService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * BigQuery 클라이언트 싱글톤 + 공통 상수
 * BigQuery 클라이언트 싱글톤 + 공통 상수
 */

const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const { getBigQueryServiceAccountPath } = require('../config/runtimeConfig.cjs');

const DATASET_ID = 'daily_log_system';

let _client = null;

function getBigQueryClient() {
  if (_client) return _client;
  const keyFilePath = getBigQueryServiceAccountPath();

  if (!fs.existsSync(keyFilePath)) {
    console.warn('[BigQuery] 키 파일 없음:', keyFilePath);
    return null;
  }

  try {
    _client = new BigQuery({ keyFilename: keyFilePath });
    return _client;
  } catch (err) {
    console.error('[BigQuery] 클라이언트 초기화 실패:', err.message);
    return null;
  }
}

module.exports = { getBigQueryClient, DATASET_ID };
