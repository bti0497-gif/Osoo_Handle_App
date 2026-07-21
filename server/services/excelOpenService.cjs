/**
 * excelOpenService.cjs
 *
 *
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
 * $??optional
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

function ptToPx(pt) {
  return Math.round(Number(pt || 0) * (96 / 72));
}

function _columnPx(ws, c) {
  return Math.max(1, Math.round((ws.getColumn(c).width || 8) * 7.0));
}

function _rowPx(ws, r) {
  return Math.max(1, Math.round((ws.getRow(r).height || 15) * (96 / 72)));
}

function pixelToCol(ws, xPx) {
  let rem = Math.max(0, Number(xPx) || 0);
  const maxCols = Math.max(64, ws.columnCount + 16);
  for (let c = 1; c <= maxCols; c++) {
    const cw = _columnPx(ws, c);
    if (rem <= cw) return (c - 1) + (rem / cw);
    rem -= cw;
  }
  return maxCols - 1;
}

function pixelToRow(ws, yPx) {
  let rem = Math.max(0, Number(yPx) || 0);
  const maxRows = Math.max(300, ws.rowCount + 50);
  for (let r = 1; r <= maxRows; r++) {
    const rh = _rowPx(ws, r);
    if (rem <= rh) return (r - 1) + (rem / rh);
    rem -= rh;
  }
  return maxRows - 1;
}

// ─── 이미지 삽입 ────────────────────────────────────────────────────────────

/**
 * 로컬 파일 경로(filePath) 또는 Buffer 를 셀 범위에 리사이즈 후 삽입
 *
 * opts:
 *   fitBy   : 'width' | 'height'  — 기준 축 (기본: 'height')
 *   pct     : 0~1                 — 기준 축 비율 (기본: 0.9)
 *   cellW   : number (px)         — 셀 폭 직접 지정 (생략 시 시트에서 계산)
 *   cellH   : number (px)         — 셀 높이 직접 지정 (생략 시 시트에서 계산)
 *
 * ※ 캔버스 합성 없이 ext(픽셀 명시) + tl 분수 오프셋으로 중앙 배치
 *
 *
 * @param {ExcelJS.Workbook} wb
 * @param {ExcelJS.Worksheet} ws
 * @param {{ startCol, startRow, endCol, endRow }} extent  (getMergedCellExtent 반환)
 * @param {string|Buffer} imgSource  파일 경로 or Buffer
 * @param {{ fitBy?: 'width'|'height', pct?: number, cellW?: number, cellH?: number, leftPt?: number, topPt?: number, boxWidthPt?: number, boxHeightPt?: number }} [opts]
 */
async function insertImageToCell(wb, ws, extent, imgSource, opts = {}) {
  const sharp = require('../compat/sharp.cjs');

  // ── 1. 셀 전체 픽셀 크기 (opts로 직접 지정하거나 시트에서 계산) ──────────
  // 엑셀 column.width 단위: "문자 폭"(≈7 px/단위), row.height 단위: pt(1pt ≈ 1.333 px)
  const hasAbsoluteBox = opts.leftPt != null && opts.topPt != null
    && opts.boxWidthPt != null && opts.boxHeightPt != null;

  let cellW = opts.cellW;
  let cellH = opts.cellH;
  if (hasAbsoluteBox) {
    cellW = ptToPx(opts.boxWidthPt);
    cellH = ptToPx(opts.boxHeightPt);
  }
  if (!cellW) {
    cellW = 0;
    for (let c = extent.startCol; c <= extent.endCol; c++)
      cellW += Math.round((ws.getColumn(c).width || 8) * 7.0);
    cellW = Math.max(20, cellW);
  }
  if (!cellH) {
    cellH = 0;
    for (let r = extent.startRow; r <= extent.endRow; r++)
      cellH += Math.round((ws.getRow(r).height || 15) * (96 / 72));
    cellH = Math.max(20, cellH);
  }

  // ── 2. 리사이즈 목표 크기 결정 ──────────────────────────────────────────
  const fitBy = opts.fitBy || (opts.widthPct != null ? 'width' : 'height');
  const rawPct = opts.pct != null
    ? opts.pct
    : (fitBy === 'width' ? opts.widthPct : opts.heightPct);
  const pct = Math.max(0.05, Math.min(1, rawPct != null ? Number(rawPct) : 0.9));

  const resizeOpts = { fit: 'inside', withoutEnlargement: false };
  if (fitBy === 'width') {
    resizeOpts.width  = Math.round(cellW * pct);
    resizeOpts.height = Math.round(cellH * 0.98);
  } else {
    resizeOpts.width  = Math.round(cellW * 0.98);
    resizeOpts.height = Math.round(cellH * pct);
  }

  // ── 3. 이미지 리사이즈 ──────────────────────────────────────────────────
  const srcBuf = typeof imgSource === 'string' ? fs.readFileSync(imgSource) : imgSource;
  const isBmp  = srcBuf[0] === 0x42 && srcBuf[1] === 0x4D;

  let sharpInst;
  if (isBmp) {
    const raw = _decodeBmpToRgb(srcBuf);
    sharpInst = sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 3 } });
  } else {
    sharpInst = sharp(srcBuf);
  }

  const { data: imgBuf, info } = await sharpInst
    .rotate()
    .resize(resizeOpts)
    .png()
    .toBuffer({ resolveWithObject: true });

  // ── 4. 중앙 배치: 픽셀 마진 → 셀 분수 오프셋 변환 ──────────────────────
  // ExcelJS tl: { col, row } 에서 소수점 이하는 "해당 셀 안의 비율"
  // marginX 픽셀 / 시작 셀 폭 픽셀 = 해당 셀 내 비율
  const marginX = Math.max(0, (cellW - info.width)  / 2);
  const marginY = Math.max(0, (cellH - info.height) / 2);
  let tlCol;
  let tlRow;
  if (hasAbsoluteBox) {
    const absX = ptToPx(opts.leftPt) + marginX;
    const absY = ptToPx(opts.topPt) + marginY;
    tlCol = pixelToCol(ws, absX);
    tlRow = pixelToRow(ws, absY);
  } else {
    const firstColW = _columnPx(ws, extent.startCol);
    const firstRowH = _rowPx(ws, extent.startRow);
    const colFrac = marginX / firstColW;
    const rowFrac = marginY / firstRowH;
    tlCol = extent.startCol - 1 + colFrac;
    tlRow = extent.startRow - 1 + rowFrac;
  }

  // ── 5. 이미지 삽입 (ext로 크기 명시 → 셀 테두리 불가침) ──────────────────
  const imageId = wb.addImage({ buffer: imgBuf, extension: 'png' });
  ws.addImage(imageId, {
    tl: { col: tlCol, row: tlRow },
    ext: { width: info.width, height: info.height },
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
