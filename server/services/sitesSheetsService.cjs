'use strict';

/**
 * sitesSheetsService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 구글 스프레드시트 현장 관리 서비스 (서비스 계정 인증)
 *
 * 스프레드시트 구조 (시트명: Wastewater_Sites, 1행 = 헤더):
 *   A: id  B: site_name  C: manager_name  D: method  E: series  F: is_active  G: notes
 *
 * 환경변수:
 *   GOOGLE_MEMBERS_SHEET_ID — 스프레드시트 파일 ID (여러 시트 포함)
 *   같은 파일 내에서 'Wastewater_Member' 시트와 'Wastewater_Sites' 시트 사용
 *
 * 첫 설정 방법:
 *   1. 이미 생성된 Google Sheets 파일에 새 시트 추가
 *   2. 새 시트 이름을 'Wastewater_Sites'로 지정
 *   3. 스프레드시트가 이미 서비스 계정과 공유된 상태
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { google } = require('googleapis');

const KEY_FILE   = path.join(__dirname, '../config/google-key.json');
const SHEET_NAME = 'Wastewater_Sites';
const HEADER_ROW = ['id', 'site_name', 'manager_name', 'method', 'series', 'is_active', 'notes'];
const HEADER_IDX = Object.fromEntries(HEADER_ROW.map((h, i) => [h, i]));

// 서비스 계정 인증
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

function getSheetId() {
  const id = String(process.env.GOOGLE_MEMBERS_SHEET_ID || '').trim();
  if (!id) throw new Error('GOOGLE_MEMBERS_SHEET_ID 환경변수가 설정되지 않았습니다. (회원/현장 공유 스프레드시트)');
  return id;
}

function isSheetsConfigured() {
  const fs = require('fs');
  return Boolean(
    fs.existsSync(KEY_FILE) &&
    process.env.GOOGLE_MEMBERS_SHEET_ID
  );
}

async function ensureSheetExists(sheetId) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties'
  });

  const hasSheet = (spreadsheet.data.sheets || []).some(
    (sheet) => sheet?.properties?.title === SHEET_NAME
  );

  if (hasSheet) {
    return;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: SHEET_NAME
            }
          }
        }
      ]
    }
  });
}

/** 행 배열 → 현장 객체 변환 */
function rowToSite(row) {
  const getAt = (index) => row[index] ?? '';

  const id = getAt(0);
  const site_name = getAt(1);
  const manager_name = getAt(2);
  const method = getAt(3) || 'A2O';
  const series = getAt(4) || '1계열';
  const is_active = getAt(5) === '1' || getAt(5) === 1 || getAt(5) === 'true' ? 1 : 0;
  const notes = getAt(6);

  return {
    id,
    site_name,
    manager_name,
    method,
    series,
    is_active,
    notes
  };
}

/** 현장 객체 → 행 배열 변환 */
function siteToRow(site) {
  return HEADER_ROW.map(col => {
    if (col === 'is_active') {
      return site[col] ? '1' : '0';
    }
    const v = site[col];
    return v != null ? String(v) : '';
  });
}

/**
 * 헤더 행 초기화 (첫 사용 시)
 * 이미 있으면 스킵.
 */
async function ensureHeader(sheetId) {
  await ensureSheetExists(sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:G1`
  });
  const existing = (res.data.values || [])[0] || [];
  if (existing[0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] }
    });
  }
}

/**
 * 시트 전체 읽기 (2행~) → 현장 배열 반환
 */
async function getSites() {
  if (!isSheetsConfigured()) return [];
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:G`
  });

  return (res.data.values || [])
    .filter(row => row[0])        // id 비어있는 행 제외
    .map(rowToSite);
}

/**
 * 현장 upsert (id로 기존 행 검색 → 없으면 append, 있으면 update)
 */
async function upsertSite(site) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  // 전체 조회 후 id 검색
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:A`   // id 컬럼만 (헤더 제외)
  });
  const idCol = ['id', ...(res.data.values || []).map(r => r[0] || '')];  // 헤더 추가
  const rowIndex = idCol.indexOf(String(site.id));   // 0-based

  const newRow = siteToRow(site);

  if (rowIndex <= 0) {
    // 새 행 추가 (append)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } else {
    // 기존 행 업데이트 (1-based 시트 행 번호 = rowIndex + 1)
    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A${sheetRow}:G${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
  }
}

/**
 * 현장 삭제 (해당 id 행을 is_active = 0으로 표시)
 */
async function deleteSite(id) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const sheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(id));

  if (rowIndex <= 0) {
    throw new Error('삭제할 현장을 찾을 수 없습니다.');
  }

  const sheetRow = rowIndex;
  const currentRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:G${sheetRow}`
  });
  const currentRow = (currentRes.data.values || [])[0] || [];
  currentRow[5] = '0';  // is_active 컬럼을 0으로

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:G${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [currentRow] }
  });
}

module.exports = {
  isSheetsConfigured,
  getSites,
  upsertSite,
  deleteSite
};
