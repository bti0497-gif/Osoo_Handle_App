'use strict';

const regionConfig = require('../config/kma-land-forecast-regions.json');

const KMA_LAND_FORECAST_URL = 'https://apihub.kma.go.kr/api/typ01/url/fct_afs_dl.php';
const INVALID_TEMPERATURE = -90;
const SHARED_AUTH_KEY_SETTING = 'KMA_API_HUB_AUTH_KEY';
let sharedAuthKeyPromise = null;

function toKstDateParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function compactDate(date) {
  return String(date || '').replace(/-/g, '');
}

function shiftDate(date, offsetDays) {
  const [year, month, day] = String(date).split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays, 12));
  const parts = toKstDateParts(shifted);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveRegion(siteName) {
  return regionConfig.sites[String(siteName || '').trim()] || null;
}

async function resolveAuthKey() {
  const localKey = String(process.env.KMA_API_HUB_AUTH_KEY || '').trim();
  if (localKey) return localKey;

  if (!sharedAuthKeyPromise) {
    sharedAuthKeyPromise = (async () => {
      const { getAppSettings, isSheetsConfigured } = require('./sitesSheetsService.cjs');
      if (!isSheetsConfigured()) return '';
      const settings = await getAppSettings();
      return String(settings[SHARED_AUTH_KEY_SETTING] || '').trim();
    })().catch((error) => {
      sharedAuthKeyPromise = null;
      throw error;
    });
  }
  return sharedAuthKeyPromise;
}

async function fetchTextWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const bytes = await response.arrayBuffer();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        message = payload?.result?.message || message;
      } catch (_) {
        // 인증키나 요청 URL이 오류 메시지에 섞이지 않도록 상태만 사용합니다.
      }
      throw new Error(message);
    }
    return new TextDecoder('euc-kr').decode(bytes);
  } finally {
    clearTimeout(timer);
  }
}

function parseForecastRows(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const fields = line.split(',');
      if (fields.length < 17) return null;
      return {
        regionId: fields[0],
        issuedAt: fields[1],
        effectiveAt: fields[2],
        period: fields[3],
        temperature: Number(fields[12]),
        rainProbability: Number(fields[13]),
        skyCode: fields[14],
        precipitationCode: fields[15],
        weatherText: fields[16],
      };
    })
    .filter(Boolean);
}

function isValidTemperature(value) {
  return Number.isFinite(value) && value > INVALID_TEMPERATURE;
}

function chooseIssueRows(rows, targetDate) {
  const dateKey = compactDate(targetDate);
  const grouped = new Map();
  rows
    .filter((row) => row.effectiveAt.startsWith(dateKey))
    .forEach((row) => {
      const group = grouped.get(row.issuedAt) || [];
      group.push(row);
      grouped.set(row.issuedAt, group);
    });

  const issues = [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left));
  const complete = issues.find(([, issueRows]) => (
    new Set(issueRows
      .filter((row) => isValidTemperature(row.temperature))
      .map((row) => row.effectiveAt.slice(8, 10))).size >= 2
  ));
  return complete || issues.find(([, issueRows]) => (
    issueRows.some((row) => isValidTemperature(row.temperature))
  )) || null;
}

function summarizeWeather(rows) {
  const precipitationPriority = { '1': 4, '4': 3, '2': 2, '3': 1 };
  const skyPriority = { DB04: 4, DB03: 3, DB02: 2, DB01: 1 };
  const precipitation = rows
    .filter((row) => precipitationPriority[row.precipitationCode])
    .sort((left, right) => (
      precipitationPriority[right.precipitationCode] - precipitationPriority[left.precipitationCode]
      || (right.rainProbability || 0) - (left.rainProbability || 0)
    ))[0];
  if (precipitation?.weatherText) return precipitation.weatherText;

  const sky = [...rows].sort((left, right) => (
    (skyPriority[right.skyCode] || 0) - (skyPriority[left.skyCode] || 0)
  ))[0];
  return sky?.weatherText || '';
}

function summarizeForecast(text, targetDate) {
  const chosen = chooseIssueRows(parseForecastRows(text), targetDate);
  if (!chosen) return null;
  const [issuedAt, rows] = chosen;
  const temperatures = rows
    .map((row) => row.temperature)
    .filter(isValidTemperature);
  if (!temperatures.length && !rows.some((row) => row.weatherText)) return null;
  const averageTemperature = temperatures.length
    ? Math.round((temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length) * 10) / 10
    : null;
  return {
    weather: summarizeWeather(rows),
    averageTemperature,
    issuedAt,
  };
}

async function getKmaLandForecast({ siteName, date }) {
  const authKey = await resolveAuthKey();
  if (!authKey) return { result: null, reason: 'missing-auth-key' };
  const region = resolveRegion(siteName);
  if (!region) return { result: null, reason: 'missing-region' };

  const params = new URLSearchParams({
    reg: region.regionId,
    tmfc1: `${compactDate(shiftDate(date, -1))}17`,
    tmfc2: `${compactDate(date)}23`,
    disp: '1',
    help: '0',
    authKey,
  });
  const text = await fetchTextWithTimeout(`${KMA_LAND_FORECAST_URL}?${params}`);
  const result = summarizeForecast(text, date);
  if (!result) return { result: null, reason: 'missing-forecast' };
  return {
    result: {
      ...result,
      regionId: region.regionId,
      regionName: region.regionName,
    },
    reason: '',
  };
}

module.exports = {
  getKmaLandForecast,
  parseForecastRows,
  resolveAuthKey,
  resolveRegion,
  summarizeForecast,
};
