#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const viewModelPath = path.join(baseDir, 'src', 'features', 'water', 'useWaterQualityViewModel.js');
const source = fs.readFileSync(viewModelPath, 'utf8');
const { mapProjectsToWaterRows } = require('../server/services/qntechWaterValueImportService.cjs');

const forcedReloadCount = (source.match(/WaterQualityModel\.clearHistoryCache\(\);\s*await loadReadings\(\{\s*force:\s*true\s*\}\);/g) || []).length;

if (forcedReloadCount < 2) {
  throw new Error(
    'QnTECH 단일일·기간 가져오기 완료 후 캐시 폐기 및 DB 강제 재조회 계약이 누락되었습니다.'
  );
}

const mockProjects = [47149, 47147, 47142].map((id) => ({
  id,
  regDt: '2026-07-27',
  measurements: [{
    ppm: String(id),
    item: { id: 1, name: 'NH3-N' },
    sample: { id: 1, name: '유량조정조' },
  }],
}));
const mapped = mapProjectsToWaterRows(mockProjects, ['유량조정조'], [], {
  fallbackDate: '2026-07-27',
});
const groups = new Set(mapped.importedRows.map((row) => row.measurement_group));
const orders = mapped.importedRows.map((row) => row.measurement_order).sort((a, b) => a - b);
if (groups.size !== 3 || orders.join(',') !== '1,2,3') {
  throw new Error('QnTECH 동일 날짜 3개 프로젝트가 독립된 1·2·3회차로 유지되지 않습니다.');
}

console.log('✓ QnTECH 단일일·기간 가져오기 완료 후 다회차 DB 강제 재조회 계약 유지');
