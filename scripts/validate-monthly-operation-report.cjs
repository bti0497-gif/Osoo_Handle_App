const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { exportMonthlyOperationReport } = require('../server/services/monthlyOperationReportService.cjs');

const templatePath = path.join(__dirname, '..', 'templates', 'reports', '월운영보고서.xlsx');
const outputPath = path.join(os.tmpdir(), `osoo-monthly-report-validation-${process.pid}.xlsx`);

function dbStub() {
  return {
    prepare(sql) {
      return {
        get(...args) {
          if (sql.includes('FROM app_settings')) return { site_id: 'test', site_name: '검증현장' };
          if (sql.includes('SELECT current_inventory')) return { current_inventory: 100 };
          if (sql.includes('SUM(purchase_amount)')) return { total: 20 };
          throw new Error(`Unexpected get query: ${sql} / ${args}`);
        },
        all() {
          if (sql.includes('FROM site_config_items')) sql = sql.replace('FROM site_config_items', 'FROM config_items');
          if (sql.includes('FROM config_items')) return [{ item_name: '포도당' }, { item_name: '중탄산나트륨' }, { item_name: '팩(PAC)' }];
          if (sql.includes('FROM flow_readings')) return [
            { date: '2026-07-01', type: '유입유량계', calculated_flow: 12.5, sludge_export: null },
            { date: '2026-07-01', type: '방류유량계', calculated_flow: 10.25, sludge_export: null },
            { date: '2026-07-01', type: '슬러지', calculated_flow: 0, sludge_export: 3 },
          ];
          if (sql.includes('FROM medicine_logs')) return [
            { date: '2026-07-01', medicine_name: '포도당', purchase_amount: 0, usage_amount: 4, current_inventory: 96 },
          ];
          throw new Error(`Unexpected all query: ${sql}`);
        },
      };
    },
  };
}

function snapshot(workbook) {
  const sheet = workbook.getWorksheet('월간운영일지');
  const formulas = {};
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (cell.value && typeof cell.value === 'object' && cell.value.formula) formulas[cell.address] = cell.value.formula;
  }));
  return {
    sheets: workbook.worksheets.map((item) => item.name),
    formulas,
    merges: Object.keys(sheet._merges || {}).sort(),
    printArea: sheet.pageSetup.printArea,
    orientation: sheet.pageSetup.orientation,
  };
}

(async () => {
  assert(fs.existsSync(templatePath), '월운영보고서 기본양식이 없습니다.');
  const before = new ExcelJS.Workbook();
  await before.xlsx.readFile(templatePath);
  const expected = snapshot(before);
  await exportMonthlyOperationReport({ db: dbStub(), templatePath, outputPath, year: 2026, month: 7 });
  const after = new ExcelJS.Workbook();
  await after.xlsx.readFile(outputPath);
  assert.deepStrictEqual(snapshot(after), expected, '출력 과정에서 시트·수식·병합·인쇄 설정이 변경되었습니다.');
  assert.strictEqual(after.getWorksheet('월간운영일지').getCell('A1').value, '검증현장 2026년 7월 운영보고서');
  assert.strictEqual(after.getWorksheet('월간운영일지').getCell('B4').value, 12.5);
  assert.strictEqual(after.getWorksheet('월간운영일지').getCell('C4').value, 10.25);
  assert.strictEqual(after.getWorksheet('월간운영일지').getCell('D4').value, 3);
  const zip = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  assert(/<calcPr\b[^>]*calcMode="auto"/.test(workbookXml), '자동 수식 계산 설정이 없습니다.');
  assert(/<calcPr\b[^>]*fullCalcOnLoad="1"/.test(workbookXml), '전체 수식 재계산 설정이 없습니다.');
  assert(/<calcPr\b[^>]*forceFullCalc="1"/.test(workbookXml), '강제 수식 재계산 설정이 없습니다.');
  fs.rmSync(outputPath, { force: true });
  console.log('월운영보고서 양식/수식 보존 검증 통과');
})().catch((error) => {
  fs.rmSync(outputPath, { force: true });
  console.error(error);
  process.exit(1);
});
