const express = require('express');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const router = express.Router();

module.exports = function(db, baseDir) {
  router.get('/api/logs/generate-excel', async (req, res) => {
    const { date, templateName } = req.query;
    const mappingPath = path.join(baseDir, 'templates', 'mapping.json');
    const templatePath = path.join(baseDir, 'templates', templateName);

    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ error: 'Template file not found' });
    }

    try {
      const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(templatePath);
      const worksheet = workbook.worksheets[0];

      const flows = db.prepare('SELECT * FROM flow_readings WHERE date = ?').all(date);
      const medicines = db.prepare('SELECT * FROM medicine_logs WHERE date = ?').all(date);

      const getDataValue = (fieldName) => {
        if (fieldName === 'date') return date;
        const flowMatch = fieldName.match(/^flow_(\w+)_(\w+)$/);
        if (flowMatch) {
          const [, type, valType] = flowMatch;
          const r = flows.find(f => f.type === type);
          return r ? (valType === 'raw' ? r.raw_value : r.calculated_flow) : '';
        }
        const medMatch = fieldName.match(/^medicine_(\w+)_(\w+)$/);
        if (medMatch) {
          const [, name, valType] = medMatch;
          const m = medicines.find(med => med.medicine_name.includes(name));
          return m ? m[valType === 'usage' ? 'usage_amount' : 'purchase_amount'] : '';
        }
        return '';
      };

      const excelMapping = mapping.excel || {};
      for (const [cellAddr, config] of Object.entries(excelMapping)) {
        const field = typeof config === 'string' ? config : config.field;
        const type = typeof config === 'string' ? 'text' : config.type;
        if (type === 'text' || type === 'number') {
          worksheet.getCell(cellAddr).value = getDataValue(field);
        } else if (type === 'image') {
          const imagePath = path.join(baseDir, 'resources', 'images', date, `${field}.jpg`);
          if (fs.existsSync(imagePath)) {
            const imgId = workbook.addImage({ filename: imagePath, extension: 'jpeg' });
            worksheet.addImage(imgId, {
              tl: { col: worksheet.getCell(cellAddr).col - 1, row: worksheet.getCell(cellAddr).row - 1 },
              ext: { width: config.width || 200, height: config.height || 150 }
            });
          }
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=Log_${date}.xlsx`);
      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      res.status(500).json({ error: 'Excel generation failed: ' + err.message });
    }
  });

  return router;
};
