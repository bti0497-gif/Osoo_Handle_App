const sqlite3 = require('better-sqlite3');
const path = require('path');

const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
const dbPath = path.join(appDataPath, 'osoo.db');

try {
    const db = new sqlite3(dbPath, { readonly: true });
    console.log(`DB Path: ${dbPath}`);

    const sheets = db.prepare("SELECT * FROM excel_sheets").all();
    console.log("\n--- Excel Sheets (Imported) ---");
    console.log(sheets);

    const dataCount = db.prepare("SELECT COUNT(*) AS count FROM excel_raw_data").get();
    console.log("\n--- Excel Raw Data Row Count ---");
    console.log(dataCount);

    const flowReadingsCount = db.prepare("SELECT COUNT(*) AS count FROM flow_readings").get();
    console.log("\n--- Flow Readings Count ---");
    console.log(flowReadingsCount);

} catch (err) {
    console.error("Error reading DB:", err);
}
