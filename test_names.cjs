const ExcelJS = require('exceljs'); 
const path = require('path');
const dbObj = require('./server/database.cjs'); 
async function run() { 
  const p = path.join(dbObj.appDataPath, 'templates', 'excel-originals', '청주운영일지(2025년도-) -신규 (1).xlsm');
  const workbook = new ExcelJS.Workbook(); 
  await workbook.xlsx.readFile(p); 
  const regex = /NH3|암모|전력|1m3/; 
  const ranges = workbook.definedNames.ranges;
  const filtered = Object.keys(ranges).filter(k => regex.test(k)); 
  console.log('Defined Names for NH3 and Power:');
  filtered.forEach(k => console.log(k, '->', ranges[k])); 
} 
run().catch(console.error);
