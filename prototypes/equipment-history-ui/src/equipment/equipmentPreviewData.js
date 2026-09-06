// 장비이력카드 Phase 1 프리뷰 데이터.
//
// 1) 공법별 기본 설비 목록(시드): 공법은 앱 기본설정(app_settings.method, 'A2O' | 'MBR')에서 지정.
//    다중 대수 장비는 호기 단위 카드(예: 교반기 A / 교반기 B)로 등록해 장비별 이력을 추적한다.
// 2) 설비 카탈로그: '장비 추가' 화면의 체크 목록 원본. 체크하면 목록에 장비가 추가되고,
//    개수 지정형(펌프류/교반기류/브로아류/막분리)은 A, B, C... 호기가 이어서 증가한다.
//    카탈로그에 없는 항목은 직접 입력으로 카탈로그에 추가한 뒤 체크할 수 있다.
//
// Phase 2에서 EquipmentModel이 apiClient 호출로 교체되면 이 파일은 개발 확인용으로만 사용된다.

export const EQUIPMENT_STATUS_OPTIONS = ['사용 중', '점검 필요', '수리 중', '예비', '폐기'];
export const EQUIPMENT_CATEGORY_OPTIONS = ['기계', '전기', '계측기', '기타'];
export const EQUIPMENT_HISTORY_TYPES = ['정기점검', '고장', '수리', '부품교체', '위탁', '기타'];

export const EQUIPMENT_PROCESS_METHODS = [
  { value: 'A2O', label: 'A2O' },
  { value: 'MBR', label: 'MBR' },
];

// 처리 흐름 순서(공정별 보기)와 장비 종류 순서(종류별 보기).
export const EQUIPMENT_PROCESS_ORDER = ['침사조', '유량조정조', '혐기조', '무산소조', '포기조', '막분리조', '침전조', '응집침전조', '방류조'];
export const EQUIPMENT_TYPE_ORDER = ['펌프류', '약품펌프류', '교반기류', '브로아류', '스크린류', '계측기류', '유량계', '감속기', '탱크류', '막분리', '소독기류', '여과기'];

// 기본 카드 생성 헬퍼: 다중 대수는 `${name} ${호기}` / `${관리번호}${호기}` 규칙.
const card = (id, managementNo, category1, category2, name, extras = {}) => {
  const category3 = (category2 === '계측기류' || category2 === '유량계') ? '계측기' : '기계';
  return {
    id,
    managementNo,
    category1,
    category2,
    category3,
    category4: `${category1}${category3 === '계측기' ? '계측기시설' : '기계시설'}`,
    name,
    model: '',
    specification: '',
    unit: '대',
    quantity: 1,
    power: '',
    installedAt: '2020-10',
    vendor: '',
    location: category1,
    accessory: '',
    status: '사용 중',
    notes: '',
    ...extras,
  };
};

const UNITS2 = ['A', 'B'];
const UNITS4 = ['A', 'B', 'C', 'D'];
// 다중 대수 장비: 호기별 카드 생성. statusByUnit으로 특정 호기 상태를 지정할 수 있다.
const unitCards = (prefix, category1, category2, baseName, { managementNoBase, statusByUnit, ...extras }, letters = UNITS2) => letters.map(
  (letter) => card(
    `${prefix}-${letter.toLowerCase()}`,
    `${managementNoBase}${letter}`,
    category1,
    category2,
    `${baseName} ${letter}`,
    { ...extras, status: (statusByUnit && statusByUnit[letter]) || '사용 중' },
  ),
);

// 공통 장비(모든 공법에 포함)
const COMMON_ITEMS = [
  card('seed-m-101', 'M-101', '침사조', '스크린류', '조목스크린', { model: '자동식 조목 스크린', power: '0.75 kW' }),
  card('seed-m-102', 'M-102', '침사조', '스크린류', '드럼스크린', { model: '드럼형 스크린', power: '0.4 kW' }),
  card('seed-flt-101', 'FLT-101', '침사조', '유량계', '파샬플롬유량계', { model: '파샬플롬 + 초음파 수위식', accessory: '지시계 포함', notes: '유입유량 측정' }),
  ...unitCards('seed-m-103', '유량조정조', '교반기류', '교반기', { managementNoBase: 'M-103', model: '수중 교반기', power: '1.5 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards('seed-m-104', '유량조정조', '펌프류', '원수펌프', { managementNoBase: 'M-104', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('seed-flt-102', 'FLT-102', '유량조정조', '유량계', '유입유량계', { model: '전자유량계' }),
  ...unitCards('seed-m-105', '포기조', '브로아류', '포기조브로아', { managementNoBase: 'M-105', model: '루츠 블로어', power: '7.5 kW', location: '송풍기실', accessory: '공기 여과기 포함', notes: '기본 2대 · 추가 시 C, D, E...', statusByUnit: { A: '수리 중' } }),
  ...unitCards('seed-m-106', '포기조', '펌프류', '내부반송펌프', { managementNoBase: 'M-106', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...', statusByUnit: { A: '점검 필요' } }),
  card('seed-flt-103', 'FLT-103', '포기조', '유량계', '내부반송유량계', { model: '전자유량계' }),
  card('seed-do-101', 'DO-101', '포기조', '계측기류', 'DO계', { model: '막전극 용존산소계', specification: '0~20 mg/L' }),
  card('seed-ph-101', 'PH-101', '포기조', '계측기류', 'PH계', { model: '유리전극 pH계', specification: '0~14 pH' }),
  ...unitCards('seed-m-114', '방류조', '펌프류', '방류펌프', { managementNoBase: 'M-114', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards('seed-m-115', '방류조', '펌프류', '중수펌프', { managementNoBase: 'M-115', model: '수중펌프', power: '1.5 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  ...unitCards('seed-m-116', '방류조', '펌프류', '역세펌프', { managementNoBase: 'M-116', model: '수중펌프', power: '1.5 kW', notes: '여과기 역세용 · 기본 2대' }),
  card('seed-m-117', 'M-117', '방류조', '여과기', '여과기', { model: '모래여과기', accessory: '부속 펌프·밸브 포함' }),
  card('seed-m-118', 'M-118', '방류조', '소독기류', 'UV 소독기', { model: '관류식 자외선 소독기', specification: '램프 4식', power: '0.8 kW', accessory: '램프·안정기 포함' }),
];

// A2O 전용: 침전조(감속기·외부반송)와 응집침전조(응집제·폴리머 계열)
const A2O_ONLY_ITEMS = [
  card('seed-m-107', 'M-107', '침전조', '감속기', '감속기', { model: '중심구동 스크래퍼용', power: '0.75 kW', accessory: '스크래퍼 포함' }),
  ...unitCards('seed-m-108', '침전조', '펌프류', '외부반송펌프', { managementNoBase: 'M-108', model: '수중펌프', power: '2.2 kW', notes: '기본 2대 · 추가 시 C, D, E...' }),
  card('seed-flt-104', 'FLT-104', '침전조', '유량계', '외부반송유량계', { model: '전자유량계' }),
  card('seed-m-109', 'M-109', '응집침전조', '감속기', '감속기', { model: '중심구동 스크래퍼용', power: '0.75 kW', accessory: '스크래퍼 포함' }),
  card('seed-m-110', 'M-110', '응집침전조', '탱크류', '응집제탱크', { model: 'PE 저장탱크', unit: '개', location: '약품실' }),
  card('seed-m-111', 'M-111', '응집침전조', '약품펌프류', '응집제 주입펌프', { model: '정량 다이어프램 펌프', power: '0.1 kW', location: '약품실', notes: '예비 포함 시 추가 등록' }),
  card('seed-m-112', 'M-112', '응집침전조', '탱크류', '폴리머탱크', { model: 'PE 저장탱크', unit: '개', location: '약품실', accessory: '교반기 포함' }),
  card('seed-m-113', 'M-113', '응집침전조', '약품펌프류', '폴리머 주입펌프', { model: '정량 다이어프램 펌프', power: '0.1 kW', location: '약품실', notes: '예비 포함 시 추가 등록' }),
];

// MBR 전용: 침전조·외부반송·응집침전 대신 막분리설비
const MBR_ONLY_ITEMS = [
  ...unitCards('seed-m-119', '막분리조', '막분리', '막모듈', { managementNoBase: 'M-119', model: '침지형 평막 모듈', specification: '0.1 um 평막', unit: '식', accessory: '막 지지 프레임 포함', notes: '기본 4식 · 증설 시 추가 등록' }, UNITS4),
  ...unitCards('seed-m-120', '막분리조', '펌프류', '흡인펌프', { managementNoBase: 'M-120', model: '자흡식 원심펌프', power: '1.5 kW', notes: '교대 운전 2대 · 추가 시 C, D, E...' }),
  card('seed-m-121', 'M-121', '막분리조', '펌프류', '막세척펌프', { model: '정량 다이어프램 펌프', power: '0.4 kW', accessory: 'CIP 약액 라인 포함', notes: '화학세척(CIP)용' }),
  card('seed-flt-105', 'FLT-105', '막분리조', '유량계', '막분리유량계', { model: '전자유량계', notes: '처리수 유량 측정' }),
];

export const EQUIPMENT_SEEDS = {
  A2O: [...COMMON_ITEMS, ...A2O_ONLY_ITEMS],
  MBR: [...COMMON_ITEMS, ...MBR_ONLY_ITEMS],
};

// 설비 카탈로그: '장비 추가' 체크 목록.
// supportsCount = 개수 지정형(호기 A, B, C... 증가). methods 미지정은 모든 공법.
export const EQUIPMENT_CATALOG = [
  {
    group: '펌프류',
    supportsCount: true,
    items: [
      { name: '원수펌프', process: '유량조정조' },
      { name: '내부반송펌프', process: '포기조' },
      { name: '외부반송펌프', process: '침전조', methods: ['A2O'] },
      { name: '방류펌프', process: '방류조' },
      { name: '중수펌프', process: '방류조' },
      { name: '역세펌프', process: '방류조' },
      { name: '흡인펌프', process: '막분리조', methods: ['MBR'] },
      { name: '막세척펌프', process: '막분리조', methods: ['MBR'] },
    ],
  },
  {
    group: '교반기류',
    supportsCount: true,
    items: [
      { name: '교반기', process: '유량조정조' },
      { name: '교반기', process: '무산소조' },
      { name: '교반기', process: '혐기조' },
      { name: '교반기', process: '포기조' },
      { name: '교반기', process: '방류조' },
    ],
  },
  {
    group: '브로아류',
    supportsCount: true,
    items: [
      { name: '포기조브로아', process: '포기조' },
      { name: '교반브로아', process: '포기조' },
    ],
  },
  {
    group: '스크린류',
    items: [
      { name: '조목스크린', process: '침사조' },
      { name: '드럼스크린', process: '침사조' },
    ],
  },
  {
    group: '계측기류',
    items: [
      { name: 'DO계', process: '포기조' },
      { name: 'PH계', process: '포기조' },
      { name: 'MLSS계', process: '포기조' },
    ],
  },
  {
    group: '유량계',
    items: [
      { name: '파샬플롬유량계', process: '침사조' },
      { name: '유입유량계', process: '유량조정조' },
      { name: '내부반송유량계', process: '포기조' },
      { name: '외부반송유량계', process: '침전조', methods: ['A2O'] },
      { name: '중수유량계', process: '방류조' },
      { name: '응집이송유량계', process: '응집침전조', methods: ['A2O'] },
      { name: '막분리유량계', process: '막분리조', methods: ['MBR'] },
    ],
  },
  {
    group: '감속기',
    items: [
      { name: '감속기', process: '침전조', methods: ['A2O'] },
      { name: '감속기', process: '응집침전조', methods: ['A2O'] },
    ],
  },
  {
    group: '탱크류',
    items: [
      { name: '응집제탱크', process: '응집침전조', methods: ['A2O'] },
      { name: '폴리머탱크', process: '응집침전조', methods: ['A2O'] },
    ],
  },
  {
    group: '약품펌프류',
    items: [
      { name: '응집제 주입펌프', process: '응집침전조', methods: ['A2O'] },
      { name: '폴리머 주입펌프', process: '응집침전조', methods: ['A2O'] },
    ],
  },
  {
    group: '막분리',
    supportsCount: true,
    items: [
      { name: '막모듈', process: '막분리조', methods: ['MBR'] },
    ],
  },
  {
    group: '소독기류',
    items: [
      { name: 'UV 소독기', process: '방류조' },
    ],
  },
  {
    group: '여과기',
    items: [
      { name: '여과기', process: '방류조' },
    ],
  },
];

const COMMON_HISTORY = [
  {
    id: 'history-1',
    equipmentId: 'seed-m-105-a',
    date: '2026-08-14',
    completedAt: '',
    type: '고장',
    content: 'A호기 운전 중 이상 진동 발생으로 가동 정지',
    company: '',
    contact: '',
    price: 0,
    photoCount: 2,
  },
  {
    id: 'history-2',
    equipmentId: 'seed-m-105-a',
    date: '2026-08-15',
    completedAt: '2026-08-18',
    type: '수리',
    content: 'A호기 베어링 교체 및 진동 측정 후 재가동',
    company: '(주)대영기전',
    contact: '033-342-8890',
    price: 480000,
    photoCount: 5,
  },
  {
    id: 'history-3',
    equipmentId: 'seed-m-105-a',
    date: '2025-08-20',
    completedAt: '2025-08-20',
    type: '위탁',
    content: '연간 정밀검사(진동·절연 측정)',
    company: '(주)한국설비진단',
    contact: '02-861-4400',
    price: 520000,
    photoCount: 0,
  },
  {
    id: 'history-4',
    equipmentId: 'seed-m-106-a',
    date: '2026-06-03',
    completedAt: '2026-06-03',
    type: '부품교체',
    content: 'A호기 기계밀봉(메커니컬실) 교체',
    company: '(주)동원파워펌프',
    contact: '010-4477-2211',
    price: 320000,
    photoCount: 3,
  },
  {
    id: 'history-5',
    equipmentId: 'seed-m-106-a',
    date: '2025-12-09',
    completedAt: '2025-12-09',
    type: '정기점검',
    content: '반기 정기점검: 절연저항 측정, 윤활유 보충',
    company: '',
    contact: '',
    price: 0,
    photoCount: 1,
  },
  {
    id: 'history-6',
    equipmentId: 'seed-m-101',
    date: '2026-04-08',
    completedAt: '2026-04-08',
    type: '정기점검',
    content: '스크린 세정 및 체인 급유, 이물질 제거 상태 점검',
    company: '',
    contact: '',
    price: 0,
    photoCount: 1,
  },
  {
    id: 'history-7',
    equipmentId: 'seed-m-101',
    date: '2026-01-15',
    completedAt: '2026-01-15',
    type: '고장',
    content: '조목 걸림으로 스크린 정지, 수동 제거 후 재가동',
    company: '',
    contact: '',
    price: 0,
    photoCount: 2,
  },
  {
    id: 'history-8',
    equipmentId: 'seed-m-114-a',
    date: '2026-05-21',
    completedAt: '2026-05-21',
    type: '위탁',
    content: 'A호기 연간 정밀검사(진동·절연 측정)',
    company: '(주)한국설비진단',
    contact: '02-861-4400',
    price: 550000,
    photoCount: 0,
  },
  {
    id: 'history-9',
    equipmentId: 'seed-m-118',
    date: '2026-07-12',
    completedAt: '2026-07-13',
    type: '부품교체',
    content: 'UV 램프 4식 및 석영관 세정 교체',
    company: '그린수처리',
    contact: '010-8812-6655',
    price: 760000,
    photoCount: 4,
  },
  {
    id: 'history-10',
    equipmentId: 'seed-flt-101',
    date: '2026-04-08',
    completedAt: '2026-04-08',
    type: '정기점검',
    content: '파샬플롬 수위 센서 세정 및 지시값 대조',
    company: '',
    contact: '',
    price: 0,
    photoCount: 1,
  },
];

const MBR_ONLY_HISTORY = [
  {
    id: 'history-mbr-1',
    equipmentId: 'seed-m-119-a',
    date: '2026-06-20',
    completedAt: '2026-06-20',
    type: '위탁',
    content: '막 화학세척(CIP) 및 차압 점검',
    company: '(주)코아텍워터',
    contact: '02-555-1234',
    price: 640000,
    photoCount: 3,
  },
  {
    id: 'history-mbr-2',
    equipmentId: 'seed-m-120-a',
    date: '2026-03-11',
    completedAt: '2026-03-11',
    type: '부품교체',
    content: 'A호기 흡인펌프 기계밀봉 교체',
    company: '',
    contact: '',
    price: 180000,
    photoCount: 2,
  },
];

export const EQUIPMENT_HISTORY_SEEDS = {
  A2O: COMMON_HISTORY,
  MBR: [...COMMON_HISTORY, ...MBR_ONLY_HISTORY],
};

// 업무사진관리(work_records) 프리뷰. 날짜별 하루 1건 계약과 동일하게 날짜를 둔다.
const COMMON_WORK_RECORDS = [
  {
    id: 'work-1',
    date: '2026-08-28',
    title: '방류펌프 소음 점검 및 사진 기록',
    content: '운전 소음 측정과 커플링 상태를 확인했다.',
    photoCount: 3,
    equipmentIds: ['seed-m-114-a'],
  },
  {
    id: 'work-2',
    date: '2026-08-15',
    title: '포기조브로아 베어링 교체 작업',
    content: 'A호기 베어링 교체 작업 과정 사진.',
    photoCount: 5,
    equipmentIds: ['seed-m-105-a'],
  },
  {
    id: 'work-3',
    date: '2026-07-30',
    title: '일일 순찰 사진 기록',
    content: '침사조 유량계 지시값 확인.',
    photoCount: 2,
    equipmentIds: ['seed-flt-101'],
  },
  {
    id: 'work-4',
    date: '2026-07-12',
    title: 'UV 램프 교체',
    content: '소독기 램프 교체 전후 사진.',
    photoCount: 4,
    equipmentIds: ['seed-m-118'],
  },
];

const MBR_ONLY_WORK_RECORDS = [
  {
    id: 'work-mbr-1',
    date: '2026-06-20',
    title: '막 화학세척(CIP) 작업',
    content: '차아염소산나트륨 계열 약액 순환 세척 작업 사진.',
    photoCount: 6,
    equipmentIds: ['seed-m-119-a', 'seed-m-121'],
  },
];

export const WORK_RECORD_SEEDS = {
  A2O: COMMON_WORK_RECORDS,
  MBR: [...COMMON_WORK_RECORDS, ...MBR_ONLY_WORK_RECORDS],
};

// 하위 호환 기본 내보내기(A2O 시드)
export const EQUIPMENT_PREVIEW_ITEMS = EQUIPMENT_SEEDS.A2O;
export const EQUIPMENT_HISTORY_PREVIEW = EQUIPMENT_HISTORY_SEEDS.A2O;
export const WORK_RECORD_PREVIEW_ITEMS = WORK_RECORD_SEEDS.A2O;
