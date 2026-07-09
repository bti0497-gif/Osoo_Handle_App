#!/usr/bin/env node

const path = require('path');

const modulePath = process.argv[2];
if (!modulePath) {
  throw new Error('better-sqlite3 package path is required.');
}

const Database = require(path.resolve(modulePath));
const db = new Database(':memory:');

try {
  db.exec('CREATE TABLE native_smoke_test (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO native_smoke_test (value) VALUES (?)').run('ok');
  const row = db.prepare('SELECT value FROM native_smoke_test WHERE id = 1').get();
  if (row?.value !== 'ok') {
    throw new Error('Packaged SQLite read/write verification failed.');
  }
  console.log('Packaged better-sqlite3 smoke test passed.');
} finally {
  db.close();
}
