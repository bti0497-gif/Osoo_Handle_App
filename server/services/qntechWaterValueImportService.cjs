const DEFAULT_LOCATION_ORDER = ['유량조정조', '무산소조', '포기조', '침전조', '방류조'];

const ITEM_NAME_TO_FIELD = new Map([
  ['암모니아성 질소', 'nh3_n'],
  ['질산성 질소', 'no3_n'],
  ['오르토 인산염', 'po4_p'],
  ['알칼리도', 'alkalinity']
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
    if (normalized.includes('무산소')) return '무산소조';
    if (normalized.includes('포기') || normalized.includes('호기')) return '포기조';
    if (normalized.includes('침전')) return '침전조';
    if (normalized.includes('방류') || normalized.includes('막여과')) return '방류조';
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

function mapProjectsToWaterRows(projects, activeLocations, configuredSampleMappings = []) {
  const rowMap = new Map();
  const unmatchedSamples = [];

  projects.forEach((project) => {
    const resolver = buildSampleLocationResolver(project.measurements || [], activeLocations, configuredSampleMappings);

    (project.measurements || []).forEach((measurement) => {
      const field = ITEM_NAME_TO_FIELD.get(measurement?.item?.name || '');
      if (!field) return;

      const targetLocation = resolver(measurement?.sample?.name || '');
      if (!targetLocation) {
        unmatchedSamples.push(measurement?.sample?.name || '(unknown)');
        return;
      }

      const rowKey = `${project.regDt}|${targetLocation}`;
      const row = rowMap.get(rowKey) || {
        date: String(project.regDt || '').slice(0, 10),
        location: targetLocation
      };

      row[field] = normalizeMeasurementValue(measurement.ppm);
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