const { db } = require('./server/database.cjs');

console.log('--- [config_items] Flow Categories ---');
const configs = db.prepare("SELECT * FROM config_items WHERE category = 'flow'").all();
console.log(JSON.stringify(configs, null, 2));

console.log('\n--- [flow_readings] Sample Data (Latest 20) ---');
const readings = db.prepare("SELECT * FROM flow_readings ORDER BY date DESC, id DESC LIMIT 20").all();
console.log(JSON.stringify(readings, null, 2));

process.exit(0);
