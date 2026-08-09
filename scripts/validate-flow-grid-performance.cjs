#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'server/routes/flowRoutes.cjs'), 'utf8');
const viewModel = fs.readFileSync(path.join(root, 'src/features/flow/useFlowViewModel.js'), 'utf8');
const model = fs.readFileSync(path.join(root, 'src/features/flow/FlowModel.js'), 'utf8');
const view = fs.readFileSync(path.join(root, 'src/features/flow/FlowManagementView.jsx'), 'utf8');
const grid = fs.readFileSync(path.join(root, 'src/components/common/AdvancedDataGrid.jsx'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/features/records/recordPreloadService.js'), 'utf8');
const rangeHelper = fs.readFileSync(path.join(root, 'src/features/records/historyRange.js'), 'utf8');

const boundedFeatures = [
  ['flow', 'flows'],
  ['medicine', 'medicines'],
  ['kit', 'kits'],
  ['water', 'water-quality'],
];

assert(route.includes('const readingsByDate = new Map()'),
  'flow history must group readings in one pass');
assert(!route.includes('allReadings.filter(r => r.date === d.date)'),
  'flow history must not scan all readings once per date');
assert(model.includes("fromDate: getRecentHistoryStart()") &&
  model.includes('async fetchOlderHistory(beforeDate)') &&
  viewModel.includes('const requestedStart = String(historyData.fromDate || todayStr)') &&
  viewModel.includes('const loadOlder = useCallback(async () =>') &&
  view.includes('if (scrollTop <= 80 && hasOlder && !loadingOlder)'),
  'flow grid must fetch two recent months first and load older chunks only near the top');
assert(!viewModel.includes("const firstDateStr = hist[0].date > todayStr ? todayStr : hist[0].date;"),
  'flow grid must not synthesize rows from an unbounded historical date');
assert(grid.includes('const overscan = 10') &&
  grid.includes('const visibleData = useMemo(() =>') &&
  grid.includes('for (let i = startIndex; i <= endIndex; i++)'),
  'advanced grid must render only viewport rows plus bounded overscan');
assert(app.includes('preloadRecordGridData().finally(() =>') &&
  preload.includes('const workerCount = Math.max(1, Math.min(Number(concurrency) || 2, total))'),
  'record grids must warm in the background with bounded concurrency');
assert(rangeHelper.includes('now.getMonth() - 2') && rangeHelper.includes('start.setMonth(start.getMonth() - 2)'),
  'history windows must use bounded two-month chunks');
boundedFeatures.forEach(([feature, endpoint]) => {
  const modelText = fs.readFileSync(path.join(root, `src/features/${feature}/${
    feature === 'flow' ? 'FlowModel' : feature === 'medicine' ? 'MedicineModel' : feature === 'kit' ? 'KitModel' : 'WaterQualityModel'
  }.js`), 'utf8');
  const viewText = fs.readFileSync(path.join(root, `src/features/${feature}/${
    feature === 'flow' ? 'FlowManagementView' : feature === 'medicine' ? 'MedicineManagementView' : feature === 'kit' ? 'KitManagementView' : 'WaterQualityView'
  }.jsx`), 'utf8');
  assert(modelText.includes(`apiClient.get('/api/${endpoint}/history', { fromDate: getRecentHistoryStart() })`),
    `${feature} must fetch only the recent window initially`);
  assert(modelText.includes('fetchOlderHistory(beforeDate)'), `${feature} must support older chunks`);
  assert(viewText.includes('scrollTop <= 80') && viewText.includes('void loadOlder()'),
    `${feature} must load older chunks only when scrolling near the top`);
});

console.log('PASS flow grid viewport, background-warmup, bounded-row and linear-grouping contract');
