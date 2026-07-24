#!/usr/bin/env node
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const appDataPath = process.env.OSOO_APP_DATA_PATH
  || path.join(process.env.APPDATA || '', 'Osoo_Handle_App');
const db = new Database(path.join(appDataPath, 'osoo.db'), { readonly: true });
const limit = Math.max(1, Math.min(5000, Number(process.argv[2]) || 100));
const rows = db.prepare(`
  SELECT id, created_at, area, action, result, details_json
  FROM app_diagnostic_logs
  WHERE area = 'focus'
  ORDER BY id DESC
  LIMIT ?
`).all(limit);

const parsedRows = rows.reverse().map((row) => ({
  ...row,
  details: (() => {
    try {
      return JSON.parse(row.details_json || '{}');
    } catch {
      return {};
    }
  })(),
  details_json: undefined,
}));

if (process.argv.includes('--transitions')) {
  console.log(JSON.stringify(parsedRows.filter((row) => (
    row.action.includes('window')
    || row.action === 'focus-native-event'
    || row.action === 'focus-input-focus-in'
    || row.action === 'focus-input-focus-out'
    || row.action === 'focus-key-down'
    || row.action === 'focus-input-accepted'
    || row.action.includes('save')
    || row.action.includes('context')
  )).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    action: row.action,
    result: row.result,
    documentHasFocus: row.details?.documentHasFocus,
    nativeState: row.details?.nativeState,
    nativeEvent: row.details?.nativeEvent,
    activeElement: row.details?.activeElement,
    eventTarget: row.details?.eventTarget,
    defaultPrevented: row.details?.defaultPrevented,
    appState: row.details?.appState,
  })), null, 2));
} else if (process.argv.includes('--summary')) {
  const counts = {};
  const anomalies = [];
  for (const row of parsedRows) {
    counts[row.action] = (counts[row.action] || 0) + 1;
    const details = row.details || {};
    const activeTag = details.activeElement?.tag;
    const targetTag = details.eventTarget?.tag;
    const native = details.nativeState || {};
    const inputTarget = ['input', 'textarea', 'select'].includes(targetTag)
      || details.eventTarget?.contentEditable === 'true';
    if (
      (row.action === 'focus-input-pointer-settled' && (
        activeTag !== targetTag
        || details.documentHasFocus === false
        || native.windowFocused === false
        || native.webContentsFocused === false
      ))
      || (row.action === 'focus-key-down' && inputTarget && details.defaultPrevented)
      || row.action === 'focus-context-load-failed'
    ) {
      anomalies.push(row);
    }
  }
  console.log(JSON.stringify({
    range: parsedRows.length ? {
      first: parsedRows[0].created_at,
      last: parsedRows[parsedRows.length - 1].created_at,
    } : null,
    count: parsedRows.length,
    actions: counts,
    anomalies: anomalies.slice(-20).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      result: row.result,
      activeElement: row.details?.activeElement,
      eventTarget: row.details?.eventTarget,
      documentHasFocus: row.details?.documentHasFocus,
      nativeState: row.details?.nativeState,
      delayMs: row.details?.delayMs,
      defaultPrevented: row.details?.defaultPrevented,
      appState: row.details?.appState,
      nativeEvent: row.details?.nativeEvent,
      recoveryResult: row.details?.recoveryResult,
    })),
    recent: parsedRows.slice(-40).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      result: row.result,
      activeTag: row.details?.activeElement?.tag,
      activeId: row.details?.activeElement?.id,
      targetTag: row.details?.eventTarget?.tag,
      targetId: row.details?.eventTarget?.id,
      documentHasFocus: row.details?.documentHasFocus,
      nativeWindowFocused: row.details?.nativeState?.windowFocused,
      nativeWebContentsFocused: row.details?.nativeState?.webContentsFocused,
      delayMs: row.details?.delayMs,
      defaultPrevented: row.details?.defaultPrevented,
      appState: row.details?.appState,
    })),
  }, null, 2));
} else {
  console.log(JSON.stringify(parsedRows, null, 2));
}
