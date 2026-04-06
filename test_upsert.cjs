const dbObj = require('./server/database.cjs'); 
try { 
  dbObj.db.prepare('INSERT INTO water_quality (date, measurement_group, location) VALUES (\'2025-01-01\', \'test\', \'test\') ON CONFLICT(date, measurement_group, location) DO UPDATE SET is_synced=0').run(); 
  console.log('SUCCESS'); 
} catch (e) { 
  console.error('ERROR:', e.message); 
}
