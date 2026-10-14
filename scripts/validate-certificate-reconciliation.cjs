'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/features/certificate/useCertificateViewModel.js', 'utf8');
const start = source.indexOf('const loadRecords = useCallback(');
const end = source.indexOf('\n    useEffect(', start);
const loader = source.slice(start, end).replace('const loadRecords =', 'globalThis.loadRecords =');

async function test({ offline = false, fail = false, stale = false } = {}) {
  const calls = [], published = [], errors = [];
  const local = Array.from({ length: 5 }, (_, i) => ({ id: String(i), previewUrl: '', localCached: true }));
  const remote = [...local, { id: 'missing', previewUrl: '', localCached: false }];
  const sequence = { current: 0 };
  const context = {
    useCallback: (fn) => fn, loadSequenceRef: sequence, currentUser: {}, selectedYear: 2026, selectedMonth: 8,
    buildCertificateAuthHeaders: () => ({}), normalizeRecord: (item) => item,
    setIsLoading: () => {}, setErrorMessage: (text) => errors.push(text),
    setRecords: (items) => published.push(items), setSelectedCertificateIds: () => {}, setSelectedId: () => {},
    showToast: () => {}, console: { error: () => {}, warn: () => {} }, URL,
    CertificateModel: {
      fetchList: async (params, headers, options) => {
        calls.push({ source: params.source || 'local', force: options.force });
        if (params.source === 'drive') {
          if (stale) sequence.current += 1;
          if (fail) throw Error('offline');
          return { items: remote, offline };
        }
        return { items: calls.length > 2 ? remote.map((item) => ({ ...item, localCached: true })) : local };
      },
      syncLocalFiles: async ({ items }) => { calls.push({ sync: items.map((item) => item.id) }); return { failedCount: 0 }; },
      clearListCache: () => calls.push({ clear: true }),
    },
  };
  vm.runInNewContext(loader, context);
  await context.loadRecords();
  assert.equal(published[0].length, 5, 'local list must appear first');
  assert.equal(calls[1].source, 'drive', 'nonempty local list must still query Drive');
  assert.equal(calls[1].force, true);
  if (offline || fail || stale) {
    assert.equal(calls.some((call) => call.sync), false);
    assert.equal(published.length, 1, 'offline/stale result must not replace local evidence');
    if (!stale) assert.ok(errors.some(Boolean));
  } else {
    assert.equal(published[1].length, 6, 'missing remote file must be shown before download');
    assert.deepEqual(calls.find((call) => call.sync).sync, ['missing']);
    assert.equal(calls.at(-1).force, true, 'post-download local reread must bypass cache');
    assert.equal(published.at(-1).length, 6);
    assert.ok(published.at(-1).every((item) => item.localCached));
  }
}
(async () => {
  await test(); await test({ offline: true }); await test({ fail: true }); await test({ stale: true });
  assert.ok(source.includes('loadRecords({ force: true })'));
  console.log('PASS actual certificate loader: local-first, missing-file reconciliation, offline preservation, stale result guard');
})().catch((error) => { console.error(error); process.exitCode = 1; });
