const fs = require('fs');
const path = require('path');
const { extractRouteEndpoints, inventoryDigest } = require('../server/apiInventory.cjs');

const root = path.resolve(__dirname, '..');
const endpoints = extractRouteEndpoints(root);
const output = {
  schemaVersion: 1,
  endpointCount: endpoints.length,
  digest: inventoryDigest(endpoints),
  endpoints,
};
const target = path.join(root, 'docs', 'API_ROUTE_BASELINE.json');
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`API 라우트 기준선 저장: ${endpoints.length}개 (${target})`);
