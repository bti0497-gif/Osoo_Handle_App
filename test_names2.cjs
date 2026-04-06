const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const dbObj = require('./server/database.cjs'); 
async function run() { 
  const p = path.join(dbObj.appDataPath, 'templates', 'excel-originals', '청주운영일지(2025년도-) -신규 (1).xlsm');
  if (!fs.existsSync(p)) return console.log('not exists');
  const workbook = xlsx.readFile(p);
  const names = workbook.Workbook && workbook.Workbook.Names ? workbook.Workbook.Names : [];
  const regex = /NH3|암모|전력|1m3/i; 
  const filtered = names.filter(n => regex.test(n.Name)); 
  console.log('Defined Names count:', names.length);
  filtered.forEach(k => console.log(k.Name, '=>', k.Ref));
} 
run().catch(console.error);
