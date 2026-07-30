'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const {
  bindWorkbookToPage,
  buildPhosphorusRows,
  buildSixLocationRows,
} = require('../server/services/dailyLogPreviewService.cjs');
const {
  syncBundledTemplatesToAppData,
} = require('../server/services/reportTemplateService.cjs');

const names = ['유량조정조', '혐기조', '무산소조', '포기조', '침전조', '방류조'];
const rows = names.map((location, index) => ({ location, nh3_n: index + 1, po4_p: index + 10 }));

assert.deepStrictEqual(
  buildSixLocationRows(rows, names).map((row) => row?.location || ''),
  names,
  '6개 분석장소는 1~6번 셀에 순서대로 바인딩되어야 합니다.'
);

const fiveNames = ['유량조정조', '무산소조', '포기조', '침전조', '방류조'];
const fiveRows = rows.filter((row) => fiveNames.includes(row.location));
assert.deepStrictEqual(
  buildSixLocationRows(fiveRows, fiveNames).map((row) => row?.location || ''),
  ['유량조정조', '', '무산소조', '포기조', '침전조', '방류조'],
  '5개 분석장소는 2번(혐기조)을 비우고 1·3·4·5·6번 셀에 바인딩되어야 합니다.'
);

assert.deepStrictEqual(
  buildPhosphorusRows(rows, names).map((row) => row?.location || ''),
  ['유량조정조', '침전조', '방류조'],
  'A2O 인산염인은 유량조정조·침전조·방류조 3곳이어야 합니다.'
);

const mbrNames = ['유량조정조', '무산소조', '포기조', '방류조'];
const mbrRows = rows.filter((row) => mbrNames.includes(row.location));
assert.deepStrictEqual(
  buildPhosphorusRows(mbrRows, mbrNames).map((row) => row?.location || ''),
  ['유량조정조', '포기조', '방류조'],
  'MBR 인산염인은 유량조정조·포기조·방류조 3곳이어야 합니다.'
);

async function validateTemplate() {
  const templatePath = path.join(__dirname, '..', 'templates', 'reports', '수질분석일지.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const definedNames = new Set((workbook.definedNames.model || []).map((entry) => entry.name));
  ['암모니아', '질산', '알칼리'].forEach((prefix) => {
    for (let index = 1; index <= 6; index += 1) {
      assert(definedNames.has(`${prefix}${index}`), `${prefix}${index} 셀 이름이 새 양식에 필요합니다.`);
    }
  });
  ['인1', '인2', '인3'].forEach((name) => {
    assert(definedNames.has(name), `${name} 셀 이름이 새 양식에 필요합니다.`);
  });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-water-template-'));
  try {
    const boundPath = path.join(tempRoot, 'bound-five.xlsx');
    await bindWorkbookToPage(templatePath, boundPath, { date: '2026-07-30' }, {
      activeLocations: fiveNames,
      rows: fiveRows,
      photoSelection: { selectedPhotos: {} },
    });
    const boundWorkbook = new ExcelJS.Workbook();
    await boundWorkbook.xlsx.readFile(boundPath);
    const boundNames = new Map((boundWorkbook.definedNames.model || []).map((entry) => [entry.name, entry.ranges[0]]));
    const readNamedValue = (name) => {
      const range = String(boundNames.get(name) || '');
      const match = range.match(/^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)/);
      assert(match, `${name} 이름 범위를 읽을 수 없습니다.`);
      return boundWorkbook.getWorksheet((match[1] || match[2]).replace(/''/g, "'")).getCell(`${match[3]}${match[4]}`).value;
    };
    assert.strictEqual(readNamedValue('암모니아1'), 1);
    assert.strictEqual(readNamedValue('암모니아2'), '');
    assert.strictEqual(readNamedValue('암모니아3'), 3);
    assert.strictEqual(readNamedValue('암모니아6'), 6);
    assert.strictEqual(readNamedValue('인1'), 10);
    assert.strictEqual(readNamedValue('인2'), 14);
    assert.strictEqual(readNamedValue('인3'), 15);

    const customDir = path.join(tempRoot, 'templates', 'reports');
    fs.mkdirSync(customDir, { recursive: true });
    const customTemplate = path.join(customDir, '수질분석일지.xlsx');
    fs.writeFileSync(customTemplate, 'legacy-template');

    syncBundledTemplatesToAppData(path.join(__dirname, '..'), tempRoot);
    assert(fs.readFileSync(customTemplate).equals(fs.readFileSync(templatePath)), '첫 실행에서 새 수질분석일지로 교체되어야 합니다.');

    fs.writeFileSync(customTemplate, 'field-customized-after-upgrade');
    syncBundledTemplatesToAppData(path.join(__dirname, '..'), tempRoot);
    assert.strictEqual(
      fs.readFileSync(customTemplate, 'utf8'),
      'field-customized-after-upgrade',
      '동일 릴리즈의 다음 실행부터는 현장 수정본을 다시 덮어쓰면 안 됩니다.'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

validateTemplate()
  .then(() => console.log('✓ 수질분석일지 5/6개 위치·인 3개·1회 교체 계약 검증 통과'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
