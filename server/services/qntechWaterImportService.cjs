const { createAuthenticatedClient } = require('./qntechAuthService.cjs');
const { PROJECTS_QUERY, getActiveLocations, getConfiguredSampleMappings, mapProjectsToWaterRows } = require('./qntechWaterValueImportService.cjs');
const { saveProjectPhotos } = require('./qntechWaterPhotoImportService.cjs');
const { getCurrentRecordMetadata } = require('./syncMetadataService.cjs');

const RANGE_IMPORT_DELAY_MS = 250;

function normalizeDateInput(date) {
  const normalized = String(date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error('?좎쭨 ?뺤떇? YYYY-MM-DD ?댁뼱???⑸땲??');
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

async function fetchProjectsForDate(db, date) {
  const normalizedDate = normalizeDateInput(date);
  const client = await createAuthenticatedClient(db);
  return fetchProjectsForDateWithClient(client, normalizedDate);
}

function enumerateDates(startDate, endDate) {
  const start = new Date(`${normalizeDateInput(startDate)}T00:00:00`);
  const end = new Date(`${normalizeDateInput(endDate)}T00:00:00`);
  if (start > end) {
    throw new Error('?쒖옉?쇱? 醫낅즺?쇰낫????쓣 ???놁뒿?덈떎.');
  }

  const dates = [];
  const current = new Date(start);
  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

function persistWaterRows(db, importedRows) {
  if (!Array.isArray(importedRows) || importedRows.length === 0) {
    return { insertedRowCount: 0, upsertedRowCount: 0 };
  }

  const metadata = getCurrentRecordMetadata(db);
  const existingRowStmt = db.prepare(`
    SELECT 1
    FROM water_quality
    WHERE date = ? AND measurement_group = ? AND location = ?
    LIMIT 1
  `);

  const stmt = db.prepare(`
    INSERT INTO water_quality (
      date, measurement_group, measurement_order, source_type, source_label, qntech_project_id,
      location, nh3_n, no3_n, po4_p, alkalinity, tn, tp, cod, ss,
      site_id, site_name, author, created_at, last_modified, is_synced
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, measurement_group, location) DO UPDATE SET
      measurement_order = excluded.measurement_order,
      source_type = excluded.source_type,
      source_label = excluded.source_label,
      qntech_project_id = excluded.qntech_project_id,
      nh3_n = COALESCE(excluded.nh3_n, nh3_n),
      no3_n = COALESCE(excluded.no3_n, no3_n),
      po4_p = COALESCE(excluded.po4_p, po4_p),
      alkalinity = COALESCE(excluded.alkalinity, alkalinity),
      tn = COALESCE(excluded.tn, tn),
      tp = COALESCE(excluded.tp, tp),
      cod = COALESCE(excluded.cod, cod),
      ss = COALESCE(excluded.ss, ss),
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
      if (!existingRowStmt.get(item.date, measurementGroup, item.location || '?좎엯??)) {
        insertedRowCount += 1;
      }

      stmt.run(
        item.date,
        measurementGroup,
        item.measurement_order ?? 1,
        item.source_type || 'manual',
        item.source_label ?? null,
        item.qntech_project_id ?? null,
        item.location || '?좎엯??,
        item.nh3_n ?? null,
        item.no3_n ?? null,
        item.po4_p ?? null,
        item.alkalinity ?? null,
        item.tn ?? null,
        item.tp ?? null,
        item.cod ?? null,
        item.ss ?? null,
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
    upsertedRowCount: importedRows.length
  };
}

async function fetchProjectsForDateWithClient(client, normalizedDate) {
  const sites = client.me?.sites || [];
  if (!sites.length) {
    throw new Error('QnTECH?먯꽌 ?묎렐 媛?ν븳 ?꾩옣??李얠? 紐삵뻽?듬땲??');
  }

  const site = sites[0];
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

async function importQntechWaterValues(db, date) {
  const context = await fetchProjectsForDate(db, date);
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
    unmatchedSamples: mapped.unmatchedSamples
  };
}

async function importQntechWaterPhotos(db, baseDir, date) {
  const context = await fetchProjectsForDate(db, date);
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

async function importQntechWaterAll(db, baseDir, date) {
  const context = await fetchProjectsForDate(db, date);
  const activeLocations = getActiveLocations(db);
  const configuredSampleMappings = getConfiguredSampleMappings(db);
  const photoSetting = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();
  const mapped = mapProjectsToWaterRows(context.projects, activeLocations, configuredSampleMappings, {
    fallbackDate: context.date
  });
  const persistResult = persistWaterRows(db, mapped.importedRows);
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
    identifiedPhotos: photoResult.identifiedPhotos,
    savedPhotos: photoResult.savedPhotos,
    driveUploadedPhotos: photoResult.driveUploadedPhotos,
    photoRoot: photoResult.photoRoot,
    photoDirectory: photoResult.photoDirectory,
    driveFolderId: photoResult.driveFolderId,
    driveFolderUrl: photoResult.driveFolderUrl,
    summary: {
      importedRowCount: persistResult.upsertedRowCount,
      insertedRowCount: persistResult.insertedRowCount,
      savedPhotoCount: photoResult.savedPhotos.length,
      driveUploadedPhotoCount: photoResult.driveUploadedPhotos.length
    }
  };
}

async function importQntechWaterRange(db, baseDir, startDate, endDate, options = {}) {
  const { onProgress } = options;
  const dates = enumerateDates(startDate, endDate);
  const client = await createAuthenticatedClient(db);
  const activeLocations = getActiveLocations(db);
  const configuredSampleMappings = getConfiguredSampleMappings(db);
  const photoSetting = db.prepare('SELECT qntech_photo_root FROM app_settings WHERE id = 1').get();

  const summaryRows = [];
  let totalSavedPhotos = 0;
  let totalDriveUploadedPhotos = 0;
  let totalInsertedRows = 0;
  let photoRoot = null;

  onProgress?.({
    status: 'processing',
    totalDates: dates.length,
    completedDates: 0,
    currentDate: null,
    message: `珥?${dates.length}???곗씠?곕? 以鍮꾪븯??以?..`
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
      message: `${date} ?곗씠?곕? 遺덈윭?ㅻ뒗 以?..`
    });

    const context = await fetchProjectsForDateWithClient(client, date);
    const mapped = mapProjectsToWaterRows(context.projects, activeLocations, configuredSampleMappings, {
      fallbackDate: context.date
    });
    const persistResult = persistWaterRows(db, mapped.importedRows);
    const insertedRowCount = persistResult.insertedRowCount;
    const hadExistingValues = persistResult.upsertedRowCount > insertedRowCount;

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
    totalInsertedRows += insertedRowCount;

    summaryRows.push({
      date,
      siteName: context.site?.name || '',
      existingValues: hadExistingValues,
      projectCount: context.projects.length,
      insertedRowCount,
      savedPhotoCount: photoResult.savedPhotos.length,
      driveUploadedPhotoCount: photoResult.driveUploadedPhotos.length,
      photoDirectory: photoResult.photoDirectory,
      driveFolderUrl: photoResult.driveFolderUrl,
      unmatchedSamples: mapped.unmatchedSamples
    });

    onProgress?.({
      status: 'processing',
      totalDates: dates.length,
      completedDates: index + 1,
      currentDate: date,
      message: `${date} ?곗씠??泥섎━瑜??꾨즺?덉뒿?덈떎.`
    });
  }

  return {
    success: true,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    processedDates: dates.length,
    insertedDates: summaryRows.filter((item) => item.insertedRowCount > 0).map((item) => item.date),
    existingValueDates: summaryRows.filter((item) => item.existingValues).map((item) => item.date),
    summaryRows,
    photoRoot,
    driveFolderUrl: summaryRows.find((item) => item.driveFolderUrl)?.driveFolderUrl || '',
    summary: {
      insertedRowCount: totalInsertedRows,
      savedPhotoCount: totalSavedPhotos,
      driveUploadedPhotoCount: totalDriveUploadedPhotos,
      existingValueDateCount: summaryRows.filter((item) => item.existingValues).length
    }
  };
}

module.exports = {
  importQntechWaterValues,
  importQntechWaterPhotos,
  importQntechWaterAll,
  importQntechWaterRange,
  fetchProjectsForDate
};