const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const TAIL_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 16 * 1024;
const MAX_MINUTE_BYTES = 256 * 1024;

function compactOversizedLog(filePath, force = false) {
  const fd = fs.openSync(filePath, 'r+');
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= MAX_LOG_BYTES && !force) return false;
    const tail = Buffer.allocUnsafe(TAIL_BYTES);
    const read = fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    fs.writeSync(fd, tail, 0, read, 0);
    fs.ftruncateSync(fd, read);
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

function createBoundedServerLog(appDataPath) {
  const logDir = path.join(appDataPath, 'logs');
  const filePath = path.join(logDir, 'electron-server.log');
  let minute = -1;
  let minuteBytes = 0;
  let suppressed = false;

  function append(chunk) {
    try {
      const currentMinute = Math.floor(Date.now() / 60000);
      if (currentMinute !== minute) {
        minute = currentMinute;
        minuteBytes = 0;
        suppressed = false;
      }
      if (minuteBytes >= MAX_MINUTE_BYTES) {
        if (!suppressed) {
          suppressed = true;
          const notice = Buffer.from('\n[log-rate-limit] further stderr omitted for this minute\n');
          if (fs.statSync(filePath).size + notice.length > MAX_LOG_BYTES) compactOversizedLog(filePath, true);
          fs.appendFileSync(filePath, notice);
        }
        return;
      }
      const bytes = Buffer.from(String(chunk));
      const output = bytes.length > MAX_WRITE_BYTES
        ? Buffer.concat([bytes.subarray(0, MAX_WRITE_BYTES), Buffer.from('\n[log-entry-truncated]\n')])
        : bytes;
      if (minuteBytes + output.length > MAX_MINUTE_BYTES) {
        minuteBytes = MAX_MINUTE_BYTES;
        return;
      }
      const size = fs.statSync(filePath).size;
      if (size + output.length > MAX_LOG_BYTES) compactOversizedLog(filePath, true);
      fs.appendFileSync(filePath, output);
      minuteBytes += output.length;
    } catch (_) {
      // Disk pressure must not prevent the server from starting or reporting to stderr.
    }
  }

  try {
    fs.mkdirSync(logDir, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '');
    compactOversizedLog(filePath);
  } catch (_) {
    // The service may still run when logging storage is unavailable.
  }
  return { append, filePath };
}

module.exports = { createBoundedServerLog, compactOversizedLog, MAX_LOG_BYTES };
