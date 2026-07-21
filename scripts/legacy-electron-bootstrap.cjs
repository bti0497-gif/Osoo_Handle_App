#!/usr/bin/env node
'use strict';

const http = require('http');
const https = require('https');
const path = require('path');

if (typeof global.fetch !== 'function') {
  global.fetch = (input, options = {}) => new Promise((resolve, reject) => {
    const url = new URL(input);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: options.method || 'GET',
      headers: options.headers,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          text: async () => body.toString('utf8'),
          json: async () => JSON.parse(body.toString('utf8')),
        });
      });
    });
    request.on('error', reject);
    if (options.signal) {
      const abort = () => request.destroy(new Error('The operation was aborted'));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    if (options.body) request.write(options.body);
    request.end();
  });
}

const target = process.argv[2];
if (!target) {
  console.error('Legacy Electron bootstrap requires a target script.');
  process.exit(2);
}
process.argv = [process.argv[0], path.resolve(target), ...process.argv.slice(3)];
require(path.resolve(target));
