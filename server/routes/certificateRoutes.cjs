const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const { drive, getOrCreateFolder, uploadBufferToFolder } = require('../services/driveService.cjs');
const { isSheetsConfigured: isSitesSheetsConfigured, getSites: getSitesFromSheets } = require('../services/sitesSheetsService.cjs');
const { db } = require('../database.cjs');
const { triggerSync: triggerBigQuerySync } = require('../services/bigQueryTriggerService.cjs');
const { getBigQueryClient, DATASET_ID } = require('../services/bigQueryClientService.cjs');

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

function normalizeYear(value) {
  const y = String(value || '').trim();
  return /^\d{4}$/.test(y) ? y : '';
}

function normalizeMonth(value) {
  const m = String(value || '').trim();
  return /^(0[1-9]|1[0-2])$/.test(m) ? m : '';
}

async function resolveMonthFolders({ year, month }) {
  const yearFolders = await listFolders(CERTIFICATE_ROOT_FOLDER_ID);
  if (!year && !month) {
    const monthFolders = [];
    for (const yf of yearFolders) {
      const months = await listFolders(yf.id);
      months.forEach((mf) => monthFolders.push({ year: yf.name, month: mf.name, folderId: mf.id }));
    }
    return monthFolders;
  }

  const yearFolder = yearFolders.find((f) => f.name === year);
  if (!yearFolder) return [];
  const monthFolders = await listFolders(yearFolder.id);
  if (!month) {
    return monthFolders.map((mf) => ({ year, month: mf.name, folderId: mf.id }));
  }
  const monthFolder = monthFolders.find((f) => f.name === month);
  if (!monthFolder) return [];
  return [{ year, month, folderId: monthFolder.id }];
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSiteNameKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()\-_/]/g, '')
    .replace(/휴게소/g, '')
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
  aliases.add(raw.replace(/휴게소/g, '').trim());
  aliases.add(raw.replace(/방향/g, '').trim());
  aliases.add(raw.replace(/휴게소/g, '').replace(/방향/g, '').trim());
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
      aliases.add(`${base}휴게소(${dir})`);
      aliases.add(`${base}휴게소${dir}`);
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

  if (!best || bestScore < 0.55) {
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
  return String(
    req.headers['x-user-role']
    || req.body?._user?.role
    || req.query?._role
    || ''
  ).trim().toLowerCase();
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

function upsertCertificateFileMeta({
  reportDate,
  siteId,
  siteName,
  category,
  driveFileId,
  driveWebViewLink,
  uploadedFileName,
  originalFileName,
}) {
  const nowIso = new Date().toISOString();
  const rows = db.prepare(`
    SELECT id, source_payload_json
    FROM certificate_water_quality
    WHERE report_date = ?
      AND (
        (? IS NOT NULL AND site_id = ?)
        OR (? IS NOT NULL AND site_name = ?)
      )
    ORDER BY id DESC
  `).all(
    reportDate,
    siteId || null, siteId || null,
    siteName || null, siteName || null
  );

  if (!rows.length) return 0;
  const updateStmt = db.prepare(`
    UPDATE certificate_water_quality
    SET source_payload_json = ?, last_modified = ?, is_synced = 0
    WHERE id = ?
  `);
  const tx = db.transaction((items) => {
    items.forEach((row) => {
      const payload = parseJsonObject(row.source_payload_json);
      payload.certificate_file = {
        category: category || null,
        file_name: uploadedFileName || null,
        original_file_name: originalFileName || null,
        drive_file_id: driveFileId || null,
        drive_web_view_link: driveWebViewLink || null,
        updated_at: nowIso,
      };
      updateStmt.run(JSON.stringify(payload), nowIso, row.id);
    });
  });
  tx(rows);
  return rows.length;
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

function normalizeIncomingJsonRecords(payload) {
  const incoming = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.records) ? payload.records : [payload]);
  return incoming.filter((row) => row && typeof row === 'object');
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

module.exports = function () {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

  router.get('/api/certificates/site-normalization', async (req, res) => {
    try {
      if (!isSitesSheetsConfigured()) {
        return res.status(400).json({
          success: false,
          message: 'Google Sheets이 설정되지 않았습니다. (GOOGLE_MEMBERS_SHEET_ID)',
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
          message: 'report_date(YYYY-MM-DD)가 필요합니다.',
          received: normalized,
        });
      }

      if (!record.site_name && !record.site_id) {
        return res.status(400).json({
          success: false,
          message: 'site_name 또는 site_id 중 하나는 필요합니다.',
          received: normalized,
        });
      }

      const insertInfo = db.prepare(`
        INSERT INTO certificate_water_quality (
          report_date, site_id, site_name, site_name_raw,
          ss, bod, tn, tp, total_coliform, mlss, do, ph,
          source_pdf_name, source_page_index,
          ai_confidence, site_match_confidence, manual_review_required,
          warnings_json, source_payload_json,
          created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(record.report_date),
        record.site_id ? String(record.site_id) : null,
        record.site_name ? String(record.site_name) : null,
        record.site_name_raw ? String(record.site_name_raw) : null,
        toNullableNumber(record.ss),
        toNullableNumber(record.bod),
        toNullableNumber(record.tn),
        toNullableNumber(record.tp),
        toNullableNumber(record.total_coliform),
        toNullableNumber(record.mlss),
        toNullableNumber(record.do),
        toNullableNumber(record.ph),
        normalized.source.source_pdf_name ? String(normalized.source.source_pdf_name) : null,
        normalized.source.page_index != null ? Number(normalized.source.page_index) : null,
        toNullableNumber(normalized.meta.confidence),
        toNullableNumber(normalized.meta.site_match_confidence),
        normalized.meta.manual_review_required ? 1 : 0,
        JSON.stringify(normalized.meta.warnings || []),
        JSON.stringify(req.body || {}),
        new Date().toISOString(),
        new Date().toISOString(),
        0
      );

      triggerBigQuerySync('after-save:POST:/api/certificates/import-from-ai');
      return res.json({
        success: true,
        accepted: true,
        message: 'AI 추출 결과를 정상 수신/저장했습니다.',
        id: insertInfo.lastInsertRowid,
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
        return res.status(400).json({ success: false, message: '업로드할 JSON 레코드가 없습니다.' });
      }

      const insertStmt = db.prepare(`
        INSERT INTO certificate_water_quality (
          report_date, site_id, site_name, site_name_raw,
          ss, bod, tn, tp, total_coliform, mlss, do, ph,
          source_pdf_name, source_page_index,
          ai_confidence, site_match_confidence, manual_review_required,
          warnings_json, source_payload_json,
          created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const nowIso = new Date().toISOString();
      const warnings = [];
      let inserted = 0;

      const tx = db.transaction((rows) => {
        rows.forEach((raw, index) => {
          const reportDate = normalizeDateLike(raw.report_date || raw.date || raw.sampled_at);
          if (!reportDate) {
            warnings.push(`index ${index}: report_date 형식이 올바르지 않아 제외되었습니다.`);
            return;
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

          insertStmt.run(
            reportDate,
            matched.site_id ? String(matched.site_id) : null,
            matched.site_name ? String(matched.site_name) : null,
            matched.site_name_raw ? String(matched.site_name_raw) : null,
            toNullableNumber(raw.ss),
            toNullableNumber(raw.bod),
            toNullableNumber(raw.tn),
            toNullableNumber(raw.tp),
            toNullableNumber(raw.total_coliform),
            toNullableNumber(raw.mlss),
            toNullableNumber(raw.do),
            toNullableNumber(raw.ph),
            raw.source_pdf_name ? String(raw.source_pdf_name) : null,
            raw.source_page_index != null ? Number(raw.source_page_index) : null,
            toNullableNumber(raw.ai_confidence ?? raw.meta?.confidence),
            toNullableNumber(raw.site_match_confidence ?? raw.meta?.site_match_confidence ?? matched.site_match_confidence),
            manualReview ? 1 : 0,
            JSON.stringify(rowWarnings),
            JSON.stringify(raw),
            nowIso,
            nowIso,
            0
          );
          inserted += 1;
        });
      });

      tx(records);
      if (inserted > 0) {
        triggerBigQuerySync('after-save:POST:/api/certificates/manual-import-json');
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

  router.get('/api/certificates', async (req, res) => {
    try {
      const bq = getBigQueryClient();
      const siteNameFilter = String(req.query.siteName || '').trim();
      if (bq) {
        const where = [
          "COALESCE(drive_file_id, JSON_EXTRACT_SCALAR(source_payload_json, '$.certificate_file.drive_file_id')) IS NOT NULL",
        ];
        const params = {};
        if (siteNameFilter) {
          where.push('site_name = @siteName');
          params.siteName = siteNameFilter;
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
        const items = (rows || [])
          .filter((row) => row && row.drive_file_id)
          .map((row) => {
            const reportDate = String(row.report_date || '').slice(0, 10);
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
        return res.json({ success: true, items });
      }

      if (!drive || !CERTIFICATE_ROOT_FOLDER_ID) {
        return res.json({ success: true, items: [] });
      }

      const year = normalizeYear(req.query.year);
      const month = normalizeMonth(req.query.month);
      const folders = await resolveMonthFolders({ year, month });
      const items = [];

      for (const folder of folders) {
        const files = await listFiles(folder.folderId);
        for (const file of files) {
          const meta = parseCertMeta(file.name);
          if (!meta) continue;
          items.push({
            id: file.id,
            fileName: file.name,
            siteName: '공통',
            sampledAt: meta.sampledAt,
            issuedAt: meta.issuedAt,
            category: meta.category,
            year: folder.year,
            month: folder.month,
            downloadUrl: `/api/certificates/files/${encodeURIComponent(file.id)}?name=${encodeURIComponent(file.name)}`,
          });
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

  router.get('/api/certificates/:id/download', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: '성적서 ID가 필요합니다.' });
    return res.json({
      success: true,
      downloadUrl: `/api/certificates/files/${encodeURIComponent(id)}`,
    });
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
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: '업로드 파일이 없습니다.' });
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
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ success: false, message: '업로드 파일이 없습니다.' });
      }

      const siteMaster = await loadSiteMaster();
      const certFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, '성적서');
      const items = [];
      const errors = [];

      for (const file of files) {
        try {
          const parsed = parseManualCertificateFileName(file.originalname);
          if (!parsed) {
            errors.push({
              file: file.originalname,
              message: '파일명 형식이 올바르지 않습니다. (성적서_yyyymmdd_현장명.jpg 또는 mlss_yyyymmdd_현장명.jpg)',
            });
            continue;
          }
          const reportDate = normalizeDateLike(parsed.yyyymmdd);
          if (!reportDate) {
            errors.push({
              file: file.originalname,
              message: '파일명 날짜(yyyymmdd)가 올바르지 않습니다.',
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
          const linkedRows = upsertCertificateFileMeta({
            reportDate,
            siteId: matched.site_id,
            siteName: matched.site_name || parsed.site_name_raw,
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
        return res.status(400).json({ success: false, message: 'Drive 설정이 필요합니다.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'ZIP 파일이 필요합니다. (bundleZip)' });
      }
      if (!/\.zip$/i.test(String(req.file.originalname || ''))) {
        return res.status(400).json({ success: false, message: 'zip 형식 파일만 업로드할 수 있습니다.' });
      }

      const siteMaster = await loadSiteMaster();
      const certFolder = await getOrCreateFolder(CERTIFICATE_ROOT_FOLDER_ID, '성적서');
      const zip = await JSZip.loadAsync(req.file.buffer);
      const entries = Object.keys(zip.files || {})
        .map((key) => zip.files[key])
        .filter((entry) => entry && !entry.dir);

      const allJsonRecords = [];
      const jsonErrors = [];
      const ignoredJsonFiles = [];
      const fileEntries = [];
      const masterJsonEntry = entries.find((entry) => isMasterJsonFile(toBaseName(entry.name))) || null;

      if (masterJsonEntry) {
        try {
          const text = await masterJsonEntry.async('text');
          const parsed = JSON.parse(text);
          const records = normalizeIncomingJsonRecords(parsed);
          allJsonRecords.push(...records);
        } catch (jsonErr) {
          jsonErrors.push({
            file: masterJsonEntry.name,
            message: `JSON 파싱 실패: ${jsonErr.message}`,
          });
        }
      }

      for (const entry of entries) {
        const baseName = toBaseName(entry.name);
        if (isJsonFileName(baseName)) {
          if (masterJsonEntry) {
            if (entry.name !== masterJsonEntry.name) {
              ignoredJsonFiles.push(entry.name);
            }
            continue;
          }
          try {
            const text = await entry.async('text');
            const parsed = JSON.parse(text);
            const records = normalizeIncomingJsonRecords(parsed);
            allJsonRecords.push(...records);
          } catch (jsonErr) {
            jsonErrors.push({
              file: entry.name,
              message: `JSON 파싱 실패: ${jsonErr.message}`,
            });
          }
          continue;
        }

        if (isAllowedManualMedia(baseName)) {
          fileEntries.push({ entry, baseName });
        }
      }

      const insertStmt = db.prepare(`
        INSERT INTO certificate_water_quality (
          report_date, site_id, site_name, site_name_raw,
          ss, bod, tn, tp, total_coliform, mlss, do, ph,
          source_pdf_name, source_page_index,
          ai_confidence, site_match_confidence, manual_review_required,
          warnings_json, source_payload_json,
          created_at, last_modified, is_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const nowIso = new Date().toISOString();
      const importWarnings = [];
      let inserted = 0;

      const tx = db.transaction((rows) => {
        rows.forEach((raw, index) => {
          const reportDate = normalizeDateLike(raw.report_date || raw.date || raw.sampled_at);
          if (!reportDate) {
            importWarnings.push(`json index ${index}: report_date 형식이 올바르지 않아 제외되었습니다.`);
            return;
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

          insertStmt.run(
            reportDate,
            matched.site_id ? String(matched.site_id) : null,
            matched.site_name ? String(matched.site_name) : null,
            matched.site_name_raw ? String(matched.site_name_raw) : null,
            toNullableNumber(raw.ss),
            toNullableNumber(raw.bod),
            toNullableNumber(raw.tn),
            toNullableNumber(raw.tp),
            toNullableNumber(raw.total_coliform),
            toNullableNumber(raw.mlss),
            toNullableNumber(raw.do),
            toNullableNumber(raw.ph),
            raw.source_pdf_name ? String(raw.source_pdf_name) : null,
            raw.source_page_index != null ? Number(raw.source_page_index) : null,
            toNullableNumber(raw.ai_confidence ?? raw.meta?.confidence),
            toNullableNumber(raw.site_match_confidence ?? raw.meta?.site_match_confidence ?? matched.site_match_confidence),
            manualReview ? 1 : 0,
            JSON.stringify(rowWarnings),
            JSON.stringify(raw),
            nowIso,
            nowIso,
            0
          );
          inserted += 1;
        });
      });
      tx(allJsonRecords);
      if (inserted > 0) {
        triggerBigQuerySync('after-save:POST:/api/certificates/manual-upload-zip');
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
              message: '파일명 형식이 올바르지 않습니다. (성적서_yyyymmdd_현장명.jpg 또는 mlss_yyyymmdd_현장명.jpg)',
            });
            continue;
          }
          const reportDate = normalizeDateLike(parsed.yyyymmdd);
          if (!reportDate) {
            uploadErrors.push({
              file: originalName,
              message: '파일명 날짜(yyyymmdd)가 올바르지 않습니다.',
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
          const fileBuffer = await fileObj.entry.async('nodebuffer');
          const uploaded = await uploadBufferToFolder({
            folderId: monthFolder.id,
            fileName: finalFileName,
            buffer: fileBuffer,
            mimeType: parsed.ext === 'pdf' ? 'application/pdf' : 'image/jpeg',
          });
          const linkedRows = upsertCertificateFileMeta({
            reportDate,
            siteId: matched.site_id,
            siteName: matched.site_name || parsed.site_name_raw,
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
          uploadErrors.push({
            file: originalName,
            message: fileErr.message,
          });
        }
      }

      return res.json({
        success: true,
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
      return res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
};

