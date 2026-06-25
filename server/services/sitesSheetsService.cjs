'use strict';

/**
 * sitesSheetsService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 구글 스프레드시트 현장 관리 서비스 (서비스 계정 인증)
 *
 * 스프레드시트 구조 (시트명: Wastewater_Sites, 1행 = 헤더):
 *   id, site_name, manager_name, method, series, is_active, notes
 *   road_web_user_id, road_web_password
 *   water_analysis_user_id, water_analysis_password
 *
 * 공통 앱 설정 시트 (시트명: Wastewater_App_Settings):
 *   setting_key, setting_value, notes
 *
 * ─────────────────────────────────────────────────────────────────────
 *   GOOGLE_MEMBERS_SHEET_ID — 스프레드시트 파일 ID (여러 시트 포함)
 *   같은 파일 내에서 'Wastewater_Member' 시트와 'Wastewater_Sites' 시트 사용
 *
 * 환경변수:
 *   1. 이미 생성된 Google Sheets 파일에 새 시트 추가
 *   2. 새 시트 이름을 'Wastewater_Sites'로 지정
 *   3. 스프레드시트가 이미 서비스 계정과 공유된 상태
 */

const { google } = require('googleapis');
const { getGoogleServiceAccountPath, loadRuntimeEnv } = require('../config/runtimeConfig.cjs');

loadRuntimeEnv();
const KEY_FILE   = getGoogleServiceAccountPath();
const SHEET_NAME = 'Wastewater_Sites';
const KMSC_SHEET_NAME = 'KMSC';
const APP_SETTINGS_SHEET_NAME = 'Wastewater_App_Settings';
const HEADER_ROW = [
  'id',
  'site_name',
  'manager_name',
  'method',
  'series',
  'is_active',
  'notes',
  'road_web_user_id',
  'road_web_password',
  'water_analysis_user_id',
  'water_analysis_password',
  'qntech_site_id',
];
const APP_SETTINGS_HEADER_ROW = ['setting_key', 'setting_value', 'notes'];

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

async function ensureNamedSheetExists(sheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets.properties'
  });

  const hasSheet = (spreadsheet.data.sheets || []).some(
    (sheet) => sheet?.properties?.title === sheetName
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
              title: sheetName
            }
          }
        }
      ]
    }
  });
}

function columnLetter(index) {
  let n = index + 1;
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function normalizeHeaderFor(header, requiredHeader) {
  const cleaned = (header || []).map((item) => String(item || '').trim());
  const merged = [...cleaned];
  for (const col of requiredHeader) {
    if (!merged.includes(col)) {
      merged.push(col);
    }
  }
  return merged;
}

function normalizeHeader(header) {
  return normalizeHeaderFor(header, HEADER_ROW);
}

function headerIndex(header) {
  return Object.fromEntries((header || []).map((h, i) => [h, i]));
}

/** 행 배열 → 현장 객체 변환 */
function rowToSite(row, header = HEADER_ROW) {
  const index = headerIndex(header);
  const get = (col) => row[index[col]] ?? '';

  const id = get('id');
  const site_name = get('site_name');
  const manager_name = get('manager_name');
  const method = get('method') || 'A2O';
  const series = get('series') || '1계열';
  const isActiveValue = get('is_active');
  const is_active = isActiveValue === '1' || isActiveValue === 1 || isActiveValue === 'true' ? 1 : 0;
  const notes = get('notes');

  return {
    id,
    site_name,
    manager_name,
    method,
    series,
    is_active,
    notes,
    road_web_user_id: get('road_web_user_id'),
    road_web_password: get('road_web_password'),
    water_analysis_user_id: get('water_analysis_user_id'),
    water_analysis_password: get('water_analysis_password'),
    qntech_site_id: get('qntech_site_id'),
  };
}

async function getKmscSiteSettings(sheetId) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${KMSC_SHEET_NAME}!A1:Z`
    });
    const rows = res.data.values || [];
    const header = rows[0] || [];
    const index = headerIndex(header);

    return new Map(
      rows.slice(1)
        .map((row) => {
          const siteName = String(row[index['place name']] || '').trim();
          if (!siteName) return null;
          return [siteName, {
            water_analysis_user_id: String(row[index['id name']] || '').trim(),
            water_analysis_password: String(row[index.password] || '').trim(),
            qntech_site_id: String(row[index.qntech_site_id] || '').trim(),
          }];
        })
        .filter(Boolean)
    );
  } catch (error) {
    if (error?.code === 400 || error?.code === 404) {
      return new Map();
    }
    throw error;
  }
}

/** 행 배열 → 현장 객체 변환 */
function siteToRow(site, header = HEADER_ROW, existingRow = []) {
  const merged = rowToSite(existingRow, header);
  const source = { ...merged, ...site };

  return header.map(col => {
    if (col === 'is_active') {
      return source[col] ? '1' : '0';
    }
    const v = source[col];
    return v != null ? String(v) : '';
  });
}

async function ensureSheetExists(sheetId) {
  await ensureNamedSheetExists(sheetId, SHEET_NAME);
}

async function getHeader(sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!1:1`
  });
  return normalizeHeader((res.data.values || [])[0] || []);
}

async function ensureAppSettingsHeader(sheetId) {
  await ensureNamedSheetExists(sheetId, APP_SETTINGS_SHEET_NAME);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${APP_SETTINGS_SHEET_NAME}!1:1`
  });
  const existing = (res.data.values || [])[0] || [];
  const nextHeader = normalizeHeaderFor(existing, APP_SETTINGS_HEADER_ROW);

  if (existing[0] !== 'setting_key' || nextHeader.some((col, idx) => col !== existing[idx])) {
    const endCol = columnLetter(nextHeader.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${APP_SETTINGS_SHEET_NAME}!A1:${endCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [nextHeader] }
    });
  }

  return nextHeader;
}

async function getAppSettings() {
  if (!isSheetsConfigured()) return {};
  const sheetId = getSheetId();
  const header = await ensureAppSettingsHeader(sheetId);
  const endCol = columnLetter(header.length - 1);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${APP_SETTINGS_SHEET_NAME}!A2:${endCol}`
  });
  const index = headerIndex(header);
  const settings = {};
  for (const row of res.data.values || []) {
    const key = String(row[index.setting_key] || '').trim();
    if (!key) continue;
    settings[key] = String(row[index.setting_value] || '').trim();
  }
  return settings;
}

async function upsertAppSettings(settings = {}) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const entries = Object.entries(settings).filter(([key]) => String(key || '').trim());
  if (entries.length === 0) return {};

  const sheetId = getSheetId();
  const header = await ensureAppSettingsHeader(sheetId);
  const endCol = columnLetter(header.length - 1);
  const index = headerIndex(header);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${APP_SETTINGS_SHEET_NAME}!A2:${endCol}`
  });
  const rows = res.data.values || [];
  const rowByKey = new Map(rows.map((row, rowIndex) => [String(row[index.setting_key] || '').trim(), { row, sheetRow: rowIndex + 2 }]));

  for (const [rawKey, rawValue] of entries) {
    const key = String(rawKey || '').trim();
    const value = rawValue != null ? String(rawValue) : '';
    const found = rowByKey.get(key);
    if (found) {
      const nextRow = [...found.row];
      nextRow[index.setting_key] = key;
      nextRow[index.setting_value] = value;
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${APP_SETTINGS_SHEET_NAME}!A${found.sheetRow}:${endCol}${found.sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [nextRow] }
      });
    } else {
      const nextRow = header.map((col) => {
        if (col === 'setting_key') return key;
        if (col === 'setting_value') return value;
        return '';
      });
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${APP_SETTINGS_SHEET_NAME}!A:${endCol}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [nextRow] }
      });
    }
  }

  return getAppSettings();
}

/**
 * 헤더 초기화 (첫 사용 시
 * 이미 있으면 스킵.
 */
async function ensureHeader(sheetId) {
  await ensureSheetExists(sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!1:1`
  });
  const existing = (res.data.values || [])[0] || [];
  if (existing[0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] }
    });
    return HEADER_ROW;
  }

  const nextHeader = normalizeHeader(existing);
  if (nextHeader.length !== existing.length || nextHeader.some((col, idx) => col !== existing[idx])) {
    const endCol = columnLetter(nextHeader.length - 1);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1:${endCol}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [nextHeader] }
    });
  }

  return nextHeader;
}

/**
 * 시트 전체 읽기 (2단계) 의 현장 배열 반환
 */
async function getSites() {
  if (!isSheetsConfigured()) return [];
  const sheetId = getSheetId();
  const header = await ensureHeader(sheetId);
  const endCol = columnLetter(header.length - 1);
  const kmscSettings = await getKmscSiteSettings(sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:${endCol}`
  });

  return (res.data.values || [])
    .filter(row => row[0])        // id 비어있는 행 제외
    .map((row) => {
      const site = rowToSite(row, header);
      const kmsc = kmscSettings.get(String(site.site_name || '').trim());
      if (!kmsc) return site;
      return {
        ...site,
        water_analysis_user_id: kmsc.water_analysis_user_id || site.water_analysis_user_id,
        water_analysis_password: kmsc.water_analysis_password || site.water_analysis_password,
        qntech_site_id: kmsc.qntech_site_id || site.qntech_site_id,
      };
    });
}

/**
 * 현장 upsert (id로 기존 행 검색 → 없으면 append, 있으면 update)
 */
async function upsertSite(site) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const sheetId = getSheetId();
  const header = await ensureHeader(sheetId);
  const endCol = columnLetter(header.length - 1);

  // 전체 조회 후 id 검색
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:A`   // id 컬럼만 (헤더 제외)
  });
  const idCol = ['id', ...(res.data.values || []).map(r => r[0] || '')];  // 헤더 추가
  const rowIndex = idCol.indexOf(String(site.id));   // 0-based

  if (rowIndex <= 0) {
    const newRow = siteToRow(site, header);
    // 새 행 추가 (append)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:${endCol}`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } else {
    // 기존 행 업데이트 (1-based 시트 행 번호 = rowIndex + 1)
    const sheetRow = rowIndex + 1;
    const currentRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A${sheetRow}:${endCol}${sheetRow}`
    });
    const currentRow = (currentRes.data.values || [])[0] || [];
    const newRow = siteToRow(site, header, currentRow);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A${sheetRow}:${endCol}${sheetRow}`,
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
  const header = await ensureHeader(sheetId);
  const endCol = columnLetter(header.length - 1);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(id));

  if (rowIndex <= 0) {
    throw new Error('삭제할 현장을 찾을 수 없습니다.');
  }

  const sheetRow = rowIndex + 1;
  const currentRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:${endCol}${sheetRow}`
  });
  const currentRow = (currentRes.data.values || [])[0] || [];
  currentRow[headerIndex(header).is_active] = '0';  // is_active 컬럼을 0으로

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:${endCol}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [currentRow] }
  });
}

module.exports = {
  isSheetsConfigured,
  getSites,
  upsertSite,
  deleteSite,
  getAppSettings,
  upsertAppSettings
};
