/**
 * excelOpenService.cjs
 *
 * 엑셀 파일 생성 공통 유틸리티
 * - parseNamedRanges(wb)          : ExcelJS Workbook -> named range 맵
 * - getMergedCellExtent(ws, ...)  : 병합 셀 범위 반환
 * - insertImageToCell(...)        : sharp 리사이즈 후 셀에 이미지 삽입
 * - buildExcelTempPath(sub, name) : 임시 출력 경로 생성
 * - openExcelFile(filePath)       : start "" "경로" 로 Excel 오픈
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec } = require('child_process');

// ─── Named Range 파싱 ────────────────────────────────────────────────────────

/**
 * ExcelJS wb.definedNames.model (배열) → { 이름: { sheetName, col, row, address } }
 * ExcelJS 는 model 이 배열([{ name, ranges: [...] }]) 형태임
 */
function parseNamedRanges(wb) {
  const model = wb.definedNames?.model;
  const list  = Array.isArray(model) ? model : [];
  const map   = {};
  for (const entry of list) {
    const rangeStr = Array.isArray(entry.ranges) ? entry.ranges[0] : entry.ranges;
    const parsed   = _parseRangeStr(rangeStr);
    if (parsed) map[entry.name] = parsed;
  }
  return map;
}

/**
 * "'시트명'!$C$5"  또는  "시트명!$C$5"  → { sheetName, col, row, address }
 * $는 optional
 */
function _parseRangeStr(rangeStr) {
  if (!rangeStr) return null;
  const s = Array.isArray(rangeStr) ? rangeStr[0] : String(rangeStr);
  const m = s.match(/^(?:'([^']+)'|([^'!][^!]*))!\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  const sheetName = (m[1] || m[2] || '').trim();
  const col       = m[3];
  const row       = parseInt(m[4], 10);
  return { sheetName, col, row, address: `${col}${row}` };
}

// ─── 병합 셀 범위 ────────────────────────────────────────────────────────────

/**
 * 컬럼 문자 → 1-index 번호 (A=1, B=2, ...)
 */
function colLetterToNumber(letter) {
  let n = 0;
  for (const c of String(letter).toUpperCase()) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n;
}

/**
 * ws 내에서 (colLetter, row) 를 포함하는 병합 범위를 반환
 * 반환: { startCol, startRow, endCol, endRow }  (1-indexed)
 * 병합 없으면 단일 셀 범위 반환
 */
function getMergedCellExtent(ws, colLetter, row) {
  const ci    = colLetterToNumber(colLetter);
  const rowN  = parseInt(row, 10);
  const merges = ws.model?.merges || [];
  for (const merge of merges) {
    if (typeof merge !== 'string') continue;
    const parts = merge.split(':');
    if (parts.length !== 2) continue;
    const ca = ws.getCell(parts[0]);
    const cb = ws.getCell(parts[1]);
    if (ci >= ca.col && ci <= cb.col && rowN >= ca.row && rowN <= cb.row) {
      return { startCol: ca.col, startRow: ca.row, endCol: cb.col, endRow: cb.row };
    }
  }
  return { startCol: ci, startRow: rowN, endCol: ci, endRow: rowN };
}

// ─── 이미지 삽입 ────────────────────────────────────────────────────────────

/**
 * 로컬 파일 경로(filePath) 또는 Buffer 를 셀 범위에 리사이즈 후 삽입
 * @param {ExcelJS.Workbook} wb
 * @param {ExcelJS.Worksheet} ws
 * @param {{ startCol, startRow, endCol, endRow }} extent  (getMergedCellExtent 반환)
 * @param {string|Buffer} imgSource  파일 경로 or Buffer
 * @param {{ quality?: number }} [opts]
 */
async function insertImageToCell(wb, ws, extent, imgSource, opts = {}) {
  const sharp = require('sharp');
  const quality = opts.quality ?? 88;

  // 병합 셀 전체 픽셀 크기 계산
  let cellW = 0;
  for (let c = extent.startCol; c <= extent.endCol; c++) {
    cellW += Math.round((ws.getColumn(c).width || 8) * 7.0);
  }
  let cellH = 0;
  for (let r = extent.startRow; r <= extent.endRow; r++) {
    cellH += Math.round((ws.getRow(r).height || 15) * (96 / 72));
  }
  cellW = Math.max(20, cellW);
  cellH = Math.max(20, cellH);

  // 목표: 세로 = 셀 세로의 90%, 가로는 비율 유지 (widthPct 지정 시 가로도 제한)
  const targetH = Math.round(cellH * 0.9) * 2;
  const resizeOpts = { height: targetH, fit: 'inside', withoutEnlargement: false };
  if (opts.widthPct) {
    resizeOpts.width = Math.round(cellW * opts.widthPct) * 2;
  }

  const srcBuf = typeof imgSource === 'string' ? fs.readFileSync(imgSource) : imgSource;
  const isBmp  = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;

  let sharpInst;
  if (isBmp) {
    const raw = _decodeBmpToRgb(srcBuf);
    sharpInst = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } });
  } else {
    sharpInst = sharp(srcBuf);
  }

  const { data: outBuf, info } = await sharpInst
    .rotate()
    .resize(resizeOpts)
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });

  // 실제 표시 크기 (2× 역산)
  const imgW = info.width  / 2;
  const imgH = info.height / 2;

  // 셀 중앙 배치를 위한 픽셀 오프셋
  const xOff = Math.max(0, (cellW - imgW) / 2);
  const yOff = Math.max(0, (cellH - imgH) / 2);

  // 픽셀 오프셋 → ExcelJS fractional col/row (0-based)
  const firstColPx = Math.max(1, Math.round((ws.getColumn(extent.startCol).width || 8) * 7.0));
  const firstRowPx = Math.max(1, Math.round((ws.getRow(extent.startRow).height   || 15) * (96 / 72)));
  const tlCol = (extent.startCol - 1) + xOff / firstColPx;
  const tlRow = (extent.startRow - 1) + yOff / firstRowPx;

  const imageId = wb.addImage({ buffer: outBuf, extension: 'jpeg' });
  ws.addImage(imageId, {
    tl:     { col: tlCol, row: tlRow },
    ext:    { width: Math.round(imgW), height: Math.round(imgH) },
    editAs: 'oneCell',
  });
}

// ─── BMP 디코딩 ──────────────────────────────────────────────────────────────

function _decodeBmpToRgb(buf) {
  const dataOffset   = buf.readUInt32LE(10);
  const width        = buf.readInt32LE(18);
  const rawHeight    = buf.readInt32LE(22);
  const height       = Math.abs(rawHeight);
  const bpp          = buf.readUInt16LE(28);
  const compression  = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`압축 BMP 미지원 (compression=${compression})`);
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP ${bpp}bpp 미지원`);

  const channels  = bpp >>> 3;
  const rowSize   = Math.floor((bpp * width + 31) / 32) * 4;
  const bottomUp  = rawHeight > 0;
  const out       = Buffer.alloc(width * height * 3);

  for (let row = 0; row < height; row++) {
    const srcRow = bottomUp ? (height - 1 - row) : row;
    const srcOff = dataOffset + srcRow * rowSize;
    const dstOff = row * width * 3;
    for (let col = 0; col < width; col++) {
      const s = srcOff + col * channels;
      out[dstOff + col * 3 + 0] = buf[s + 2]; // R
      out[dstOff + col * 3 + 1] = buf[s + 1]; // G
      out[dstOff + col * 3 + 2] = buf[s + 0]; // B
    }
  }
  return { data: out, width, height };
}

// ─── 임시 경로 / 파일 열기 ───────────────────────────────────────────────────

/**
 * 임시 출력 파일 경로 반환
 * @param {string} subDir  e.g. 'osoo-sludge-photo'
 * @param {string} fileName
 */
function buildExcelTempPath(subDir, fileName) {
  const dir = path.join(os.tmpdir(), subDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

/**
 * Windows에서 해당 경로 파일을 연결 프로그램으로 열기
 * (Excel 파일이면 Excel, HWP 파일이면 HWP 등 OS 기본 앱으로 실행)
 */
function openExcelFile(filePath) {
  return new Promise((resolve) => {
    exec(`start "" "${filePath}"`, { shell: 'cmd.exe' }, (err) => {
      if (err) console.warn('[excelOpenService] 파일 열기 실패:', err.message);
      resolve(!err);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  parseNamedRanges,
  getMergedCellExtent,
  insertImageToCell,
  buildExcelTempPath,
  openExcelFile,
};
