const sqlite3 = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const appDataPath = path.join(process.env.APPDATA, 'Osoo_Handle_App');
const dbPath = path.join(appDataPath, 'osoo.db');

try {
    const db = new sqlite3(dbPath, { readonly: true });
    console.log(`DB Path: ${dbPath}`);

    const settings = db.prepare("SELECT * FROM app_settings").all();
    console.log("\n--- Settings ---");
    console.log(settings);

    const flowMappings = db.prepare("SELECT * FROM config_items WHERE category = 'flow'").all();
    console.log("\n--- Flow Mappings ---");
    console.log(flowMappings);

} catch (err) {
    console.error("Error reading DB:", err);
}
