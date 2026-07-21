const express = require('express');
const sharp = require('../compat/sharp.cjs');
const { PDFDocument } = require('pdf-lib');
const { drive } = require('../services/driveService.cjs');
const { isSheetsConfigured: isSitesSheetsConfigured, getSites: getSitesFromSheets } = require('../services/sitesSheetsService.cjs');
const { db } = require('../database.cjs');
const { decodeUserContextHeader } = require('../utils/httpUserHeaders.cjs');
const { getBigQueryClient, DATASET_ID } = require('../services/bigQueryClientService.cjs');
const { syncCertificateCacheForSiteMonth } = require('../services/certificateCacheSyncService.cjs');

const router = express.Router();

const CERTIFICATE_ROOT_FOLDER_ID =
  String(process.env.CERTIFICATE_DRIVE_FOLDER_ID || '1Po-gd-OKlaeGyL-Ppjc6_wKgSLEM4iX4').trim();
const CERTIFICATE_PREFIX_RE = /^(성적서|mlss)-(\d{8})(\.[^.]+)?$/i;
const MANUAL_CERT_FILE_RE = /^(성적서|mlss)[_-](\d{8})[_-](.+)\.(jpg|jpeg|png|webp|pdf)$/i;
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

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function escapeDriveQueryValue(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

async function findDriveFileByName(fileName) {
  const name = String(fileName || '').trim();
  if (!name) return null;

  const res = await drive.files.list({
    q: `name='${escapeDriveQueryValue(name)}' and trashed=false`,
    fields: 'files(id,name,mimeType,size)',
    spaces: 'drive',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    pageSize: 10,
  });

  return (res.data.files || [])[0] || null;
}

async function downloadDriveFileWithMeta(fileIdOrName) {
  try {
    const meta = await drive.files.get({
      fileId: fileIdOrName,
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true,
    });
    const media = await drive.files.get(
      { fileId: fileIdOrName, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    return {
      meta: meta.data || {},
      buffer: await streamToBuffer(media.data),
    };
  } catch (err) {
    const found = await findDriveFileByName(fileIdOrName);
    if (!found) throw err;

    const meta = await drive.files.get({
      fileId: found.id,
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true,
    });
    const media = await drive.files.get(
      { fileId: found.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    return {
      meta: meta.data || found,
      buffer: await streamToBuffer(media.data),
    };
  }
}

function fitSize(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: width * scale,
    height: height * scale,
  };
}

async function appendCertificateFileToPdf(mergedPdf, file) {
  const mimeType = String(file.meta?.mimeType || '').toLowerCase();
  const fileName = String(file.meta?.name || '').toLowerCase();
  const buffer = file.buffer;

  if (mimeType.includes('pdf') || fileName.endsWith('.pdf')) {
    const sourcePdf = await PDFDocument.load(buffer);
    const copiedPages = await mergedPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
    return;
  }

  let image;
  if (mimeType.includes('png') || fileName.endsWith('.png')) {
    image = await mergedPdf.embedPng(buffer);
  } else if (mimeType.includes('jpeg') || mimeType.includes('jpg') || /\.(jpe?g)$/i.test(fileName)) {
    image = await mergedPdf.embedJpg(buffer);
  } else {
    const pngBuffer = await sharp(buffer).png().toBuffer();
    image = await mergedPdf.embedPng(pngBuffer);
  }

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 24;
  const fitted = fitSize(image.width, image.height, pageWidth - margin * 2, pageHeight - margin * 2);
  const page = mergedPdf.addPage([pageWidth, pageHeight]);
  page.drawImage(image, {
    x: (pageWidth - fitted.width) / 2,
    y: (pageHeight - fitted.height) / 2,
    width: fitted.width,
    height: fitted.height,
  });
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
  const certRoot = rootFolders.find((f) => String(f.name || '').trim() === '성적서');
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
    .replace(/합계/g, '')
    .replace(/방향/g, '')
    .replace(/상행|하행/g, '');
}

function normalizeDateLike(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return '';
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
  aliases.add(raw.replace(/합계/g, '').trim());
  aliases.add(raw.replace(/방향/g, '').trim());
  aliases.add(raw.replace(/합계/g, '').replace(/방향/g, '').trim());
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
      aliases.add(`${base}(${dir.replace(/방향/g, '')})`);
      aliases.add(`${base}${dir.replace(/방향/g, '')}`);
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

  // OCR·약칭 등 약간 어긋난 현장명도 시트 별칭과 맞추기 위해 하한을 낮춤 (업서트 폴백이 추가 안전망)
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
  res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
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

/** JSON 본문에 들어 있을 수 있는 현장명 후보 (OCR 원문 등) */
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

/** DB 행(컬럼 + payload) vs 파일명에서 온 현장 문자열 유사도 */
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
    throw new Error('BigQuery 연결이 필요합니다. (certificate 파일 메타 동기화)');
  }

  const nowIso = new Date().toISOString();
  const rawForFuzzy = String(siteNameRawFromFile ?? siteName ?? '').trim();
  const officialForFuzzy = String(siteName ?? '').trim();

  const [candidates] = await bq.query({
    query: `
      SELECT id, site_name, site_name_raw, report_date
      FROM \`${DATASET_ID}.water_quality\`
      WHERE report_date = @reportDate
      ORDER BY id DESC
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
    const localId = String(t.id || '').trim();
    if (!localId) continue;
    await bq.query({
      query: `
        UPDATE \`${DATASET_ID}.water_quality\`
        SET
          category = @category,
          drive_file_name = @uploadedFileName,
          source_pdf_name = @originalFileName,
          uploaded_at = @updatedAt
        WHERE report_date = @reportDate
          AND id = @localId
      `,
      params: {
        category: category || null,
        uploadedFileName: uploadedFileName || null,
        originalFileName: originalFileName || null,
        updatedAt: nowIso,
        reportDate,
        localId,
      },
      types: {
        category: 'STRING',
        uploadedFileName: 'STRING',
        originalFileName: 'STRING',
        updatedAt: 'TIMESTAMP',
        reportDate: 'DATE',
        localId: 'STRING',
      },
    });
  }

  return targets.length;
}

async function upsertCertificateRowToBigQuery(row, uniqueIndex) {
  const bq = getBigQueryClient();
  if (!bq) throw new Error('BigQuery 연결이 필요합니다.');

  const reportDate = normalizeDateLike(row.report_date || row.date || row.sampled_at);
  if (!reportDate) return { inserted: false, reason: 'invalid_date' };
  const nowIso = new Date().toISOString();
  const rowId = String(row.id || `${Date.now()}${String(uniqueIndex % 1000).padStart(3, '0')}`);

  await bq.query({
    query: `
      DELETE FROM \`${DATASET_ID}.water_quality\`
      WHERE report_date = DATE(@reportDate)
        AND (@siteName IS NOT NULL AND site_name = @siteName)
    `,
    params: {
      reportDate,
      siteName: row.site_name || null,
    },
    types: {
      reportDate: 'STRING',
      siteName: 'STRING',
    },
  });

  await bq.query({
    query: `
      INSERT INTO \`${DATASET_ID}.water_quality\` (
        id, uploaded_at, report_date, category, site_name, site_name_raw,
        bod, ss, tn, tp, mlss, total_coliform, drive_file_name, source_pdf_name
      )
      VALUES (
        @id, @uploaded_at, DATE(@report_date), @category, @site_name, @site_name_raw,
        @bod, @ss, @tn, @tp, @mlss, @total_coliform, @drive_file_name, @source_pdf_name
      )
    `,
    params: {
      category: row.category || row.certificate_category || null,
      drive_file_name: row.drive_file_name || row.certificate_file_name || null,
      id: rowId,
      site_name: row.site_name || null,
      site_name_raw: row.site_name_raw || null,
      report_date: reportDate,
      ss: toNullableNumber(row.ss),
      bod: toNullableNumber(row.bod),
      tn: toNullableNumber(row.tn),
      tp: toNullableNumber(row.tp),
      total_coliform: toNullableNumber(row.total_coliform),
      mlss: toNullableNumber(row.mlss),
      source_pdf_name: row.source_pdf_name || null,
      uploaded_at: nowIso,
    },
    types: {
      category: 'STRING',
      drive_file_name: 'STRING',
      site_name: 'STRING',
      site_name_raw: 'STRING',
      id: 'STRING',
      report_date: 'STRING',
      ss: 'FLOAT64',
      bod: 'FLOAT64',
      tn: 'FLOAT64',
      tp: 'FLOAT64',
      total_coliform: 'FLOAT64',
      mlss: 'FLOAT64',
      source_pdf_name: 'STRING',
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

/** 페이지/래퍼 객체를 INSERT에서 바로 쓸 수 있게 record·data·extracted를 한 객체로 합침 */
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
 * AI Studio batch_export 등: 최상위 배열, records[], pages[] 만 다건으로 인식했었음.
 * 단일 객체에 record만 있거나 pages[]에 페이지별 데이터가 있으면 1건만 들어가던 문제 보완.
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

function normalizeYearMonth(year, month) {
  const y = String(year || '').trim();
  const m = String(month || '').trim().padStart(2, '0');
  if (/^\d{4}$/.test(y) && /^(0[1-9]|1[0-2])$/.test(m)) {
    return `${y}${m}`;
  }
  return '';
}

function inferYearMonthFromCertificateItems(items = []) {
  for (const item of items) {
    const fileName = String(item.fileName || '').trim();
    const compact = fileName.match(/(20\d{2})(0[1-9]|1[0-2])\d{2}/);
    if (compact) return `${compact[1]}${compact[2]}`;

    const dashed = fileName.match(/(20\d{2})[-_. ](0[1-9]|1[0-2])[-_. ]\d{2}/);
    if (dashed) return `${dashed[1]}${dashed[2]}`;
  }

  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function safePdfFileName(name) {
  const raw = String(name || '').trim() || 'certificate.pdf';
  const withoutExt = raw.replace(/\.[^.]+$/, '');
  return `${withoutExt || 'certificate'}.pdf`.replace(/["\r\n\\/:*?<>|]+/g, '_').slice(0, 180);
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

module.exports = function () {
  router.get('/api/certificates', async (req, res) => {
    try {
      const role = resolveUserRole(req);
      const appSettings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const currentSiteName = String(appSettings?.site_name || '').trim();
      if (!currentSiteName) {
        return res.status(400).json({ success: false, code: 'SITE_NOT_CONFIGURED', message: '설정에서 현장을 먼저 확정해 주세요.' });
      }
      const requestedSiteName = currentSiteName;
      const userSiteName = resolveUserSiteName(req);
      const userName = resolveUserName(req);
      let siteNameFilters = [requestedSiteName];
      if (role === 'user') {
        const allowedFromHeader = getDirectionalPairSiteNames(userSiteName);
        const allowedFromManager = getManagedSiteNamesByManagerName(userName);
        const allowedSites = Array.from(new Set([...allowedFromHeader, ...allowedFromManager]));
        if (allowedSites.length === 0) {
          return res.status(403).json({ success: false, message: '현장 정보가 없어 성적서를 조회할 수 없습니다.' });
        }
        if (!allowedSites.includes(requestedSiteName)) {
          return res.status(403).json({ success: false, message: '현장 정보가 없어 성적서를 조회할 수 없습니다.' });
        }
        siteNameFilters = [requestedSiteName];
      }
      const year = normalizeYear(req.query.year);
      const month = normalizeMonth(req.query.month);
      const normalizedSiteFilterKeys = new Set(
        siteNameFilters.map((name) => normalizeSiteNameKey(name)).filter(Boolean)
      );
      const items = [];
      if (!drive || !CERTIFICATE_ROOT_FOLDER_ID) {
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }

      // 성적서 메뉴의 파일 목록은 Drive를 단일 원천으로 사용한다.
      // BigQuery water_quality는 성적서 분석값 동기화/업무일지 바인딩용이며 파일 목록에는 사용하지 않는다.
      {
        const folders = await resolveMonthFolders({ year, month });

        for (const folder of folders) {
          const files = await listFiles(folder.folderId);
          for (const file of files) {
            const baseName = toBaseName(file.name);
            // 성적서 목록은 결과 파일만 노출 (ZIP/기타 산출물 제외)
            if (!isAllowedManualMedia(baseName)) {
              continue;
            }
            const parsed = parseManualCertificateFileName(file.name);
            let siteName = '공통';
            let reportDate = '';
            let category = '';
            if (parsed) {
              siteName = parsed.site_name_raw || '공통';
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

            items.push({
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
        return res.status(400).json({ success: false, message: 'year/month 값이 필요합니다.' });
      }

      let targetSiteNames = requestedSiteName ? [requestedSiteName] : [];
      if (role === 'user') {
        const allowedFromHeader = getDirectionalPairSiteNames(userSiteName);
        const allowedFromManager = getManagedSiteNamesByManagerName(userName);
        const allowedSites = Array.from(new Set([...allowedFromHeader, ...allowedFromManager]));
        if (allowedSites.length === 0) {
          return res.status(403).json({ success: false, message: '현장 정보가 없어 동기화할 수 없습니다.' });
        }
        if (requestedSiteName && !allowedSites.includes(requestedSiteName)) {
          return res.status(403).json({ success: false, message: '현장 정보가 없어 동기화할 수 없습니다.' });
        }
        targetSiteNames = requestedSiteName ? [requestedSiteName] : allowedSites;
      } else if (targetSiteNames.length === 0 && userSiteName) {
        targetSiteNames = [userSiteName];
      }

      if (targetSiteNames.length === 0) {
        return res.status(400).json({ success: false, message: '동기화 대상 현장을 확인할 수 없습니다.' });
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
    if (!id) return res.status(400).json({ success: false, message: '성적서 ID가 필요합니다.' });

    return res.json({
      success: true,
      downloadUrl: `/api/certificates/files/${encodeURIComponent(id)}`,
    });
  });

  router.post('/api/certificates/download-selected-pdf', async (req, res) => {
    try {
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const requestedYearMonth = normalizeYearMonth(req.body?.year, req.body?.month);
      const items = rawItems
        .map((item) => ({
          id: String(item?.id || '').trim(),
          fileName: String(item?.fileName || item?.file_name || '').trim(),
        }))
        .filter((item) => item.id);

      if (!items.length) {
        return res.status(400).json({ success: false, message: '다운로드할 성적서를 선택해 주세요.' });
      }
      if (items.length > 100) {
        return res.status(400).json({ success: false, message: '한 번에 100개 이하만 다운로드할 수 있습니다.' });
      }
      if (!drive) {
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }

      const mergedPdf = await PDFDocument.create();
      for (const item of items) {
        const file = await downloadDriveFileWithMeta(item.id);
        if (item.fileName && !file.meta.name) {
          file.meta.name = item.fileName;
        }
        await appendCertificateFileToPdf(mergedPdf, file);
      }

      const bytes = await mergedPdf.save();
      const outputName = items.length === 1
        ? safePdfFileName(items[0].fileName || '성적서.pdf')
        : `병합성적서_${requestedYearMonth || inferYearMonthFromCertificateItems(items)}_${items.length}건.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(outputName)}`);
      return res.send(Buffer.from(bytes));
    } catch (err) {
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  router.get('/api/certificates/files/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) return res.status(400).send('잘못된 요청입니다.');

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
      const disposition = String(req.query.preview || '') === '1' ? 'inline' : 'attachment';
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(safeFileName)}`);
      media.data.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      media.data.pipe(res);
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};

