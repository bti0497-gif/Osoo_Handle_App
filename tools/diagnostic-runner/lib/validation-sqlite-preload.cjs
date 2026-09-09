'use strict';
// Only for explicitly invoked Node validation; no networking or application policy changes.
const Module = require('module');
const { sqlitePath } = require('./validation-environment.cjs');
const original = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'better-sqlite3') return original.call(this, sqlitePath, parent, isMain);
  return original.call(this, request, parent, isMain);
};
