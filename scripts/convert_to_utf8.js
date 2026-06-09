const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// 한글 깨짐 식별용 유틸 (UTF-8 디코딩 시 깨졌을 만한 패턴 검출)
const GARBLED_REGEX = /[^\x00-\x7F가-힣ㄱ-ㅎㅏ-ㅣ\s─—→←⚠️✅❌⚠✓✗ℹ🔍▶║═⭐●│┌┐└┘├┤┬┴┼※≈]/;

function checkAndConvertFile(relativeFilePath) {
  const filePath = path.join(ROOT_DIR, relativeFilePath);
  if (!fs.existsSync(filePath)) return;

  const rawBuffer = fs.readFileSync(filePath);
  
  // 1. 먼저 UTF-8로 디코딩해봅니다.
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let isUtf8 = true;
  try {
    text = utf8Decoder.decode(rawBuffer);
  } catch (err) {
    isUtf8 = false;
  }

  // UTF-8로 정상 디코딩 되었더라도 내부에 깨진 한글 바이트 패턴이 존재하는지 정밀 점검
  if (isUtf8 && !GARBLED_REGEX.test(text)) {
    // 이미 완전하고 올바른 UTF-8 파일이므로 조치 필요 없음
    return;
  }

  // 2. UTF-8이 아니거나 깨진 한글이 존재한다면, EUC-KR(CP949) 인코딩으로 간주하여 재디코딩합니다.
  const eucKrDecoder = new TextDecoder('euc-kr');
  const eucText = eucKrDecoder.decode(rawBuffer);

  // EUC-KR로 디코딩했을 때 깨짐이 없고 올바른 한글이 복구되는지 검사
  const hasGarbledInEuc = GARBLED_REGEX.test(eucText);
  if (!hasGarbledInEuc) {
    console.log(`[CONVERT] ${relativeFilePath} : CP949(EUC-KR) -> UTF-8 Conversion completed.`);
    fs.writeFileSync(filePath, eucText, 'utf8');
    return;
  }

  // 만약 EUC-KR로도 깨진 문자가 여전히 남아있다면, 
  // 원본이 UTF-8로 저장되었지만 깨진 문자 자체가 하드코딩되었던 것이므로 
  // UTF-8로 강제 유지한 상태에서 딕셔너리 치환을 통해 복원해야 합니다.
}

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build' || file === 'release') return;
      scanDir(fullPath);
    } else if (stat.isFile() && /\.(js|jsx|cjs)$/.test(file)) {
      const relativePath = path.relative(ROOT_DIR, fullPath);
      checkAndConvertFile(relativePath);
    }
  });
}

function main() {
  console.log('=== Step 1: Converting CP949(EUC-KR) encoded files to UTF-8 ===');
  scanDir(path.join(ROOT_DIR, 'src'));
  scanDir(path.join(ROOT_DIR, 'server'));
  console.log('=== Conversion Step Completed! ===');
}

main();
