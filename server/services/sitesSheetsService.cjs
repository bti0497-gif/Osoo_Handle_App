'use strict';

/**
 * sitesSheetsService.cjs
 * ?????????????????????????????????????????????????????????????????????
 * 援ш? ?ㅽ봽?덈뱶?쒗듃 ?꾩옣 愿由??쒕퉬??(?쒕퉬??怨꾩젙 ?몄쬆)
 *
 * ?ㅽ봽?덈뱶?쒗듃 援ъ“ (?쒗듃紐? Wastewater_Sites, 1??= ?ㅻ뜑):
 *   A: id  B: site_name  C: manager_name  D: method  E: series  F: is_active  G: notes
 *
 * ?섍꼍蹂??
 *   GOOGLE_MEMBERS_SHEET_ID ???ㅽ봽?덈뱶?쒗듃 ?뚯씪 ID (?щ윭 ?쒗듃 ?ы븿)
 *   媛숈? ?뚯씪 ?댁뿉??'Wastewater_Member' ?쒗듃? 'Wastewater_Sites' ?쒗듃 ?ъ슜
 *
 * 泥??ㅼ젙 諛⑸쾿:
 *   1. ?대? ?앹꽦??Google Sheets ?뚯씪?????쒗듃 異붽?
 *   2. ???쒗듃 ?대쫫??'Wastewater_Sites'濡?吏??
 *   3. ?ㅽ봽?덈뱶?쒗듃媛 ?대? ?쒕퉬??怨꾩젙怨?怨듭쑀???곹깭
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });
const { google } = require('googleapis');

const KEY_FILE   = path.join(__dirname, '../config/google-key.json');
const SHEET_NAME = 'Wastewater_Sites';
const HEADER_ROW = ['id', 'site_name', 'manager_name', 'method', 'series', 'is_active', 'notes'];
const HEADER_IDX = Object.fromEntries(HEADER_ROW.map((h, i) => [h, i]));

// ?쒕퉬??怨꾩젙 ?몄쬆
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

function getSheetId() {
  const id = String(process.env.GOOGLE_MEMBERS_SHEET_ID || '').trim();
  if (!id) throw new Error('GOOGLE_MEMBERS_SHEET_ID ?섍꼍蹂?섍? ?ㅼ젙?섏? ?딆븯?듬땲?? (?뚯썝/?꾩옣 怨듭쑀 ?ㅽ봽?덈뱶?쒗듃)');
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

/** ??諛곗뿴 ???꾩옣 媛앹껜 蹂??*/
function rowToSite(row) {
  const getAt = (index) => row[index] ?? '';

  const id = getAt(0);
  const site_name = getAt(1);
  const manager_name = getAt(2);
  const method = getAt(3) || 'A2O';
  const series = getAt(4) || '1怨꾩뿴';
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

/** ?꾩옣 媛앹껜 ????諛곗뿴 蹂??*/
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
 * ?ㅻ뜑 ??珥덇린??(泥??ъ슜 ??
 * ?대? ?덉쑝硫??ㅽ궢.
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
 * ?쒗듃 ?꾩껜 ?쎄린 (2??) ???꾩옣 諛곗뿴 諛섑솚
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
    .filter(row => row[0])        // id 鍮꾩뼱?덈뒗 ???쒖쇅
    .map(rowToSite);
}

/**
 * ?꾩옣 upsert (id濡?湲곗〈 ??寃?????놁쑝硫?append, ?덉쑝硫?update)
 */
async function upsertSite(site) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  const sheetId = getSheetId();
  await ensureHeader(sheetId);

  // ?꾩껜 議고쉶 ??id 寃??
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A2:A`   // id 而щ읆留?(?ㅻ뜑 ?쒖쇅)
  });
  const idCol = ['id', ...(res.data.values || []).map(r => r[0] || '')];  // ?ㅻ뜑 異붽?
  const rowIndex = idCol.indexOf(String(site.id));   // 0-based

  const newRow = siteToRow(site);

  if (rowIndex <= 0) {
    // ????異붽? (append)
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
  } else {
    // 湲곗〈 ???낅뜲?댄듃 (1-based ?쒗듃 ??踰덊샇 = rowIndex + 1)
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
 * ?꾩옣 ??젣 (?대떦 id ?됱쓣 is_active = 0?쇰줈 ?쒖떆)
 */
async function deleteSite(id) {
  if (!isSheetsConfigured()) throw new Error('Google Sheets媛 ?ㅼ젙?섏? ?딆븯?듬땲??');
  const sheetId = getSheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:A`
  });
  const idCol = (res.data.values || []).map(r => r[0] || '');
  const rowIndex = idCol.indexOf(String(id));

  if (rowIndex <= 0) {
    throw new Error('??젣???꾩옣??李얠쓣 ???놁뒿?덈떎.');
  }

  const sheetRow = rowIndex;
  const currentRes = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A${sheetRow}:G${sheetRow}`
  });
  const currentRow = (currentRes.data.values || [])[0] || [];
  currentRow[5] = '0';  // is_active 而щ읆??0?쇰줈

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
