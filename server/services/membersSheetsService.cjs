'use strict';

/**
 * membersSheetsService.cjs
 * ─────────────────────────────────────────────────────────────────────
 * 구글 스프레드시트 회원 관리 서비스 (서비스 계정 인증)
 *
 * 스프레드시트 구조 (시트명: Wastewater_Member, 1행 = 헤더):
 *   A: id  B: name  C: password  D: role  E: site_name1  F: phone
 *   G: target_lat  H: target_lng  I: radius_m  J: notes
 *
 * 환경변수:
 *   GOOGLE_MEMBERS_SHEET_ID — 스프레드시트 파일 ID (여러 시트 포함)
 *
 * 첫 설정 방법:
 *   1. Google Sheets에 새 스프레드시트 생성
 *   2. 첫 번째 시트 이름을 'Wastewater_Member'로 변경
 *   3. 파일 ID를 .env.local에 GOOGLE_MEMBERS_SHEET_ID=... 로 추가
 *   4. 스프레드시트를 서비스 계정 이메일에 편집자로 공유
 *      (osoo-handler-service@gen-lang-client-0937938814.iam.gserviceaccount.com)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { google } = require('googleapis');

const KEY_FILE   = path.join(__dirname, '../config/google-key.json');
const SHEET_NAME = 'Wastewater_Member';
const HEADER_ROW = ['id', 'name', 'password', 'role', 'site_name1', 'phone', 'target_lat', 'target_lng', 'radius_m', 'notes'];
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
  // 구형 시트(10열, site_name2 포함) → 신형 시트(10열, phone 포함) 마이그레이션 지원
  const getAt = (index) => row[index] ?? '';
  const isOldFormat = Array.isArray(row) && row.length >= 11; // 11열 이상 = site_name2 있음

  let id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes;

  if (isOldFormat) {
    // 구형 (11열, site_name2 포함): id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes
    id = getAt(0);
    name = getAt(1);
    password = getAt(2);
    role = getAt(3) || 'user';
    site_name1 = getAt(4);
    // site_name2는 무시 (getAt(5))
    target_lat = parseFloat(getAt(6)) || null;
    target_lng = parseFloat(getAt(7)) || null;
    radius_m = parseFloat(getAt(8)) || null;
    notes = getAt(9);
    phone = ''; // 구형에는 phone이 없으므로 빈값
  } else {
    // 신형 (10열, phone 포함): id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes
    id = getAt(0);
    name = getAt(1);
    password = getAt(2);
    role = getAt(3) || 'user';
    site_name1 = getAt(4);
    phone = getAt(5);
    target_lat = parseFloat(getAt(6)) || null;
    target_lng = parseFloat(getAt(7)) || null;
    radius_m = parseFloat(getAt(8)) || null;
    notes = getAt(9);
  }

  return {
    id,
    name,
    password,
    role,
    site_name1,
    phone,
    target_lat,
    target_lng,
    radius_m,
    notes
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
 * 헤더 행 초기화 및 마이그레이션
 * - 헤더 없음: HEADER_ROW 생성
 * - 구형(site_name2 포함): phone으로 마이그레이션
 * - 신형(phone 포함): 스킵
 */
async function ensureHeader(sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:K1`
  });
  const existing = (res.data.values || [])[0] || [];
  
  // 헤더가 없으면 생성
  if (!existing[0] || existing[0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] }
    });
    return;
  }
  
  // 구형(site_name2 있음) → 신형(phone으로) 마이그레이션
  // 구형 헤더(11열): id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes
  // 신형 헤더(10열): id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes
  const hasSiteName2 = existing[5] === 'site_name2';
  const hasPhone = existing[5] === 'phone';
  
  if (hasSiteName2 && !hasPhone) {
    // 마이그레이션 필요: F열(site_name2)을 phone으로 변경하고, 나머지 컬럼 정렬
    console.log('[membersSheetsService] 구형→신형 스키마 마이그레이션 시작...');
    
    // 전체 데이터 읽기
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:J`
    });
    const allRows = dataRes.data.values || [];
    
    // 신형으로 변환: 각 행에서 site_name2(F) 제거, phone(F) 추가
    const migratedRows = [
      HEADER_ROW, // 새 헤더
      ...allRows.slice(1).map(row => {
        // 구형: [id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes, ...]
        // 신형: [id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes]
        return [
          row[0] || '',        // id
          row[1] || '',        // name
          row[2] || '',        // password
          row[3] || '',        // role
          row[4] || '',        // site_name1
          '',                  // phone (비워둠)
          row[6] || '',        // target_lat
          row[7] || '',        // target_lng
          row[8] || '',        // radius_m
          row[9] || ''         // notes
        ];
      })
    ];
    
    // A1:J로 하나의 배치 업데이트
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: migratedRows }
    });
    
    console.log('[membersSheetsService] 마이그레이션 완료');
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
    range: `${SHEET_NAME}!A2:A`   // id 컬럼만 (헤더 제외)
  });
  const idCol = ['id', ...(res.data.values || []).map(r => r[0] || '')];  // 헤더 추가
  const rowIndex = idCol.indexOf(String(member.id));   // 0-based

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
    range: `${SHEET_NAME}!A${sheetRow}:I${sheetRow}`
  });
}

module.exports = {
  isSheetsConfigured,
  getMembers,
  upsertMember,
  deleteMember
};
