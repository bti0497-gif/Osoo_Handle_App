'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const { sumMaintenanceCost } = await import(pathToFileURL(path.resolve('src/features/equipment/equipmentCostPolicy.js')));
  const { EQUIPMENT_PROCESS_ORDER, EQUIPMENT_TYPE_ORDER } = await import(pathToFileURL(path.resolve('src/features/equipment/equipmentPreviewData.js')));
  for (const process of ['부상조', '막분리조', '제어반', '기타']) assert.ok(EQUIPMENT_PROCESS_ORDER.includes(process));
  assert.equal(EQUIPMENT_PROCESS_ORDER.includes('막'), false);
  for (const type of ['막', '제어반', '기타']) assert.ok(EQUIPMENT_TYPE_ORDER.includes(type));
  const rows = [
    { type: '수리의뢰', date: '2026-10-14', price: 100000 },
    { type: '수리 의뢰', date: '2026-10-14', price: 200000 },
    { type: '수리&재설치', date: '2026-10-15', price: 100000 },
    { type: '교체', date: '2025-12-31', price: 50000 },
    { type: '기타', date: '2026-10-16', price: 0 },
  ];
  const before = JSON.stringify(rows);
  assert.equal(sumMaintenanceCost(rows), 150000);
  assert.equal(sumMaintenanceCost(rows, { startDate: '2026-01-01', endDate: '2026-12-31' }), 100000);
  assert.equal(sumMaintenanceCost(rows, { startDate: '2026-10-15', endDate: '2026-10-15' }), 100000);
  assert.equal(JSON.stringify(rows), before);
  const { mechanicalProcessGroup } = require('../server/services/equipment/equipmentShared.cjs');
  assert.equal(mechanicalProcessGroup('막분리조'), 3);
  assert.equal(mechanicalProcessGroup('부상조'), 4);
  console.log('PASS equipment categories, request exclusion, year/period boundaries and source amount preservation');
})().catch((error) => { console.error(error); process.exitCode = 1; });
