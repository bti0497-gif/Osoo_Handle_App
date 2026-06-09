const DEFAULT_LOCATION_ORDER = ['유량조정조', '무산소조', '폭기조', '침전조', '방류조'];

const ITEM_NAME_TO_DEFINITION = new Map([
  ['암모니아성 질소', { itemCode: 'nh3_n', itemName: '암모니아성질소(NH3-N)', unit: 'mg/L' }],
  ['질산성 질소', { itemCode: 'no3_n', itemName: '질산성질소(NO3-N)', unit: 'mg/L' }],
  ['오르토인산염', { itemCode: 'po4_p', itemName: '인산염인(PO4-P)', unit: 'mg/L' }],
  ['알칼리도', { itemCode: 'alkalinity', itemName: '알칼리도(ALK)', unit: 'mg/L' }]
]);

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

  return (sampleName) => {
    const normalized = normalizeSampleName(sampleName);
    if (configuredMap.has(normalized)) return configuredMap.get(normalized);
    if (candidates.has(normalized)) return candidates.get(normalized);
    if (normalized.includes('유량')) return '유량조정조';
    if (normalized.includes('무산')) return '무산소조';
    if (normalized.includes('폭기') || normalized.includes('포기')) return '폭기조';
    if (normalized.includes('침전')) return '침전조';
    if (normalized.includes('방류') || normalized.includes('말단')) return '방류조';
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
      const definition = ITEM_NAME_TO_DEFINITION.get(measurement?.item?.name || '');
      if (!definition) return;

      const targetLocation = resolver(measurement?.sample?.name || '');
      if (!targetLocation) {
        unmatchedSamples.push(measurement?.sample?.name || '(unknown)');
        return;
      }

      const rowKey = `${projectDate}|${measurementGroup}|${targetLocation}|${definition.itemCode}`;
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
    unmatchedSamples: Array.from(new Set(unmatchedSamples.filter(Boolean)))
  };
}

module.exports = {
  PROJECTS_QUERY,
  getActiveLocations,
  getConfiguredSampleMappings,
  mapProjectsToWaterRows
};
