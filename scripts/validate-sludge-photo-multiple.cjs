'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function main() {
  const state = [];
  let cursor = 0;
  const uploads = [], saves = [], notices = [];
  let failSecond = true;
  const context = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useCallback: (fn) => fn,
    useEffect: () => {},
    useDialog: () => ({ showToast: (...args) => notices.push(args), showConfirm: async () => true }),
    SludgePhotoModel: {
      uploadPhoto: async (date, type, file) => {
        uploads.push({ date, type, name: file.name });
        if (file.name === 'second.jpg' && failSecond) return { success: false, error: 'simulated failure' };
        return { success: true, url: '/saved/' + file.name, driveUploaded: 'queued' };
      },
      save: async (payload) => { saves.push(payload); return { success: true }; },
      fetchByMonth: async () => ({ success: true, items: [] }),
    },
  };
  const source = fs.readFileSync('src/features/sludge/useSludgePhotoViewModel.js', 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export function useSludgePhotoViewModel()', 'function useSludgePhotoViewModel()');
  vm.createContext(context);
  vm.runInContext(source + '\nglobalThis.render = useSludgePhotoViewModel;', context);
  const render = () => { cursor = 0; return context.render(); };
  let model = render();
  model.handleSludgePhoto([{ name: 'first.jpg', path: 'legacy-first-path' }]);
  model = render();
  model.handleSludgePhoto([{ name: 'second.jpg' }]);
  model.handleCertPhoto([{ name: 'cert.jpg' }]);
  model = render();
  assert.equal(model.editEntry.sludgePhotoFiles.length, 2, 'additional selection must append');
  await model.handleSave();
  model = render();
  assert.equal(saves.length, 0, 'photo failure must preserve pending form');
  assert.equal(model.editEntry.sludgePhotoFiles.length, 1, 'successful first photo removed from retry queue');
  assert.equal(model.editEntry.certPhotoFiles.length, 1, 'unattempted certificate retained');
  assert.equal(model.hasChanges, true);
  failSecond = false;
  await model.handleSave();
  assert.deepEqual(uploads.map((r) => r.name), ['first.jpg', 'second.jpg', 'second.jpg', 'cert.jpg']);
  assert.equal(saves.length, 1);
  assert.equal('sludge_photo_path' in saves[0], false, 'all files use append upload API, including Electron path files');
  assert.ok(notices.some((row) => row[1] === 'success'));
  model = render();
  model.handleSludgePhoto([{ name: 'third.jpg' }]);
  model = render();
  await model.handleSave();
  assert.equal(uploads.at(-1).name, 'third.jpg', 'additional photo after save must upload without old photos');
  assert.equal(uploads.filter((row) => row.name === 'first.jpg').length, 1);
  const view = fs.readFileSync('src/features/sludge/SludgePhotoView.jsx', 'utf8');
  assert.equal((view.match(/onFiles=\{handle(?:Sludge|Cert)Photo\}/g) || []).length, 2);
  const tab = fs.readFileSync('src/features/records/photo-management/PhotoManagementTab.jsx', 'utf8');
  for (const text of ['슬러지 반출량이 입력되지 않았습니다', '약품 입고 데이터가 없습니다', '키트 입고 데이터가 없습니다']) assert.ok(tab.includes(text));
  console.log('PASS actual sludge ViewModel: multi-select append, sequential save, partial failure retry without duplicates; empty-state guidance');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
