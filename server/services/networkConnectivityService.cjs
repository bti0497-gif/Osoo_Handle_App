const dns = require('dns');

const DEFAULT_CHECK_HOST = 'www.googleapis.com';
const DEFAULT_TIMEOUT_MS = 3000;

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('network check timeout')), timeoutMs);
    })
  ]);
}

async function isInternetReachable({ host = DEFAULT_CHECK_HOST, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    await withTimeout(dns.promises.lookup(host), timeoutMs);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  isInternetReachable
};
