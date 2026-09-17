'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');

module.exports = {
  id: 'equipment-card-excel',
  covers: ['equipment_card_excel', 'equipment_history_export'],
  version: '0.1.0',
  status: 'implemented',
  async run({ ctx, fixtures, dbPath, expected }) {
    let equipment20Id;
    let equipment50Id;
    const baseDate = fixtures.dataset.fixedDate;
    const dateAt = (offset) => {
      const date = new Date(`${baseDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };

    await ctx.step('equipment-export-fixture', async () => {
      const createEquipment = async (name) => {
        const next = await ctx.request('GET', '/api/equipment/next-management-no', {
          query: { name, category2: '펌프류', category1: '방류조' },
        });
        ctx.assert(next.ok && next.json?.managementNo, 'Excel 출력용 장비 번호 생성 실패', 'EQUIPMENT_EXPORT_NUMBER_FAILED');
        const created = await ctx.request('POST', '/api/equipment', {
          body: {
            managementNo: next.json.managementNo,
            name,
            category1: '방류조',
            category2: '펌프류',
            vendor: '진단업체',
            model: '진단모델',
          },
        });
        ctx.assert(created.ok && created.json?.id, 'Excel 출력용 장비 생성 실패', 'EQUIPMENT_EXPORT_SETUP_FAILED', created.json);
        return created.json.id;
      };
      const addHistories = async (equipmentId, count, label) => {
        for (let index = 1; index <= count; index += 1) {
          const response = await ctx.request('POST', '/api/equipment/history', {
            body: {
              equipmentId,
              date: dateAt(index),
              type: index % 2 ? '정기점검' : '수리',
              content: `${label} 직접 입력 이력 ${index}`,
              company: `${label} 업체 ${index}`,
              price: index * 1000,
            },
          });
          ctx.assert(response.ok, `${label} 직접 이력 ${index}건 생성 실패`, 'EQUIPMENT_EXPORT_HISTORY_SETUP_FAILED', response.json);
        }
      };

      equipment20Id = await createEquipment('진단출력펌프20');
      await addHistories(equipment20Id, 20, '20건');
      const linked = await ctx.request('POST', '/api/work-records', {
        body: {
          date: dateAt(25),
          title: '작업사진 연결 기록',
          content: '작업사진 메뉴에서 연결된 작업 내용',
          equipmentIds: [equipment20Id],
        },
      });
      ctx.assert(linked.ok, '업무사진 연결 기록 생성 실패', 'EQUIPMENT_EXPORT_LINK_SETUP_FAILED', linked.json);

      equipment50Id = await createEquipment('진단출력펌프50');
      await addHistories(equipment50Id, 50, '50건');
    });

    await ctx.step('equipment-export-20-records', async () => {
      const response = await ctx.request('GET', `/api/equipment/${equipment20Id}/export-excel`, { query: { open: 'false' } });
      ctx.assert(response.ok && response.json?.success, '20건 장비 Excel 출력 실패', 'EQUIPMENT_EXPORT_20_FAILED', response.json);
      const outputPath = response.json.outputPath;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      ctx.assert(workbook.worksheets.length === 2, '20건 출력의 시트 수가 2가 아닙니다.', 'EQUIPMENT_EXPORT_20_PAGE_COUNT_BROKEN');
      const first = workbook.getWorksheet('1');
      const second = workbook.getWorksheet('2');
      ctx.assert(first.getCell('A19').value === dateAt(1) && first.getCell('A29').value === dateAt(11),
        '20건 첫 페이지 정렬이 깨졌습니다.', 'EQUIPMENT_EXPORT_20_ORDER_BROKEN');
      ctx.assert(second.getCell('A6').value === dateAt(12) && second.getCell('A15').value === dateAt(25),
        '20건 두 번째 페이지에 직접 이력 또는 업무사진 연결 이력이 누락됐습니다.', 'EQUIPMENT_EXPORT_20_LINKED_HISTORY_MISSING');
      ctx.assert(second.getCell('D15').value === '작업사진 연결 기록: 작업사진 메뉴에서 연결된 작업 내용'
        && second.getCell('R15').value === '' && second.getCell('T15').value === '',
      '업무사진 연결 이력의 업체명·금액 공란 계약이 깨졌습니다.', 'EQUIPMENT_EXPORT_20_WORK_RECORD_BINDING_BROKEN');
      ctx.assert(first.getCell('T3').value === '1/2' && second.getCell('T3').value === '2/2',
        '20건 페이지 번호가 깨졌습니다.', 'EQUIPMENT_EXPORT_20_PAGE_NUMBER_BROKEN');
      fs.rmSync(outputPath, { force: true });
    });

    await ctx.step('equipment-export-50-records', async () => {
      const response = await ctx.request('GET', `/api/equipment/${equipment50Id}/export-excel`, { query: { open: 'false' } });
      ctx.assert(response.ok && response.json?.success, '50건 장비 Excel 출력 실패', 'EQUIPMENT_EXPORT_50_FAILED', response.json);
      const outputPath = response.json.outputPath;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(outputPath);
      ctx.assert(workbook.worksheets.length === 3, '50건 출력의 시트 수가 3이 아닙니다.', 'EQUIPMENT_EXPORT_50_PAGE_COUNT_BROKEN');
      const first = workbook.getWorksheet('1');
      const second = workbook.getWorksheet('2');
      const third = workbook.getWorksheet('3');
      ctx.assert(first.getCell('A19').value === dateAt(1) && second.getCell('A6').value === dateAt(12)
        && second.getCell('A29').value === dateAt(35)
        && third.getCell('A6').value === dateAt(36) && third.getCell('A20').value === dateAt(50),
      '50건 출력의 페이지 분할 또는 오름차순 정렬이 깨졌습니다.', 'EQUIPMENT_EXPORT_50_RANGE_BROKEN');
      ctx.assert(first.getCell('T3').value === '1/3' && second.getCell('T3').value === '2/3' && third.getCell('T3').value === '3/3',
        '50건 페이지 번호가 깨졌습니다.', 'EQUIPMENT_EXPORT_50_PAGE_NUMBER_BROKEN');
      fs.rmSync(outputPath, { force: true });
    });

    await ctx.step('equipment-export-diagnostics', async () => {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      try {
        const rows = db.prepare(`
          SELECT details_json FROM app_diagnostic_logs
          WHERE site_id = ? AND area = 'equipment-card' AND action = 'excel-export' AND result = 'ok'
          ORDER BY id DESC
        `).all(expected.siteId);
        ctx.assert(rows.length >= 2, 'Excel 출력 전용 진단 이벤트가 누락됐습니다.', 'EQUIPMENT_EXPORT_DIAGNOSTIC_MISSING', rows.length);
        const summaries = rows.map((row) => JSON.parse(row.details_json));
        ctx.assert(summaries.some((details) => details.pageCount === 2 && details.historyCount === 21
          && details.historySourceCounts['work-record'] === 1),
        '20건 출력의 페이지·업무 연결 이력 진단이 누락됐습니다.', 'EQUIPMENT_EXPORT_20_DIAGNOSTIC_BROKEN');
        ctx.assert(summaries.some((details) => details.pageCount === 3 && details.historyCount === 50),
        '50건 출력의 페이지·이력 수 진단이 누락됐습니다.', 'EQUIPMENT_EXPORT_50_DIAGNOSTIC_BROKEN');
      } finally {
        db.close();
      }
    });
  },
};
