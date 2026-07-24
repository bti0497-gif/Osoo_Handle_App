/**
 * server/routeRegistry.cjs
 *
 * 모든 API 라우터 등록 정보를 한 곳에 모은 엔트리입니다.
 * 계층별로 분류되어 있으면 server/index.cjs의 registerLazyApplication()이
 * 이 파일을 조회하여 Express 등에 자동 등록합니다.
 *
 * 새 라우터 추가 방법:
 *   이 배열에 항목 하나만 추가하면 됩니다
 *   { tier: 2, path: '/api/new-feature', module: './routes/newFeatureRoutes.cjs', args: ['db', 'appDataPath'] }
 *
 * tier:
 *   0 = 즉시 등록 (로그인 없이 필요한 API, auth만)
 *   1 = 로그인 성공 시 (preload-trigger) 200ms 간격 프리로드
 *   2 = 첫 HTTP 요청 시 로드 (makeLazy)
 *
 * watch: true는 BigQuery 즉시 동기화 감시 대상
 * args: ['db', 'appDataPath', 'BASE_DIR'] 중 해당 라우터가 필요로 하는 것만 명시
 *        resolveArgs()가 ctx에서 자동 매핑됩니다
 */
const routeRegistry = [
  // ==================================================================
  // Tier 0: 즉시 등록
  // ==================================================================
  { tier: 0, path: '/api/auth',          module: './routes/authRoutes.cjs',           args: ['db', 'appDataPath'] },

  // ==================================================================
  // Tier 1: 로그인 성공 시 (preload-trigger) 200ms 간격으로 프리로드
  // ==================================================================
  // 이 waterQualityRoutes.cjs 검증 완료:
  //    module.exports = function (db, baseDir) { ... }
  //    이미 baseDir에서 importQntechWaterPhotos(), buildManualPhotoDirectory()를 호출하므로 BASE_DIR 필요
  { tier: 1, path: '/',                   module: './routes/flowRoutes.cjs',           args: ['db'],           watch: true },
  { tier: 1, path: '/',                   module: './routes/waterQualityRoutes.cjs',   args: ['db', 'BASE_DIR'], watch: true },
  { tier: 1, path: '/',                   module: './routes/operationStatusRoutes.cjs', args: ['db'] },
  { tier: 1, path: '/',                   module: './routes/medicineRoutes.cjs',       args: ['db'],           watch: true },
  { tier: 1, path: '/',                   module: './routes/kitRoutes.cjs',            args: ['db'],           watch: true },
  { tier: 1, path: '/',                   module: './routes/facilityRoutes.cjs',       args: ['db', 'appDataPath'], watch: true },

  // ==================================================================
  // Tier 2: 첫 HTTP 요청이 들어올 때 로드 (makeLazy)
  // ==================================================================
  { tier: 2, path: '/',                   module: './routes/settingsRoutes.cjs',       args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/boardRoutes.cjs',          args: ['db'] },
  { tier: 2, path: '/',                   module: './routes/uploadRoutes.cjs',         args: ['appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/excelRoutes.cjs',          args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/sludgePhotoRoutes.cjs',    args: ['db', 'BASE_DIR', 'appDataPath'], watch: true },
  { tier: 2, path: '/',                   module: './routes/medicineInRoutes.cjs',     args: ['db', 'BASE_DIR', 'appDataPath'], watch: true },
  { tier: 2, path: '/',                   module: './routes/medicineRegisterRoutes.cjs', args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/certificateRoutes.cjs',    args: ['db'] },
  { tier: 2, path: '/',                   module: './routes/locationRoutes.cjs',       args: ['BASE_DIR'] },
  { tier: 2, path: '/',                   module: './routes/dailyWorkLogRoutes.cjs',   args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/monthlyOperationReportRoutes.cjs', args: ['db', 'BASE_DIR', 'appDataPath'] },
  { tier: 2, path: '/',                   module: './routes/roadworkHelperRoutes.cjs', args: ['db'] },
];

module.exports = routeRegistry;
