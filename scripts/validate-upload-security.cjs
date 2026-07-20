const assert = require('assert');
const multer = require('multer');
const {
  MAX_BOARD_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEMPLATE_BYTES,
  boardFileFilter,
  imageFileFilter,
  templateFileFilter,
  uploadErrorMiddleware,
} = require('../server/middleware/uploadSecurity.cjs');

function accepts(filter, file) {
  return new Promise((resolve) => filter({}, file, (error, allowed) => resolve({ error, allowed })));
}

async function run() {
  assert.strictEqual((await accepts(imageFileFilter, { originalname: '현장사진.jpg', mimetype: 'image/jpeg' })).allowed, true);
  assert.ok((await accepts(imageFileFilter, { originalname: '위장사진.exe', mimetype: 'image/jpeg' })).error);
  assert.ok((await accepts(imageFileFilter, { originalname: '위장사진.jpg', mimetype: 'application/octet-stream' })).error);
  assert.strictEqual((await accepts(boardFileFilter, { originalname: '일지양식.hwpx', mimetype: 'application/octet-stream' })).allowed, true);
  assert.ok((await accepts(boardFileFilter, { originalname: '실행파일.exe', mimetype: 'application/octet-stream' })).error);
  assert.strictEqual((await accepts(templateFileFilter, { originalname: '월운영보고서.xlsx' })).allowed, true);
  assert.ok((await accepts(templateFileFilter, { originalname: '양식.pdf' })).error);

  assert.strictEqual(MAX_IMAGE_BYTES, 20 * 1024 * 1024);
  assert.strictEqual(MAX_BOARD_ATTACHMENT_BYTES, 50 * 1024 * 1024);
  assert.strictEqual(MAX_TEMPLATE_BYTES, 50 * 1024 * 1024);
  assert.strictEqual(MAX_IMAGE_PIXELS, 50_000_000);

  const error = new multer.MulterError('LIMIT_FILE_SIZE');
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  uploadErrorMiddleware(error, { files: {} }, response, () => assert.fail('업로드 오류가 다음 미들웨어로 전달되면 안 됩니다.'));
  assert.strictEqual(response.statusCode, 413);
  assert.strictEqual(response.payload.code, 'LIMIT_FILE_SIZE');

  console.log('✓ 게시판 첨부·사진·설정 양식 파일형식 허용목록 검증 통과');
  console.log('✓ 업로드 용량·개수·이미지 픽셀 제한 계약 검증 통과');
  console.log('✓ 업로드 거부 JSON 오류 응답 검증 통과');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
