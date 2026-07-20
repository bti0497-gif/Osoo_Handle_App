const assert = require('assert');
const fs = require('fs');
const path = require('path');
const routeRegistry = require('../server/routeRegistry.cjs');
const { extractRouteEndpoints, inventoryDigest } = require('../server/apiInventory.cjs');

const root = path.resolve(__dirname, '..');
const routeDir = path.join(root, 'server', 'routes');
const baselinePath = path.join(root, 'docs', 'API_ROUTE_BASELINE.json');
const registeredFiles = new Set(routeRegistry.map((entry) => path.basename(entry.module)));
const sourceRouteFiles = fs.readdirSync(routeDir)
  .filter((file) => file.endsWith('Routes.cjs'))
  .filter((file) => /\brouter\.(?:get|post|put|patch|delete)\s*\(/.test(fs.readFileSync(path.join(routeDir, file), 'utf8')));

for (const file of sourceRouteFiles) {
  assert.ok(registeredFiles.has(file), `routeRegistry에 등록되지 않은 라우트 파일: ${file}`);
}
assert.strictEqual(registeredFiles.size, routeRegistry.length, 'routeRegistry 모듈이 중복 등록되어 있습니다.');

const endpoints = extractRouteEndpoints(root);
const duplicateKeys = endpoints
  .map((endpoint) => `${endpoint.method} ${endpoint.path}`)
  .filter((key, index, all) => all.indexOf(key) !== index);
assert.deepStrictEqual([...new Set(duplicateKeys)], [], `중복 API 경로: ${[...new Set(duplicateKeys)].join(', ')}`);

assert.ok(fs.existsSync(baselinePath), 'API 라우트 기준선이 없습니다. npm run api:inventory:update를 실행하세요.');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
assert.strictEqual(baseline.endpointCount, endpoints.length, 'API 라우트 개수가 기준선과 달라졌습니다. 의도된 변경이면 기준선을 검토 후 갱신하세요.');
assert.strictEqual(baseline.digest, inventoryDigest(endpoints), 'API 메서드·경로·모듈·tier·동기화 감시 계약이 기준선과 달라졌습니다.');
assert.deepStrictEqual(baseline.endpoints, endpoints, 'API 라우트 상세 기준선이 실제 코드와 다릅니다.');

console.log(`✓ 라우트 모듈 ${routeRegistry.length}개 등록·중복·누락 검사 통과`);
console.log(`✓ 실제 API ${endpoints.length}개 메서드·경로·tier·동기화 감시 기준선 검사 통과`);
