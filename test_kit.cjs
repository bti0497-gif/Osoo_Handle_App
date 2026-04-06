const dbObj = require('./server/database.cjs'); console.log(dbObj.db.prepare('SELECT * FROM config_items WHERE category=\'kit\'').all());
