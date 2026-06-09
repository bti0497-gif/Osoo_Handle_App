const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const GARBLED_RESULTS_PATH = path.resolve('C:\\Users\\ASUS\\.gemini\\antigravity-ide\\brain\\c42524f3-028c-4494-8905-83a2f57b94a2\\scratch\\garbled_results.json');
const PAST_COMMIT = 'f9714e1';

// 한글 깨짐 1대1 매핑 딕셔너리 (코드 유사성 매칭 실패 시 폴백용)
const GARBLED_DICT = {
  // 기본 단어들
  '수질분석일지': '수질분석일지',
  '수질분석': '수질분석',
  '사진관리': '사진관리',
  '?쏀뭹?낃퀬?쇱?_': '약품입고일지_',
  '?쏀뭹?낃퀬': '약품입고',
  '슬러지': '슬러지',
  '?곗씠?': '데이터',
  '?뚯씪??': '파일을',
  '?놁뒿?덈떎': '없습니다',
  '잘못된 요청입니다.': '잘못된 요청입니다.',
  '이름 또는 비밀번호가 일치하지 않습니다.': '이름 또는 비밀번호가 일치하지 않습니다.',
  '?깆쟻??': '성적서',
  '?낅줈??': '업로드',
  '?좎쭨': '날짜',
  '?쒖옉': '시작',
  '?뺤떇': '형식',
  '사용자': '사용자',
  '설정': '설정',
  '무효': '무효',
  '캐시': '캐시',
  '로그인에': '로그인에',
  '?숆린??': '동기화',
  '?꾩옣': '현장',
  '?깆쟻?쒕?': '성적서를',
  '조회': '조회',
  '권한': '권한',
  '?놁쓬': '없음',
  '?섏젙': '수정',
  '??젣': '삭제',
  '?볤?': '댓글',
  '?묒꽦': '작성',
  '?대씪?댁뼵??': '클라이언트',
  '브라우저': '브라우저',
  '?덉슜': '허용',
  '출근': '출근',
  '?대렐': '퇴근',
  '출결': '출결',
  '목록': '목록',
  '?뺤긽': '정상',
  '?깆쟻?쒕뒗': '성적서는',
  '성적서ID媛€': '성적서 ID가',
  '필요합니다.': '필요합니다.',
  '?낅줈???뚯씪???놁뒿?덈떎.': '업로드할 파일이 없습니다.',
  '파일명': '파일명',
  '올바르지': '올바르지',
  '?뺤텞': '압축',
  '?댁꽍': '해석',
  '추출': '추출',
  '결과': '결과',
  '이미지': '이미지',
  '?낅줈?쒓가': '업로드가',
  '예외 발생': '예외 발생',
  '?묒떇': '양식',
  '?대낫?닿린': '미리보기',
  '미리보기???ㅽ뙣?덉뒿?덈떎': '미리보기에 실패했습니다',
  '개의': '개의',
  '?댁뿀?듬땲??': '열었습니다',
  '이름 또는 비밀번호가 일치하지 않습니다': '이름 또는 비밀번호가 일치하지 않습니다',
  '찾을 수 없습니다': '찾을 수 없습니다',
  '시작?쇱? 醫낅즺?쇰낫????쓣 ??없습니다': '시작일은 종료일보다 클 수 없습니다',
  '날짜 형식??올바르지 않습니다': '날짜 형식이 올바르지 않습니다',
  '날짜?€ ??ぉ??필요합니다.': '날짜와 항목이 필요합니다'
};

// 깨진 글자인지 판단하는 정규식
const GARBLED_REGEX = /[^\x00-\x7F가-힣\s]/; // ASCII와 정상 한글, 공백을 제외한 문자가 있으면 깨진 한글이 포함된 것으로 간주

// 두 문자열에서 영문/숫자/특수기호만 추출하여 비교하는 헬퍼 함수
function getCodeStructure(str) {
  return str.replace(/[가-힣]/g, '').replace(/[^\x00-\x7F]/g, '').replace(/\s+/g, '');
}

// 간단한 레벤슈타인 거리 계산 (코드 구조의 유사성 판별용)
function getLevenshteinDistance(a, b) {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp.push([i]);
  }
  for (j = 0; j <= b.length; j++) {
    tmp[0][j] = j;
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

// 코드 구조 유사도 (0 ~ 1)
function getSimilarity(a, b) {
  const structA = getCodeStructure(a);
  const structB = getCodeStructure(b);
  if (!structA && !structB) return 1.0;
  if (!structA || !structB) return 0.0;
  const distance = getLevenshteinDistance(structA, structB);
  const maxLength = Math.max(structA.length, structB.length);
  return (maxLength - distance) / maxLength;
}

// 과거 파일에서 가장 유사한 줄을 찾는 함수
function findMatchingLine(currentLine, pastLines, targetIndex, windowSize = 30) {
  const start = Math.max(0, targetIndex - windowSize);
  const end = Math.min(pastLines.length - 1, targetIndex + windowSize);
  
  let bestIndex = -1;
  let bestSim = 0;
  
  for (let i = start; i <= end; i++) {
    const sim = getSimilarity(currentLine, pastLines[i]);
    if (sim > bestSim) {
      bestSim = sim;
      bestIndex = i;
    }
  }
  
  if (bestSim >= 0.85) {
    return pastLines[bestIndex];
  }
  return null;
}

// 한글 텍스트(한글 + 공백 + 일부 특수기호)만 추출하는 함수
function extractKoreanParts(str) {
  // 한글(가-힣)과 공백, 숫자가 섞인 패턴 매칭
  const matches = str.match(/[가-힣\s0-9().,?!~]+/g) || [];
  return matches.map(m => m.trim()).filter(m => m.length > 0);
}

// 복구 메인 로직
function restoreFile(relativeFilePath, dryRun = true) {
  const filePath = path.join(ROOT_DIR, relativeFilePath);
  if (!fs.existsSync(filePath)) {
    console.log(`[PASS] File does not exist: ${relativeFilePath}`);
    return { success: false, reason: 'File not found' };
  }

  const currentContent = fs.readFileSync(filePath, 'utf8');
  const currentLines = currentContent.split('\n');
  
  let pastLines = [];
  try {
    const pastContent = execSync(`git show ${PAST_COMMIT}:${relativeFilePath.replace(/\\/g, '/')}`, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'] // stderr 무시
    });
    pastLines = pastContent.split('\n');
  } catch (err) {
    // 과거 커밋에 파일이 없는 경우
    console.log(`[INFO] Past version not found for: ${relativeFilePath} (Using dictionary only)`);
  }

  let restoredLinesCount = 0;
  let dictionaryFallbackCount = 0;
  const newLines = currentLines.map((line, idx) => {
    // 깨진 글자가 없으면 그대로 반환
    if (!GARBLED_REGEX.test(line)) {
      return line;
    }

    // 1. 과거 파일에서 코드 구조 매칭 시도
    if (pastLines.length > 0) {
      const matchedLine = findMatchingLine(line, pastLines, idx);
      if (matchedLine) {
        // 과거 라인에서 정상 한글 영역을 추출
        const pastKoreans = extractKoreanParts(matchedLine);
        // 현재 라인에서 깨진 영역을 찾아 치환하거나 통째로 교체 시도
        // 코드 구조가 95% 이상으로 아주 일치하면 통째로 교체하는 것이 가장 안전
        const sim = getSimilarity(line, matchedLine);
        if (sim >= 0.95) {
          restoredLinesCount++;
          return matchedLine; // 코드 구조가 거의 완벽히 같으므로 통째로 과거 라인으로 교체
        }
      }
    }

    // 2. 매칭 실패 시, 매핑 딕셔너리로 단어 치환 시도
    let newLine = line;
    let replaced = false;
    for (const [garbled, normal] of Object.entries(GARBLED_DICT)) {
      if (newLine.includes(garbled)) {
        newLine = newLine.split(garbled).join(normal);
        replaced = true;
      }
    }

    if (replaced) {
      dictionaryFallbackCount++;
      return newLine;
    }

    return line; // 복구 실패 시 일단 현행 유지
  });

  const newContent = newLines.join('\n');
  const isChanged = newContent !== currentContent;

  if (isChanged && !dryRun) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }

  return {
    success: true,
    isChanged,
    restoredLinesCount,
    dictionaryFallbackCount
  };
}

// 메인 실행
function main() {
  const dryRun = process.argv.includes('--apply') ? false : true;
  console.log(`=== Restoring Korean Characters (DryRun: ${dryRun}) ===`);
  
  if (!fs.existsSync(GARBLED_RESULTS_PATH)) {
    console.error(`Garbled results not found at: ${GARBLED_RESULTS_PATH}`);
    process.exit(1);
  }

  const garbledResults = JSON.parse(fs.readFileSync(GARBLED_RESULTS_PATH, 'utf8'));
  const files = Object.keys(garbledResults);
  
  let totalChangedFiles = 0;
  let totalRestoredLines = 0;
  let totalDictFallbacks = 0;

  files.forEach((file) => {
    // release 폴더나 빌드 출력에 있는 파일들은 제외 (소스코드만 복구)
    if (file.startsWith('release') || file.startsWith('dist') || file.startsWith('build')) {
      return;
    }

    // 윈도우 경로를 표준화
    const standardizedPath = file.replace(/\\/g, '/');
    const res = restoreFile(standardizedPath, dryRun);
    
    if (res.success && res.isChanged) {
      totalChangedFiles++;
      totalRestoredLines += res.restoredLinesCount;
      totalDictFallbacks += res.dictionaryFallbackCount;
      console.log(`[MODIFIED] ${standardizedPath} (Struct matches: ${res.restoredLinesCount}, Dict matches: ${res.dictionaryFallbackCount})`);
    }
  });

  console.log('==================================================');
  console.log(`Summary:`);
  console.log(` - Total Changed Files: ${totalChangedFiles}`);
  console.log(` - Total Line Level Restores: ${totalRestoredLines}`);
  console.log(` - Total Dictionary Fallbacks: ${totalDictFallbacks}`);
  console.log(`==================================================`);
  
  if (dryRun) {
    console.log(`To apply changes, run: node restore_korean.js --apply`);
  } else {
    console.log(`Changes successfully applied!`);
  }
}

main();
