const path = require('path');
const multer = require('multer');

const MB = 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * MB;
const MAX_BOARD_ATTACHMENT_BYTES = 50 * MB;
const MAX_TEMPLATE_BYTES = 50 * MB;
const MAX_IMAGE_PIXELS = 50_000_000;
const COMMON_MULTIPART_LIMITS = { fields: 30, parts: 40, fieldSize: 1 * MB };

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif']);
const BOARD_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  '.pdf', '.txt', '.csv', '.zip',
  '.doc', '.docx', '.hwp', '.hwpx',
  '.xls', '.xlsx', '.xlsm', '.ppt', '.pptx',
]);
const TEMPLATE_EXTENSIONS = new Set(['.xls', '.xlsx', '.xlsm', '.hwpx']);

function extensionOf(file) {
  return path.extname(String(file?.originalname || '')).toLowerCase();
}

function createExtensionFilter(extensions, message, { requireImageMime = false } = {}) {
  return (_req, file, callback) => {
    const extensionAllowed = extensions.has(extensionOf(file));
    const mimeAllowed = !requireImageMime || String(file?.mimetype || '').toLowerCase().startsWith('image/');
    const allowed = extensionAllowed && mimeAllowed;
    callback(allowed ? null : Object.assign(new Error(message), { statusCode: 415, code: 'UPLOAD_TYPE_NOT_ALLOWED' }), allowed);
  };
}

const imageFileFilter = createExtensionFilter(IMAGE_EXTENSIONS, '지원하는 이미지 파일만 업로드할 수 있습니다.', { requireImageMime: true });
const boardFileFilter = createExtensionFilter(BOARD_EXTENSIONS, '지원하지 않는 첨부파일 형식입니다.');
const templateFileFilter = createExtensionFilter(TEMPLATE_EXTENSIONS, '엑셀·HWPX 양식 파일만 업로드할 수 있습니다.');

function uploadErrorMiddleware(error, req, res, next) {
  if (!(error instanceof multer.MulterError) && error?.code !== 'UPLOAD_TYPE_NOT_ALLOWED') return next(error);

  const uploadedFiles = [req.file, ...Object.values(req.files || {}).flat()].filter(Boolean);
  for (const file of uploadedFiles) {
    if (!file.path) continue;
    try { require('fs').unlinkSync(file.path); } catch (_) { /* already moved or removed */ }
  }

  const messages = {
    LIMIT_FILE_SIZE: '업로드 파일의 허용 용량을 초과했습니다.',
    LIMIT_FILE_COUNT: '한 번에 업로드할 수 있는 파일 개수를 초과했습니다.',
    LIMIT_UNEXPECTED_FILE: '허용되지 않은 파일 항목이거나 파일 개수가 너무 많습니다.',
    LIMIT_FIELD_VALUE: '업로드 요청의 입력값이 너무 큽니다.',
    LIMIT_PART_COUNT: '업로드 요청의 항목 개수가 너무 많습니다.',
    UPLOAD_TYPE_NOT_ALLOWED: error.message,
  };
  return res.status(error.statusCode || 413).json({
    success: false,
    code: error.code || 'UPLOAD_REJECTED',
    message: messages[error.code] || '파일 업로드 요청을 처리할 수 없습니다.',
  });
}

module.exports = {
  COMMON_MULTIPART_LIMITS,
  MAX_BOARD_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEMPLATE_BYTES,
  boardFileFilter,
  imageFileFilter,
  templateFileFilter,
  uploadErrorMiddleware,
};
