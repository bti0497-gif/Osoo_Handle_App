'use strict';

const fs = require('fs');
const path = require('path');
const { APP_DATA_ROOT } = require('../config/runtimeConfig.cjs');

const REMOTE_STATE_FILE = path.join(APP_DATA_ROOT, 'runtime', 'remote-session-state.json');
const REQUIRED_WATCHDOG_VERSION = '1.0.8';
const MAX_STATE_AGE_MS = 15_000;

function compareVersions(left, right) {
  const a = String(left || '').split('.').map((part) => Number(part) || 0);
  const b = String(right || '').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta) return delta;
  }
  return 0;
}

function detectRemoteSession({ statePath = REMOTE_STATE_FILE } = {}) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const checkedAt = Date.parse(state.checkedAt || '');
    const ageMs = Date.now() - checkedAt;
    const supportedVersion = compareVersions(state.version, REQUIRED_WATCHDOG_VERSION) >= 0;
    const fresh = Number.isFinite(checkedAt) && ageMs >= -5_000 && ageMs <= MAX_STATE_AGE_MS;
    if (!supportedVersion || !fresh || !['active', 'clear', 'unknown'].includes(state.state)) {
      return {
        detected: false,
        sessionType: 'unknown',
        evidence: !supportedVersion ? 'watchdog-version-outdated' : !fresh ? 'watchdog-state-stale' : 'watchdog-state-invalid',
        observedTools: [],
        verificationFailed: true,
        source: 'watchdog',
        stateAgeMs: Number.isFinite(ageMs) ? ageMs : null,
      };
    }

    const detected = state.state === 'active';
    return {
      detected,
      sessionType: detected ? (state.sessionType || 'remote') : state.state === 'unknown' ? 'unknown' : 'local',
      evidence: String(state.evidence || (detected ? 'watchdog-confirmed-remote-session' : state.state)),
      observedTools: Array.isArray(state.observedTools)
        ? state.observedTools.filter((tool) => ['RustDesk', 'Chrome Remote Desktop'].includes(tool))
        : [],
      verificationFailed: state.state === 'unknown',
      source: 'watchdog',
      stateAgeMs: ageMs,
      watchdogVersion: String(state.version || ''),
    };
  } catch (error) {
    return {
      detected: false,
      sessionType: 'unknown',
      evidence: error?.code === 'ENOENT' ? 'watchdog-state-missing' : 'watchdog-state-unreadable',
      observedTools: [],
      verificationFailed: true,
      source: 'watchdog',
      stateAgeMs: null,
      watchdogVersion: null,
    };
  }
}

module.exports = {
  MAX_STATE_AGE_MS,
  REMOTE_STATE_FILE,
  REQUIRED_WATCHDOG_VERSION,
  detectRemoteSession,
};
