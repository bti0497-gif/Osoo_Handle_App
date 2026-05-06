const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const { drive, getOrCreateFolder, uploadBufferToFolder } = require('../services/driveService.cjs');
const { isSheetsConfigured: isSitesSheetsConfigured, getSites: getSitesFromSheets } = require('../services/sitesSheetsService.cjs');
const { db } = require('../database.cjs');
const { decodeUserContextHeader } = require('../utils/httpUserHeaders.cjs');
const { getBigQueryClient, DATASET_ID } = require('../services/bigQueryClientService.cjs');
const { syncCertificateCacheForSiteMonth } = require('../services/certificateCacheSyncService.cjs');

const router = express.Router();

const CERTIFICATE_ROOT_FOLDER_ID =
  String(process.env.CERTIFICATE_DRIVE_FOLDER_ID || '1Po-gd-OKlaeGyL-Ppjc6_wKgSLEM4iX4').trim();
const CERTIFICATE_PREFIX_RE = /^(?깆쟻??mlss)-(\d{8})(\.[^.]+)?$/i;
const MANUAL_CERT_FILE_RE = /^(?깆쟻??mlss)[_-](\d{8})[_-](.+)\.(jpg|jpeg|png|webp|pdf)$/i;
const zipUploadProgressMap = new Map();

function toDisplayDate(yyyymmdd) {
  if (!/^\d{8}$/.test(String(yyyymmdd || ''))) return '';
  const y = yyyymmdd.slice(0, 4);
  const m = yyyymmdd.slice(4, 6);
  const d = yyyymmdd.slice(6, 8);
  return `${y}-${m}-${d}`;
}

function parseCertMeta(fileName) {
  const normalized = String(fileName || '').trim();
  const m = normalized.match(CERTIFICATE_PREFIX_RE);
  if (!m) return null;
  const category = m[1].toLowerCase();
  const stamp = m[2];
  return {
    category,
    stamp,
    issuedAt: toDisplayDate(stamp),
    sampledAt: toDisplayDate(stamp),
  };
}

async function listFolders(parentId) {
  const res = await drive.files.list({
    q: [
      "mimeType='application/vnd.google-apps.folder'",
      `'${String(parentId)}' in parents`,
      'trashed=false',
    ].join(' and '),
    fields: 'files(id, name)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 200,
  });
  return res.data.files || [];
}

async function listFiles(parentId) {
  const res = await drive.files.list({
    q: [
      "mimeType!='application/vnd.google-apps.folder'",
      `'${String(parentId)}' in parents`,
      'trashed=false',
    ].join(' and '),
    fields: 'files(id, name, mimeType, modifiedTime, size)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 500,
  });
  return res.data.files || [];
}

function normalizeYear(value) {
  const y = String(value || '').trim();
  return /^\d{4}$/.test(y) ? y : '';
}

function normalizeMonth(value) {
  const m = String(value || '').trim();
  return /^(0[1-9]|1[0-2])$/.test(m) ? m : '';
}

async function resolveMonthFolders({ year, month }) {
  const rootFolders = await listFolders(CERTIFICATE_ROOT_FOLDER_ID);
  const certRoot = rootFolders.find((f) => String(f.name || '').trim() === '?깆쟻??);
  const searchRoots = [CERTIFICATE_ROOT_FOLDER_ID, certRoot?.id].filter(Boolean);
  const monthFolders = [];
  const seen = new Set();

  for (const rootId of searchRoots) {
    const yearFolders = await listFolders(rootId);
    if (!year && !month) {
      for (const yf of yearFolders) {
        const months = await listFolders(yf.id);
        for (const mf of months) {
          const key = `${yf.name}|${mf.name}|${mf.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          monthFolders.push({ year: yf.name, month: mf.name, folderId: mf.id });
        }
      }
      continue;
    }

    const yearFolder = yearFolders.find((f) => f.name === year);
    if (!yearFolder) continue;
    const months = await listFolders(yearFolder.id);
    if (!month) {
      for (const mf of months) {
        const key = `${year}|${mf.name}|${mf.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        monthFolders.push({ year, month: mf.name, folderId: mf.id });
      }
      continue;
    }

    const monthFolder = months.find((f) => f.name === month);
    if (!monthFolder) continue;
    const key = `${year}|${month}|${monthFolder.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      monthFolders.push({ year, month, folderId: monthFolder.id });
    }
  }

  return monthFolders;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSiteNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\-_/]/g, '')
    .replace(/?닿쾶??g, '')
    .replace(/諛⑺뼢/g, '')
    .replace(/?곹뻾|?섑뻾/g, '');
}

function normalizeDateLike(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return '';
}

function normalizeBigQueryDateValue(value) {
  if (value && typeof value === 'object') {
    if (typeof value.value === 'string') {
      return normalizeDateLike(value.value);
    }
    if (typeof value.valueOf === 'function') {
      const v = value.valueOf();
      const normalized = normalizeDateLike(v);
      if (normalized) return normalized;
    }
  }
  return normalizeDateLike(value);
}

function resolveReportDate(raw = {}) {
  return normalizeDateLike(
    raw.report_date
    || raw.date
    || raw.sampled_at
    || raw?.record?.report_date
    || raw?.record?.date
    || raw?.extractedData?.record?.report_date
    || raw?.data?.report_date
  );
}

function resolveSiteNameFromRecord(raw = {}) {
  return String(
    raw.site_name
    || raw?.record?.site_name
    || raw?.extractedData?.record?.site_name
    || ''
  ).trim();
}

function pickReportDateForImageLink({ fileReportDate, parsedSiteName, normalizedSiteName, jsonRecords = [] }) {
  const fromFile = normalizeDateLike(fileReportDate);
  const targetKey = normalizeSiteNameKey(normalizedSiteName || parsedSiteName || '');
  if (!targetKey) return fromFile;

  const candidate = (jsonRecords || []).find((row) => {
    const rowSite = resolveSiteNameFromRecord(row);
    return normalizeSiteNameKey(rowSite) === targetKey;
  });
  const fromJson = candidate ? resolveReportDate(candidate) : '';
  return fromJson || fromFile;
}

function getCompactDate(yyyyMmDd) {
  const normalized = normalizeDateLike(yyyyMmDd);
  return normalized ? normalized.replace(/-/g, '') : '';
}

function normalizeForFileSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '');
}

function levenshteinDistance(a, b) {
  const aa = String(a || '');
  const bb = String(b || '');
  if (aa === bb) return 0;
  if (!aa.length) return bb.length;
  if (!bb.length) return aa.length;

  const prev = Array(bb.length + 1).fill(0);
  const curr = Array(bb.length + 1).fill(0);
  for (let j = 0; j <= bb.length; j += 1) prev[j] = j;

  for (let i = 1; i <= aa.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= bb.length; j += 1) prev[j] = curr[j];
  }
  return prev[bb.length];
}

function stringSimilarity(a, b) {
  const aa = normalizeSiteNameKey(a);
  const bb = normalizeSiteNameKey(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.92;
  const dist = levenshteinDistance(aa, bb);
  const maxLen = Math.max(aa.length, bb.length, 1);
  return 1 - (dist / maxLen);
}

function buildAliasCandidates(siteName) {
  const raw = String(siteName || '').trim();
  if (!raw) return [];

  const aliases = new Set([raw]);
  aliases.add(raw.replace(/\s+/g, ''));
  aliases.add(raw.replace(/?닿쾶??g, '').trim());
  aliases.add(raw.replace(/諛⑺뼢/g, '').trim());
  aliases.add(raw.replace(/?닿쾶??g, '').replace(/諛⑺뼢/g, '').trim());
  aliases.add(raw.replace(/[()]/g, '').trim());
  aliases.add(raw.replace(/[()]/g, '').replace(/\s+/g, '').trim());

  const parenthesized = raw.match(/^(.*)\((.*)\)\s*$/);
  if (parenthesized) {
    const base = String(parenthesized[1] || '').trim();
    const dir = String(parenthesized[2] || '').trim();
    if (base && dir) {
      aliases.add(`${base}(${dir})`);
      aliases.add(`${base}${dir}`);
      aliases.add(`${base} ${dir}`);
      aliases.add(`${base}?닿쾶??${dir})`);
      aliases.add(`${base}?닿쾶??{dir}`);
      aliases.add(`${base}(${dir.replace(/諛⑺뼢/g, '')})`);
      aliases.add(`${base}${dir.replace(/諛⑺뼢/g, '')}`);
    }
  }

  return Array.from(aliases)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

async function loadSiteMaster() {
  const sheetActive = isSitesSheetsConfigured();
  if (sheetActive) {
    const sites = await getSitesFromSheets();
    const activeSites = (sites || []).filter((site) => site && site.is_active !== 0);
    if (activeSites.length > 0) {
      return activeSites.map((site) => {
        const officialName = String(site.site_name || '').trim();
        return {
          site_id: String(site.id || '').trim(),
          official_name: officialName,
          aliases: buildAliasCandidates(officialName),
          normalized_key: normalizeSiteNameKey(officialName),
        };
      }).filter((item) => item.site_id && item.official_name);
    }
  }

  const rows = db.prepare(`
    SELECT id, site_name
    FROM sites
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY site_name ASC
  `).all();

  return rows.map((row) => {
    const officialName = String(row.site_name || '').trim();
    return {
      site_id: String(row.id || '').trim(),
      official_name: officialName,
      aliases: buildAliasCandidates(officialName),
      normalized_key: normalizeSiteNameKey(officialName),
    };
  }).filter((item) => item.site_id && item.official_name);
}

function findBestSiteMatch(rawSiteName, siteMaster = []) {
  const raw = String(rawSiteName || '').trim();
  if (!raw || !Array.isArray(siteMaster) || siteMaster.length === 0) {
    return {
      site_id: null,
      site_name: null,
      site_name_raw: raw || null,
      site_match_confidence: null,
      manual_review_required: true,
      matched: false,
    };
  }

  let best = null;
  let bestScore = 0;
  for (const site of siteMaster) {
    const aliasPool = [site.official_name, ...(site.aliases || [])];
    for (const alias of aliasPool) {
      const score = stringSimilarity(raw, alias);
      if (score > bestScore) {
        bestScore = score;
        best = site;
      }
    }
  }

  // OCR쨌?쎌묶 ???쎄컙 ?닿툔???꾩옣紐낅룄 ?쒗듃 蹂꾩묶怨?留욎텛湲??꾪빐 ?섑븳????땄 (?낆꽌???대갚??異붽? ?덉쟾留?
  if (!best || bestScore < 0.5) {
    return {
      site_id: null,
      site_name: raw || null,
      site_name_raw: raw || null,
      site_match_confidence: Number(bestScore.toFixed(4)),
      manual_review_required: true,
      matched: false,
    };
  }

  return {
    site_id: best.site_id,
    site_name: best.official_name,
    site_name_raw: raw,
    site_match_confidence: Number(bestScore.toFixed(4)),
    manual_review_required: bestScore < 0.8,
    matched: true,
  };
}

function resolveUserRole(req) {
  return decodeUserContextHeader(
    req.headers['x-user-role']
    || req.body?._user?.role
    || req.query?._role
    || ''
  ).trim().toLowerCase();
}

function resolveUserSiteName(req) {
  return decodeUserContextHeader(
    req.headers['x-user-site']
    || req.body?._user?.site_name1
    || req.body?._user?.site
    || req.query?._site
    || ''
  ).trim();
}

function resolveUserManagedSiteNames(req) {
  const raw = decodeUserContextHeader(
    req.headers['x-user-sites']
    || req.body?._user?.managed_sites
    || req.query?._sites
    || ''
  ).trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => String(v || '').trim()).filter(Boolean);
    }
  } catch (_) {
    // noop
  }
  return raw
    .split(',')
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

function resolveUserName(req) {
  return decodeUserContextHeader(
    req.headers['x-user-name']
    || req.body?._user?.name
    || req.query?._name
    || ''
  ).trim();
}

function getDirectionalPairSiteNames(baseSiteName) {
  const raw = String(baseSiteName || '').trim();
  if (!raw) return [];
  const seeds = raw.split(',').map((v) => String(v || '').trim()).filter(Boolean);
  const out = new Set(seeds);
  const baseNames = new Set();

  for (const seed of seeds) {
    const m = seed.match(/^(.+?)\(([^)]+)\)$/);
    if (m) {
      const b = String(m[1] || '').trim();
      if (b) baseNames.add(b);
    } else {
      baseNames.add(seed);
    }
  }

  if (baseNames.size === 0) return Array.from(out);

  const rows = db.prepare(`
    SELECT site_name
    FROM sites
    WHERE COALESCE(is_active, 1) = 1
  `).all();
  for (const row of rows || []) {
    const name = String(row?.site_name || '').trim();
    if (!name) continue;
    const mm = name.match(/^(.+?)\(([^)]+)\)$/);
    if (mm) {
      const rowBase = String(mm[1] || '').trim();
      if (baseNames.has(rowBase)) {
        out.add(name);
      }
      continue;
    }
    if (baseNames.has(name)) {
      out.add(name);
    }
  }
  return Array.from(out);
}

function getManagedSiteNamesByManagerName(userName) {
  const name = String(userName || '').trim();
  if (!name) return [];
  const rows = db.prepare(`
    SELECT site_name
    FROM sites
    WHERE COALESCE(is_active, 1) = 1
      AND manager_name = ?
    ORDER BY site_name ASC
  `).all(name);
  return rows.map((r) => String(r?.site_name || '').trim()).filter(Boolean);
}

function ensureAdmin(req, res) {
  const role = resolveUserRole(req);
  if (role === 'admin' || role === 'group_admin') return true;
  res.status(403).json({ success: false, message: '愿由ъ옄 沅뚰븳???꾩슂?⑸땲??' });
  return false;
}

function parseManualCertificateFileName(fileName) {
  const normalized = String(fileName || '').trim();
  const match = normalized.match(MANUAL_CERT_FILE_RE);
  if (!match) return null;
  return {
    prefix: String(match[1] || '').toLowerCase(),
    yyyymmdd: String(match[2] || ''),
    site_name_raw: String(match[3] || '').trim(),
    ext: String(match[4] || '').toLowerCase(),
  };
}

function parseJsonObject(text) {
  if (!text) return {};
  try {
    const parsed = JSON.parse(String(text));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

/** JSON 蹂몃Ц???ㅼ뼱 ?덉쓣 ???덈뒗 ?꾩옣紐??꾨낫 (OCR ?먮Ц ?? */
function collectSiteNameHintsFromPayloadJson(jsonStr) {
  const p = parseJsonObject(jsonStr);
  const out = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s) out.push(s);
  };
  push(p.site_name);
  push(p.site_name_raw);
  if (p.meta && typeof p.meta === 'object') {
    push(p.meta.site_name);
    push(p.meta.site_name_raw);
  }
  return out;
}

/** DB ??而щ읆 + payload) vs ?뚯씪紐낆뿉?????꾩옣 臾몄옄???좎궗??*/
function rowSiteSimilarityScore(row, siteRawFromFile, officialFromMatch) {
  const needles = [];
  const r = String(siteRawFromFile || '').trim();
  const o = String(officialFromMatch || '').trim();
  if (r) needles.push(r);
  if (o && o !== r) needles.push(o);
  if (!needles.length) return 0;

  const hay = new Set();
  if (row.site_name) hay.add(String(row.site_name).trim());
  if (row.site_name_raw) hay.add(String(row.site_name_raw).trim());
  for (const s of collectSiteNameHintsFromPayloadJson(row.source_payload_json)) {
    hay.add(s);
  }

  let best = 0;
  for (const h of hay) {
    if (!h) continue;
    for (const n of needles) {
      best = Math.max(best, stringSimilarity(h, n));
      if (normalizeSiteNameKey(h) && normalizeSiteNameKey(h) === normalizeSiteNameKey(n)) {
        best = Math.max(best, 0.97);
      }
    }
  }
  return best;
}

async function upsertCertificateFileMeta({
  reportDate,
  siteId,
  siteName,
  siteNameRawFromFile,
  category,
  driveFileId,
  driveWebViewLink,
  uploadedFileName,
  originalFileName,
}) {
  const bq = getBigQueryClient();
  if (!bq) {
    throw new Error('BigQuery ?곌껐???꾩슂?⑸땲?? (certificate ?뚯씪 硫뷀? ?숆린??');
  }

  const nowIso = new Date().toISOString();
  const rawForFuzzy = String(siteNameRawFromFile ?? siteName ?? '').trim();
  const officialForFuzzy = String(siteName ?? '').trim();

  const [candidates] = await bq.query({
    query: `
      SELECT local_id, site_id, site_name, site_name_raw, source_payload_json
      FROM \`${DATASET_ID}.certificate_water_quality\`
      WHERE report_date = @reportDate
      ORDER BY local_id DESC
      LIMIT 200
    `,
    params: { reportDate },
    types: { reportDate: 'DATE' },
  });

  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return 0;

  const exact = rows.filter((r) => {
    if (siteId && String(r.site_id || '') === String(siteId)) return true;
    if (siteName && String(r.site_name || '') === String(siteName)) return true;
    return false;
  });
  let targets = exact;

  if (!targets.length) {
    const FUZZY_MIN = 0.42;
    const AMBIGUITY_GAP = 0.06;
    const SINGLE_ROW_MIN = 0.32;
    const scored = rows.map((row) => ({
      row,
      score: rowSiteSimilarityScore(row, rawForFuzzy, officialForFuzzy),
    }));
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1];
    if (top && top.score >= FUZZY_MIN && (!second || top.score - second.score >= AMBIGUITY_GAP)) {
      targets = [top.row];
    } else if (rows.length === 1 && top && top.score >= SINGLE_ROW_MIN) {
      targets = [top.row];
    } else {
      targets = [];
    }
  }

  if (!targets.length) return 0;

  for (const t of targets) {
    const localId = Number(t.local_id);
    if (!Number.isFinite(localId)) continue;
    await bq.query({
      query: `
        UPDATE \`${DATASET_ID}.certificate_water_quality\`
        SET
          certificate_category = @category,
          certificate_file_name = @uploadedFileName,
          certificate_original_file_name = @originalFileName,
          drive_file_id = @driveFileId,
          drive_web_view_link = @driveWebViewLink,
          updated_at = @updatedAt
        WHERE report_date = @reportDate
          AND local_id = @localId
      `,
      params: {
        category: category || null,
        uploadedFileName: uploadedFileName || null,
        originalFileName: originalFileName || null,
        driveFileId: driveFileId || null,
        driveWebViewLink: driveWebViewLink || null,
        updatedAt: nowIso,
        reportDate,
        localId,
      },
      types: {
        category: 'STRING',
        uploadedFileName: 'STRING',
        originalFileName: 'STRING',
        driveFileId: 'STRING',
        driveWebViewLink: 'STRING',
        updatedAt: 'TIMESTAMP',
        reportDate: 'DATE',
        localId: 'INT64',
      },
    });
  }

  return targets.length;
}

async function upsertCertificateRowToBigQuery(row, uniqueIndex) {
  const bq = getBigQueryClient();
  if (!bq) throw new Error('BigQuery ?곌껐???꾩슂?⑸땲??');

  const reportDate = normalizeDateLike(row.report_date || row.date || row.sampled_at);
  if (!reportDate) return { inserted: false, reason: 'invalid_date' };
  const nowIso = new Date().toISOString();
  const localId = Number(`${Date.now()}${String(uniqueIndex % 1000).padStart(3, '0')}`);

  await bq.query({
    query: `
      DELETE FROM \`${DATASET_ID}.certificate_water_quality\`
      WHERE report_date = DATE(@reportDate)
        AND (
          (@siteId IS NOT NULL AND site_id = @siteId)
          OR (@siteName IS NOT NULL AND site_name = @siteName)
        )
    `,
    params: {
      reportDate,
      siteId: row.site_id || null,
      siteName: row.site_name || null,
    },
    types: {
      reportDate: 'STRING',
      siteId: 'STRING',
      siteName: 'STRING',
    },
  });

  await bq.query({
    query: `
      INSERT INTO \`${DATASET_ID}.certificate_water_quality\` (
        certificate_category, certificate_file_name, certificate_original_file_name,
        drive_file_id, drive_web_view_link,
        site_id, site_name, site_name_raw, local_id, report_date,
        ss, bod, tn, tp, total_coliform, mlss, do, ph,
        source_pdf_name, source_page_index, ai_confidence, site_match_confidence,
        manual_review_required, warnings_json, source_payload_json,
        created_at, updated_at, uploaded_at
      )
      VALUES (
        @certificate_category, @certificate_file_name, @certificate_original_file_name,
        @drive_file_id, @drive_web_view_link,
        @site_id, @site_name, @site_name_raw, @local_id, DATE(@report_date),
        @ss, @bod, @tn, @tp, @total_coliform, @mlss, @do, @ph,
        @source_pdf_name, @source_page_index, @ai_confidence, @site_match_confidence,
        @manual_review_required, @warnings_json, @source_payload_json,
        @created_at, @updated_at, @uploaded_at
      )
    `,
    params: {
      certificate_category: row.certificate_category || null,
      certificate_file_name: row.certificate_file_name || null,
      certificate_original_file_name: row.certificate_original_file_name || null,
      drive_file_id: row.drive_file_id || null,
      drive_web_view_link: row.drive_web_view_link || null,
      site_id: row.site_id || null,
      site_name: row.site_name || null,
      site_name_raw: row.site_name_raw || null,
      local_id: localId,
      report_date: reportDate,
      ss: toNullableNumber(row.ss),
      bod: toNullableNumber(row.bod),
      tn: toNullableNumber(row.tn),
      tp: toNullableNumber(row.tp),
      total_coliform: toNullableNumber(row.total_coliform),
      mlss: toNullableNumber(row.mlss),
      do: toNullableNumber(row.do),
      ph: toNullableNumber(row.ph),
      source_pdf_name: row.source_pdf_name || null,
      source_page_index: row.source_page_index != null ? Number(row.source_page_index) : null,
      ai_confidence: toNullableNumber(row.ai_confidence),
      site_match_confidence: toNullableNumber(row.site_match_confidence),
      manual_review_required: Boolean(row.manual_review_required),
      warnings_json: row.warnings_json || '[]',
      source_payload_json: row.source_payload_json || '{}',
      created_at: row.created_at || nowIso,
      updated_at: nowIso,
      uploaded_at: nowIso,
    },
    types: {
      certificate_category: 'STRING',
      certificate_file_name: 'STRING',
      certificate_original_file_name: 'STRING',
      drive_file_id: 'STRING',
      drive_web_view_link: 'STRING',
      site_id: 'STRING',
      site_name: 'STRING',
      site_name_raw: 'STRING',
      local_id: 'INT64',
      report_date: 'STRING',
      ss: 'FLOAT64',
      bod: 'FLOAT64',
      tn: 'FLOAT64',
      tp: 'FLOAT64',
      total_coliform: 'FLOAT64',
      mlss: 'FLOAT64',
      do: 'FLOAT64',
      ph: 'FLOAT64',
      source_pdf_name: 'STRING',
      source_page_index: 'INT64',
      ai_confidence: 'FLOAT64',
      site_match_confidence: 'FLOAT64',
      manual_review_required: 'BOOL',
      warnings_json: 'STRING',
      source_payload_json: 'STRING',
      created_at: 'TIMESTAMP',
      updated_at: 'TIMESTAMP',
      uploaded_at: 'TIMESTAMP',
    },
  });

  return { inserted: true };
}

function toBaseName(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const chunks = normalized.split('/').filter(Boolean);
  return chunks[chunks.length - 1] || '';
}

function isJsonFileName(fileName) {
  return /\.json$/i.test(String(fileName || '').trim());
}

function isMasterJsonFile(fileName) {
  return String(fileName || '').trim().toLowerCase() === 'all_pages_data.json';
}

/** ?섏씠吏/?섑띁 媛앹껜瑜?INSERT?먯꽌 諛붾줈 ?????덇쾶 record쨌data쨌extracted瑜???媛앹껜濡??⑹묠 */
function mergeRowForCertificateImport(row) {
  if (!row || typeof row !== 'object') return null;
  const base = { ...row };
  if (typeof row.extractedData === 'string') {
    try {
      const parsed = JSON.parse(row.extractedData);
      if (parsed && typeof parsed === 'object') {
        base.extractedData = parsed;
      }
    } catch (_) {
      // ignore malformed extractedData string
    }
  }
  if (typeof row.record === 'string') {
    try {
      const parsed = JSON.parse(row.record);
      if (parsed && typeof parsed === 'object') {
        base.record = parsed;
      }
    } catch (_) {
      // ignore malformed record string
    }
  }
  if (row.extractedData && typeof row.extractedData === 'object') {
    Object.assign(base, row.extractedData);
    if (row.extractedData.record && typeof row.extractedData.record === 'object') {
      Object.assign(base, row.extractedData.record);
    }
    if (row.extractedData.source && typeof row.extractedData.source === 'object') {
      if (base.source_pdf_name == null && row.extractedData.source.source_pdf_name != null) {
        base.source_pdf_name = row.extractedData.source.source_pdf_name;
      }
      if (base.source_page_index == null && row.extractedData.source.page_index != null) {
        base.source_page_index = row.extractedData.source.page_index;
      }
    }
    if (row.extractedData.meta && typeof row.extractedData.meta === 'object') {
      if (base.ai_confidence == null && row.extractedData.meta.confidence != null) {
        base.ai_confidence = row.extractedData.meta.confidence;
      }
      if (base.site_match_confidence == null && row.extractedData.meta.site_match_confidence != null) {
        base.site_match_confidence = row.extractedData.meta.site_match_confidence;
      }
      if (base.manual_review_required == null && row.extractedData.meta.manual_review_required != null) {
        base.manual_review_required = row.extractedData.meta.manual_review_required;
      }
      if (base.warnings == null && Array.isArray(row.extractedData.meta.warnings)) {
        base.warnings = row.extractedData.meta.warnings;
      }
    }
  }
  if (row.record && typeof row.record === 'object') {
    Object.assign(base, row.record);
  }
  if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
    Object.assign(base, row.data);
  }
  if (row.extracted && typeof row.extracted === 'object') {
    Object.assign(base, row.extracted);
  }
  if (base.source_page_index == null && base.page_index != null) {
    base.source_page_index = base.page_index;
  }
  if (base.source_pdf_name == null && base.pdf_name != null) {
    base.source_pdf_name = base.pdf_name;
  }
  return base;
}

/**
 * AI Studio batch_export ?? 理쒖긽??諛곗뿴, records[], pages[] 留??ㅺ굔?쇰줈 ?몄떇?덉뿀??
 * ?⑥씪 媛앹껜??record留??덇굅??pages[]???섏씠吏蹂??곗씠?곌? ?덉쑝硫?1嫄대쭔 ?ㅼ뼱媛??臾몄젣 蹂댁셿.
 */
function normalizeIncomingJsonRecords(payload) {
  if (payload == null) return [];
  let incoming;
  if (Array.isArray(payload)) {
    incoming = payload;
  } else if (typeof payload === 'object') {
    if (Array.isArray(payload.records)) incoming = payload.records;
    else if (Array.isArray(payload.pages)) incoming = payload.pages;
    else if (Array.isArray(payload.data)) incoming = payload.data;
    else if (Array.isArray(payload.items)) incoming = payload.items;
    else if (Array.isArray(payload.results)) incoming = payload.results;
    else if (Array.isArray(payload.outputs)) incoming = payload.outputs;
    else if (Array.isArray(payload.predictions)) incoming = payload.predictions;
    else incoming = [payload];
  } else {
    return [];
  }
  return incoming
    .filter((row) => row && typeof row === 'object')
    .map((row) => mergeRowForCertificateImport(row))
    .filter(Boolean);
}

function isAllowedManualMedia(fileName) {
  return /\.(jpg|jpeg|png|webp|pdf)$/i.test(String(fileName || '').trim());
}

function normalizeAiImportPayload(body = {}) {
  const extracted = body.extractedData && typeof body.extractedData === 'object'
    ? body.extractedData
    : null;
  const source = body.source && typeof body.source === 'object'
    ? body.source
    : (extracted?.source || {});
  const include = typeof body.include === 'boolean'
    ? body.include
    : (typeof extracted?.include === 'boolean' ? extracted.include : true);
  const reason = String(body.reason || extracted?.reason || 'ok');
  const rawRecord = body.record && typeof body.record === 'object'
    ? body.record
    : (extracted?.record && typeof extracted.record === 'object' ? extracted.record : {});
  const meta = body.meta && typeof body.meta === 'object'
    ? body.meta
    : (extracted?.meta && typeof extracted.meta === 'object' ? extracted.meta : {});

  return {
    include,
    reason,
    source: {
      source_pdf_name: source.source_pdf_name || body.source_pdf_name || null,
      page_index: source.page_index ?? body.page_index ?? null,
    },
    record: {
      report_date: rawRecord.report_date || null,
      site_id: rawRecord.site_id || null,
      site_name: rawRecord.site_name || null,
      site_name_raw: rawRecord.site_name_raw || null,
      ss: rawRecord.ss ?? null,
      bod: rawRecord.bod ?? null,
      tn: rawRecord.tn ?? null,
      tp: rawRecord.tp ?? null,
      total_coliform: rawRecord.total_coliform ?? null,
      mlss: rawRecord.mlss ?? null,
      do: rawRecord.do ?? null,
      ph: rawRecord.ph ?? null,
    },
    meta: {
      confidence: meta.confidence ?? null,
      warnings: Array.isArray(meta.warnings) ? meta.warnings : [],
      site_match_confidence: meta.site_match_confidence ?? null,
      manual_review_required: Boolean(meta.manual_review_required),
    },
  };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function setZipUploadProgress(taskId, patch = {}) {
  const key = String(taskId || '').trim();
  if (!key) return;
  const prev = zipUploadProgressMap.get(key) || {};
  zipUploadProgressMap.set(key, {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  });
}

module.exports = function () {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

  router.get('/api/certificates/manual-upload-zip-progress', async (req, res) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const taskId = String(req.query.taskId || '').trim();
      if (!taskId) {
        return res.status(400).json({ success: false, message: 'taskId媛 ?꾩슂?⑸땲??' });
      }
      const progress = zipUploadProgressMap.get(taskId);
      if (!progress) {
        return res.status(404).json({ success: false, message: '吏꾪뻾 ?곹깭瑜?李얠쓣 ???놁뒿?덈떎.' });
      }
      return res.json({ success: true, progress });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/certificates/site-normalization', async (req, res) => {
    try {
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({
          success: false,
          message: 'Google Sheets???ㅼ젙?섏? ?딆븯?듬땲?? (GOOGLE_MEMBERS_SHEET_ID)',
        });
      }

      const sites = await getSitesFromSheets();
      const activeSites = (sites || []).filter((site) => site && site.is_active !== 0);
      const siteMaster = activeSites.map((site) => {
        const officialName = String(site.site_name || '').trim();
        const aliases = buildAliasCandidates(officialName);
        return {
          site_id: String(site.id || '').trim(),
          official_name: officialName,
          aliases,
          normalized_key: normalizeSiteNameKey(officialName),
          regex: aliases.length
            ? aliases.map((alias) => escapeRegex(alias)).join('|')
            : escapeRegex(officialName),
        };
      }).filter((item) => item.site_id && item.official_name);

      const combinedRegex = siteMaster.map((item) => `(?:${item.regex})`).join('|');
      return res.json({
        success: true,
        count: siteMaster.length,
        siteMaster,
        combinedRegex,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/import-from-ai', async (req, res) => {
    try {
      const normalized = normalizeAiImportPayload(req.body || {});
      const { include, record } = normalized;

      if (!include) {
        return res.json({
          success: true,
          accepted: false,
          skipped: true,
          reason: normalized.reason || 'excluded_by_ai',
          received: normalized,
        });
      }

      if (!record.report_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(record.report_date))) {
        return res.status(400).json({
          success: false,
          message: 'report_date(YYYY-MM-DD)媛 ?꾩슂?⑸땲??',
          received: normalized,
        });
      }

      if (!record.site_name && !record.site_id) {
        return res.status(400).json({
          success: false,
          message: 'site_name ?먮뒗 site_id 以??섎굹???꾩슂?⑸땲??',
          received: normalized,
        });
      }

      await upsertCertificateRowToBigQuery({
        site_id: record.site_id ? String(record.site_id) : null,
        site_name: record.site_name ? String(record.site_name) : null,
        site_name_raw: record.site_name_raw ? String(record.site_name_raw) : null,
        report_date: String(record.report_date),
        ss: record.ss,
        bod: record.bod,
        tn: record.tn,
        tp: record.tp,
        total_coliform: record.total_coliform,
        mlss: record.mlss,
        do: record.do,
        ph: record.ph,
        source_pdf_name: normalized.source.source_pdf_name ? String(normalized.source.source_pdf_name) : null,
        source_page_index: normalized.source.page_index != null ? Number(normalized.source.page_index) : null,
        ai_confidence: normalized.meta.confidence,
        site_match_confidence: normalized.meta.site_match_confidence,
        manual_review_required: normalized.meta.manual_review_required ? 1 : 0,
        warnings_json: JSON.stringify(normalized.meta.warnings || []),
        source_payload_json: JSON.stringify(req.body || {}),
      }, 0);
      return res.json({
        success: true,
        accepted: true,
        message: 'AI 異붿텧 寃곌낵瑜??뺤긽 ?섏떊/??ν뻽?듬땲??',
        id: null,
        received: normalized,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/manual-import-json', async (req, res) => {
    try {
      if (!ensureAdmin(req, res)) return;
      const siteMaster = await loadSiteMaster();
      const body = req.body;
      const incomingRecords = Array.isArray(body)
        ? body
        : (Array.isArray(body?.records) ? body.records : [body]);
      const records = incomingRecords.filter((row) => row && typeof row === 'object');
      if (records.length === 0) {
        return res.status(400).json({ success: false, message: '?낅줈?쒗븷 JSON ?덉퐫?쒓? ?놁뒿?덈떎.' });
      }

      const warnings = [];
      let inserted = 0;
      for (let index = 0; index < records.length; index += 1) {
        const raw = records[index];
        const reportDate = resolveReportDate(raw);
        if (!reportDate) {
          warnings.push(`index ${index}: report_date ?뺤떇???щ컮瑜댁? ?딆븘 ?쒖쇅?섏뿀?듬땲??`);
          continue;
        }

        const matchedById = raw.site_id
          ? siteMaster.find((site) => String(site.site_id) === String(raw.site_id))
          : null;
        const matched = matchedById
          ? {
              site_id: matchedById.site_id,
              site_name: matchedById.official_name,
              site_name_raw: String(raw.site_name || raw.site_name_raw || matchedById.official_name || '').trim() || null,
              site_match_confidence: 1,
              manual_review_required: false,
            }
          : findBestSiteMatch(raw.site_name || raw.site_name_raw || '', siteMaster);
        const rowWarnings = Array.isArray(raw.warnings)
          ? raw.warnings
          : (Array.isArray(raw.meta?.warnings) ? raw.meta.warnings : []);
        const manualReview = Boolean(raw.manual_review_required || raw.meta?.manual_review_required || matched.manual_review_required);

        try {
          await upsertCertificateRowToBigQuery({
            site_id: matched.site_id ? String(matched.site_id) : null,
            site_name: matched.site_name ? String(matched.site_name) : null,
            site_name_raw: matched.site_name_raw ? String(matched.site_name_raw) : null,
            report_date: reportDate,
            ss: raw.ss,
            bod: raw.bod,
            tn: raw.tn,
            tp: raw.tp,
            total_coliform: raw.total_coliform,
            mlss: raw.mlss,
            do: raw.do,
            ph: raw.ph,
            source_pdf_name: raw.source_pdf_name ? String(raw.source_pdf_name) : null,
            source_page_index: raw.source_page_index != null ? Number(raw.source_page_index) : null,
            ai_confidence: raw.ai_confidence ?? raw.meta?.confidence ?? null,
            site_match_confidence: raw.site_match_confidence ?? raw.meta?.site_match_confidence ?? matched.site_match_confidence,
            manual_review_required: manualReview,
            warnings_json: JSON.stringify(rowWarnings),
            source_payload_json: JSON.stringify(raw),
          }, index);
          inserted += 1;
        } catch (rowErr) {
          warnings.push(`index ${index}: BigQuery ????ㅽ뙣 (${rowErr.message})`);
        }
      }

      return res.json({
        success: true,
        inserted,
        skipped: records.length - inserted,
        warnings,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  // ?깆쟻??紐⑸줉? BigQuery/Drive瑜??⑥씪 吏꾩떎?먮낯?쇰줈 ?ъ슜?쒕떎. (濡쒖뺄 SQLite 誘몄궗??

  router.get('/api/certificates', async (req, res) => {
    try {
      const role = resolveUserRole(req);
      const requestedSiteName = String(req.query.siteName || '').trim();
      const userSiteName = resolveUserSiteName(req);
      const userName = resolveUserName(req);
      let siteNameFilters = requestedSiteName ? [requestedSiteName] : [];
      if (role === 'user') {
        const allowedFromHeader = getDirectionalPairSiteNames(userSiteName);
        const allowedFromManager = getManagedSiteNamesByManagerName(userName);
        const allowedSites = Array.from(new Set([...allowedFromHeader, ...allowedFromManager]));
        if (allowedSites.length === 0) {
          return res.status(403).json({ success: false, message: '?꾩옣 ?뺣낫媛 ?놁뼱 ?깆쟻?쒕? 議고쉶?????놁뒿?덈떎.' });
        }
        if (requestedSiteName && !allowedSites.includes(requestedSiteName)) {
          return res.status(403).json({ success: false, message: '? ?꾩옣 ?깆쟻?쒕뒗 議고쉶?????놁뒿?덈떎.' });
        }
        siteNameFilters = requestedSiteName ? [requestedSiteName] : allowedSites;
      }
      const year = normalizeYear(req.query.year);
      const month = normalizeMonth(req.query.month);
      const normalizedSiteFilterKeys = new Set(
        siteNameFilters.map((name) => normalizeSiteNameKey(name)).filter(Boolean)
      );
      let items = [];
      const bq = getBigQueryClient();
      if (bq) {
        const where = [
          "COALESCE(drive_file_id, JSON_EXTRACT_SCALAR(source_payload_json, '$.certificate_file.drive_file_id')) IS NOT NULL",
        ];
        const params = {};
        const hasSingleSiteFilter = siteNameFilters.length === 1;
        if (hasSingleSiteFilter) {
          where.push('site_name = @siteName');
          params.siteName = siteNameFilters[0];
        }
        if (year) {
          where.push('EXTRACT(YEAR FROM report_date) = @yearNum');
          params.yearNum = Number(year);
        }
        if (month) {
          where.push('EXTRACT(MONTH FROM report_date) = @monthNum');
          params.monthNum = Number(month);
        }

        const query = `
          SELECT
            report_date,
            site_name,
            COALESCE(certificate_file_name, JSON_EXTRACT_SCALAR(source_payload_json, '$.certificate_file.file_name')) AS file_name,
            COALESCE(certificate_category, JSON_EXTRACT_SCALAR(source_payload_json, '$.certificate_file.category')) AS category,
            COALESCE(drive_file_id, JSON_EXTRACT_SCALAR(source_payload_json, '$.certificate_file.drive_file_id')) AS drive_file_id
          FROM \`${DATASET_ID}.certificate_water_quality\`
          WHERE ${where.join(' AND ')}
          ORDER BY report_date DESC
          LIMIT 1000
        `;
        const [rows] = await bq.query({ query, params });
        items = (rows || [])
          .filter((row) => {
            if (hasSingleSiteFilter || normalizedSiteFilterKeys.size === 0) return true;
            const key = normalizeSiteNameKey(row?.site_name || '');
            return key && normalizedSiteFilterKeys.has(key);
          })
          .filter((row) => row && row.drive_file_id)
          .map((row) => {
            const reportDate = normalizeBigQueryDateValue(row.report_date);
            return {
              id: row.drive_file_id,
              fileName: row.file_name || '',
              siteName: row.site_name || '',
              sampledAt: reportDate,
              issuedAt: reportDate,
              category: row.category || '',
              downloadUrl: `/api/certificates/files/${encodeURIComponent(row.drive_file_id)}?name=${encodeURIComponent(row.file_name || 'certificate.jpg')}`,
            };
          });
      }

      // ?ъ슜???섎룄: ?깆쟻??JPG 紐⑸줉? Drive 湲곗??쇰줈 蹂댁뿬???쒕떎.
      if (drive && CERTIFICATE_ROOT_FOLDER_ID) {
        const folders = await resolveMonthFolders({ year, month });
        const driveItems = [];

        for (const folder of folders) {
          const files = await listFiles(folder.folderId);
          for (const file of files) {
            const baseName = toBaseName(file.name);
            // ?깆쟻??紐⑸줉? 寃곌낵 ?뚯씪留??몄텧 (ZIP/湲고? ?곗텧臾??쒖쇅)
            if (!isAllowedManualMedia(baseName)) {
              continue;
            }
            const parsed = parseManualCertificateFileName(file.name);
            let siteName = '怨듯넻';
            let reportDate = '';
            let category = '';
            if (parsed) {
              siteName = parsed.site_name_raw || '怨듯넻';
              reportDate = normalizeDateLike(parsed.yyyymmdd);
              category = parsed.prefix || '';
            } else {
              const legacy = parseCertMeta(file.name);
              if (legacy) {
                reportDate = legacy.issuedAt || '';
                category = legacy.category || '';
              }
            }

            if (normalizedSiteFilterKeys.size > 0 && parsed) {
              const fileSiteKey = normalizeSiteNameKey(parsed.site_name_raw || '');
              if (!fileSiteKey || !normalizedSiteFilterKeys.has(fileSiteKey)) {
                continue;
              }
            }
            if (normalizedSiteFilterKeys.size > 0 && !parsed) {
              const legacyKey = normalizeSiteNameKey(siteName || '');
              if (!legacyKey || !normalizedSiteFilterKeys.has(legacyKey)) {
                continue;
              }
            }
            if (requestedSiteName && !parsed && !String(siteName || '').includes(requestedSiteName)) {
              continue;
            }

            driveItems.push({
              id: file.id,
              fileName: file.name,
              siteName,
              sampledAt: reportDate,
              issuedAt: reportDate,
              category,
              year: folder.year,
              month: folder.month,
              downloadUrl: `/api/certificates/files/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}`,
            });
          }
        }

        const byId = new Map();
        [...driveItems, ...items].forEach((item) => {
          if (!item || !item.id) return;
          byId.set(String(item.id), item);
        });
        items = Array.from(byId.values())
          .filter((item) => isAllowedManualMedia(toBaseName(item.fileName || '')));
      }

      items.sort((a, b) => {
        if (a.issuedAt !== b.issuedAt) return String(b.issuedAt).localeCompare(String(a.issuedAt));
        return String(a.fileName).localeCompare(String(b.fileName), 'ko');
      });

      res.json({ success: true, items });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/sync-cache', async (req, res) => {
    try {
      const role = resolveUserRole(req);
      const userSiteName = resolveUserSiteName(req);
      const userName = resolveUserName(req);
      const requestedSiteName = String(req.body?.siteName || '').trim();
      const year = normalizeYear(req.body?.year);
      const month = normalizeMonth(req.body?.month);

      if (!year || !month) {
        return res.status(400).json({ success: false, message: 'year/month 媛믪씠 ?꾩슂?⑸땲??' });
      }

      let targetSiteNames = requestedSiteName ? [requestedSiteName] : [];
      if (role === 'user') {
        const allowedFromHeader = getDirectionalPairSiteNames(userSiteName);
        const allowedFromManager = getManagedSiteNamesByManagerName(userName);
        const allowedSites = Array.from(new Set([...allowedFromHeader, ...allowedFromManager]));
        if (allowedSites.length === 0) {
          return res.status(403).json({ success: false, message: '?꾩옣 ?뺣낫媛 ?놁뼱 ?숆린?뷀븷 ???놁뒿?덈떎.' });
        }
        if (requestedSiteName && !allowedSites.includes(requestedSiteName)) {
          return res.status(403).json({ success: false, message: '? ?꾩옣 ?숆린?붾뒗 ?덉슜?섏? ?딆뒿?덈떎.' });
        }
        targetSiteNames = requestedSiteName ? [requestedSiteName] : allowedSites;
      } else if (targetSiteNames.length === 0 && userSiteName) {
        targetSiteNames = [userSiteName];
      }

      if (targetSiteNames.length === 0) {
        return res.status(400).json({ success: false, message: '?숆린??????꾩옣???뺤씤?????놁뒿?덈떎.' });
      }

      let totalCount = 0;
      const syncedSites = [];
      for (const siteName of targetSiteNames) {
        const result = await syncCertificateCacheForSiteMonth({
          db,
          siteName,
          year,
          month,
        });
        totalCount += Number(result?.count || 0);
        syncedSites.push(siteName);
      }

      return res.json({
        success: true,
        siteNames: syncedSites,
        year,
        month,
        syncedCount: totalCount,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/certificates/:id/download', async (req, res) => {
    let id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: '?깆쟻??ID媛 ?꾩슂?⑸땲??' });

    return res.json({
      success: true,
      downloadUrl: `/api/certificates/files/${encodeURIComponent(id)}`,
    });
  });

  router.get('/api/certificates/files/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).send('?섎せ???붿껌?낅땲??');

      const meta = await drive.files.get({
        fileId: id,
        fields: 'id,name,mimeType,size',
        supportsAllDrives: true,
      });
      const fileName = String(req.query.name || meta.data.name || 'certificate');
      const safeFileName = fileName.replace(/["\r\n]/g, '_');

      const media = await drive.files.get(
        { fileId: id, alt: 'media', supportsAllDrives: true },
        { responseType: 'stream' }
      );

      res.setHeader('Content-Type', meta.data.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);
      media.data.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      media.data.pipe(res);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/upload', upload.single('certificatePdf'), async (req, res) => {
    try {
      if (!drive || !CERTIFICATE_ROOT_FOLDER_ID) {
        return res.status(400).json({ success: false, message: 'Drive ?ㅼ젙???꾩슂?⑸땲??' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: '?낅줈???뚯씪???놁뒿?덈떎.' });
      }

      const now = new Date();
      const year = String(now.getFullYear());
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const yearFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, year);
      const monthFolder = await getOrCreateFolder(yearFolder.id, month);

      const uploadRes = await drive.files.create({
        resource: { name: req.file.originalname, parents: [monthFolder.id] },
        media: { mimeType: req.file.mimetype || 'application/pdf', body: require('stream').Readable.from(req.file.buffer) },
        fields: 'id,name,webViewLink',
        supportsAllDrives: true,
      });

      res.json({ success: true, item: uploadRes.data });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/manual-upload-file', upload.array('files', 300), async (req, res) => {
    try {
      if (!ensureAdmin(req, res)) return;
      if (!drive || !CERTIFICATE_ROOT_FOLDER_ID) {
        return res.status(400).json({ success: false, message: 'Drive ?ㅼ젙???꾩슂?⑸땲??' });
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ success: false, message: '?낅줈???뚯씪???놁뒿?덈떎.' });
      }

      const siteMaster = await loadSiteMaster();
      const certFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, '?깆쟻??);
      const items = [];
      const errors = [];

      for (const file of files) {
        try {
          const parsed = parseManualCertificateFileName(file.originalname);
          if (!parsed) {
            errors.push({
              file: file.originalname,
              message: '?뚯씪紐??뺤떇???щ컮瑜댁? ?딆뒿?덈떎. (?깆쟻??yyyymmdd_?꾩옣紐?jpg ?먮뒗 mlss_yyyymmdd_?꾩옣紐?jpg)',
            });
            continue;
          }
          const reportDate = normalizeDateLike(parsed.yyyymmdd);
          if (!reportDate) {
            errors.push({
              file: file.originalname,
              message: '?뚯씪紐??좎쭨(yyyymmdd)媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
            });
            continue;
          }

          const year = parsed.yyyymmdd.slice(0, 4);
          const month = parsed.yyyymmdd.slice(4, 6);
          const yearFolder = await getOrCreateFolder(certFolder.id, year);
          const monthFolder = await getOrCreateFolder(yearFolder.id, month);

          const matched = findBestSiteMatch(parsed.site_name_raw, siteMaster);
          const safeSiteName = normalizeForFileSegment(matched.site_name || parsed.site_name_raw);
          const finalFileName = `${parsed.prefix}_${getCompactDate(reportDate)}_${safeSiteName}.${parsed.ext}`;
          const uploaded = await uploadBufferToFolder({
            folderId: monthFolder.id,
            fileName: finalFileName,
            buffer: file.buffer,
            mimeType: file.mimetype || 'application/octet-stream',
          });
          const linkedRows = await upsertCertificateFileMeta({
            reportDate,
            siteId: matched.site_id,
            siteName: matched.site_name || parsed.site_name_raw,
            siteNameRawFromFile: parsed.site_name_raw,
            category: parsed.prefix,
            driveFileId: uploaded.id,
            driveWebViewLink: uploaded.webViewLink || null,
            uploadedFileName: finalFileName,
            originalFileName: file.originalname,
          });

          items.push({
            original_file_name: file.originalname,
            uploaded_file_name: finalFileName,
            category: parsed.prefix,
            report_date: reportDate,
            year,
            month,
            site_id: matched.site_id,
            site_name: matched.site_name || parsed.site_name_raw,
            site_name_raw: parsed.site_name_raw,
            site_match_confidence: matched.site_match_confidence,
            manual_review_required: Boolean(matched.manual_review_required),
            drive_file_id: uploaded.id,
            drive_web_view_link: uploaded.webViewLink || null,
            linked_row_count: linkedRows,
          });
        } catch (fileErr) {
          errors.push({
            file: file.originalname,
            message: fileErr.message,
          });
        }
      }

      return res.json({
        success: true,
        uploaded_count: items.length,
        failed_count: errors.length,
        items,
        errors,
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.post('/api/certificates/manual-upload-zip', upload.single('bundleZip'), async (req, res) => {
    try {
      if (!ensureAdmin(req, res)) return;
      if (!drive || !CERTIFICATE_ROOT_FOLDER_ID) {
        return res.status(400).json({ success: false, message: 'Drive ?ㅼ젙???꾩슂?⑸땲??' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'ZIP ?뚯씪???꾩슂?⑸땲?? (bundleZip)' });
      }
      if (!/\.zip$/i.test(String(req.file.originalname || ''))) {
        return res.status(400).json({ success: false, message: 'zip ?뺤떇 ?뚯씪留??낅줈?쒗븷 ???덉뒿?덈떎.' });
      }

      const uploadTaskId = String(req.body?.uploadTaskId || '').trim();
      setZipUploadProgress(uploadTaskId, {
        status: 'processing',
        stage: 'zip_received',
        message: '?뺤텞 ?뚯씪???댁꽍 以묒엯?덈떎...',
        fileName: req.file.originalname,
      });
      console.log(`[Certificate ZIP] 泥섎━ ?쒖옉: ${req.file.originalname} (${req.file.size || 0} bytes)`);

      const siteMaster = await loadSiteMaster();
      const certFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, '?깆쟻??);
      const zip = await JSZip.loadAsync(req.file.buffer);
      const entries = Object.keys(zip.files || {})
        .map((key) => zip.files[key])
        .filter((entry) => entry && !entry.dir);

      const allJsonRecords = [];
      const jsonErrors = [];
      const ignoredJsonFiles = [];
      const fileEntries = [];
      const masterJsonEntry = entries.find((entry) => isMasterJsonFile(toBaseName(entry.name))) || null;

      if (!masterJsonEntry) {
        console.warn(`[Certificate ZIP] all_pages_data.json ?꾨씫: ${req.file.originalname}`);
        return res.status(400).json({
          success: false,
          message: 'all_pages_data.json ?뚯씪???꾩슂?⑸땲??',
        });
      }

      try {
        const text = await masterJsonEntry.async('text');
        const parsed = JSON.parse(text);
        const records = normalizeIncomingJsonRecords(parsed);
        allJsonRecords.push(...records);
      } catch (jsonErr) {
        jsonErrors.push({
          file: masterJsonEntry.name,
          message: `JSON ?뚯떛 ?ㅽ뙣: ${jsonErr.message}`,
        });
      }

      for (const entry of entries) {
        const baseName = toBaseName(entry.name);
        if (isJsonFileName(baseName)) {
          if (entry.name !== masterJsonEntry.name) {
            ignoredJsonFiles.push(entry.name);
          }
          continue;
        }

        if (isAllowedManualMedia(baseName)) {
          fileEntries.push({ entry, baseName });
        }
      }

      console.log(
        `[Certificate ZIP] ?뚯떛 ?꾨즺: jsonRecords=${allJsonRecords.length}, mediaFiles=${fileEntries.length}, ignoredJson=${ignoredJsonFiles.length}`
      );
      setZipUploadProgress(uploadTaskId, {
        stage: 'parsed',
        message: `?뺤텞 ?댁꽍 ?꾨즺 (JSON ${allJsonRecords.length}嫄? ?대?吏 ${fileEntries.length}媛?`,
        jsonTotal: allJsonRecords.length,
        fileTotal: fileEntries.length,
      });

      const importWarnings = [];
      let inserted = 0;
      for (let index = 0; index < allJsonRecords.length; index += 1) {
        const raw = allJsonRecords[index];
        const reportDate = resolveReportDate(raw);
        if (!reportDate) {
          importWarnings.push(
            `json index ${index}: report_date ?뺤떇???щ컮瑜댁? ?딆븘 ?쒖쇅?섏뿀?듬땲?? `
            + `keys=${Object.keys(raw || {}).slice(0, 12).join(',')}, `
            + `recordKeys=${Object.keys(raw?.record || {}).slice(0, 12).join(',')}`
          );
          continue;
        }

        const matchedById = raw.site_id
          ? siteMaster.find((site) => String(site.site_id) === String(raw.site_id))
          : null;
        const matched = matchedById
          ? {
              site_id: matchedById.site_id,
              site_name: matchedById.official_name,
              site_name_raw: String(raw.site_name || raw.site_name_raw || matchedById.official_name || '').trim() || null,
              site_match_confidence: 1,
              manual_review_required: false,
            }
          : findBestSiteMatch(raw.site_name || raw.site_name_raw || '', siteMaster);
        const rowWarnings = Array.isArray(raw.warnings)
          ? raw.warnings
          : (Array.isArray(raw.meta?.warnings) ? raw.meta.warnings : []);
        const manualReview = Boolean(raw.manual_review_required || raw.meta?.manual_review_required || matched.manual_review_required);

        try {
          await upsertCertificateRowToBigQuery({
            site_id: matched.site_id ? String(matched.site_id) : null,
            site_name: matched.site_name ? String(matched.site_name) : null,
            site_name_raw: matched.site_name_raw ? String(matched.site_name_raw) : null,
            report_date: reportDate,
            ss: raw.ss,
            bod: raw.bod,
            tn: raw.tn,
            tp: raw.tp,
            total_coliform: raw.total_coliform,
            mlss: raw.mlss,
            do: raw.do,
            ph: raw.ph,
            source_pdf_name: raw.source_pdf_name ? String(raw.source_pdf_name) : null,
            source_page_index: raw.source_page_index != null ? Number(raw.source_page_index) : null,
            ai_confidence: raw.ai_confidence ?? raw.meta?.confidence ?? null,
            site_match_confidence: raw.site_match_confidence ?? raw.meta?.site_match_confidence ?? matched.site_match_confidence,
            manual_review_required: manualReview,
            warnings_json: JSON.stringify(rowWarnings),
            source_payload_json: JSON.stringify(raw),
          }, index);
          inserted += 1;
        } catch (rowErr) {
          importWarnings.push(`json index ${index}: BigQuery ????ㅽ뙣 (${rowErr.message})`);
        }
        setZipUploadProgress(uploadTaskId, {
          stage: 'json_processing',
          message: `JSON 泥섎━ 以?.. (${index + 1}/${allJsonRecords.length})`,
          jsonProcessed: index + 1,
          jsonInserted: inserted,
        });
      }

      const uploadedItems = [];
      const uploadErrors = [];
      for (const fileObj of fileEntries) {
        const originalName = fileObj.baseName;
        try {
          const parsed = parseManualCertificateFileName(originalName);
          if (!parsed) {
            uploadErrors.push({
              file: originalName,
              message: '?뚯씪紐??뺤떇???щ컮瑜댁? ?딆뒿?덈떎. (?깆쟻??yyyymmdd_?꾩옣紐?jpg ?먮뒗 mlss_yyyymmdd_?꾩옣紐?jpg)',
            });
            continue;
          }
          const reportDate = normalizeDateLike(parsed.yyyymmdd);
          if (!reportDate) {
            uploadErrors.push({
              file: originalName,
              message: '?뚯씪紐??좎쭨(yyyymmdd)媛 ?щ컮瑜댁? ?딆뒿?덈떎.',
            });
            continue;
          }

          const year = parsed.yyyymmdd.slice(0, 4);
          const month = parsed.yyyymmdd.slice(4, 6);
          const yearFolder = await getOrCreateFolder(certFolder.id, year);
          const monthFolder = await getOrCreateFolder(yearFolder.id, month);

          const matched = findBestSiteMatch(parsed.site_name_raw, siteMaster);
          const effectiveReportDate = pickReportDateForImageLink({
            fileReportDate: reportDate,
            parsedSiteName: parsed.site_name_raw,
            normalizedSiteName: matched.site_name,
            jsonRecords: allJsonRecords,
          });
          const safeSiteName = normalizeForFileSegment(matched.site_name || parsed.site_name_raw);
          const finalFileName = `${parsed.prefix}_${getCompactDate(effectiveReportDate || reportDate)}_${safeSiteName}.${parsed.ext}`;
          const fileBuffer = await fileObj.entry.async('nodebuffer');
          const uploaded = await uploadBufferToFolder({
            folderId: monthFolder.id,
            fileName: finalFileName,
            buffer: fileBuffer,
            mimeType: parsed.ext === 'pdf' ? 'application/pdf' : 'image/jpeg',
          });
          const linkedRows = await upsertCertificateFileMeta({
            reportDate: effectiveReportDate || reportDate,
            siteId: matched.site_id,
            siteName: matched.site_name || parsed.site_name_raw,
            siteNameRawFromFile: parsed.site_name_raw,
            category: parsed.prefix,
            driveFileId: uploaded.id,
            driveWebViewLink: uploaded.webViewLink || null,
            uploadedFileName: finalFileName,
            originalFileName: originalName,
          });

          uploadedItems.push({
            original_file_name: originalName,
            uploaded_file_name: finalFileName,
            category: parsed.prefix,
            report_date: effectiveReportDate || reportDate,
            year,
            month,
            site_id: matched.site_id,
            site_name: matched.site_name || parsed.site_name_raw,
            site_name_raw: parsed.site_name_raw,
            site_match_confidence: matched.site_match_confidence,
            manual_review_required: Boolean(matched.manual_review_required),
            drive_file_id: uploaded.id,
            drive_web_view_link: uploaded.webViewLink || null,
            linked_row_count: linkedRows,
          });
        } catch (fileErr) {
          uploadErrors.push({
            file: originalName,
            message: fileErr.message,
          });
        }
        setZipUploadProgress(uploadTaskId, {
          stage: 'image_uploading',
          message: `?대?吏 ?낅줈??以?.. (${uploadedItems.length + uploadErrors.length}/${fileEntries.length})`,
          fileProcessed: uploadedItems.length + uploadErrors.length,
          fileUploaded: uploadedItems.length,
        });
      }

      setZipUploadProgress(uploadTaskId, {
        stage: 'finalizing',
        message: '???寃곌낵瑜??뺤씤 以묒엯?덈떎...',
        jsonProcessed: allJsonRecords.length,
        jsonInserted: inserted,
        fileProcessed: fileEntries.length,
        fileUploaded: uploadedItems.length,
      });

      const hasProcessableJson = allJsonRecords.length > 0;
      const hasProcessableFiles = fileEntries.length > 0;
      const hardFailureReasons = [];
      if (!hasProcessableJson && !hasProcessableFiles) {
        hardFailureReasons.push('ZIP?먯꽌 泥섎━ 媛?ν븳 JSON/?대?吏 ?뚯씪??李얠? 紐삵뻽?듬땲?? (all_pages_data.json, jpg/png/webp/pdf)');
      }
      if (hasProcessableJson && inserted === 0) {
        hardFailureReasons.push('JSON ?덉퐫????μ씠 0嫄댁엯?덈떎. warnings/errors瑜??뺤씤??二쇱꽭??');
      }
      if (hasProcessableFiles && uploadedItems.length === 0) {
        hardFailureReasons.push('?대?吏/?뚯씪 ?낅줈?쒓? 0嫄댁엯?덈떎. ?뚯씪紐??뺤떇怨?Drive 沅뚰븳???뺤씤??二쇱꽭??');
      }

      if (hardFailureReasons.length > 0) {
        if (importWarnings.length > 0) {
          console.warn(`[Certificate ZIP] JSON 寃쎄퀬 ?섑뵆: ${importWarnings.slice(0, 5).join(' | ')}`);
        }
        console.warn(
          `[Certificate ZIP] 泥섎━ ?ㅽ뙣: inserted=${inserted}/${allJsonRecords.length}, uploaded=${uploadedItems.length}/${fileEntries.length}`
        );
        setZipUploadProgress(uploadTaskId, {
          status: 'failed',
          stage: 'failed',
          message: hardFailureReasons.join(' '),
          jsonInserted: inserted,
          jsonTotal: allJsonRecords.length,
          fileUploaded: uploadedItems.length,
          fileTotal: fileEntries.length,
        });
        return res.status(400).json({
          success: false,
          message: hardFailureReasons.join(' '),
          zip_file_name: req.file.originalname,
          json: {
            source: masterJsonEntry ? 'all_pages_data.json' : 'all-json-files',
            total_records: allJsonRecords.length,
            inserted,
            skipped: allJsonRecords.length - inserted,
            warnings: importWarnings,
            errors: jsonErrors,
            ignored_files: ignoredJsonFiles,
          },
          files: {
            total_files: fileEntries.length,
            uploaded_count: uploadedItems.length,
            failed_count: uploadErrors.length,
            items: uploadedItems,
            errors: uploadErrors,
          },
        });
      }

      console.log(
        `[Certificate ZIP] 泥섎━ ?꾨즺: inserted=${inserted}/${allJsonRecords.length}, uploaded=${uploadedItems.length}/${fileEntries.length}, jsonWarnings=${importWarnings.length}, jsonErrors=${jsonErrors.length}, fileErrors=${uploadErrors.length}`
      );
      if (importWarnings.length > 0) {
        console.warn(`[Certificate ZIP] JSON 寃쎄퀬 ?섑뵆: ${importWarnings.slice(0, 5).join(' | ')}`);
      }
      setZipUploadProgress(uploadTaskId, {
        status: 'completed',
        stage: 'completed',
        message: `泥섎━ ?꾨즺 (JSON ${inserted}/${allJsonRecords.length}, ?대?吏 ${uploadedItems.length}/${fileEntries.length})`,
        jsonInserted: inserted,
        jsonTotal: allJsonRecords.length,
        fileUploaded: uploadedItems.length,
        fileTotal: fileEntries.length,
      });

      return res.json({
        success: true,
        partial_success: (inserted < allJsonRecords.length) || (uploadedItems.length < fileEntries.length),
        zip_file_name: req.file.originalname,
        json: {
          source: masterJsonEntry ? 'all_pages_data.json' : 'all-json-files',
          total_records: allJsonRecords.length,
          inserted,
          skipped: allJsonRecords.length - inserted,
          warnings: importWarnings,
          errors: jsonErrors,
          ignored_files: ignoredJsonFiles,
        },
        files: {
          total_files: fileEntries.length,
          uploaded_count: uploadedItems.length,
          failed_count: uploadErrors.length,
          items: uploadedItems,
          errors: uploadErrors,
        },
      });
    } catch (err) {
      console.error(`[Certificate ZIP] ?덉쇅 諛쒖깮: ${err.message}`);
      const uploadTaskId = String(req.body?.uploadTaskId || '').trim();
      setZipUploadProgress(uploadTaskId, {
        status: 'failed',
        stage: 'failed',
        message: err.message,
      });
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};

