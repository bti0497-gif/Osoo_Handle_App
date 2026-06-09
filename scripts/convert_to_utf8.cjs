const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function checkAndConvertFile(relativeFilePath) {
  const filePath = path.join(ROOT_DIR, relativeFilePath);
  if (!fs.existsSync(filePath)) return;

  const rawBuffer = fs.readFileSync(filePath);
  
  // 1. UTF-8로 검증 디코딩 (fatal: true 로 올바르지 않은 UTF-8 바이트 시퀀스 감지)
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let isUtf8 = true;
  try {
    text = utf8Decoder.decode(rawBuffer);
  } catch (err) {
    isUtf8 = false;
  }

  // 2. 만약 UTF-8이 아니거나 에러가 났다면 CP949(EUC-KR)로 읽은 후 UTF-8로 변환 저장
  if (!isUtf8) {
    const eucKrDecoder = new TextDecoder('euc-kr');
    const eucText = eucKrDecoder.decode(rawBuffer);
    console.log(`[CONVERT] ${relativeFilePath} : UTF-8 Invalid detection, converting from CP949/EUC-KR to UTF-8`);
    fs.writeFileSync(filePath, eucText, 'utf8');
  }
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
  console.log('=== Step 1: Converting non-UTF8 encoded files to UTF-8 ===');
  scanDir(path.join(ROOT_DIR, 'src'));
  scanDir(path.join(ROOT_DIR, 'server'));
  console.log('=== Conversion Step Completed! ===');
}

main();
