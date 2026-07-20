const DEFAULT_LOCATION_ORDER = ['유량조정조', '무산소조', '폭기조', '침전조', '방류조'];

const ITEM_DEFINITIONS = {
  nh3_n: { itemCode: 'nh3_n', itemName: '암모니아성질소(NH3-N)', unit: 'mg/L' },
  no3_n: { itemCode: 'no3_n', itemName: '질산성질소(NO3-N)', unit: 'mg/L' },
  po4_p: { itemCode: 'po4_p', itemName: '인산염인(PO4-P)', unit: 'mg/L' },
  alkalinity: { itemCode: 'alkalinity', itemName: '알칼리도(ALK)', unit: 'mg/L' }
};

function normalizeItemName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function resolveMeasurementDefinition(itemName) {
  const normalized = normalizeItemName(itemName);
  if (!normalized) return null;

  if ((normalized.includes('암모니아') && normalized.includes('질소')) || normalized.includes('NH3N')) {
    return ITEM_DEFINITIONS.nh3_n;
  }
  if ((normalized.includes('질산') && normalized.includes('질소')) || normalized.includes('NO3N')) {
    return ITEM_DEFINITIONS.no3_n;
  }

  // 성적서 항목인 총인은 통합 수질분석 가져오기 대상이 아니다.
  const isTotalPhosphorus = normalized.includes('총인') || normalized === 'TP' || normalized.includes('TOTALPHOSPHORUS');
  if (!isTotalPhosphorus && (normalized.includes('인') || normalized.includes('PO4'))) {
    return ITEM_DEFINITIONS.po4_p;
  }

  if (normalized.includes('알칼리도') || normalized === 'ALK' || normalized.includes('ALKALINITY')) {
    return ITEM_DEFINITIONS.alkalinity;
  }
  return null;
}

const PROJECTS_QUERY = `query Projects($data: SelectProjectInput!) {
  selectProjectListByRegDt(data: $data) {
    id
    regDt
    note
    analysisProcess
    measurements {
      id
      ppm
      item {
        id
        name
      }
      sample {
        id
        name
      }
      dilution
    }
    user {
      id
      name
    }
    files {
      id
      item {
        id
        name
      }
      filePath
    }
  }
}`;

function normalizeSampleName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function getActiveLocations(db) {
  const rows = db.prepare(`
    SELECT item_name
    FROM config_items
    WHERE category = 'location' AND is_active = 1
    ORDER BY display_order, id
  `).all();

  if (!rows.length) return [...DEFAULT_LOCATION_ORDER];
  return rows.map((row) => row.item_name);
}

function getConfiguredSampleMappings(db) {
  const row = db.prepare('SELECT qntech_sample_mappings FROM app_settings WHERE id = 1').get();
  if (!row?.qntech_sample_mappings) return [];

  try {
    const parsed = JSON.parse(row.qntech_sample_mappings);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function buildDirectLocationMap(activeLocations, configuredSampleMappings = []) {
  const candidates = new Map();
  activeLocations.forEach((location) => {
    const normalized = normalizeSampleName(location);
    candidates.set(normalized, location);
  });

  const configuredMap = new Map();
  configuredSampleMappings.forEach((mapping) => {
    const sourceName = normalizeSampleName(mapping?.sourceName || '');
    const targetLocation = String(mapping?.targetLocation || '').trim();
    if (!sourceName || !targetLocation || !activeLocations.includes(targetLocation)) return;
    configuredMap.set(sourceName, targetLocation);
  });

  const findActiveLocation = (tokens, fallback) => (
    activeLocations.find((location) => {
      const normalizedLocation = normalizeSampleName(location);
      return tokens.some((token) => normalizedLocation.includes(token));
    }) || fallback
  );

  return (sampleName) => {
    const normalized = normalizeSampleName(sampleName);
    if (configuredMap.has(normalized)) return configuredMap.get(normalized);
    if (candidates.has(normalized)) return candidates.get(normalized);
    if (normalized.includes('유량')) return findActiveLocation(['유량'], '유량조정조');
    if (normalized.includes('혐기')) return findActiveLocation(['혐기'], '혐기조');
    if (normalized.includes('무산')) return findActiveLocation(['무산'], '무산소조');
    if (normalized.includes('폭기') || normalized.includes('포기')) return findActiveLocation(['폭기', '포기'], '포기조');
    // 최종 응집침전/여과 시료는 1차침전보다 뒤의 방류 지점이다.
    // 일반 "침전" 판정보다 먼저 검사해야 두 장소가 같은 칸에 충돌하지 않는다.
    if (normalized.includes('응집침전') || normalized.includes('여과') || normalized.includes('최종처리')) return findActiveLocation(['방류', '말단', '처리수'], '방류조');
    if (normalized.includes('1차침전')) return findActiveLocation(['침전'], '침전조');
    if (normalized.includes('침전')) return findActiveLocation(['침전'], '침전조');
    if (normalized.includes('방류') || normalized.includes('말단') || normalized.includes('처리수')) return findActiveLocation(['방류', '말단', '처리수'], '방류조');
    return null;
  };
}

function buildSampleLocationResolver(measurements, activeLocations, configuredSampleMappings = []) {
  const directResolver = buildDirectLocationMap(activeLocations, configuredSampleMappings);
  const uniqueSamples = [];
  measurements.forEach((measurement) => {
    const sampleName = measurement?.sample?.name;
    if (!sampleName || uniqueSamples.includes(sampleName)) return;
    uniqueSamples.push(sampleName);
  });

  const sampleMap = new Map();
  const usedLocations = new Set();

  uniqueSamples.forEach((sampleName) => {
    const direct = directResolver(sampleName);
    if (direct && !sampleMap.has(sampleName)) {
      sampleMap.set(sampleName, direct);
      usedLocations.add(direct);
    }
  });

  uniqueSamples.forEach((sampleName, index) => {
    if (sampleMap.has(sampleName)) return;
    const fallback = activeLocations[index] || activeLocations.find((location) => !usedLocations.has(location));
    if (fallback) {
      sampleMap.set(sampleName, fallback);
      usedLocations.add(fallback);
    }
  });

  return (sampleName) => sampleMap.get(sampleName) || directResolver(sampleName);
}

function normalizeMeasurementValue(value) {
  if (value === null || value === undefined) return null;

  const normalized = String(value).trim();
  if (['-1', '-1.0', '-1.00'].includes(normalized)) {
    return '초과';
  }

  return normalized;
}

function toNumericMeasurementValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeProjectDate(projectRegDt, fallbackDate) {
  const fallback = String(fallbackDate || '').trim().slice(0, 10);
  const raw = String(projectRegDt || '').trim();
  if (!raw) return fallback;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return fallback || raw.slice(0, 10);
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function toTrimmedString(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function buildQntechMeasurementGroup(projectDate, project, measurementOrder) {
  const projectId = toTrimmedString(project?.id);
  if (projectId) return `qntech:${projectId}`;
  return `qntech:${projectDate}:${measurementOrder}`;
}

function buildSourceLabel(project, measurementOrder, totalForDate) {
  const analysisProcess = toTrimmedString(project?.analysisProcess);
  const note = toTrimmedString(project?.note);

  if (analysisProcess) return analysisProcess;
  if (note) return note;
  if (totalForDate > 1) return `${measurementOrder}차`;
  return '';
}

function mapProjectsToWaterRows(projects, activeLocations, configuredSampleMappings = [], options = {}) {
  const { fallbackDate = '' } = options;
  const rowMap = new Map();
  const unmatchedSamples = [];
  const unmatchedItems = [];
  const mappingCollisions = [];
  const sourceSampleByRowKey = new Map();
  const projectsWithDate = (Array.isArray(projects) ? projects : []).map((project) => ({
    project,
    projectDate: normalizeProjectDate(project?.regDt, fallbackDate)
  }));
  const totalCountByDate = new Map();

  projectsWithDate.forEach(({ projectDate }) => {
    totalCountByDate.set(projectDate, (totalCountByDate.get(projectDate) || 0) + 1);
  });

  const orderByDate = new Map();

  projectsWithDate.forEach(({ project, projectDate }) => {
    const measurementOrder = (orderByDate.get(projectDate) || 0) + 1;
    orderByDate.set(projectDate, measurementOrder);

    const measurementGroup = buildQntechMeasurementGroup(projectDate, project, measurementOrder);
    const sourceLabel = buildSourceLabel(project, measurementOrder, totalCountByDate.get(projectDate) || 0);
    const resolver = buildSampleLocationResolver(project.measurements || [], activeLocations, configuredSampleMappings);

    (project.measurements || []).forEach((measurement) => {
      const rawItemName = String(measurement?.item?.name || '').trim();
      const definition = resolveMeasurementDefinition(rawItemName);
      if (!definition) {
        if (rawItemName) unmatchedItems.push(rawItemName);
        return;
      }

      const targetLocation = resolver(measurement?.sample?.name || '');
      if (!targetLocation) {
        unmatchedSamples.push(measurement?.sample?.name || '(unknown)');
        return;
      }

      const rowKey = `${projectDate}|${measurementGroup}|${targetLocation}|${definition.itemCode}`;
      const sourceSampleName = String(measurement?.sample?.name || '').trim();
      const previousSourceSampleName = sourceSampleByRowKey.get(rowKey);
      if (previousSourceSampleName && previousSourceSampleName !== sourceSampleName) {
        mappingCollisions.push({
          date: projectDate,
          measurementGroup,
          targetLocation,
          itemCode: definition.itemCode,
          keptSampleName: previousSourceSampleName,
          skippedSampleName: sourceSampleName,
        });
        return;
      }
      sourceSampleByRowKey.set(rowKey, sourceSampleName);
      const row = rowMap.get(rowKey) || {
        date: projectDate,
        measurement_group: measurementGroup,
        measurement_order: measurementOrder,
        source_type: 'qntech',
        source_label: sourceLabel || null,
        qntech_project_id: toTrimmedString(project?.id) || null,
        location: targetLocation,
        item_name: definition.itemName,
        item_code: definition.itemCode,
        unit: definition.unit
      };

      row.result_value = normalizeMeasurementValue(measurement.ppm);
      row.result_numeric = toNumericMeasurementValue(row.result_value);
      rowMap.set(rowKey, row);
    });
  });

  return {
    importedRows: Array.from(rowMap.values()),
    unmatchedSamples: Array.from(new Set(unmatchedSamples.filter(Boolean))),
    unmatchedItems: Array.from(new Set(unmatchedItems.filter(Boolean))),
    mappingCollisions,
  };
}

module.exports = {
  PROJECTS_QUERY,
  getActiveLocations,
  getConfiguredSampleMappings,
  resolveMeasurementDefinition,
  mapProjectsToWaterRows
};
