#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const baseDir = path.resolve(__dirname, '..');
const viewModelPath = path.join(baseDir, 'src', 'features', 'water', 'useWaterQualityViewModel.js');
const source = fs.readFileSync(viewModelPath, 'utf8');
const { mapProjectsToWaterRows } = require('../server/services/qntechWaterValueImportService.cjs');

const cacheClearCount = (source.match(/WaterQualityModel\.clearHistoryCache\(\);/g) || []).length;
const forcedReloadCount = (source.match(/loadReadings\(\{\s*force:\s*true\s*\}\)/g) || []).length;

if (cacheClearCount < 2 || forcedReloadCount < 2) {
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

const dilutionRows = mapProjectsToWaterRows([{
  id: 48170,
  regDt: '2026-08-13',
  measurements: [
    { ppm: '9', dilution: 7, item: { id: 1, name: 'NH3-N' }, sample: { id: 1, name: '유량조정조' } },
    { ppm: '-1', dilution: 7, item: { id: 1, name: 'NH3-N' }, sample: { id: 2, name: '무산소조' } },
    { ppm: '9.3', dilution: 7, item: { id: 1, name: 'NH3-N' }, sample: { id: 3, name: '포기조' } },
  ],
}], ['유량조정조', '무산소조', '포기조'], [], { fallbackDate: '2026-08-13' }).importedRows;
if (dilutionRows.find((row) => row.location === '유량조정조')?.result_value !== '63.0' ||
    dilutionRows.find((row) => row.location === '무산소조')?.result_value !== '초과' ||
    dilutionRows.find((row) => row.location === '포기조')?.result_value !== '65.1') {
  throw new Error('QnTECH 희석배수 적용 또는 분석한계 초과 보존 정책이 깨졌습니다.');
}

if (!source.includes("recordQntechUiDiagnostic('import-completed'") ||
    !source.includes('dbMeasurementGroupCount') ||
    !source.includes('gridRoundCount') ||
    !source.includes('loadRequestSequenceRef') ||
    !source.includes('identifiedPhotoCount') ||
    !source.includes('savedPhotoCount') ||
    !source.includes('photoProjectsWithoutRecognizedFiles') ||
    !source.includes('photoDownloadFailureCount')) {
  throw new Error('QnTECH 다회차 저장·그리드 반영 진단 또는 최신 조회 보호가 누락되었습니다.');
}

console.log('✓ QnTECH 단일일·기간 가져오기 완료 후 다회차 DB 강제 재조회 계약 유지');
