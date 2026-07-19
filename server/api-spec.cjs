/**
 * server/api-spec.cjs
 * 
 * 모든 API 엔드포인트 정의를 한 군데 관리
 * - 라우트 검증
 * - 테스트 자동 생성
 * - API 변경 추적
 */

const apiSpec = {
  // ===== Tier 0: 필수 인증/기본 API =====
  auth: {
    tier: 0,
    path: '/api/auth',
    endpoints: [
      { method: 'POST', path: '/login', description: '로그인' },
      { method: 'POST', path: '/logout', description: '로그아웃' },
      { method: 'GET', path: '/current-user', description: '현재 사용자 정보' },
      { method: 'GET', path: '/verify-token', description: '토큰 검증' },
    ],
  },

  // ===== Tier 1: 주요 데이터 조회 (preload) =====
  flows: {
    tier: 1,
    path: '/api/flows',
    endpoints: [
      { method: 'GET', path: '', description: '처리 흐름 목록' },
      { method: 'GET', path: '/:id', description: '처리 흐름 상세' },
      { method: 'POST', path: '', description: '처리 흐름 생성' },
      { method: 'PUT', path: '/:id', description: '처리 흐름 수정' },
    ],
  },

  waterQuality: {
    tier: 1,
    path: '/api/water-quality',
    endpoints: [
      { method: 'GET', path: '', description: '수질 데이터 목록' },
      { method: 'POST', path: '', description: '수질 데이터 생성' },
      { method: 'GET', path: '/photos/:date', description: '수질 사진 조회' },
      { method: 'POST', path: '/import-qntech', description: 'QNTECH 사진 임포트' },
    ],
  },

  medicines: {
    tier: 1,
    path: '/api/medicines',
    endpoints: [
      { method: 'GET', path: '', description: '약품 목록' },
      { method: 'POST', path: '', description: '약품 추가' },
      { method: 'PUT', path: '/:id', description: '약품 수정' },
    ],
  },

  kits: {
    tier: 1,
    path: '/api/kits',
    endpoints: [
      { method: 'GET', path: '', description: '시약 키트 목록' },
    ],
  },

  facilities: {
    tier: 1,
    path: '/api/facilities',
    endpoints: [
      { method: 'GET', path: '', description: '시설물 목록' },
      { method: 'POST', path: '', description: '시설물 추가' },
    ],
  },

  // ===== Tier 2: 보조 기능 (lazy-loaded) =====
  settings: {
    tier: 2,
    path: '/',
    module: './routes/settingsRoutes.cjs',
    endpoints: [
      { method: 'GET', path: '/api/settings', description: '기본 설정 조회' },
      { method: 'GET', path: '/api/settings/sites', description: '현장 목록 (구글시트 또는 로컬DB)' },
      { method: 'POST', path: '/api/settings/select-site', description: '현장 선택' },
      { method: 'GET', path: '/api/settings/current-site', description: '현재 선택된 현장' },
      { method: 'GET', path: '/api/settings/members', description: '직원 목록' },
      { method: 'GET', path: '/api/settings/roles', description: '역할 목록' },
      { method: 'PUT', path: '/api/settings/theme', description: '테마 설정' },
      { method: 'GET', path: '/api/settings/app-version', description: '앱 버전' },
    ],
  },

  board: {
    tier: 2,
    path: '/api/board',
    endpoints: [
      { method: 'GET', path: '', description: '게시판 목록' },
      { method: 'POST', path: '', description: '게시글 작성' },
      { method: 'PUT', path: '/:id', description: '게시글 수정' },
      { method: 'DELETE', path: '/:id', description: '게시글 삭제' },
    ],
  },

  upload: {
    tier: 2,
    path: '/api/upload',
    endpoints: [
      { method: 'POST', path: '/photo', description: '사진 업로드' },
      { method: 'POST', path: '/excel', description: '엑셀 파일 업로드' },
    ],
  },

  logs: {
    tier: 2,
    path: '/api/logs',
    endpoints: [
      { method: 'GET', path: '/daily', description: '일일 업무 로그 조회' },
      { method: 'POST', path: '/daily', description: '일일 업무 로그 생성' },
      { method: 'GET', path: '/export', description: '로그 내보내기' },
      { method: 'POST', path: '/import', description: '로그 가져오기' },
    ],
  },


  sludgePhotos: {
    tier: 2,
    path: '/api/sludge-photos',
    endpoints: [
      { method: 'GET', path: '', description: '슬러지 사진 목록' },
      { method: 'POST', path: '', description: '슬러지 사진 업로드' },
    ],
  },

  medicineIn: {
    tier: 2,
    path: '/api/medicine-in',
    endpoints: [
      { method: 'GET', path: '', description: '약품 입고 목록' },
      { method: 'POST', path: '', description: '약품 입고 기록' },
    ],
  },

  medicineRegister: {
    tier: 2,
    path: '/api/medicine-register',
    endpoints: [
      { method: 'GET', path: '', description: '약품 관리 목록' },
      { method: 'PUT', path: '/:id', description: '약품 정보 수정' },
    ],
  },

  certificates: {
    tier: 2,
    path: '/api/certificates',
    endpoints: [
      { method: 'GET', path: '', description: '성적서 목록 조회' },
      { method: 'POST', path: '/sync-cache', description: '성적서 BigQuery 캐시 동기화' },
      { method: 'POST', path: '/download-selected-pdf', description: '선택 성적서 PDF 병합 다운로드' },
      { method: 'GET', path: '/:id/download', description: '성적서 다운로드 URL 조회' },
      { method: 'GET', path: '/files/:id', description: '성적서 원본 파일 다운로드' },
    ],
  },

  location: {
    tier: 2,
    path: '/api/location',
    endpoints: [
      { method: 'GET', path: '/current', description: '현재 위치' },
      { method: 'GET', path: '/history', description: '위치 기록' },
    ],
  },

  dailyWorkLog: {
    tier: 2,
    path: '/api/daily-work-log',
    endpoints: [
      { method: 'GET', path: '', description: '일일 작업 로그 조회' },
      { method: 'POST', path: '', description: '일일 작업 로그 저장' },
      { method: 'GET', path: '/export', description: '로그 내보내기' },
      { method: 'GET', path: '/export-pdf', description: 'HWPX 기반 일일업무일지 다중 날짜 PDF 병합 내보내기' },
      { method: 'GET', path: '/export-hwpx', description: '책갈피 기반 일일업무일지 HWPX 내보내기' },
    ],
  },

  roadworkHelper: {
    tier: 2,
    path: '/api/roadwork-helper',
    endpoints: [
      { method: 'GET', path: '/all', description: '공사 입력 도우미 전체 데이터 조회' },
      { method: 'GET', path: '/flow', description: '공사 입력 도우미 유량 데이터 조회' },
      { method: 'GET', path: '/electricity', description: '공사 입력 도우미 전력량 데이터 조회' },
      { method: 'GET', path: '/medicine', description: '공사 입력 도우미 약품 데이터 조회' },
      { method: 'GET', path: '/kit', description: '공사 입력 도우미 키트 데이터 조회' },
    ],
  },

  // ===== 필수 시스템 API =====
  monthlyOperationReport: {
    tier: 2,
    path: '/api/monthly-operation-report',
    endpoints: [
      { method: 'GET', path: '', description: '월운영보고서 월별 자료 요약' },
      { method: 'POST', path: '/export', description: '기존 엑셀 양식 기반 월운영보고서 생성' },
    ],
  },

  system: {
    tier: 0,
    path: '/api',
    endpoints: [
      { method: 'GET', path: '/ping', description: '서버 상태 확인' },
      { method: 'GET', path: '/health', description: '헬스 체크 (모든 모듈 상태)' },
    ],
  },
};

/**
 * API 스펙에서 모든 엔드포인트 추출
 * @returns {Array} [{ method, fullPath, description }, ...]
 */
function getAllEndpoints() {
  const all = [];
  for (const [key, spec] of Object.entries(apiSpec)) {
    const basePath = spec.path || '';
    spec.endpoints?.forEach(ep => {
      all.push({
        group: key,
        method: ep.method,
        fullPath: (basePath + (ep.path || '')).replace(/\/+/g, '/'),
        description: ep.description,
        tier: spec.tier,
      });
    });
  }
  return all;
}

module.exports = {
  apiSpec,
  getAllEndpoints,
};
