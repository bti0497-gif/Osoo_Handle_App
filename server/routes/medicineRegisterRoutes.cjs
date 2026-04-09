const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const { resolveReportTemplatePath } = require('../services/reportTemplateService.cjs');
const { replaceHwpxPlaceholders } = require('../services/hwpPdfService.cjs');

const router = express.Router();

// 기본 3종 약품 (순서 고정 — HWPX 약1, 약2, 약3)
const BASE_MEDICINES = ['포도당', '중탄산나트륨', '팩(PAC)'];
// 기본 4종 키트 (순서 고정 — HWPX 키1, 키2, 키3, 키4)
const BASE_KITS = ['암모니아성질소(NH3-N)', '질산성질소(NO3-N)', '인산염인(PO4-P)', '알칼리도(ALK)'];

/**
 * 월간 집계 데이터를 조회한다.
 * - purchase  : 해당 월 구매량 합계
 * - usage     : 해당 월 사용량 합계
 * - yearTotal : 해당 연도 1월 ~ 해당 월 사용량 누계
 * - balance   : 해당 월 내 가장 최근 current_inventory
 */
function getAggregate(db, table, nameCol, name, startDate, endDate, yearStart) {
  const purchase = db.prepare(
    `SELECT COALESCE(SUM(purchase_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, startDate, endDate)?.v ?? 0;

  const usage = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, startDate, endDate)?.v ?? 0;

  const yearTotal = db.prepare(
    `SELECT COALESCE(SUM(usage_amount), 0) AS v FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?`
  ).get(name, yearStart, endDate)?.v ?? 0;

  const balance = db.prepare(
    `SELECT current_inventory FROM ${table}
     WHERE ${nameCol} = ? AND date >= ? AND date <= ?
     ORDER BY date DESC LIMIT 1`
  ).get(name, startDate, endDate)?.current_inventory ?? 0;

  return { purchase, usage, yearTotal, balance };
}

module.exports = function (db, baseDir, appDataPath) {
  /**
   * GET /api/medicine-register
   * Query: year (number), month (number)
   */
  router.get('/api/medicine-register', (req, res) => {
    try {
      const year = parseInt(req.query.year, 10);
      const month = parseInt(req.query.month, 10);

      if (!year || !month || month < 1 || month > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      const mm = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${year}-${mm}-01`;
      const endDate = `${year}-${mm}-${dd}`;
      const yearStart = `${year}-01-01`;

      // 현장명
      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      // 추가 약품 (기본 3종 제외, is_active=1인 것)
      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('포도당', '중탄산나트륨', '팩(PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      // 기본 약품 집계
      const medicineData = BASE_MEDICINES.map((name) =>
        ({ name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) })
      );

      // 추가 약품 집계 (최대 3개, 없으면 null)
      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) };
      });

      // 키트 집계
      const kitData = BASE_KITS.map((name) =>
        ({ name, ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart) })
      );

      // 인터록: 지난 달이거나 말일 데이터가 존재하면 생성 가능
      const now = new Date();
      const isPastMonth = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);
      const lastDayRecordCount = db.prepare(
        `SELECT COUNT(*) AS cnt FROM medicine_logs WHERE date = ?`
      ).get(endDate)?.cnt ?? 0;
      const interlockEnabled = isPastMonth || lastDayRecordCount > 0;

      res.json({
        success: true,
        year,
        month,
        siteName,
        medicines: medicineData,
        extraMedicines: extraData,
        kits: kitData,
        interlock: {
          enabled: interlockEnabled,
          reason: isPastMonth ? '지난 달' : lastDayRecordCount > 0 ? `말일(${endDate}) 데이터 존재` : '',
        },
      });
    } catch (err) {
      console.error('[medicine-register GET]', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/medicine-register/export
   * Body: { year, month }
   * Returns: PDF (application/pdf)
   */
  router.post('/api/medicine-register/export', async (req, res) => {
    try {
      const { year, month } = req.body;
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);

      if (!y || !m || m < 1 || m > 12) {
        return res.status(400).json({ success: false, error: '유효하지 않은 연월입니다.' });
      }

      // 템플릿 파일 확인
      const templateInfo = resolveReportTemplatePath(baseDir, appDataPath, '약품관리대장', { excelOnly: false });
      if (!templateInfo?.absolutePath || !fs.existsSync(templateInfo.absolutePath)) {
        return res.status(404).json({
          success: false,
          code: 'HWP_TEMPLATE_MISSING',
          error: '약품관리대장 HWPX 양식을 찾을 수 없습니다.',
          userMessage: '설정에서 약품관리대장 HWPX 파일을 업로드해 주세요.',
        });
      }

      const ext = path.extname(templateInfo.absolutePath).toLowerCase();
      if (ext !== '.hwpx') {
        return res.status(400).json({
          success: false,
          code: 'HWP_TEMPLATE_INVALID',
          error: 'HWPX 파일만 지원합니다.',
        });
      }

      // 집계 데이터 조회 (GET 엔드포인트와 동일 로직)
      const mm = String(m).padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const dd = String(lastDay).padStart(2, '0');
      const startDate = `${y}-${mm}-01`;
      const endDate = `${y}-${mm}-${dd}`;
      const yearStart = `${y}-01-01`;

      const settings = db.prepare('SELECT site_name FROM app_settings WHERE id = 1').get();
      const siteName = settings?.site_name || '';

      const extraMedicines = db.prepare(
        `SELECT item_name FROM config_items
         WHERE category = 'medicine' AND is_active = 1
           AND item_name NOT IN ('포도당', '중탄산나트륨', '팩(PAC)')
         ORDER BY display_order ASC
         LIMIT 3`
      ).all().map((r) => r.item_name);

      const medicineData = BASE_MEDICINES.map((name) =>
        ({ name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) })
      );

      const extraData = Array.from({ length: 3 }, (_, i) => {
        const name = extraMedicines[i] || null;
        if (!name) return { name: '', purchase: 0, usage: 0, yearTotal: 0, balance: 0 };
        return { name, ...getAggregate(db, 'medicine_logs', 'medicine_name', name, startDate, endDate, yearStart) };
      });

      const kitData = BASE_KITS.map((name) =>
        ({ name, ...getAggregate(db, 'kit_logs', 'kit_name', name, startDate, endDate, yearStart) })
      );

      // 숫자 포맷: 0이면 빈 문자열이 아닌 "0" 표시, 소수점은 필요 시 표시
      const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v ?? ''));

      // Placeholder → 값 매핑
      const bindings = {
        '{{월}}': mm,
        '{{현장명}}': siteName,
        '{{약품목록}}': [...BASE_MEDICINES, ...extraMedicines].filter(Boolean).join(', '),

        // 기본 약품 (약1=포도당, 약2=중탄산나트륨, 약3=팩(PAC))
        '{{약1-구매}}': fmt(medicineData[0]?.purchase),
        '{{약1-사용}}': fmt(medicineData[0]?.usage),
        '{{약1-연누계}}': fmt(medicineData[0]?.yearTotal),
        '{{약1-잔량}}': fmt(medicineData[0]?.balance),

        '{{약2-구매}}': fmt(medicineData[1]?.purchase),
        '{{약2-사용}}': fmt(medicineData[1]?.usage),
        '{{약2-연누계}}': fmt(medicineData[1]?.yearTotal),
        '{{약2-잔량}}': fmt(medicineData[1]?.balance),

        '{{약3-구매}}': fmt(medicineData[2]?.purchase),
        '{{약3-사용}}': fmt(medicineData[2]?.usage),
        '{{약3-연누계}}': fmt(medicineData[2]?.yearTotal),
        '{{약3-잔량}}': fmt(medicineData[2]?.balance),

        // 추가약품
        '{{추가약품1_명}}': extraData[0]?.name || '',
        '{{추1-구매}}': extraData[0]?.name ? fmt(extraData[0].purchase) : '',
        '{{추1-사용}}': extraData[0]?.name ? fmt(extraData[0].usage) : '',
        '{{추1-연누계}}': extraData[0]?.name ? fmt(extraData[0].yearTotal) : '',
        '{{추1-잔량}}': extraData[0]?.name ? fmt(extraData[0].balance) : '',

        '{{추가약품2_명}}': extraData[1]?.name || '',
        '{{추2-구매}}': extraData[1]?.name ? fmt(extraData[1].purchase) : '',
        '{{추2-사용}}': extraData[1]?.name ? fmt(extraData[1].usage) : '',
        '{{추2-연누계}}': extraData[1]?.name ? fmt(extraData[1].yearTotal) : '',
        '{{추2-잔량}}': extraData[1]?.name ? fmt(extraData[1].balance) : '',

        '{{추가약품3_명}}': extraData[2]?.name || '',
        '{{추3-구매}}': extraData[2]?.name ? fmt(extraData[2].purchase) : '',
        '{{추3-사용}}': extraData[2]?.name ? fmt(extraData[2].usage) : '',
        '{{추3-연누계}}': extraData[2]?.name ? fmt(extraData[2].yearTotal) : '',
        '{{추3-잔량}}': extraData[2]?.name ? fmt(extraData[2].balance) : '',

        // 키트 (키1=NH3-N, 키2=NO3-N, 키3=PO4-P, 키4=ALK)
        '{{키1-구매}}': fmt(kitData[0]?.purchase),
        '{{키1-사용}}': fmt(kitData[0]?.usage),
        '{{키1-연누계}}': fmt(kitData[0]?.yearTotal),
        '{{키1-잔량}}': fmt(kitData[0]?.balance),

        '{{키2-구매}}': fmt(kitData[1]?.purchase),
        '{{키2-사용}}': fmt(kitData[1]?.usage),
        '{{키2-연누계}}': fmt(kitData[1]?.yearTotal),
        '{{키2-잔량}}': fmt(kitData[1]?.balance),

        '{{키3-구매}}': fmt(kitData[2]?.purchase),
        '{{키3-사용}}': fmt(kitData[2]?.usage),
        '{{키3-연누계}}': fmt(kitData[2]?.yearTotal),
        '{{키3-잔량}}': fmt(kitData[2]?.balance),

        '{{키4-구매}}': fmt(kitData[3]?.purchase),
        '{{키4-사용}}': fmt(kitData[3]?.usage),
        '{{키4-연누계}}': fmt(kitData[3]?.yearTotal),
        '{{키4-잔량}}': fmt(kitData[3]?.balance),
      };

      const outputDir = path.join(os.tmpdir(), 'osoo-medicine-register');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const outputPath = path.join(outputDir, `약품관리대장_${y}_${mm}.hwpx`);

      const hwpxPath = await replaceHwpxPlaceholders({
        templatePath: templateInfo.absolutePath,
        outputPath,
        bindings,
      });

      // 서버에서 직접 파일 열기 (dev/Electron 모두 동작)
      exec(`start "" "${hwpxPath}"`, { shell: 'cmd.exe' }, (err) => {
        if (err) console.warn('[medicine-register] 파일 열기 실패:', err.message);
      });

      res.json({ success: true });
    } catch (err) {
      console.error('[medicine-register export]', err);
      res.status(500).json({
        success: false,
        code: 'EXPORT_FAILED',
        error: err.message,
        userMessage: `HWP 생성에 실패했습니다: ${err.message}`,
      });
    }
  });

  return router;
};
