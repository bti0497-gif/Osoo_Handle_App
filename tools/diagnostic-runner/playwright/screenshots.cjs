'use strict';

/**
 * UI 진단 스크린샷 캡처. 산출물은 <run>/screenshots/ 에 저장된다.
 */

const path = require('path');

async function capture(page, screenshotsDir, name) {
  try {
    const file = path.join(screenshotsDir, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch (_) {
    return null;
  }
}

module.exports = { capture };
