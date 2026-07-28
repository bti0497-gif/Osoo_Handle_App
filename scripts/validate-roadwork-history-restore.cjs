const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  applyRestore,
  normalizeDocuments,
} = require('../server/services/settings/roadworkHistoryRestoreService.cjs');

async function main() {
  const sourcePath = process.argv[2];
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('검증할 SQLite DB 경로가 필요합니다.');
  }

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'osoo-history-restore-'));
  const testDbPath = path.join(testRoot, 'osoo-test.db');
  fs.copyFileSync(sourcePath, testDbPath);
  const db = new Database(testDbPath);

  try {
    const configured = (category) => db.prepare(`
      SELECT item_name FROM config_items
      WHERE category = ? AND COALESCE(is_active, 1) = 1
      ORDER BY display_order, item_name
      LIMIT 1
    `).get(category)?.item_name;
    const flowName = configured('flow');
    const medicineName = configured('medicine');
    const kitName = configured('kit');
    if (!flowName || !medicineName || !kitName) {
      throw new Error('유량·약품·키트 설정 항목이 모두 필요합니다.');
    }

    const documents = [
      {
        date: '2098-01-01',
        documentKey: 'validation-1',
        flow: [{ insrIdntIdText: flowName, prvdDrwtMsrmVal: 90, tdayDrwtMsrmVal: 100, drwtProsAmnt: 10 }],
        chemicals: [
          { chmcText: medicineName, chmcClssNmText: '약품', chmcPuchAmnt: 10, chmcUseAmnt: 2, chmcRsqnVal: 108 },
          { chmcClssNmText: 'NH₃-N', dwrmChmcClssCd: 'KIT', chmcPuchAmnt: 5, chmcUseAmnt: 1, chmcRsqnVal: 54 },
        ],
      },
      {
        date: '2098-01-03',
        documentKey: 'validation-3',
        flow: [{ insrIdntIdText: flowName, tdayDrwtMsrmVal: 125, drwtProsAmnt: 15 }],
        chemicals: [
          { chmcText: medicineName, chmcClssNmText: '약품', chmcPuchAmnt: 0, chmcUseAmnt: 3, chmcRsqnVal: 105 },
          { chmcClssNmText: 'NH₃-N', dwrmChmcClssCd: 'KIT', chmcPuchAmnt: 0, chmcUseAmnt: 2, chmcRsqnVal: 52 },
        ],
      },
    ];

    const range = { startDate: '2097-12-31', endDate: '2098-01-03' };
    const first = await applyRestore(db, testRoot, { documents, ...range });
    const second = await applyRestore(db, testRoot, { documents, ...range });
    const primarySiteId = String(db.prepare('SELECT site_id FROM app_settings WHERE id = 1').get()?.site_id || '');
    const secondarySiteId = 'history-restore-secondary-site';
    db.prepare(`
      INSERT OR REPLACE INTO sites (id, site_name, manager_name, is_active)
      VALUES (?, '복원검증 보조방향', '검증관리자', 1)
    `).run(secondarySiteId);
    db.prepare(`
      INSERT OR IGNORE INTO site_config_items (
        site_id, category, item_name, is_active, display_order, excel_cell, default_amount
      )
      SELECT ?, category, item_name, is_active, display_order, excel_cell, default_amount
      FROM site_config_items WHERE site_id = ?
    `).run(secondarySiteId, primarySiteId);
    const secondaryDocuments = [{
      date: '2098-02-01',
      documentKey: 'validation-secondary-1',
      flow: [{ insrIdntIdText: flowName, prvdDrwtMsrmVal: 890, tdayDrwtMsrmVal: 900, drwtProsAmnt: 10 }],
      chemicals: [],
    }];
    const secondary = await applyRestore(db, testRoot, {
      documents: secondaryDocuments,
      startDate: '2098-02-01',
      endDate: '2098-02-02',
      siteId: secondarySiteId,
    });
    db.prepare(`
      INSERT OR IGNORE INTO site_config_items (
        site_id, category, item_name, is_active, display_order, excel_cell, default_amount
      ) VALUES (?, 'medicine', '팩(PAC)', 1, 999, NULL, 0)
    `).run(secondarySiteId);
    for (const [index, name] of ['내부반송유량계', '외부반송유량계'].entries()) {
      db.prepare(`
        INSERT OR IGNORE INTO site_config_items (
          site_id, category, item_name, is_active, display_order, excel_cell, default_amount
        ) VALUES (?, 'flow', ?, 1, ?, NULL, 0)
      `).run(secondarySiteId, name, 990 + index);
    }
    db.prepare(`
      INSERT OR IGNORE INTO site_config_items (
        site_id, category, item_name, is_active, display_order, excel_cell, default_amount
      ) VALUES (?, 'flow', '슬러지', 1, 992, NULL, 0)
    `).run(secondarySiteId);
    const returnFlowNormalization = normalizeDocuments(db, [{
      date: '2098-02-20',
      documentKey: 'validation-return-flow-aliases',
      flow: [
        { dwrmWeihgInsrCd: '내부반송슬러지', tdayDrwtMsrmVal: 101, drwtProsAmnt: 1 },
        { dwrmWeihgInsrCd: '외부반송슬러지', tdayDrwtMsrmVal: 202, drwtProsAmnt: 2 },
      ],
      chemicals: [],
    }], secondarySiteId);
    const returnFlowTypes = returnFlowNormalization.documents[0]?.flows.map((row) => row.type) || [];
    const coagulantRange = {
      startDate: '2098-03-01',
      endDate: '2098-03-01',
      siteId: secondarySiteId,
    };
    const coagulantDocument = (usage, inventory) => [{
      date: '2098-03-01',
      documentKey: `validation-coagulant-${usage}`,
      flow: [{ insrIdntIdText: flowName, prvdDrwtMsrmVal: 900, tdayDrwtMsrmVal: 910, drwtProsAmnt: 10 }],
      chemicals: [{
        dwrmChmcClssCdText: '응집제',
        chmcPuchAmnt: 0,
        chmcUseAmnt: usage,
        chmcRsqnVal: inventory,
      }],
    }];
    await applyRestore(db, testRoot, {
      documents: coagulantDocument(4, 96),
      ...coagulantRange,
    });
    const coagulantOverwrite = await applyRestore(db, testRoot, {
      documents: coagulantDocument(7, 93),
      ...coagulantRange,
    });
    const coagulantRows = db.prepare(`
      SELECT medicine_name, purchase_amount, usage_amount, current_inventory
      FROM medicine_logs
      WHERE site_id = ? AND date = ? AND medicine_name = ?
    `).all(secondarySiteId, '2098-03-01', '팩(PAC)');
    const sludgeRestore = await applyRestore(db, testRoot, {
      documents: [{
        date: '2098-03-10',
        documentKey: 'validation-sludge-values',
        flow: [{
          dwrmWeihgInsrCd: '슬러지반출량',
          tdayDrwtMsrmVal: 144,
          drwtProsAmnt: 48,
        }],
        chemicals: [],
      }],
      startDate: '2098-03-10',
      endDate: '2098-03-10',
      siteId: secondarySiteId,
    });
    const sludgeRow = db.prepare(`
      SELECT raw_value, calculated_flow, sludge_export
      FROM flow_readings
      WHERE site_id = ? AND date = ? AND type = '슬러지'
    `).get(secondarySiteId, '2098-03-10');
    const isolatedRows = {
      primary: db.prepare('SELECT COUNT(*) AS count FROM flow_readings WHERE site_id = ? AND date BETWEEN ? AND ?')
        .get(primarySiteId, '2098-02-01', '2098-02-02')?.count || 0,
      secondary: db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE site_id = ? AND date = ? AND type = ?')
        .get(secondarySiteId, '2098-02-01', flowName),
      secondaryGap: db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE site_id = ? AND date = ? AND type = ?')
        .get(secondarySiteId, '2098-02-02', flowName),
    };
    const complemented = {
      leadingFlow: db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE date = ? AND type = ?')
        .get('2097-12-31', flowName),
      flow: db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE date = ? AND type = ?')
        .get('2098-01-02', flowName),
      medicine: db.prepare('SELECT purchase_amount, usage_amount, current_inventory FROM medicine_logs WHERE date = ? AND medicine_name = ?')
        .get('2098-01-02', medicineName),
      kit: db.prepare('SELECT purchase_amount, usage_amount, current_inventory FROM kit_logs WHERE date = ? AND kit_name = ?')
        .get('2098-01-02', kitName),
    };

    const passed = first.verification?.complete
      && first.stats.complementedDates === 2
      && complemented.leadingFlow?.raw_value === 90
      && complemented.leadingFlow?.calculated_flow === 0
      && complemented.flow?.raw_value === 100
      && complemented.flow?.calculated_flow === 0
      && complemented.medicine?.purchase_amount === 0
      && complemented.medicine?.usage_amount === 0
      && complemented.medicine?.current_inventory === 108
      && complemented.kit?.purchase_amount === 0
      && complemented.kit?.usage_amount === 0
      && complemented.kit?.current_inventory === 54
      && second.stats.flowInserted === 0
      && second.stats.medicineInserted === 0
      && second.stats.kitInserted === 0
      && secondary.verification?.complete
      && isolatedRows.primary === 0
      && isolatedRows.secondary?.raw_value === 900
      && isolatedRows.secondaryGap?.raw_value === 900
      && isolatedRows.secondaryGap?.calculated_flow === 0
      && returnFlowTypes.includes('내부반송유량계')
      && returnFlowTypes.includes('외부반송유량계')
      && coagulantRows.length === 1
      && coagulantRows[0]?.purchase_amount === 0
      && coagulantRows[0]?.usage_amount === 7
      && coagulantRows[0]?.current_inventory === 93
      && coagulantOverwrite.stats.sourceRowsOverwritten >= 1
      && sludgeRestore.verification?.complete
      && sludgeRow?.raw_value === 48
      && sludgeRow?.sludge_export === 48
      && sludgeRow?.calculated_flow === 144;

    console.log(JSON.stringify({
      passed,
      testDbPath,
      first,
      second: { stats: second.stats, verification: second.verification },
      secondary: { stats: secondary.stats, verification: secondary.verification, isolatedRows },
      returnFlowTypes,
      coagulant: {
        rows: coagulantRows,
        overwriteStats: coagulantOverwrite.stats,
        verification: coagulantOverwrite.verification,
      },
      sludge: { row: sludgeRow, verification: sludgeRestore.verification },
      complemented,
    }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
