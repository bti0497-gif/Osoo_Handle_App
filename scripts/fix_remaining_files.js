const fs = require('fs');
const path = require('path');

const filesToFix = [
  {
    path: 'server/services/dailyWorkLogService.cjs',
    replacements: [
      { from: /\?좎엯/g, to: '유입' },
      { from: /\?좎엯\?꾩씪/g, to: '유입전일' },
      { from: /\?좎엯\?꾧퀎/g, to: '유입누계' },
      { from: /\?붽컙\?좎엯/g, to: '월간유입' },
      { from: /\?곌컙\?좎엯/g, to: '연간유입' },
      { from: /\?몃??꾧퀎/g, to: '외부누계' },
      { from: /\?붽컙슬러지/g, to: '월간슬러지' },
      { from: /\?곌컙슬러지/g, to: '연간슬러지' },
      { from: /\?꾨젰/g, to: '전력' },
      { from: /\?꾩씪\?꾨젰/g, to: '전일전력' },
      { from: /\?섏쭏/g, to: '수질' },
      { from: /\?섏삩/g, to: '수온' },
      { from: /\?곗냼/g, to: '산소' },
      { from: /\?€\?€/g, to: '것은' },
      { from: /\?먿낯\s+\?쒗듃/g, to: '원본 시트' },
      { from: /\?먿낯\s+\?쒗듃\s+XML\s+\?쎄린/g, to: '원본 시트 XML 읽기' },
      { from: /name\s+\?\?rId/g, to: 'name → rId' },
      { from: /rId\s+\?\?target\s+path/g, to: 'rId → target path' },
      { from: /\?곸슜\s+완료/g, to: '적용 완료' }
    ]
  },
  {
    path: 'server/services/hwpPdfService.cjs',
    replacements: [
      { from: /형태\?\?\?\?뚮젅\?댁뒪\?€\?붾\?/g, to: '형태의 플레이스홀더를' }
    ]
  },
  {
    path: 'server/scripts/migrateAttendanceMemberIdString.cjs',
    replacements: [
      { from: /\?€\?낆씠誘€濡\?/g, to: '타입이므로' },
      { from: /諛섏쁺\?€/g, to: '반영은' },
      { from: /\?섏꽭\?\?/g, to: '하세요' }
    ]
  },
  {
    path: 'server/scripts/normalizeMemberIds.cjs',
    replacements: [
      { from: /\?뚯썝\s+ID\s+\?뺢퇋\?붾\?/g, to: '회원 ID 정규화를' },
      { from: /\?€\?\?\?\?뚯썝:/g, to: '대상 회원:' },
      { from: /諛섏쁺\?€/g, to: '반영은' },
      { from: /\?섏꽭\?\?/g, to: '하세요' },
      { from: /\?곸슜\s+완료/g, to: '적용 완료' }
    ]
  }
];

function applyFixes() {
  console.log('=== Applying Safe Character Replacements ===');
  for (const file of filesToFix) {
    const fullPath = path.resolve(__dirname, '..', file.path);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[WARN] File not found: ${file.path}`);
      continue;
    }
    
    let content = fs.readFileSync(fullPath, 'utf8');
    let changed = false;
    
    for (const rep of file.replacements) {
      if (rep.from.test(content)) {
        content = content.replace(rep.from, rep.to);
        changed = true;
      }
    }
    
    if (changed) {
      fs.writeFileSync(fullPath, content, 'utf8');
      console.log(`[SUCCESS] Restored Korean characters in: ${file.path}`);
    } else {
      console.log(`[NO CHANGE] Already clean or no matches in: ${file.path}`);
    }
  }
}

applyFixes();
