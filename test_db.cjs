const dbObj = require('./server/database.cjs'); console.log(dbObj.db.prepare('SELECT log_mappings FROM app_settings WHERE id = 1').get());
