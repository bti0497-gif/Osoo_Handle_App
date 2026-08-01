const fs = require('fs');
const path = require('path');

const VALID_REASONS = new Set(['update', 'full-exit', 'installer', 'maintenance']);

function getAppDataRoot() {
  return process.env.APPDATA || process.env.LOCALAPPDATA || '';
}

function getRuntimeStateDirectory() {
  return path.join(getAppDataRoot(), 'Osoo_Handle_App', 'runtime');
}

function getMaintenanceLockPath() {
  return path.join(getRuntimeStateDirectory(), 'maintenance.json');
}

function writeMaintenanceLock(reason, ttlMs, requestedBy = 'app') {
  if (!VALID_REASONS.has(reason)) {
    throw new Error(`Unsupported maintenance lock reason: ${reason}`);
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`Invalid maintenance lock ttl: ${ttlMs}`);
  }

  const now = Date.now();
  const payload = {
    reason,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    requestedBy,
  };

  fs.mkdirSync(getRuntimeStateDirectory(), { recursive: true });
  fs.writeFileSync(getMaintenanceLockPath(), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

function clearMaintenanceLockIfReason(reason, options = {}) {
  const {
    onlyIfNotExpired = false,
    clearOnInvalidExpiresAt = false,
    clearWhenMalformed = false,
  } = options;
  const lockPath = getMaintenanceLockPath();
  if (!fs.existsSync(lockPath)) return false;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (_) {
    if (!clearWhenMalformed) return false;
    try {
      fs.unlinkSync(lockPath);
      return true;
    } catch (_) {
      return false;
    }
  }

  if (payload?.reason !== reason) return false;

  if (onlyIfNotExpired) {
    const expiresAt = payload?.expiresAt ? Date.parse(payload.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) && !clearOnInvalidExpiresAt) return false;
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) return false;
  }

  try {
    fs.unlinkSync(lockPath);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  VALID_REASONS,
  getRuntimeStateDirectory,
  getMaintenanceLockPath,
  writeMaintenanceLock,
  clearMaintenanceLockIfReason,
};
