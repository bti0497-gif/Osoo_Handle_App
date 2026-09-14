'use strict';
// Offline regression: modular SDK loading must preserve auth/view-count contracts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { measurePhase } = require('../server/services/requestPhaseService.cjs');

(async () => {
  const driveModule = require('googleapis/build/src/apis/drive');
  assert.equal(typeof driveModule.auth.OAuth2, 'function');
  assert.equal(typeof driveModule.auth.GoogleAuth, 'function');
  assert.equal(typeof driveModule.drive({ version: 'v3' }).files.list, 'function');
  assert.ok(!require.cache[require.resolve('googleapis')], 'aggregate SDK should remain unloaded');
  const firestoreModule = require('firebase-admin/firestore');
  assert.equal(typeof firestoreModule.getFirestore, 'function');
  assert.equal(typeof firestoreModule.FieldValue.increment, 'function');

  let reads = 0;
  let incremented = false;
  const store = {
    collection: () => ({
      where() { return this; }, limit() { return this; },
      async get() { reads++; await new Promise(resolve => setTimeout(resolve, 5)); return { forEach() {} }; },
      doc: () => ({
        async get() { return { id: 'post', exists: true, data: () => ({ view_count: 2 }) }; },
        async update(value) { incremented = value.view_count.increment === 1; },
      }),
    }),
  };
  const context = {
    module: { exports: {} }, console,
    require(name) {
      if (name === 'fs') return { existsSync: () => true, readFileSync: () => '{}' };
      if (name === 'crypto') return require('node:crypto');
      if (name.includes('runtimeConfig')) return { getFirebaseServiceAccountPath: () => 'fixture' };
      if (name.includes('requestPhaseService')) return { measurePhase };
      if (name === 'firebase-admin/app') return { getApps: () => [], initializeApp() {}, cert: () => ({}) };
      if (name === 'firebase-admin/firestore') return { getFirestore: () => store, FieldValue: { increment: (value) => ({ increment: value }) } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../server/services/boardFirebaseService.cjs'), 'utf8'), context);
  const board = context.module.exports;
  await Promise.all([board.getPosts('user', 'A'), board.getPosts('user', 'A')]);
  assert.equal(reads, 2, 'identical concurrent reads share posts/comments calls');
  await Promise.all([board.getPosts('user', 'A'), board.getPosts('user', 'B')]);
  assert.equal(reads, 6, 'different sites must never share reads');
  await board.getPosts('user', 'A');
  assert.equal(reads, 8, 'completed results are not cached');
  const post = await board.getPost('post', { incrementView: true });
  assert.equal(post.view_count, 3);
  assert.ok(incremented, 'FieldValue.increment contract retained');
  console.log('PASS: Drive auth/files, Firebase view count, concurrent read scope and no stale cache');
})().catch(error => { console.error(error); process.exitCode = 1; });
