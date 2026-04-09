'use strict';

/**
 * membersSheetsService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 구글 스프레드시트 회원 관리 서비스 (서비스 계정 인증)
 *
 * 스프레드시트 구조 (Sheet1, 1행 = 헤더):
 *   A: id  B: name  C: password  D: role  E: site_name1
 *   F: site_name2  G: target_lat  H: target_lng  I: radius_m  J: notes
 *
 * 환경변수:
 *   GOOGLE_MEMBERS_SHEET_ID — 스프레드시트 파일 ID
 *
 * 첫 설정 방법:
 *   1. Google Sheets에 새 스프레드시트 생성
 *   2. 파일 ID를 .env.local에 GOOGLE_MEMBERS_SHEET_ID=... 로 추가
 *   3. 스프레드시트를 서비스 계정 이메일에 편집자로 공유
 *      (osoo-handler-service@gen-lang-client-0937938814.iam.gserviceaccount.com)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { google } = require('googleapis');

const KEY_FILE   = path.join(__dirname, '../config/google-key.json');
const SHEET_NAME = '시트1';
const HEADER_ROW = ['id', 'name', 'password', 'role', 'site_name1', 'site_name2', 'target_lat', 'target_lng', 'radius_m', 'notes'];
const HEADER_IDX = Object.fromEntries(HEADER_ROW.map((h, i) => [h, i]));

// 서비스 계정 인증
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

function getSheetId() {
  const id = String(process.env.GOOGLE_MEMBERS_SHEET_ID || '').trim();
  if (!id) throw new Error('GOOGLE_MEMBERS_SHEET_ID 환경변수가 설정되지 않았습니다.');
  return id;
}

function isSheetsConfigured() {
  const fs = require('fs');
  return Boolean(
    fs.existsSync(KEY_FILE) &&
    process.env.GOOGLE_MEMBERS_SHEET_ID
  );
}

/** 행 배열 → 회원 객체 변환 */
function rowToMember(row) {
  const get = (col) => row[HEADER_IDX[col]] ?? '';
  return {
    id:          get('id'),
    name:        get('name'),
    password:    get('password'),
    role:        get('role') || 'manager',
    site_name1:  get('site_name1'),
    site_name2:  get('site_name2'),
    target_lat:  parseFloat(get('target_lat')) || null,
    target_lng:  parseFloat(get('target_lng')) || null,
    radius_m:    parseFloat(get('radius_m'))   || null,
    notes:       get('notes')
  };
}

/** 회원 객체 → 행 배열 변환 */
function memberToRow(member) {
  return HEADER_ROW.map(col => {
    const v = member[col];
    return v != null ? String(v) : '';
  });
}

/**
 * 헤더 행 초기화 (첫 사용 시)
 * 이미 있으면 스킵.
 */
async function ensureHeader(sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:J1`
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
 * 시트 전체 읽기 (2행~) → 회원 배열 반환
 */
async function getMembers() {
  if (!isSheetsConfigured()) return [];
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:J`
  });

  return (res.data.values || [])
    .filter(row => row[0])        // id 비어있는 행 제외
    .map(rowToMember);
}

/**
 * 회원 upsert (id로 기존 행 검색 → 없으면 append, 있으면 update)
 */
async function upsertMember(member) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  // 전체 조회 후 id 검색
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`   // id 컬럼만
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(member.id));   // 0-based, 0=헤더

  const newRow = memberToRow(member);

  if (rowIndex <= 0) {
    // 새 행 추가 (append)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } else {
    // 기존 행 업데이트 (1-based 시트 행 번호 = rowIndex + 1)
    const sheetRow = rowIndex + 1;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A${sheetRow}:J${sheetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
  }
}

/**
 * 회원 삭제 (해당 id 행을 공백으로 클리어 — 실제 행 삭제는 Sheet API batchUpdate 필요)
 * 간단히 id 컬럼을 비워 getMembers()의 필터에서 제외되도록 처리
 */
async function deleteMember(id) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets가 설정되지 않았습니다.');
  const sheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(id));
  if (rowIndex <= 0) return;   // 헤더(0) 또는 없음

  const sheetRow = rowIndex + 1;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:J${sheetRow}`
  });
}

module.exports = {
  isSheetsConfigured,
  getMembers,
  upsertMember,
  deleteMember
};
