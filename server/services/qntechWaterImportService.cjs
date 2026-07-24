const { createAuthenticatedClient } = require('./qntechAuthService.cjs');
const { PROJECTS_QUERY, getActiveLocations, getConfiguredSampleMappings, mapProjectsToWaterRows } = require('./qntechWaterValueImportService.cjs');
const { saveProjectPhotos } = require('./qntechWaterPhotoImportService.cjs');
const { getCurrentRecordMetadata } = require('./syncMetadataService.cjs');

const RANGE_IMPORT_DELAY_MS = 250;

function normalizeDateInput(date) {
  const normalized = String(date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('날짜 형식은 YYYY-MM-DD 이어야 합니다.');
  }
  return normalized;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProjectsForDate(db, date, siteContext = {}) {
  const normalizedDate = normalizeDateInput(date);
  const client = await createAuthenticatedClient(db, siteContext);
  return fetchProjectsForDateWithClient(client, normalizedDate);
}

function enumerateDates(startDate, endDate) {
  const start = new Date(`${normalizeDateInput(startDate)}T00:00:00`);
  const end = new Date(`${normalizeDateInput(endDate)}T00:00:00`);
  if (start > end) {
    throw new Error('시작일은 종료일보다 클 수 없습니다.');
  }

  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function normalizeComparableValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  const numeric = Number(text);
  return Number.isFinite(numeric) ? `n:${numeric}` : `s:${text}`;
}

function buildComparableRowKey(row = {}) {
  return [
    String(row.location || '유입수').trim(),
    String(row.item_code || '').trim(),
  ].join('|');
}

function waterRowsMatchExisting(db, importedRows, metadata = {}) {
  if (!Array.isArray(importedRows) || importedRows.length === 0) return false;

  const dates = [...new Set(importedRows.map((row) => normalizeDateInput(row.date)))];
  if (dates.length !== 1) return false;

  const siteId = String(metadata.siteId || '').trim();
  const existingRows = siteId
    ? db.prepare(`
        SELECT measurement_order, location, item_code, result_value
        FROM qntech_water_quality
        WHERE date = ? AND site_id = ?
      `).all(dates[0], siteId)
    : db.prepare(`
        SELECT measurement_order, location, item_code, result_value
        FROM qntech_water_quality
        WHERE date = ?
      `).all(dates[0]);

  if (existingRows.length === 0) return false;

  const existingValues = new Map();
  for (const row of existingRows) {
    const key = buildComparableRowKey(row);
    const values = existingValues.get(key) || [];
    values.push(normalizeComparableValue(row.result_value));
    existingValues.set(key, values);
  }

  for (const row of importedRows) {
    const key = buildComparableRowKey(row);
    const expectedValue = normalizeComparableValue(row.result_value ?? row.result_numeric);
    const candidates = existingValues.get(key) || [];
    const matchedIndex = candidates.indexOf(expectedValue);
    if (matchedIndex < 0) return false;
    candidates.splice(matchedIndex, 1);
  }

  return true;
}

function persistWaterRows(db, importedRows, siteContext = {}) {
  if (!Array.isArray(importedRows) || importedRows.length === 0) {
    return {
      insertedRowCount: 0,
      upsertedRowCount: 0,
      matchedExistingData: false,
      matchedRowCount: 0,
    };
  }

  const metadata = getCurrentRecordMetadata(db, siteContext);
  if (waterRowsMatchExisting(db, importedRows, metadata)) {
    return {
      insertedRowCount: 0,
      upsertedRowCount: 0,
      matchedExistingData: true,
      matchedRowCount: importedRows.length,
    };
  }

  const existingRowStmt = db.prepare(`
    SELECT 1
    FROM qntech_water_quality
    WHERE site_id = ? AND date = ? AND measurement_group = ? AND location = ? AND item_code = ?
    LIMIT 1
  `);

  const stmt = db.prepare(`
    INSERT INTO qntech_water_quality (
      date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
      location, item_name, item_code, result_value, result_numeric, unit,
      input_status, site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_id, date, measurement_group, location, item_code) DO UPDATE SET
      measurement_order = excluded.measurement_order,
      source_type = excluded.source_type,
      input_status = excluded.input_status,
      source_label = excluded.source_label,
      qntech_project_id = excluded.qntech_project_id,
      item_name = excluded.item_name,
      result_value = excluded.result_value,
      result_numeric = excluded.result_numeric,
      unit = excluded.unit,
      site_id = excluded.site_id,
      site_name = excluded.site_name,
      author = excluded.author,
      last_modified = excluded.last_modified,
      is_synced = excluded.is_synced
  `);

  let insertedRowCount = 0;
  const runInsert = db.transaction((rows) => {
    rows.forEach((item) => {
      const measurementGroup = item.measurement_group || `manual:${item.date}`;
      if (!existingRowStmt.get(metadata.siteId, item.date, measurementGroup, item.location || '유입수', item.item_code || '')) {
        insertedRowCount += 1;
      }

      stmt.run(
        item.date,
        measurementGroup,
        item.measurement_order ?? 1,
        item.source_type || 'manual',
        item.source_label ?? null,
        item.qntech_project_id ?? null,
        item.location || '유입수',
        item.item_name || item.item_code || '측정항목',
        item.item_code || '',
        item.result_value ?? null,
        item.result_numeric ?? null,
        item.unit || null,
        metadata.siteId,
        metadata.siteName,
        metadata.author,
        metadata.createdAt,
        metadata.lastModified,
        metadata.isSynced
      );
    });
  });

  runInsert(importedRows);
  return {
    insertedRowCount,
    upsertedRowCount: importedRows.length,
    matchedExistingData: false,
    matchedRowCount: 0,
  };
}

async function fetchProjectsForDateWithClient(client, normalizedDate) {
  const sites = client.me?.sites || [];
  if (!sites.length) {
    throw new Error('QnTECH에서 접근 가능한 현장을 찾지 못했습니다.');
  }

  const configuredSiteId = String(client.qntechSiteId || '').trim();
  if (!configuredSiteId) {
    throw new Error('현재 현장의 QnTECH siteId가 설정되어 있지 않습니다. Google Sheets의 qntech_site_id를 확인해 주세요.');
  }

  const site = sites.find((item) => String(item.id) === configuredSiteId);
  if (!site) {
    throw new Error(`저장된 QnTECH siteId(${configuredSiteId})가 로그인 계정의 접근 현장 목록에 없습니다.`);
  }
  const projectResult = await client.graphqlRequest(PROJECTS_QUERY, {
    data: { siteId: Number(site.id), regDt: normalizedDate }
  }, '/');

  return {
    date: normalizedDate,
    client,
    site,
    projects: projectResult?.selectProjectListByRegDt || []
  };
}

async function importQntechWaterValues(db, date, siteContext = {}) {
  const context = await fetchProjectsForDate(db, date, siteContext);
  const activeLocations = getActiveLocations(db);
  const configuredSampleMappings = getConfiguredSampleMappings(db);
  const mapped = mapProjectsToWaterRows(context.projects, activeLocations, configuredSampleMappings, {
    fallbackDate: context.date
  });

  return {
    date: context.date,
    site: { id: context.site.id, name: context.site.name },
    projectCount: context.projects.length,
    importedRows: mapped.importedRows,
    unmatchedSamples: mapped.unmatchedSamples,
    unmatchedItems: mapped.unmatchedItems,
    mappingCollisions: mapped.mappingCollisions,
  };
}

async function importQntechWaterPhotos(db, baseDir, date, siteContext = {}) {
  const context = await fetchProjectsForDate(db, date, siteContext);
  const photoSetting = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const photoResult = await saveProjectPhotos({
    db,
    baseUrl: context.client.baseUrl,
    cookieJar: context.client.cookieJar,
    projects: context.projects,
    date: context.date,
    baseDir,
    configuredPhotoRoot: photoSetting?.qntech_photo_root,
    siteName: context.site?.name
  });

  return {
    date: context.date,
    site: { id: context.site.id, name: context.site.name },
    projectCount: context.projects.length,
    ...photoResult
  };
}

async function importQntechWaterAll(db, baseDir, date, siteContext = {}) {
  const context = await fetchProjectsForDate(db, date, siteContext);
  const activeLocations = getActiveLocations(db);
  const configuredSampleMappings = getConfiguredSampleMappings(db);
  const photoSetting = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const mapped = mapProjectsToWaterRows(context.projects, activeLocations, configuredSampleMappings, {
    fallbackDate: context.date
  });
  const persistResult = persistWaterRows(db, mapped.importedRows, siteContext);
  const photoResult = await saveProjectPhotos({
    db,
    baseUrl: context.client.baseUrl,
    cookieJar: context.client.cookieJar,
    projects: context.projects,
    date: context.date,
    baseDir,
    configuredPhotoRoot: photoSetting?.qntech_photo_root,
    siteName: context.site?.name
  });

  return {
    success: true,
    date: context.date,
    site: { id: context.site.id, name: context.site.name },
    projectCount: context.projects.length,
    importedRows: mapped.importedRows,
    unmatchedSamples: mapped.unmatchedSamples,
    unmatchedItems: mapped.unmatchedItems,
    mappingCollisions: mapped.mappingCollisions,
    identifiedPhotos: photoResult.identifiedPhotos,
    savedPhotos: photoResult.savedPhotos,
    driveUploadedPhotos: photoResult.driveUploadedPhotos,
    driveUploadErrors: photoResult.driveUploadErrors,
    photoRoot: photoResult.photoRoot,
    photoDirectory: photoResult.photoDirectory,
    driveFolderId: photoResult.driveFolderId,
    driveFolderUrl: photoResult.driveFolderUrl,
    summary: {
      importedRowCount: persistResult.upsertedRowCount,
      insertedRowCount: persistResult.insertedRowCount,
      matchedExistingData: persistResult.matchedExistingData,
      matchedRowCount: persistResult.matchedRowCount,
      savedPhotoCount: photoResult.savedPhotos.length,
      driveUploadedPhotoCount: photoResult.driveUploadedPhotos.length,
      driveUploadErrorCount: photoResult.driveUploadErrors.length
    }
  };
}

async function importQntechWaterRange(db, baseDir, startDate, endDate, options = {}) {
  const { onProgress, siteContext = {} } = options;
  const dates = enumerateDates(startDate, endDate);
  const client = await createAuthenticatedClient(db, siteContext);
  const activeLocations = getActiveLocations(db);
  const configuredSampleMappings = getConfiguredSampleMappings(db);
  const photoSetting = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();

  const summaryRows = [];
  let totalSavedPhotos = 0;
  let totalDriveUploadedPhotos = 0;
  let totalDriveUploadErrors = 0;
  let totalInsertedRows = 0;
  let photoRoot = null;

  onProgress?.({
    status: 'processing',
    totalDates: dates.length,
    completedDates: 0,
    currentDate: null,
    message: `총 ${dates.length}일 데이터를 준비하는 중...`
  });

  for (const [index, date] of dates.entries()) {
    if (index > 0 && RANGE_IMPORT_DELAY_MS > 0) {
      await sleep(RANGE_IMPORT_DELAY_MS);
    }

    onProgress?.({
      status: 'processing',
      totalDates: dates.length,
      completedDates: index,
      currentDate: date,
      message: `${date} 데이터를 불러오는 중...`
    });

    const context = await fetchProjectsForDateWithClient(client, date);
    const mapped = mapProjectsToWaterRows(context.projects, activeLocations, configuredSampleMappings, {
      fallbackDate: context.date
    });
    const persistResult = persistWaterRows(db, mapped.importedRows, siteContext);
    const insertedRowCount = persistResult.insertedRowCount;
    const hadExistingValues = persistResult.matchedExistingData
      || persistResult.upsertedRowCount > insertedRowCount;

    const photoResult = await saveProjectPhotos({
      db,
      baseUrl: context.client.baseUrl,
      cookieJar: context.client.cookieJar,
      projects: context.projects,
      date: context.date,
      baseDir,
      configuredPhotoRoot: photoSetting?.qntech_photo_root,
      siteName: context.site?.name
    });

    photoRoot = photoResult.photoRoot;
    totalSavedPhotos += photoResult.savedPhotos.length;
    totalDriveUploadedPhotos += photoResult.driveUploadedPhotos.length;
    totalDriveUploadErrors += photoResult.driveUploadErrors.length;
    totalInsertedRows += insertedRowCount;

    summaryRows.push({
      date,
      siteName: context.site?.name || '',
      existingValues: hadExistingValues,
      matchedExistingData: persistResult.matchedExistingData,
      matchedRowCount: persistResult.matchedRowCount,
      projectCount: context.projects.length,
      insertedRowCount,
      savedPhotoCount: photoResult.savedPhotos.length,
      driveUploadedPhotoCount: photoResult.driveUploadedPhotos.length,
      driveUploadErrorCount: photoResult.driveUploadErrors.length,
      driveUploadErrors: photoResult.driveUploadErrors,
      photoDirectory: photoResult.photoDirectory,
      driveFolderUrl: photoResult.driveFolderUrl,
      unmatchedSamples: mapped.unmatchedSamples,
      unmatchedItems: mapped.unmatchedItems,
      mappingCollisions: mapped.mappingCollisions,
    });

    onProgress?.({
      status: 'processing',
      totalDates: dates.length,
      completedDates: index + 1,
      currentDate: date,
      message: `${date} 데이터 처리를 완료했습니다.`
    });
  }

  return {
    success: true,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    processedDates: dates.length,
    insertedDates: summaryRows.filter((item) => item.insertedRowCount > 0).map((item) => item.date),
    existingValueDates: summaryRows.filter((item) => item.existingValues).map((item) => item.date),
    kitSyncDates: summaryRows.filter((item) => !item.matchedExistingData).map((item) => item.date),
    summaryRows,
    photoRoot,
    driveFolderUrl: summaryRows.find((item) => item.driveFolderUrl)?.driveFolderUrl || '',
    summary: {
      insertedRowCount: totalInsertedRows,
      savedPhotoCount: totalSavedPhotos,
      driveUploadedPhotoCount: totalDriveUploadedPhotos,
      driveUploadErrorCount: totalDriveUploadErrors,
      existingValueDateCount: summaryRows.filter((item) => item.existingValues).length
    }
  };
}

module.exports = {
  importQntechWaterValues,
  importQntechWaterPhotos,
  importQntechWaterAll,
  importQntechWaterRange,
  fetchProjectsForDate,
  waterRowsMatchExisting,
};
