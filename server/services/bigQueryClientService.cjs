'use strict';

/**
 * bigQueryClientService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * BigQuery 클라이언트 싱글톤 + 공통 상수
 * BigQuery 클라이언트 싱글톤 + 공통 상수
 */

const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

const KEY_FILE_PATH = path.join(__dirname, '../config/work-jindan-194620a46d59.json');
const DATASET_ID = 'daily_log_system';

let _client = null;

function getBigQueryClient() {
  if (_client) return _client;

  if (!fs.existsSync(KEY_FILE_PATH)) {
    console.warn('[BigQuery] 키 파일 없음:', KEY_FILE_PATH);
    return null;
  }

  try {
    _client = new BigQuery({ keyFilename: KEY_FILE_PATH });
    return _client;
  } catch (err) {
    console.error('[BigQuery] 클라이언트 초기화 실패:', err.message);
    return null;
  }
}

module.exports = { getBigQueryClient, DATASET_ID };
