const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { applyRestore } = require('../server/services/settings/roadworkHistoryRestoreService.cjs');

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
        flow: [{ insrIdntIdText: flowName, tdayDrwtMsrmVal: 100, drwtProsAmnt: 10 }],
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

    const first = await applyRestore(db, testRoot, { documents });
    const second = await applyRestore(db, testRoot, { documents });
    const complemented = {
      flow: db.prepare('SELECT raw_value, calculated_flow FROM flow_readings WHERE date = ? AND type = ?')
        .get('2098-01-02', flowName),
      medicine: db.prepare('SELECT purchase_amount, usage_amount, current_inventory FROM medicine_logs WHERE date = ? AND medicine_name = ?')
        .get('2098-01-02', medicineName),
      kit: db.prepare('SELECT purchase_amount, usage_amount, current_inventory FROM kit_logs WHERE date = ? AND kit_name = ?')
        .get('2098-01-02', kitName),
    };

    const passed = first.verification?.complete
      && first.stats.complementedDates === 1
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
      && second.stats.kitInserted === 0;

    console.log(JSON.stringify({
      passed,
      testDbPath,
      first,
      second: { stats: second.stats, verification: second.verification },
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
