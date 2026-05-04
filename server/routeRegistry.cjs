/**
 * server/routeRegistry.cjs
 *
 * 모든 API 라우트 등록 정보를 한 곳에 모은 레지스트리입니다.
 * 계층별로 분류되어 있으며, server/index.cjs의 registerLazyApplication()이
 * 이 파일을 순회하며 Express 앱에 자동 등록합니다.
 *
 * 새 라우트 추가 방법:
 *   이 배열에 항목 하나만 추가하면 됩니다.
 *   { tier: 2, path: '/api/new-feature', module: './routes/newFeatureRoutes.cjs', args: ['db', 'appDataPath'] }
 *
 * tier:
 *   0 = 즉시 등록 (로그인 없이도 필요한 API, auth만)
 *   1 = preload-trigger 후 200ms 간격 프리로드
 *   2 = 첫 HTTP 요청 시 로드 (makeLazy)
 *
 * watch: true → BigQuery 즉시 동기화 감시 대상
 * args: ['db', 'appDataPath', 'BASE_DIR'] 중 해당 라우트가 필요로 하는 것만 명시
 *        resolveArgs()가 ctx에서 자동 매핑합니다.
 */
const routeRegistry = [
  // ==================================================================
  // Tier 0: 즉시 등록
  // ==================================================================
  { tier: 0, path: '/api/auth',          module: './routes/authRoutes.cjs',           args: ['db'] },

  // ==================================================================
  // Tier 1: 로그인 성공 후(preload-trigger) 200ms 간격으로 프리로드
  // ==================================================================
  // ※ waterQualityRoutes.cjs 검증 완료:
  //    module.exports = function (db, baseDir) { ... }
  //    → 내부에서 baseDir을 importQntechWaterPhotos(), buildManualPhotoDirectory()에 전달하므로 BASE_DIR 필요
  { tier: 1, path: '/api/flows',          module: './routes/flowRoutes.cjs',           args: ['db'],           watch: true },
  { tier: 1, path: '/api/water-quality',  module: './routes/waterQualityRoutes.cjs',   args: ['db', 'BASE_DIR'], watch: true },
  { tier: 1, path: '/api/medicines',      module: './routes/medicineRoutes.cjs',       args: ['db'],           watch: true },
  { tier: 1, path: '/api/kits',           module: './routes/kitRoutes.cjs',            args: ['db'],           watch: true },
  { tier: 1, path: '/api/facilities',     module: './routes/facilityRoutes.cjs',       args: ['db'],           watch: true },

  // ==================================================================
  // Tier 2: 첫 HTTP 요청이 들어올 때 로드 (makeLazy)
  // ==================================================================
  { tier: 2, path: '/api/settings',       module: './routes/settingsRoutes.cjs',       args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/api/board',          module: './routes/boardRoutes.cjs',          args: ['db'] },
  { tier: 2, path: '/api/upload',         module: './routes/uploadRoutes.cjs',         args: ['appDataPath'] },
  { tier: 2, path: '/api/logs',           module: './routes/excelRoutes.cjs',          args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/api/hwp',            module: './routes/hwpRoutes.cjs',            args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/api/sludge-photos',  module: './routes/sludgePhotoRoutes.cjs',    args: ['db', 'BASE_DIR', 'appDataPath'], watch: true },
  { tier: 2, path: '/api/medicine-in',    module: './routes/medicineInRoutes.cjs',     args: ['db', 'BASE_DIR', 'appDataPath'], watch: true },
  { tier: 2, path: '/api/medicine-register', module: './routes/medicineRegisterRoutes.cjs', args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/api/certificates',   module: './routes/certificateRoutes.cjs',    args: ['db'] },
  { tier: 2, path: '/api/location',       module: './routes/locationRoutes.cjs',       args: ['BASE_DIR'] },
  { tier: 2, path: '/api/daily-work-log', module: './routes/dailyWorkLogRoutes.cjs',   args: ['db', 'BASE_DIR', 'appDataPath'] },
];

module.exports = routeRegistry;
