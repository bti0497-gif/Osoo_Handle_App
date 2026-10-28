'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
async function main() {
  const { ROADWORK_ACTION_EVIDENCE_SCRIPT: script, parseRoadworkActionEvidence: parse, ROADWORK_ACTION_PREFIX: prefix } = await import('../src/features/roadwork-helper/roadworkActionEvidence.js');
  const logs = [];
  let alerts = [];
  let listener;
  let registrations = 0;
  const doc = {
    addEventListener(type, fn, capture) { assert.equal(type, 'click'); assert.equal(capture, true); listener = fn; registrations++; },
    querySelectorAll() { return alerts; },
  };
  const win = { document: doc, frames: [], console: { info: message => logs.push(message) } };
  const context = vm.createContext({ window: win, Date });
  vm.runInContext(script, context);
  vm.runInContext(script, context);
  assert.equal(registrations, 1, 'Do not duplicate listeners');
  const click = (label, id = '', trusted = true) => listener({ isTrusted: trusted, target: { closest: () => ({ id, textContent: label, getAttribute: () => '', get value() { throw new Error('Must not read values'); } }) } });
  click('로그아웃');
  assert.equal(parse(logs.at(-1)).kind, 'logout-intent');
  assert.equal(parse(logs.at(-1)).trusted, true);
  click('저장');
  assert.equal(parse(logs.at(-1)).kind, 'save-intent');
  const count = logs.length;
  click('사용자 비밀정보');
  assert.equal(logs.length, count);
  alerts = [{ textContent: '저장이 완료되었습니다. 개인정보', getClientRects: () => [1] }];
  vm.runInContext(script, context);
  assert.equal(parse(logs.at(-1)).kind, 'save-success-message');
  const feedbackCount = logs.length;
  vm.runInContext(script, context);
  assert.equal(logs.length, feedbackCount, 'Persistent feedback must not flood logs');
  alerts = [{ textContent: '세션이 만료되었습니다', getClientRects: () => [1] }];
  vm.runInContext(script, context);
  assert.equal(parse(logs.at(-1)).kind, 'session-expiry-message');
  assert.ok(logs.every(message => !/개인정보|사용자|비밀/.test(message)));
  assert.equal(parse(prefix + JSON.stringify({kind:'unknown', at: Date.now()})), null);
  assert.equal(parse(prefix + JSON.stringify({kind:'logout-intent', at: Date.now()-60000})), null);
  assert.equal(parse(prefix + '{'), null);
  assert.equal(parse('unrelated'), null);
  const sanitized = parse(prefix + JSON.stringify({kind:'save-intent', at:Date.now(), password:'secret', trusted:false}));
  assert.deepEqual(Object.keys(sanitized).sort(), ['at','kind','trusted']);
  win.frames = [Object.defineProperty({}, 'document', { get() { throw new Error('cross-origin'); } })];
  vm.runInContext(script, context);
  console.log('PASS: passive portal actions, feedback deduplication, privacy, parser bounds, inaccessible frames');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
