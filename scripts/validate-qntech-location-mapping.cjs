#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { mapProjectsToWaterRows } = require('../server/services/qntechWaterValueImportService.cjs');

const activeLocations = ['유량조정조', '혐기조', '무산소조', '포기조', '침전조', '방류조'];
const sampleNames = ['유량조정조', '응집침전조', '무산소조', '혐기조', '포기조', '1차침전조'];
const project = {
  id: 1,
  regDt: '2026-07-16',
  analysisProcess: 'A2O',
  measurements: sampleNames.map((sampleName, index) => ({
    ppm: String(index + 1),
    item: { name: '암모니아성 질소' },
    sample: { id: index + 1, name: sampleName },
  })),
};

const mapped = mapProjectsToWaterRows([project], activeLocations);
const byLocation = new Map(mapped.importedRows.map((row) => [row.location, row.result_value]));

assert.strictEqual(byLocation.size, 6, 'A2O 6개 원본 장소가 서로 다른 분석장소로 보존되어야 합니다.');
assert.strictEqual(byLocation.get('혐기조'), '4');
assert.strictEqual(byLocation.get('침전조'), '6');
assert.strictEqual(byLocation.get('방류조'), '2');
assert.deepStrictEqual(mapped.unmatchedSamples, []);
assert.deepStrictEqual(mapped.mappingCollisions, []);

console.log('[QNTECH LOCATION PASS] anaerobic, primary settling, final coagulation/effluent mapping');
