'use strict';

const fs = require('fs');
const path = require('path');

const WEATHER_CODES = {
  0: '맑음',
  1: '대체로 맑음',
  2: '구름 조금',
  3: '흐림',
  45: '안개',
  48: '서리 안개',
  51: '약한 이슬비',
  53: '이슬비',
  55: '강한 이슬비',
  56: '약한 어는 이슬비',
  57: '강한 어는 이슬비',
  61: '약한 비',
  63: '비',
  65: '강한 비',
  66: '약한 어는 비',
  67: '강한 어는 비',
  71: '약한 눈',
  73: '눈',
  75: '강한 눈',
  77: '싸락눈',
  80: '약한 소나기',
  81: '소나기',
  82: '강한 소나기',
  85: '약한 눈 소나기',
  86: '강한 눈 소나기',
  95: '뇌우',
  96: '우박 동반 뇌우',
  99: '강한 우박 동반 뇌우',
};

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getCachePath(appDataPath) {
  return path.join(ensureDirectory(path.join(appDataPath, 'cache')), 'daily-work-log-weather.json');
}

function readCache(appDataPath) {
  try {
    return JSON.parse(fs.readFileSync(getCachePath(appDataPath), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeCache(appDataPath, cache) {
  try {
    fs.writeFileSync(getCachePath(appDataPath), JSON.stringify(cache, null, 2), 'utf8');
  } catch (error) {
    console.warn('[Weather] 캐시 저장 실패:', error.message);
  }
}

function getSiteRecord(db, context = {}) {
  const siteId = String(context.siteId || context.site_id || '').trim();
  const siteName = String(context.siteName || context.site_name || '').trim();
  const row = siteId
    ? db.prepare(`
        SELECT id, site_name, target_lat, target_lng
        FROM sites
        WHERE id = ?
        LIMIT 1
      `).get(siteId)
    : siteName
      ? db.prepare(`
          SELECT id, site_name, target_lat, target_lng
          FROM sites
          WHERE site_name = ?
          LIMIT 1
        `).get(siteName)
      : db.prepare(`
          SELECT sites.id, sites.site_name, sites.target_lat, sites.target_lng
          FROM app_settings
          LEFT JOIN sites ON sites.id = app_settings.site_id
          WHERE app_settings.id = 1
          LIMIT 1
        `).get();

  return row || null;
}

function parseStoredLocation(row, siteId, siteName) {
  if (row?.target_lat === null || row?.target_lat === undefined || row?.target_lat === ''
    || row?.target_lng === null || row?.target_lng === undefined || row?.target_lng === '') {
    return null;
  }
  const latitude = Number(row.target_lat);
  const longitude = Number(row.target_lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { siteId: row?.id || siteId, siteName: row?.site_name || siteName, latitude, longitude };
}

function normalizeSiteSearchName(siteName) {
  return String(siteName || '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function geocodeSiteName(appDataPath, row, siteId, siteName) {
  const resolvedSiteName = String(row?.site_name || siteName || '').trim();
  if (!resolvedSiteName) return null;
  const cache = readCache(appDataPath);
  cache.__locations = cache.__locations || {};
  const locationKey = String(row?.id || siteId || resolvedSiteName);
  if (cache.__locations[locationKey]) return cache.__locations[locationKey];

  const params = new URLSearchParams({
    q: `${normalizeSiteSearchName(resolvedSiteName)} 대한민국`,
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'kr',
  });
  try {
    const data = await fetchJsonWithTimeout(
      `https://nominatim.openstreetmap.org/search?${params}`,
      5000,
      { 'User-Agent': 'OsooHandleApp/1.0 (local daily report weather lookup)' }
    );
    const latitude = Number(data?.[0]?.lat);
    const longitude = Number(data?.[0]?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const location = {
      siteId: row?.id || siteId,
      siteName: resolvedSiteName,
      latitude,
      longitude,
      displayName: data[0].display_name || '',
    };
    cache.__locations[locationKey] = location;
    writeCache(appDataPath, cache);
    return location;
  } catch (error) {
    console.warn(`[Weather] 현장 위치 검색 건너뜀: ${error.message}`);
    return null;
  }
}

async function getSiteLocation(db, appDataPath, context = {}) {
  const siteId = String(context.siteId || context.site_id || '').trim();
  const siteName = String(context.siteName || context.site_name || '').trim();
  const row = getSiteRecord(db, context);
  return parseStoredLocation(row, siteId, siteName)
    || geocodeSiteName(appDataPath, row, siteId, siteName);
}

function daysBetween(leftDate, rightDate) {
  const left = new Date(`${leftDate}T00:00:00Z`);
  const right = new Date(`${rightDate}T00:00:00Z`);
  return Math.round((right - left) / 86400000);
}

function buildWeatherUrls(location, date) {
  const common = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    start_date: date,
    end_date: date,
    daily: 'weather_code,temperature_2m_mean',
    timezone: 'Asia/Seoul',
  });
  const today = new Date().toISOString().slice(0, 10);
  const recent = daysBetween(date, today) <= 90;
  const urls = [];
  if (recent) urls.push(`https://api.open-meteo.com/v1/forecast?${common}`);
  urls.push(`https://archive-api.open-meteo.com/v1/archive?${common}`);
  return urls;
}

async function fetchJsonWithTimeout(url, timeoutMs = 3500, headers = undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseWeatherResponse(data) {
  const weatherCode = Number(data?.daily?.weather_code?.[0]);
  const averageTemperature = Number(data?.daily?.temperature_2m_mean?.[0]);
  if (!Number.isFinite(weatherCode) && !Number.isFinite(averageTemperature)) return null;
  return {
    weather: WEATHER_CODES[weatherCode] || '',
    averageTemperature: Number.isFinite(averageTemperature) ? averageTemperature : null,
  };
}

async function getDailyWeather({ db, appDataPath, date, context = {} }) {
  const location = await getSiteLocation(db, appDataPath, context);
  if (!location) return { weather: '', averageTemperature: null, source: 'missing-location' };

  const cache = readCache(appDataPath);
  const cacheKey = [
    location.siteId || location.siteName || 'site',
    location.latitude.toFixed(4),
    location.longitude.toFixed(4),
    date,
  ].join(':');
  if (cache[cacheKey]) return { ...cache[cacheKey], source: 'cache' };

  for (const url of buildWeatherUrls(location, date)) {
    try {
      const result = parseWeatherResponse(await fetchJsonWithTimeout(url));
      if (!result) continue;
      cache[cacheKey] = { ...result, fetchedAt: new Date().toISOString() };
      writeCache(appDataPath, cache);
      return { ...result, source: 'open-meteo' };
    } catch (error) {
      console.warn(`[Weather] ${date} 조회 건너뜀: ${error.message}`);
    }
  }

  return { weather: '', averageTemperature: null, source: 'unavailable' };
}

module.exports = {
  getDailyWeather,
};
