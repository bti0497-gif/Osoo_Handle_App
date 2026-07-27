const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const WIDTH = 1600;
const HEIGHT = 1000;
const OUT_DIR = path.join(__dirname, '..', 'docs', 'field-user-manual-images');

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const text = (x, y, value, size = 30, weight = 600, fill = '#1e293b', anchor = 'start') =>
  `<text x="${x}" y="${y}" font-family="Malgun Gothic, Apple SD Gothic Neo, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;

const multiline = (x, y, lines, size = 27, gap = 48, weight = 600, fill = '#334155') =>
  lines.map((line, index) => text(x, y + index * gap, line, size, weight, fill)).join('');

const rect = (x, y, w, h, fill = '#fff', stroke = '#dbe4ef', radius = 20, strokeWidth = 2) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;

const button = (x, y, w, h, label, active = false) => [
  rect(x, y, w, h, active ? '#1e3a8a' : '#f8fafc', active ? '#1e3a8a' : '#cbd5e1', 13, 2),
  text(x + w / 2, y + h / 2 + 11, label, 27, 800, active ? '#fff' : '#334155', 'middle'),
].join('');

const step = (n, x, y, title, body, color = '#2563eb') => [
  `<circle cx="${x}" cy="${y}" r="34" fill="${color}"/>`,
  text(x, y + 11, n, 30, 900, '#fff', 'middle'),
  text(x + 58, y - 3, title, 30, 900, '#0f172a'),
  text(x + 58, y + 35, body, 23, 600, '#475569'),
].join('');

const arrow = (x1, y1, x2, y2, color = '#94a3b8') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="6" marker-end="url(#arrow)"/>`;

const base = (title, subtitle, body) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.12"/>
    </filter>
    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
      <path d="M0,0 L12,6 L0,12 z" fill="#94a3b8"/>
    </marker>
  </defs>
  <rect width="1600" height="1000" fill="#eef3f8"/>
  <rect x="0" y="0" width="1600" height="150" fill="#0f2f6f"/>
  ${text(70, 72, title, 48, 900, '#fff')}
  ${text(70, 119, subtitle, 25, 600, '#dbeafe')}
  ${body}
  ${text(1530, 965, '오수처리 통합관리시스템 · 현장 사용자 안내', 20, 600, '#64748b', 'end')}
</svg>`;

const cards = [
  {
    file: '01_자동업그레이드.png',
    svg: base('① 자동 업그레이드', '로그인하면 새 버전을 한 번 확인합니다', `
      <g filter="url(#shadow)">${rect(65, 195, 1470, 650, '#fff', '#dbe4ef', 28, 2)}</g>
      ${step('1', 145, 290, '평소처럼 로그인', '로그인 성공 후 새 버전을 자동 확인합니다.')}
      ${arrow(145, 345, 145, 405)}
      ${step('2', 145, 470, '업데이트 창이 나타나면 기다리기', '다운로드 진행률이 100%가 될 때까지 기다립니다.', '#7c3aed')}
      ${arrow(145, 525, 145, 585)}
      ${step('3', 145, 650, '앱 종료 → 설치 → 자동 재실행', 'PC 전원을 끄거나 설치를 취소하지 마세요.', '#ea580c')}
      ${rect(900, 255, 525, 360, '#f8fafc', '#bfdbfe', 22, 3)}
      ${text(1162, 315, '업데이트 진행 화면', 31, 900, '#1e3a8a', 'middle')}
      ${text(945, 385, '새 버전이 검색되어', 28, 800, '#0f172a')}
      ${text(945, 430, '업그레이드를 진행합니다', 28, 800, '#0f172a')}
      ${rect(945, 475, 435, 24, '#e2e8f0', '#e2e8f0', 12, 0)}
      ${rect(945, 475, 325, 24, '#2563eb', '#2563eb', 12, 0)}
      ${text(1162, 550, '다운로드 중... 75%', 25, 700, '#475569', 'middle')}
      ${rect(900, 650, 525, 120, '#fff7ed', '#fdba74', 18, 3)}
      ${text(1162, 700, '주의', 27, 900, '#c2410c', 'middle')}
      ${text(1162, 742, '설치 중에는 PC를 끄지 마세요', 24, 800, '#9a3412', 'middle')}
    `),
  },
  {
    file: '02_통합입력.png',
    svg: base('② 통합 데이터 입력', '날짜 확인 → 탭 선택 → 입력 → 현재 탭 저장', `
      <g filter="url(#shadow)">${rect(55, 185, 1490, 690, '#fff', '#dbe4ef', 28, 2)}</g>
      ${text(95, 245, '통합 데이터 입력', 36, 900, '#0f172a')}
      ${button(1260, 205, 220, 62, '2026-07-27', false)}
      ${button(95, 295, 250, 65, '유량관리', true)}
      ${button(365, 295, 250, 65, '수질분석')}
      ${button(635, 295, 250, 65, '약품관리')}
      ${button(905, 295, 250, 65, '키트관리')}
      ${rect(95, 405, 1010, 330, '#f8fafc', '#dbe4ef', 18, 2)}
      ${text(135, 465, '항목', 25, 800, '#475569')}
      ${text(560, 465, '검침값', 25, 800, '#475569')}
      ${text(850, 465, '사용량', 25, 800, '#475569')}
      ${text(135, 535, '유입유량계', 26, 800, '#1e293b')}
      ${rect(520, 495, 220, 62, '#fff', '#94a3b8', 10, 2)}
      ${text(630, 536, '163,241', 27, 700, '#0f172a', 'middle')}
      ${rect(810, 495, 220, 62, '#eff6ff', '#93c5fd', 10, 2)}
      ${text(920, 536, '69', 27, 800, '#1d4ed8', 'middle')}
      ${text(135, 625, '방류유량계', 26, 800, '#1e293b')}
      ${rect(520, 585, 220, 62, '#fff', '#94a3b8', 10, 2)}
      ${text(630, 626, '202,319', 27, 700, '#0f172a', 'middle')}
      ${rect(810, 585, 220, 62, '#eff6ff', '#93c5fd', 10, 2)}
      ${text(920, 626, '57', 27, 800, '#1d4ed8', 'middle')}
      ${button(1190, 700, 290, 70, '유량관리 저장하기', true)}
      ${step('1', 1220, 380, '날짜 확인', '입력할 날짜가 맞는지 확인')}
      ${step('2', 1220, 485, '탭 선택', '한 번에 한 탭씩 작업', '#7c3aed')}
      ${step('3', 1220, 590, '저장하기', '현재 탭만 저장됨', '#16a34a')}
      ${rect(95, 780, 1010, 58, '#fff7ed', '#fdba74', 12, 2)}
      ${text(600, 818, '탭을 바꾸기 전에 현재 탭의 저장하기를 꼭 누르세요', 25, 900, '#9a3412', 'middle')}
    `),
  },
  {
    file: '03_일지출력.png',
    svg: base('③ 각종 일지 출력', '날짜를 선택하고 누락을 확인한 뒤 출력합니다', `
      <g filter="url(#shadow)">${rect(55, 185, 1490, 690, '#fff', '#dbe4ef', 28, 2)}</g>
      ${rect(90, 230, 360, 555, '#f8fafc', '#dbe4ef', 18, 2)}
      ${text(270, 285, '2026년 7월', 30, 900, '#0f172a', 'middle')}
      ${text(125, 345, '일  월  화  수  목  금  토', 22, 700, '#64748b')}
      ${multiline(130, 405, ['  5    6    7    8    9   10   11', '12   13   14   15   16   17   18', '19   20   21   22   23   24   25', '26   27   28   29   30   31'], 23, 68, 650)}
      <circle cx="191" cy="609" r="31" fill="#1e3a8a"/>
      ${text(191, 618, '27', 23, 900, '#fff', 'middle')}
      ${text(270, 715, '① 출력할 날짜 선택', 24, 900, '#1e3a8a', 'middle')}
      ${rect(500, 230, 620, 420, '#fff', '#cbd5e1', 18, 2)}
      ${text(540, 285, '일지 현황', 31, 900, '#0f172a')}
      ${text(540, 350, '유량 데이터', 25, 700, '#475569')}
      ${text(1040, 350, '정상', 25, 900, '#15803d', 'end')}
      ${text(540, 410, '약품·키트', 25, 700, '#475569')}
      ${text(1040, 410, '정상', 25, 900, '#15803d', 'end')}
      ${text(540, 470, '수질 데이터', 25, 700, '#475569')}
      ${text(1040, 470, '확인', 25, 900, '#15803d', 'end')}
      ${text(540, 530, '사진', 25, 700, '#475569')}
      ${text(1040, 530, '사진 6개', 25, 900, '#15803d', 'end')}
      ${text(810, 615, '② 누락 표시가 없는지 확인', 24, 900, '#1e3a8a', 'middle')}
      ${button(1180, 270, 290, 65, '한글(HWP)', true)}
      ${button(1180, 355, 290, 65, 'PDF')}
      ${button(1180, 500, 290, 78, '업무일지 출력', true)}
      ${text(1325, 630, '③ 형식 선택 후 출력', 24, 900, '#1e3a8a', 'middle')}
      ${rect(500, 700, 970, 85, '#eff6ff', '#93c5fd', 16, 2)}
      ${text(985, 753, '출력 중에는 완료 메시지가 나올 때까지 기다리세요', 26, 800, '#1e40af', 'middle')}
    `),
  },
  {
    file: '04_사진업로드.png',
    svg: base('④ 사진 업로드', '날짜와 수량을 입력한 뒤 사진을 선택하고 저장합니다', `
      <g filter="url(#shadow)">${rect(55, 185, 1490, 690, '#fff', '#dbe4ef', 28, 2)}</g>
      ${step('1', 135, 280, '날짜 확인', '사진이 저장될 날짜를 먼저 확인합니다.')}
      ${arrow(135, 335, 135, 400)}
      ${step('2', 135, 465, '수량 입력', '반출량 또는 입고량을 입력합니다.', '#7c3aed')}
      ${arrow(135, 520, 135, 585)}
      ${step('3', 135, 650, '사진 선택 후 저장', '사진 있음 또는 장수를 확인합니다.', '#16a34a')}
      ${rect(750, 240, 670, 500, '#f8fafc', '#cbd5e1', 20, 2)}
      ${text(800, 300, '슬러지', 32, 900, '#0f172a')}
      ${text(800, 380, '반출량', 25, 800, '#475569')}
      ${rect(1030, 340, 310, 62, '#fff', '#94a3b8', 10, 2)}
      ${text(1185, 381, '15.5', 27, 700, '#0f172a', 'middle')}
      ${button(800, 455, 250, 66, '반출사진 (3장)', true)}
      ${button(1080, 455, 260, 66, '청소필증', true)}
      ${rect(800, 560, 540, 85, '#ecfdf5', '#86efac', 14, 2)}
      ${text(1070, 614, '✓ 사진이 선택되었습니다', 27, 900, '#15803d', 'middle')}
      ${button(1080, 675, 260, 66, '저장하기', true)}
      ${rect(750, 775, 670, 62, '#fff7ed', '#fdba74', 12, 2)}
      ${text(1085, 817, '사진을 골랐어도 저장하기를 눌러야 완료됩니다', 23, 900, '#9a3412', 'middle')}
    `),
  },
  {
    file: '05_성적서다운로드.png',
    svg: base('⑤ 성적서 다운로드', '미리보기에서 필요한 성적서를 체크해 하나의 PDF로 받습니다', `
      <g filter="url(#shadow)">${rect(55, 185, 1490, 690, '#fff', '#dbe4ef', 28, 2)}</g>
      ${button(90, 225, 180, 58, '목록')}
      ${button(285, 225, 210, 58, '미리보기', true)}
      ${button(1210, 225, 250, 58, '전체 선택')}
      ${rect(90, 330, 390, 365, '#fff', '#cbd5e1', 18, 2)}
      ${rect(115, 355, 340, 230, '#e2e8f0', '#cbd5e1', 10, 1)}
      ${text(285, 470, '성적서 JPG', 27, 800, '#64748b', 'middle')}
      ${rect(115, 615, 34, 34, '#2563eb', '#2563eb', 6, 2)}
      ${text(132, 641, '✓', 27, 900, '#fff', 'middle')}
      ${text(165, 640, '2026년 7월 성적서', 24, 800, '#1e293b')}
      ${rect(520, 330, 390, 365, '#fff', '#cbd5e1', 18, 2)}
      ${rect(545, 355, 340, 230, '#e2e8f0', '#cbd5e1', 10, 1)}
      ${text(715, 470, '성적서 JPG', 27, 800, '#64748b', 'middle')}
      ${rect(545, 615, 34, 34, '#2563eb', '#2563eb', 6, 2)}
      ${text(562, 641, '✓', 27, 900, '#fff', 'middle')}
      ${text(595, 640, '2026년 6월 성적서', 24, 800, '#1e293b')}
      ${rect(950, 330, 390, 365, '#fff', '#cbd5e1', 18, 2)}
      ${rect(975, 355, 340, 230, '#e2e8f0', '#cbd5e1', 10, 1)}
      ${text(1145, 470, '성적서 JPG', 27, 800, '#64748b', 'middle')}
      ${rect(975, 615, 34, 34, '#fff', '#94a3b8', 6, 2)}
      ${text(1025, 640, '2026년 5월 성적서', 24, 800, '#1e293b')}
      ${button(1030, 750, 430, 76, 'PDF 다운로드 (2)', true)}
      ${text(90, 790, '① 필요한 카드 체크', 26, 900, '#1e3a8a')}
      ${text(480, 790, '② 선택 개수 확인', 26, 900, '#1e3a8a')}
      ${text(790, 790, '③ PDF 다운로드', 26, 900, '#1e3a8a')}
    `),
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const card of cards) {
    const outputPath = path.join(OUT_DIR, card.file);
    await sharp(Buffer.from(card.svg)).png({ compressionLevel: 9 }).toFile(outputPath);
    console.log(outputPath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
