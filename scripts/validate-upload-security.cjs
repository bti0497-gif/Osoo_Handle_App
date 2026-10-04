const assert = require('assert');
const multer = require('multer');
const {
  MAX_BOARD_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEMPLATE_BYTES,
  boardFileFilter,
  imageFileFilter,
  medicinePhotoFileFilter,
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
  assert.strictEqual((await accepts(medicinePhotoFileFilter, { originalname: '약품사진.heic', mimetype: 'application/octet-stream' })).allowed, true);
  assert.strictEqual((await accepts(medicinePhotoFileFilter, { originalname: '약품사진.heif', mimetype: 'application/octet-stream' })).allowed, true);
  assert.strictEqual((await accepts(medicinePhotoFileFilter, { originalname: '약품사진.heic', mimetype: 'image/heic' })).allowed, true);
  assert.ok((await accepts(medicinePhotoFileFilter, { originalname: '위장사진.jpg', mimetype: 'application/octet-stream' })).error);
  assert.ok((await accepts(medicinePhotoFileFilter, { originalname: '위장사진.exe', mimetype: 'image/heic' })).error);
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

  // Exercise the actual storage conversion policy without depending on a
  // machine-specific HEIC fixture. The decoder's documented .all() shape is
  // substituted, while Sharp still creates and validates a real JPEG.
  const { prepareMedicinePhotoForStorage } = require('../server/routes/medicineInRoutes.cjs').__photoIsolationTest;
  const sharp = require('sharp');
  const decoderPath = require.resolve('heic-decode');
  const originalDecoder = require('heic-decode');
  const source = Buffer.from('synthetic-heic-payload');
  try {
    const successfulDecoder = () => {};
    successfulDecoder.all = async () => [{
      width: 1, height: 1,
      decode: async () => ({ width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) }),
    }];
    require.cache[decoderPath].exports = successfulDecoder;
    const converted = await prepareMedicinePhotoForStorage(source, '.heic');
    assert.strictEqual(converted.extension, '.jpg');
    assert.strictEqual(converted.previewAvailable, true);
    assert.deepStrictEqual(await sharp(converted.buffer).metadata().then(({ format, width, height }) => ({ format, width, height })),
      { format: 'jpeg', width: 1, height: 1 });

    const brokenDecoder = () => {};
    brokenDecoder.all = async () => { throw new Error('decode failed'); };
    require.cache[decoderPath].exports = brokenDecoder;
    const preserved = await prepareMedicinePhotoForStorage(source, '.heic');
    assert.strictEqual(preserved.extension, '.heic');
    assert.strictEqual(preserved.buffer, source);
    assert.strictEqual(preserved.previewAvailable, false);
    assert.ok(preserved.previewWarning?.message.includes('JPEG'));

    const oversizedDecoder = () => {};
    oversizedDecoder.all = async () => [{ width: MAX_IMAGE_PIXELS + 1, height: 1 }];
    require.cache[decoderPath].exports = oversizedDecoder;
    await assert.rejects(prepareMedicinePhotoForStorage(source, '.heic'),
      (error) => error.code === 'HEIC_PIXEL_LIMIT_EXCEEDED' && error.statusCode === 413);

    const png = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const regular = await prepareMedicinePhotoForStorage(png, '.png');
    assert.strictEqual(regular.extension, '.jpg');
    assert.strictEqual((await sharp(regular.buffer).metadata()).format, 'jpeg');
  } finally {
    require.cache[decoderPath].exports = originalDecoder;
  }

  console.log('✓ 게시판 첨부·사진·설정 양식 파일형식 허용목록 검증 통과');
  console.log('✓ 업로드 용량·개수·이미지 픽셀 제한 계약 검증 통과');
  console.log('✓ 업로드 거부 JSON 오류 응답 검증 통과');
  console.log('✓ HEIC JPEG 변환·원본 보존·해상도 초과 거부 및 기존 PNG 변환 검증 통과');
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
