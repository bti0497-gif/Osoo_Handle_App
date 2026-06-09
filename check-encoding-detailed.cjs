const fs = require('fs');
const path = require('path');

function checkEncoding(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Check for BOM
    const hasBOM = buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;
    
    // Check for garbled Korean patterns
    const garbledCount = (content.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F\uFFFD]/g) || []).length;
    
    // Count Korean characters
    const koreanCount = (content.match(/[\uAC00-\uD7AF\u3131-\u318E\uA960-\uA97C]/g) || []).length;
    
    return {
      file: path.basename(filePath),
      hasBOM,
      size: buffer.length,
      garbled: garbledCount,
      korean: koreanCount,
      status: hasBOM ? 'WARN-BOM' : garbledCount > 0 ? 'ERROR-GARBLED' : 'OK'
    };
  } catch (e) {
    return { 
      file: path.basename(filePath), 
      status: 'ERROR-READ', 
      error: e.message 
    };
  }
}

const baseDir = 'src/features/settings';
const dirs = ['panels', 'widgets', 'hooks'];
const results = [];

for (const dir of dirs) {
  const fullPath = path.join(baseDir, dir);
  if (fs.existsSync(fullPath)) {
    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.jsx') || f.endsWith('.js'));
    for (const f of files) {
      const result = checkEncoding(path.join(fullPath, f));
      results.push({ category: dir, ...result });
    }
  }
}

// Also check server services
const serverPath = 'server/services/settings';
if (fs.existsSync(serverPath)) {
  const files = fs.readdirSync(serverPath).filter(f => f.endsWith('.cjs'));
  for (const f of files) {
    const result = checkEncoding(path.join(serverPath, f));
    results.push({ category: 'services', ...result });
  }
}

// Print summary
console.log('\n=== ENCODING VALIDATION REPORT ===\n');
console.log('Total files checked:', results.length);

const byStatus = {};
results.forEach(r => {
  const status = r.status;
  if (!byStatus[status]) byStatus[status] = [];
  byStatus[status].push(r);
});

for (const [status, items] of Object.entries(byStatus)) {
  console.log(`\n${status}: ${items.length} files`);
  items.slice(0, 5).forEach(item => {
    const info = `  ${item.category}/${item.file} (korean:${item.korean||0}, garbled:${item.garbled||0}, bom:${item.hasBOM})`;
    console.log(info);
  });
  if (items.length > 5) {
    console.log(`  ... and ${items.length - 5} more`);
  }
}

// Write full report
const report = JSON.stringify(results, null, 2);
fs.writeFileSync('encoding-check-report.json', report);
console.log('\nFull report saved to: encoding-check-report.json');
