/**
 * excelOpenService.cjs
 *
 * ?묒? ?뚯씪 ?앹꽦 怨듯넻 ?좏떥由ы떚
 * - parseNamedRanges(wb)          : ExcelJS Workbook -> named range 留?
 * - getMergedCellExtent(ws, ...)  : 蹂묓빀 ? 踰붿쐞 諛섑솚
 * - insertImageToCell(...)        : sharp 由ъ궗?댁쫰 ??????대?吏 ?쎌엯
 * - buildExcelTempPath(sub, name) : ?꾩떆 異쒕젰 寃쎈줈 ?앹꽦
 * - openExcelFile(filePath)       : start "" "寃쎈줈" 濡?Excel ?ㅽ뵂
 */

'use strict';

const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const { exec } = require('child_process');

// ??? Named Range ?뚯떛 ????????????????????????????????????????????????????????

/**
 * ExcelJS wb.definedNames.model (諛곗뿴) ??{ ?대쫫: { sheetName, col, row, address } }
 * ExcelJS ??model ??諛곗뿴([{ name, ranges: [...] }]) ?뺥깭??
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
 * "'?쒗듃紐?!$C$5"  ?먮뒗  "?쒗듃紐?$C$5"  ??{ sheetName, col, row, address }
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

// ??? 蹂묓빀 ? 踰붿쐞 ????????????????????????????????????????????????????????????

/**
 * 而щ읆 臾몄옄 ??1-index 踰덊샇 (A=1, B=2, ...)
 */
function colLetterToNumber(letter) {
  let n = 0;
  for (const c of String(letter).toUpperCase()) {
    n = n * 26 + (c.charCodeAt(0) - 64);
  }
  return n;
}

/**
 * ws ?댁뿉??(colLetter, row) 瑜??ы븿?섎뒗 蹂묓빀 踰붿쐞瑜?諛섑솚
 * 諛섑솚: { startCol, startRow, endCol, endRow }  (1-indexed)
 * 蹂묓빀 ?놁쑝硫??⑥씪 ? 踰붿쐞 諛섑솚
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

// ??? ?대?吏 ?쎌엯 ????????????????????????????????????????????????????????????

/**
 * 濡쒖뺄 ?뚯씪 寃쎈줈(filePath) ?먮뒗 Buffer 瑜?? 踰붿쐞??由ъ궗?댁쫰 ???쎌엯
 *
 * opts:
 *   fitBy   : 'width' | 'height'  ??湲곗? 異?(湲곕낯: 'height')
 *   pct     : 0~1                 ??湲곗? 異?鍮꾩쑉 (湲곕낯: 0.9)
 *   cellW   : number (px)         ??? ??吏곸젒 吏??(?앸왂 ???쒗듃?먯꽌 怨꾩궛)
 *   cellH   : number (px)         ??? ?믪씠 吏곸젒 吏??(?앸왂 ???쒗듃?먯꽌 怨꾩궛)
 *
 * ??罹붾쾭???⑹꽦 ?놁씠 ext(?쎌? 紐낆떆) + tl 遺꾩닔 ?ㅽ봽?뗭쑝濡?以묒븰 諛곗튂
 *    ??? ?뚮몢由щ? 媛由ъ? ?딆쓬
 *
 * @param {ExcelJS.Workbook} wb
 * @param {ExcelJS.Worksheet} ws
 * @param {{ startCol, startRow, endCol, endRow }} extent  (getMergedCellExtent 諛섑솚)
 * @param {string|Buffer} imgSource  ?뚯씪 寃쎈줈 or Buffer
 * @param {{ fitBy?: 'width'|'height', pct?: number, cellW?: number, cellH?: number, leftPt?: number, topPt?: number, boxWidthPt?: number, boxHeightPt?: number }} [opts]
 */
async function insertImageToCell(wb, ws, extent, imgSource, opts = {}) {
  const sharp = require('sharp');

  // ?? 1. ? ?꾩껜 ?쎌? ?ш린 (opts濡?吏곸젒 吏?뺥븯嫄곕굹 ?쒗듃?먯꽌 怨꾩궛) ??????????
  // ?묒? column.width ?⑥쐞: "臾몄옄 ??(?? px/?⑥쐞), row.height ?⑥쐞: pt(1pt ??1.333 px)
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

  // ?? 2. 由ъ궗?댁쫰 紐⑺몴 ?ш린 寃곗젙 ??????????????????????????????????????????
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

  // ?? 3. ?대?吏 由ъ궗?댁쫰 ??????????????????????????????????????????????????
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

  // ?? 4. 以묒븰 諛곗튂: ?쎌? 留덉쭊 ??? 遺꾩닔 ?ㅽ봽??蹂????????????????????????
  // ExcelJS tl: { col, row } ?먯꽌 ?뚯닔???댄븯??"?대떦 ? ?덉쓽 鍮꾩쑉"
  // marginX ?쎌? / ?쒖옉 ? ???쎌? = ?대떦 ? ??鍮꾩쑉
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

  // ?? 5. ?대?吏 ?쎌엯 (ext濡??ш린 紐낆떆 ??? ?뚮몢由?遺덇?移? ??????????????????
  const imageId = wb.addImage({ buffer: imgBuf, extension: 'png' });
  ws.addImage(imageId, {
    tl: { col: tlCol, row: tlRow },
    ext: { width: info.width, height: info.height },
    editAs: 'oneCell',
  });
}

// ??? BMP ?붿퐫????????????????????????????????????????????????????????????????

function _decodeBmpToRgb(buf) {
  const dataOffset   = buf.readUInt32LE(10);
  const width        = buf.readInt32LE(18);
  const rawHeight    = buf.readInt32LE(22);
  const height       = Math.abs(rawHeight);
  const bpp          = buf.readUInt16LE(28);
  const compression  = buf.readUInt32LE(30);
  if (compression !== 0) throw new Error(`?뺤텞 BMP 誘몄???(compression=${compression})`);
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP ${bpp}bpp 誘몄???);

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

// ??? ?꾩떆 寃쎈줈 / ?뚯씪 ?닿린 ???????????????????????????????????????????????????

/**
 * ?꾩떆 異쒕젰 ?뚯씪 寃쎈줈 諛섑솚
 * @param {string} subDir  e.g. 'osoo-sludge-photo'
 * @param {string} fileName
 */
function buildExcelTempPath(subDir, fileName) {
  const dir = path.join(os.tmpdir(), subDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

/**
 * Windows?먯꽌 ?대떦 寃쎈줈 ?뚯씪???곌껐 ?꾨줈洹몃옩?쇰줈 ?닿린
 * (Excel ?뚯씪?대㈃ Excel, HWP ?뚯씪?대㈃ HWP ??OS 湲곕낯 ?깆쑝濡??ㅽ뻾)
 */
function openExcelFile(filePath) {
  return new Promise((resolve) => {
    exec(`start "" "${filePath}"`, { shell: 'cmd.exe' }, (err) => {
      if (err) console.warn('[excelOpenService] ?뚯씪 ?닿린 ?ㅽ뙣:', err.message);
      resolve(!err);
    });
  });
}

// ?????????????????????????????????????????????????????????????????????????????

module.exports = {
  parseNamedRanges,
  getMergedCellExtent,
  insertImageToCell,
  buildExcelTempPath,
  openExcelFile,
};
