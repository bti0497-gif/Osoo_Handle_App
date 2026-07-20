'use strict';

const assert = require('node:assert/strict');
const { sanitizeBoardHtml } = require('../server/services/boardHtmlSanitizer.cjs');

const hostile = `
  <script>globalThis.compromised = true</script>
  <p onclick="alert(1)" style="text-align:center;position:fixed">안내문</p>
  <a href="javascript:alert(1)" onmouseover="alert(2)">위험 링크</a>
  <a href="https://example.com/manual">안전 링크</a>
  <img src="data:image/png;base64,AA==" onerror="alert(3)" style="width:50%;max-width:100%">
  <iframe src="https://example.com"></iframe>
  <object data="https://example.com"></object>
  <table style="border-collapse:collapse"><tbody><tr><td colspan="2" style="border:1px solid #000;padding:4px">복사한 표</td></tr></tbody></table>
`;

async function main() {
  const { sanitizeBoardHtml: sanitizeBoardHtmlForDisplay } = await import('../src/features/board/sanitizeBoardHtml.js');
  const clean = sanitizeBoardHtml(hostile);
  const displayClean = sanitizeBoardHtmlForDisplay(hostile);

  assert.equal(displayClean, clean, '서버 저장 정화와 클라이언트 표시 정화 결과가 달라졌습니다.');
  assert.doesNotMatch(clean, /<script|<iframe|<object/i);
  assert.doesNotMatch(clean, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(clean, /javascript\s*:/i);
  assert.doesNotMatch(clean, /position\s*:/i);
  assert.match(clean, /<table/);
  assert.match(clean, /colspan="2"/);
  assert.match(clean, /border-collapse:\s*collapse/);
  assert.match(clean, /src="data:image\/png;base64,AA=="/);
  assert.match(clean, /width:\s*50%/);
  assert.match(clean, /noopener noreferrer/);

  console.log('✓ 게시판 서버/표시 동일 허용목록·위험 요소 제거·표/이미지 보존 검증 통과');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
