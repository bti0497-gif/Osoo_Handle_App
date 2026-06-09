const fs = require('fs');
const path = require('path');

const repairPlan = {
  'server/routes/authRoutes.cjs': {
    31: '// 현재 날짜 KST 기준으로 구하기 (YYYY-MM-DD)',
    267: '    // 1. 로컬 로그인',
    276: '        // 온라인 첫 로그인/정상 로그인 시 로컬 캐시 갱신',
    285: "                console.warn('[auth/local-login] 성적서 캐시 동기화 실패(sheets):', syncErr.message);",
    291: '                    // 시트 조회 실패(네트워크/권한 오류) 시 로컬 캐시로 자동 fallback',
    292: "                    console.warn('[auth/local-login] Sheets 조회 실패, 로컬 캐시 로그인으로 fallback:', sheetErr.message);",
    363: '    // 3. 활성 세션(진행 중인 출근 기록) 찾기',
    375: '    // 3b. 일자별 출결 목록 (로컬 SQLite)',
    400: '            // 이미 활성 세션이 있는지 확인',
    432: '    // 5. 퇴근 처리',
    451: '    // 6. 로컬에 저장된 미동기화 출결 기록 목록 반환',
    461: '    // 7. 동기화 완료 마킹',
    475: '    // 8. 출결 기록 → BigQuery 동기화',
    498: '    // 9. 회원 목록 조회 (Google Sheets)',
    502: "                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });",
    516: "                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });",
    525: '    // 11. 회원 삭제 (Google Sheets)',
    530: "                return res.status(400).json({ success: false, error: 'Google Sheets가 설정되지 않았습니다.' });",
    537: "                return res.status(404).json({ success: false, error: '대상 회원을 찾을 수 없습니다.' });",
    541: "                return res.status(400).json({ success: false, error: '최고관리자(admin) 계정은 삭제할 수 없습니다.' });"
  },
  'server/routes/facilityRoutes.cjs': {
    50: '  // 수정',
    68: '  // 삭제'
  },
  'server/services/bigQuerySyncService.cjs': {
    28: '  // TODO(site-id): 차기 다중현장 전환 시 activeSiteId 컨텍스트를 받아',
    29: '  // row.site_id가 비어있는 legacy 데이터도 site 단위로 강제 분리 전송한다.',
    73: '// 4. 테이블별 매핑 정의 (Local DB Row -> BigQuery Row)',
    189: '// 5. 단일 테이블 동기화 함수',
    200: "  // 5-1. 동기화 '진행 중' (is_synced = 2)으로 상태 변경",
    207: "  // 5-2. '진행 중' 상태의 데이터 조회",
    213: '  // 5-3. 데이터 변환',
    220: '  // NDJSON 임시 파일 생성',
    225: "    console.error(`[BigQuery] ${tableName} 임시 파일 쓰기 실패:`, writeErr.message);",
    232: '    // 5-4. BigQuery 전송 (Load Job - 로컬 파일 업로드)',
    238: '    // 임시 파일 삭제',
    241: '    // job 오류 확인 (job은 완료된 job metadata 객체)',
    247: "    // 5-5. 로컬 상태 '완료' (is_synced = 1)로 업데이트",
    257: '    // 임시 파일 삭제',
    260: "    // 5-6. 실패 시 로컬 상태 '대기' (is_synced = 0)로 롤백",
    273: '// 6. 전체 테이블 동기화 함수 (스케줄러에서 호출)',
    277: "    // 서버 시작 시 '진행 중' 상태(is_synced=2)로 남아있는 레코드가 있다면",
    278: "    // 이전 동기화가 비정상 종료된 것이므로, 다시 '대기' 상태(is_synced=0)로 되돌려 재시도 유도"
  },
  'server/scripts/migrateAttendanceMemberIdString.cjs': {
    60: "    console.log('이미 STRING 타입이므로 마이그레이션을 진행할 필요가 없습니다.');"
  },
  'server/scripts/normalizeMemberIds.cjs': {
    61: "  console.log('UUID 전환 대상 회원:');"
  },
  'server/index.cjs': {
    121: ' * resolveArgs는 routeRegistry의 args 문자열 배열을 실제 ctx 값으로 매핑합니다.',
    240: '  // --- BigQuery 스케줄러 ---'
  }
};

function runRepair() {
  console.log('=== Starting Line-Based Character Repair ===');
  for (const [relPath, lineMap] of Object.entries(repairPlan)) {
    const fullPath = path.resolve(__dirname, '..', relPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`[WARN] File not found: ${relPath}`);
      continue;
    }
    
    let fileContent = fs.readFileSync(fullPath, 'utf8');
    // CRLF와 LF 혼용 처리
    const hasCRLF = fileContent.includes('\r\n');
    const lines = fileContent.split(/\r?\n/);
    let changed = false;
    
    for (const [lineNumStr, replacement] of Object.entries(lineMap)) {
      const lineIdx = parseInt(lineNumStr) - 1;
      if (lineIdx >= 0 && lineIdx < lines.length) {
        const originalLine = lines[lineIdx];
        // 안전 장치: 원래 줄에 깨짐을 암시하는 물음표(?) 또는 외계어가 섞여 있는지 간단히 검증
        if (originalLine.includes('?') || originalLine.includes('濡') || originalLine.includes('議') || originalLine.includes('?')) {
          lines[lineIdx] = replacement;
          changed = true;
          console.log(`[REPLACED] ${relPath} Line ${lineNumStr}: "${originalLine.trim()}" -> "${replacement.trim()}"`);
        } else {
          console.log(`[SKIP] ${relPath} Line ${lineNumStr} seems already restored: "${originalLine.trim()}"`);
        }
      }
    }
    
    if (changed) {
      fs.writeFileSync(fullPath, lines.join(hasCRLF ? '\r\n' : '\n'), 'utf8');
      console.log(`[SUCCESS] File saved: ${relPath}\n`);
    } else {
      console.log(`[NO CHANGE] File is clean: ${relPath}\n`);
    }
  }
}

runRepair();
