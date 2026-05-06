const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function argbToCss(argb) {
  const raw = String(argb || '').replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{8}$/.test(raw)) return null;
  const a = parseInt(raw.slice(0, 2), 16) / 255;
  const r = parseInt(raw.slice(2, 4), 16);
  const g = parseInt(raw.slice(4, 6), 16);
  const b = parseInt(raw.slice(6, 8), 16);
  if (a <= 0) return null;
  if (a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

function columnToIndex(column) {
  return String(column || '')
    .split('')
    .reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
}

function parseCellAddress(address) {
  const match = String(address || '').match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    colLetters: match[1],
    col: columnToIndex(match[1]),
    row: Number(match[2]),
  };
}

function parseCellRange(range) {
  const [startAddress, endAddress = startAddress] = String(range || '').split(':');
  const start = parseCellAddress(startAddress);
  const end = parseCellAddress(endAddress);
  if (!start || !end) return null;
  return {
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

function getMerges(worksheet) {
  const merges = Array.isArray(worksheet.model?.merges) ? worksheet.model.merges : [];
  const ranges = [];
  for (const mergeRef of merges) {
    const parsed = parseCellRange(mergeRef);
    if (parsed) ranges.push({ ref: mergeRef, ...parsed });
  }
  return ranges;
}

function getMergeAt(merges, row, col) {
  return merges.find((merge) => row >= merge.startRow && row <= merge.endRow && col >= merge.startCol && col <= merge.endCol) || null;
}

// Rough but stable conversion: Excel column width unit -> px
function columnWidthToPx(width) {
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return 64;
  return Math.max(16, Math.round(w * 7));
}

// Excel row height is in points.
function rowHeightToPx(height) {
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return 20;
  return Math.max(16, Math.round(h * (96 / 72)));
}

function buildBorderStyle(edge) {
  if (!edge || edge.style === undefined || edge.style === null) return null;
  // ExcelJS style names: thin, medium, thick, double, dashed, dotted, hair
  const style = String(edge.style);
  const widthMap = {
    hair: 1,
    thin: 1,
    dashed: 1,
    dotted: 1,
    medium: 2,
    thick: 3,
    double: 3,
  };
  const px = widthMap[style] || 1;
  const color = argbToCss(edge.color?.argb) || '#000';
  const line = style === 'dotted' ? 'dotted' : style === 'dashed' ? 'dashed' : 'solid';
  return `${px}px ${line} ${color}`;
}

function buildCellCss(cell) {
  const styles = [];

  // alignment
  const align = cell.alignment || {};
  if (align.horizontal) styles.push(`text-align:${align.horizontal};`);
  if (align.vertical) styles.push(`vertical-align:${align.vertical};`);
  if (align.wrapText) styles.push('white-space:pre-wrap;');
  else styles.push('white-space:pre;');

  // font
  const font = cell.font || {};
  if (font.name) styles.push(`font-family:${escapeHtml(font.name)};`);
  if (font.size) styles.push(`font-size:${Number(font.size)}pt;`);
  if (font.bold) styles.push('font-weight:700;');
  if (font.italic) styles.push('font-style:italic;');
  if (font.color?.argb) {
    const color = argbToCss(font.color.argb);
    if (color) styles.push(`color:${color};`);
  }

  // fill
  const fill = cell.fill || {};
  if (fill.type === 'pattern' && fill.pattern === 'solid') {
    const fg = argbToCss(fill.fgColor?.argb);
    if (fg) styles.push(`background:${fg};`);
  }

  // border
  const border = cell.border || {};
  const top = buildBorderStyle(border.top);
  const right = buildBorderStyle(border.right);
  const bottom = buildBorderStyle(border.bottom);
  const left = buildBorderStyle(border.left);
  if (top) styles.push(`border-top:${top};`);
  if (right) styles.push(`border-right:${right};`);
  if (bottom) styles.push(`border-bottom:${bottom};`);
  if (left) styles.push(`border-left:${left};`);

  return styles.join('');
}

function getCellDisplayValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.formula !== undefined) return '';
    if (value.text !== undefined) return String(value.text);
    if (value.richText) return value.richText.map((part) => part.text).join('');
    if (value.result !== undefined) return String(value.result ?? '');
  }
  return String(value);
}

function parseNamedCellEntries(workbook) {
  const model = workbook.definedNames && Array.isArray(workbook.definedNames.model) ? workbook.definedNames.model : [];
  return model
    .map((entry) => {
      const range = Array.isArray(entry.ranges) ? entry.ranges[0] : null;
      if (!range) return null;
      // format: Sheet!$A$1
      const match = String(range).match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)$/);
      if (!match) return null;
      const sheetName = (match[1] || match[2] || '').replace(/''/g, "'");
      return {
        name: entry.name,
        sheetName,
        address: `${match[3]}${match[4]}`,
      };
    })
    .filter(Boolean);
}

function buildNamedCellPlaceholderMap(workbook) {
  const map = new Map();
  const namedCells = parseNamedCellEntries(workbook);
  for (const namedCell of namedCells) {
    const key = `${namedCell.sheetName}::${namedCell.address}`;
    map.set(key, `{{${namedCell.name}}}`);
  }
  return map;
}

function buildHtmlForWorksheet({ workbook, worksheet, options }) {
  const maxRow = Math.min(
    Number(options.maxRows || 0) || 300,
    worksheet.actualRowCount || worksheet.rowCount || 1
  );
  const maxCol = Math.min(
    Number(options.maxCols || 0) || 60,
    worksheet.actualColumnCount || worksheet.columnCount || 1
  );

  const merges = getMerges(worksheet);
  const skipCells = new Set();
  const columnStyles = [];
  const rowHeights = new Map();
  const namedCellPlaceholders = buildNamedCellPlaceholderMap(workbook);

  for (let c = 1; c <= maxCol; c += 1) {
    const widthPx = columnWidthToPx(worksheet.getColumn(c)?.width);
    columnStyles.push(`<col style="width:${widthPx}px" />`);
  }

  for (let r = 1; r <= maxRow; r += 1) {
    const heightPx = rowHeightToPx(worksheet.getRow(r)?.height);
    rowHeights.set(r, heightPx);
  }

  const rows = [];
  for (let r = 1; r <= maxRow; r += 1) {
    const cells = [];
    for (let c = 1; c <= maxCol; c += 1) {
      const cellKey = `${r},${c}`;
      if (skipCells.has(cellKey)) {
        continue;
      }

      const merge = getMergeAt(merges, r, c);
      if (merge && !(merge.startRow === r && merge.startCol === c)) {
        // covered by a merge but not the top-left
        continue;
      }

      let rowspan = 1;
      let colspan = 1;
      if (merge) {
        rowspan = merge.endRow - merge.startRow + 1;
        colspan = merge.endCol - merge.startCol + 1;
        for (let rr = merge.startRow; rr <= merge.endRow; rr += 1) {
          for (let cc = merge.startCol; cc <= merge.endCol; cc += 1) {
            if (rr === r && cc === c) continue;
            skipCells.add(`${rr},${cc}`);
          }
        }
      }

      const cell = worksheet.getRow(r).getCell(c);
      const addr = cell.address;
      const namedPlaceholder = namedCellPlaceholders.get(`${worksheet.name}::${addr}`);
      const rawText = namedPlaceholder || getCellDisplayValue(cell);
      const text = escapeHtml(rawText);

      const css = buildCellCss(cell);
      const attrs = [];
      if (rowspan > 1) attrs.push(`rowspan="${rowspan}"`);
      if (colspan > 1) attrs.push(`colspan="${colspan}"`);
      attrs.push(`data-excel-address="${worksheet.name}!${addr}"`);
      if (namedPlaceholder) attrs.push(`data-named-cell="${escapeHtml(namedPlaceholder.slice(2, -2))}"`);
      if (css) attrs.push(`style="${css}"`);

      cells.push(`<td ${attrs.join(' ')}>${text}</td>`);
    }

    const rowStyle = `style="height:${rowHeights.get(r)}px"`;
    rows.push(`<tr ${rowStyle}>${cells.join('')}</tr>`);
  }

  const tableClass = options.tableClass || 'excel-template-table';
  return `
<div class="excel-template" data-worksheet="${escapeHtml(worksheet.name)}">
  <table class="${tableClass}" cellspacing="0" cellpadding="0">
    <colgroup>${columnStyles.join('')}</colgroup>
    <tbody>
      ${rows.join('\n')}
    </tbody>
  </table>
</div>`;
}

function buildHtmlDocument({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title || 'template')}</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; padding: 0; background: #fff; }
      .excel-template { display: inline-block; }
      table.excel-template-table { border-collapse: separate; border-spacing: 0; }
      table.excel-template-table td {
        box-sizing: border-box;
        padding: 0;
        margin: 0;
        overflow: hidden;
      }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`;
}

async function convertExcelTemplateToHtml({ sourcePath, outputPath, options = {} }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const sheetName = options.sheetName || workbook.worksheets[0]?.name;
  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    throw new Error(`Worksheet not found: ${sheetName}`);
  }

  const bodyHtml = buildHtmlForWorksheet({ workbook, worksheet, options });
  const html = buildHtmlDocument({ title: path.parse(sourcePath).name, bodyHtml });

  ensureDirectory(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');

  return { outputPath, sheetName: worksheet.name };
}

function getHtmlTemplateDir(appDataPath) {
  return ensureDirectory(path.join(appDataPath, 'templates', 'reports-html'));
}

function getHtmlTemplatePath(appDataPath, templateFileName) {
  const safeName = String(path.parse(templateFileName || 'template').name)
    .trim()
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, '_');
  return path.join(getHtmlTemplateDir(appDataPath), `${safeName}.html`);
}

module.exports = {
  convertExcelTemplateToHtml,
  getHtmlTemplateDir,
  getHtmlTemplatePath,
};
