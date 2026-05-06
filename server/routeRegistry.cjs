/**
 * server/routeRegistry.cjs
 *
 * 紐⑤뱺 API ?쇱슦???깅줉 ?뺣낫瑜???怨녹뿉 紐⑥? ?덉??ㅽ듃由ъ엯?덈떎.
 * 怨꾩링蹂꾨줈 遺꾨쪟?섏뼱 ?덉쑝硫? server/index.cjs??registerLazyApplication()?? * ???뚯씪???쒗쉶?섎ŉ Express ?깆뿉 ?먮룞 ?깅줉?⑸땲??
 *
 * ???쇱슦??異붽? 諛⑸쾿:
 *   ??諛곗뿴????ぉ ?섎굹留?異붽??섎㈃ ?⑸땲??
 *   { tier: 2, path: '/api/new-feature', module: './routes/newFeatureRoutes.cjs', args: ['db', 'appDataPath'] }
 *
 * tier:
 *   0 = 利됱떆 ?깅줉 (濡쒓렇???놁씠???꾩슂??API, auth留?
 *   1 = preload-trigger ??200ms 媛꾧꺽 ?꾨━濡쒕뱶
 *   2 = 泥?HTTP ?붿껌 ??濡쒕뱶 (makeLazy)
 *
 * watch: true ??BigQuery 利됱떆 ?숆린??媛먯떆 ??? * args: ['db', 'appDataPath', 'BASE_DIR'] 以??대떦 ?쇱슦?멸? ?꾩슂濡??섎뒗 寃껊쭔 紐낆떆
 *        resolveArgs()媛 ctx?먯꽌 ?먮룞 留ㅽ븨?⑸땲??
 */
const routeRegistry = [
  // ==================================================================
  // Tier 0: 利됱떆 ?깅줉
  // ==================================================================
  { tier: 0, path: '/api/auth',          module: './routes/authRoutes.cjs',           args: ['db'] },

  // ==================================================================
  // Tier 1: 濡쒓렇???깃났 ??preload-trigger) 200ms 媛꾧꺽?쇰줈 ?꾨━濡쒕뱶
  // ==================================================================
  // ??waterQualityRoutes.cjs 寃利??꾨즺:
  //    module.exports = function (db, baseDir) { ... }
  //    ???대??먯꽌 baseDir??importQntechWaterPhotos(), buildManualPhotoDirectory()???꾨떖?섎?濡?BASE_DIR ?꾩슂
  { tier: 1, path: '/api/flows',          module: './routes/flowRoutes.cjs',           args: ['db'],           watch: true },
  { tier: 1, path: '/api/water-quality',  module: './routes/waterQualityRoutes.cjs',   args: ['db', 'BASE_DIR'], watch: true },
  { tier: 1, path: '/api/medicines',      module: './routes/medicineRoutes.cjs',       args: ['db'],           watch: true },
  { tier: 1, path: '/api/kits',           module: './routes/kitRoutes.cjs',            args: ['db'],           watch: true },
  { tier: 1, path: '/api/facilities',     module: './routes/facilityRoutes.cjs',       args: ['db'],           watch: true },

  // ==================================================================
  // Tier 2: 泥?HTTP ?붿껌???ㅼ뼱????濡쒕뱶 (makeLazy)
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
