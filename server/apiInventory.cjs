const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const routeRegistry = require('./routeRegistry.cjs');

const ROUTE_PATTERN = /\brouter\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;

function normalizePath(value) {
  const normalized = `/${String(value || '').replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : normalized.replace(/\/{2,}/g, '/');
}

function combineMountPath(mountPath, endpointPath) {
  if (String(endpointPath).startsWith('/api/')) return normalizePath(endpointPath);
  if (mountPath === '/') return normalizePath(endpointPath);
  return normalizePath(`${mountPath}/${endpointPath}`);
}

function extractRouteEndpoints(projectRoot = path.resolve(__dirname, '..')) {
  const endpoints = [];
  for (const registration of routeRegistry) {
    const moduleRelative = registration.module.replace(/^\.\//, 'server/');
    const modulePath = path.join(projectRoot, moduleRelative);
    if (!fs.existsSync(modulePath)) throw new Error(`등록된 라우트 모듈이 없습니다: ${registration.module}`);
    const source = fs.readFileSync(modulePath, 'utf8');
    let match;
    while ((match = ROUTE_PATTERN.exec(source)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = combineMountPath(registration.path, match[3]);
      endpoints.push({
        method,
        path: routePath,
        module: registration.module,
        tier: registration.tier,
        mutation: method !== 'GET',
        syncWatch: registration.watch === true,
      });
    }
  }
  return endpoints.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function endpointSignature(endpoint) {
  return `${endpoint.method} ${endpoint.path} ${endpoint.module} tier=${endpoint.tier} watch=${endpoint.syncWatch}`;
}

function inventoryDigest(endpoints) {
  return crypto.createHash('sha256').update(endpoints.map(endpointSignature).join('\n')).digest('hex');
}

module.exports = { extractRouteEndpoints, inventoryDigest };
