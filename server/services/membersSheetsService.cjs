'use strict';

/**
 * membersSheetsService.cjs
 * ?????????????????????????????????????????????????????????????????????
 * 援ш? ?ㅽ봽?덈뱶?쒗듃 ?뚯썝 愿由??쒕퉬??(?쒕퉬??怨꾩젙 ?몄쬆)
 *
 * ?ㅽ봽?덈뱶?쒗듃 援ъ“ (?쒗듃紐? Wastewater_Member, 1??= ?ㅻ뜑):
 *   A: id  B: name  C: password  D: role  E: site_name1  F: phone
 *   G: target_lat  H: target_lng  I: radius_m  J: notes
 *
 * ?섍꼍蹂??
 *   GOOGLE_MEMBERS_SHEET_ID ???ㅽ봽?덈뱶?쒗듃 ?뚯씪 ID (?щ윭 ?쒗듃 ?ы븿)
 *
 * 泥??ㅼ젙 諛⑸쾿:
 *   1. Google Sheets?????ㅽ봽?덈뱶?쒗듃 ?앹꽦
 *   2. 泥?踰덉㎏ ?쒗듃 ?대쫫??'Wastewater_Member'濡?蹂寃?
 *   3. ?뚯씪 ID瑜?.env.local??GOOGLE_MEMBERS_SHEET_ID=... 濡?異붽?
 *   4. ?ㅽ봽?덈뱶?쒗듃瑜??쒕퉬??怨꾩젙 ?대찓?쇱뿉 ?몄쭛?먮줈 怨듭쑀
 *      (osoo-handler-service@gen-lang-client-0937938814.iam.gserviceaccount.com)
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { google } = require('googleapis');

const KEY_FILE   = path.join(__dirname, '../config/google-key.json');
const SHEET_NAME = 'Wastewater_Member';
const HEADER_ROW = ['id', 'name', 'password', 'role', 'site_name1', 'phone', 'target_lat', 'target_lng', 'radius_m', 'notes'];
const HEADER_IDX = Object.fromEntries(HEADER_ROW.map((h, i) => [h, i]));

// ?쒕퉬??怨꾩젙 ?몄쬆
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

function getSheetId() {
  const id = String(process.env.GOOGLE_MEMBERS_SHEET_ID || '').trim();
  if (!id) throw new Error('GOOGLE_MEMBERS_SHEET_ID ?섍꼍蹂?섍? ?ㅼ젙?섏? ?딆븯?듬땲??');
  return id;
}

function isSheetsConfigured() {
  const fs = require('fs');
  return Boolean(
    fs.existsSync(KEY_FILE) &&
    process.env.GOOGLE_MEMBERS_SHEET_ID
  );
}

/** ??諛곗뿴 ???뚯썝 媛앹껜 蹂??*/
function rowToMember(row) {
  // 援ы삎 ?쒗듃(10?? site_name2 ?ы븿) ???좏삎 ?쒗듃(10?? phone ?ы븿) 留덉씠洹몃젅?댁뀡 吏??
  const getAt = (index) => row[index] ?? '';
  const isOldFormat = Array.isArray(row) && row.length >= 11; // 11???댁긽 = site_name2 ?덉쓬

  let id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes;

  if (isOldFormat) {
    // 援ы삎 (11?? site_name2 ?ы븿): id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes
    id = getAt(0);
    name = getAt(1);
    password = getAt(2);
    role = getAt(3) || 'user';
    site_name1 = getAt(4);
    // site_name2??臾댁떆 (getAt(5))
    target_lat = parseFloat(getAt(6)) || null;
    target_lng = parseFloat(getAt(7)) || null;
    radius_m = parseFloat(getAt(8)) || null;
    notes = getAt(9);
    phone = ''; // 援ы삎?먮뒗 phone???놁쑝誘濡?鍮덇컪
  } else {
    // ?좏삎 (10?? phone ?ы븿): id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes
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

/** ?뚯썝 媛앹껜 ????諛곗뿴 蹂??*/
function memberToRow(member) {
  return HEADER_ROW.map(col => {
    const v = member[col];
    return v != null ? String(v) : '';
  });
}

/**
 * ?ㅻ뜑 ??珥덇린??諛?留덉씠洹몃젅?댁뀡
 * - ?ㅻ뜑 ?놁쓬: HEADER_ROW ?앹꽦
 * - 援ы삎(site_name2 ?ы븿): phone?쇰줈 留덉씠洹몃젅?댁뀡
 * - ?좏삎(phone ?ы븿): ?ㅽ궢
 */
async function ensureHeader(sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1:K1`
  });
  const existing = (res.data.values || [])[0] || [];
  
  // ?ㅻ뜑媛 ?놁쑝硫??앹꽦
  if (!existing[0] || existing[0] !== 'id') {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADER_ROW] }
    });
    return;
  }
  
  // 援ы삎(site_name2 ?덉쓬) ???좏삎(phone?쇰줈) 留덉씠洹몃젅?댁뀡
  // 援ы삎 ?ㅻ뜑(11??: id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes
  // ?좏삎 ?ㅻ뜑(10??: id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes
  const hasSiteName2 = existing[5] === 'site_name2';
  const hasPhone = existing[5] === 'phone';
  
  if (hasSiteName2 && !hasPhone) {
    // 留덉씠洹몃젅?댁뀡 ?꾩슂: F??site_name2)??phone?쇰줈 蹂寃쏀븯怨? ?섎㉧吏 而щ읆 ?뺣젹
    console.log('[membersSheetsService] 援ы삎?믪떊???ㅽ궎留?留덉씠洹몃젅?댁뀡 ?쒖옉...');
    
    // ?꾩껜 ?곗씠???쎄린
    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:J`
    });
    const allRows = dataRes.data.values || [];
    
    // ?좏삎?쇰줈 蹂?? 媛??됱뿉??site_name2(F) ?쒓굅, phone(F) 異붽?
    const migratedRows = [
      HEADER_ROW, // ???ㅻ뜑
      ...allRows.slice(1).map(row => {
        // 援ы삎: [id, name, password, role, site_name1, site_name2, target_lat, target_lng, radius_m, notes, ...]
        // ?좏삎: [id, name, password, role, site_name1, phone, target_lat, target_lng, radius_m, notes]
        return [
          row[0] || '',        // id
          row[1] || '',        // name
          row[2] || '',        // password
          row[3] || '',        // role
          row[4] || '',        // site_name1
          '',                  // phone (鍮꾩썙??
          row[6] || '',        // target_lat
          row[7] || '',        // target_lng
          row[8] || '',        // radius_m
          row[9] || ''         // notes
        ];
      })
    ];
    
    // A1:J濡??섎굹??諛곗튂 ?낅뜲?댄듃
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: migratedRows }
    });
    
    console.log('[membersSheetsService] 留덉씠洹몃젅?댁뀡 ?꾨즺');
  }
}

/**
 * ?쒗듃 ?꾩껜 ?쎄린 (2??) ???뚯썝 諛곗뿴 諛섑솚
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
    .filter(row => row[0])        // id 鍮꾩뼱?덈뒗 ???쒖쇅
    .map(rowToMember);
}

/**
 * ?뚯썝 upsert (id濡?湲곗〈 ??寃?????놁쑝硫?append, ?덉쑝硫?update)
 */
async function upsertMember(member) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  // ?꾩껜 議고쉶 ??id 寃??
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:A`   // id 而щ읆留?(?ㅻ뜑 ?쒖쇅)
  });
  const idCol = ['id', ...(res.data.values || []).map(r => r[0] || '')];  // ?ㅻ뜑 異붽?
  const rowIndex = idCol.indexOf(String(member.id));   // 0-based

  const newRow = memberToRow(member);

  if (rowIndex <= 0) {
    // ????異붽? (append)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:J`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } else {
    // 湲곗〈 ???낅뜲?댄듃 (1-based ?쒗듃 ??踰덊샇 = rowIndex + 1)
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
 * ?뚯썝 ??젣 (?대떦 id ?됱쓣 怨듬갚?쇰줈 ?대━?????ㅼ젣 ????젣??Sheet API batchUpdate ?꾩슂)
 * 媛꾨떒??id 而щ읆??鍮꾩썙 getMembers()???꾪꽣?먯꽌 ?쒖쇅?섎룄濡?泥섎━
 */
async function deleteMember(id) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  const sheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(id));
  if (rowIndex <= 0) return;   // ?ㅻ뜑(0) ?먮뒗 ?놁쓬

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
