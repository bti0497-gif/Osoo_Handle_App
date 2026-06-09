# 서버 라우트 지연 로딩(Lazy Loading) 최적화 계획

## 배경

현재 `server/index.cjs`의 `registerHeavyApplication()` 함수는 앱 시작 시점에 **17개 모든 라우트 모듈을 한꺼번에 require**하고 있습니다. 이로 인해:

- 서버 초기화 시간이 길어짐 (모든 라우트가 각자의 의존성 모듈을 로드)
- 로그인 화면이 뜨기까지 지연 발생
- 사용자가 당장 사용하지 않을 기능(예: 한글, 엑셀 일지)까지도 로드됨

## 목표

앱 실행 → 로그인까지의 시간을 최소화하고, 필요한 기능만 그때그때 로드하여 전반적인 사용자 경험을 개선합니다.

---

## Tier 전략

워크플로우 분석 결과, 라우트를 3개 Tier로 분류합니다.

### Tier 0 — 즉시 로드 (앱 실행 시)

로그인과 출결 처리에 필수적인 라우트만 즉시 로드합니다.

| 라우트 | 설명 |
|--------|------|
| `authRoutes` | 로그인, 출근/퇴근, 출결현황, 회원 동기화 |
| `/api/ping` | 서버 상태 확인 (프론트엔드 서버 탐색용) |

**예상 로딩 시간:** 1~2초

---

### Tier 1 — 로그인 성공 후 백그라운드 프리로드

현장 근무자가 **매일 하는 작업**들입니다. 로그인 후 바로 사용할 가능성이 높으므로, 로그인이 완료되면 백그라운드에서 순차적으로 미리 로드합니다.

| 라우트 | 설명 |
|--------|------|
| `flowRoutes` | 유량관리 (검침값 입력) |
| `waterQualityRoutes` | 수질관리 (실험값 입력/QnTECH 연동) |
| `medicineRoutes` | 약품관리 (약품 사용량 입력) |
| `kitRoutes` | 분석키트 (재고 관리) |
| `facilityRoutes` | 시설관리 (시설 점검 이력) |

**로딩 순서:** 위 표 순서대로 1초 간격으로 순차 로드

---

### Tier 2 — 메뉴 클릭 시에만 로드 (On-demand)

상황이 발생했을 때만 사용하는 기능들입니다. 사용자가 해당 메뉴를 처음 클릭할 때 로드하며, 한 번 로드되면 앱 종료까지 캐시되어 유지됩니다.

| 라우트 | 설명 | 예상 로딩 시간 |
|--------|------|---------------|
| `excelRoutes` | 일지 (엑셀/PDF 미리보기, 내보내기) | ~1초 (exceljs) |
| `hwpRoutes` | 한글 (HWPX → PDF 변환) | ~2초 (hwpPdfService) |
| `sludgePhotoRoutes` | 슬러지 사진관리 | ~0.3초 |
| `medicineInRoutes` | 약품입고 | ~0.3초 |
| `medicineRegisterRoutes` | 약품등록대장 | ~0.3초 |
| `settingsRoutes` | 설정 | ~0.5초 |
| `boardRoutes` | 게시판 | ~0.2초 |
| `certificateRoutes` | 성적서 | ~0.3초 |
| `uploadRoutes` | 파일업로드 | ~0.2초 |
| `locationRoutes` | 위치정보 | ~0.2초 |
| `dailyWorkLogRoutes` | 일일업무일지 | ~0.3초 |

---

## 구현 방식

### 1. 각 라우트의 실제 인수 시그니처

각 라우트의 팩토리 함수는 라우트마다 받는 인수가 다릅니다. 구현 시 아래 시그니처를 정확히 사용해야 합니다.

| 라우트 | 팩토리 인수 |
|--------|------------|
| `authRoutes` | `(db)` |
| `flowRoutes` | `(db)` |
| `medicineRoutes` | `(db)` |
| `kitRoutes` | `(db)` |
| `facilityRoutes` | `(db)` |
| `waterQualityRoutes` | `(db, BASE_DIR)` |
| `medicineRegisterRoutes` | `(db, BASE_DIR, appDataPath)` |
| `medicineInRoutes` | `(db, BASE_DIR, appDataPath)` |
| `settingsRoutes` | `(db, BASE_DIR, appDataPath)` |
| `excelRoutes` | `(db, BASE_DIR, appDataPath)` |
| `dailyWorkLogRoutes` | `(db, BASE_DIR, appDataPath)` |
| `hwpRoutes` | `(db, BASE_DIR, appDataPath)` |
| `sludgePhotoRoutes` | `(db, BASE_DIR, appDataPath)` |
| `uploadRoutes` | `(appDataPath)` |
| `locationRoutes` | `(BASE_DIR)` |
| `boardRoutes` | `()` |
| `certificateRoutes` | `()` |

---

### 2. Tier 0: 즉시 로드 + BigQuery 감시 미들웨어 등록

```javascript
// auth + ping 즉시 로드
app.use('/api/auth', require('./routes/authRoutes.cjs')(db));
app.get('/api/ping', (req, res) => res.json({ ok: true, port }));

// BigQuery 감시 미들웨어를 Tier 0 직후, Tier 1/2 등록 전에 먼저 등록
// → 이후 동적으로 등록되는 모든 Tier 1/2 라우트 요청도 감지됨
app.use((req, res, next) => {
  // 기존 BigQuery 감시 로직
  const shouldWatchMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const shouldWatchPath = BIGQUERY_IMMEDIATE_SYNC_PREFIXES.some(p => req.path.startsWith(p));
  if (!shouldWatchMethod || !shouldWatchPath) return next();
  const originalEnd = res.end;
  res.end = function (...args) {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      triggerBigQuerySync(`after-save:${req.method}:${req.path}`);
    }
    return originalEnd.apply(this, args);
  };
  next();
});
```

---

### 3. Tier 1: 로그인 성공 후 백그라운드 프리로드

**트리거 방식**: 프론트엔드에서 로그인 성공 응답을 받은 뒤 `/api/preload-trigger`를 호출합니다.  
- `authRoutes.cjs`는 건드리지 않습니다.  
- 로그인 응답이 클라이언트에 먼저 도착하므로 화면 전환이 빠릅니다.  
- 프리로드는 그 다음에 백그라운드에서 진행됩니다.

```javascript
// server/index.cjs — Tier 1 프리로드 함수
const TIER1_ROUTES = [
  { prefix: '/api/flows',         load: () => require('./routes/flowRoutes.cjs')(db) },
  { prefix: '/api/water-quality', load: () => require('./routes/waterQualityRoutes.cjs')(db, BASE_DIR) },
  { prefix: '/api/medicines',     load: () => require('./routes/medicineRoutes.cjs')(db) },
  { prefix: '/api/kits',          load: () => require('./routes/kitRoutes.cjs')(db) },
  { prefix: '/api/facility',      load: () => require('./routes/facilityRoutes.cjs')(db) },
];

let tier1Loaded = false;
function preloadTier1Routes() {
  if (tier1Loaded) return;
  tier1Loaded = true;

  let index = 0;
  function loadNext() {
    if (index >= TIER1_ROUTES.length) return;
    const { prefix, load } = TIER1_ROUTES[index];
    console.log(`[Preload] Tier1 ${prefix}`);
    app.use(prefix, load());
    index++;
    setTimeout(loadNext, 200); // 200ms 간격으로 순차 로드
  }
  loadNext();
}

// /api/preload-trigger 엔드포인트 (Tier 0에 함께 등록)
app.post('/api/preload-trigger', (req, res) => {
  res.json({ ok: true });
  setImmediate(preloadTier1Routes); // 응답 먼저 보내고 로딩 시작
});
```

---

### 4. Tier 2: 첫 요청 시 동적 등록 (app.use 방식)

Express의 `app.use(prefix, router)` 정규 동작을 활용합니다. 첫 요청 시 해당 prefix로 라우터를 등록하고 `next('router')`로 재처리를 유도합니다.

```javascript
// server/index.cjs — Tier 2 lazy 팩토리
function makeLazy(modulePath, ...args) {
  let loaded = false;
  return (req, res, next) => {
    if (!loaded) {
      console.log(`[Lazy] 첫 요청 — ${modulePath} 로딩 중`);
      loaded = true;
      // 첫 요청은 현재 미들웨어가 처리 (args 정확히 전달)
    }
    require(modulePath)(...args)(req, res, next);
  };
}

// Tier 2 등록 (각 라우트의 실제 시그니처 사용)
app.use('/api/logs',              makeLazy('./routes/excelRoutes.cjs',          db, BASE_DIR, appDataPath));
app.use('/api/hwp',               makeLazy('./routes/hwpRoutes.cjs',            db, BASE_DIR, appDataPath));
app.use('/api/sludge-photos',     makeLazy('./routes/sludgePhotoRoutes.cjs',    db, BASE_DIR, appDataPath));
app.use('/api/medicine-in',       makeLazy('./routes/medicineInRoutes.cjs',     db, BASE_DIR, appDataPath));
app.use('/api/medicine-register', makeLazy('./routes/medicineRegisterRoutes.cjs', db, BASE_DIR, appDataPath));
app.use('/api/settings',          makeLazy('./routes/settingsRoutes.cjs',       db, BASE_DIR, appDataPath));
app.use('/api/board',             makeLazy('./routes/boardRoutes.cjs'));
app.use('/api/certificate',       makeLazy('./routes/certificateRoutes.cjs'));
app.use('/api/upload',            makeLazy('./routes/uploadRoutes.cjs',         appDataPath));
app.use('/api/location',          makeLazy('./routes/locationRoutes.cjs',       BASE_DIR));
app.use('/api/daily-work-log',    makeLazy('./routes/dailyWorkLogRoutes.cjs',   db, BASE_DIR, appDataPath));
```

> **주의**: `makeLazy`는 `require(modulePath)(...args)`를 매 요청마다 호출하지 않도록,  
> `loaded` 플래그 후 라우터 인스턴스를 변수에 캐싱하는 방식으로 최종 구현 시 개선합니다.

```javascript
// 캐싱 개선 버전 (최종 채택)
function makeLazy(modulePath, ...args) {
  let router = null;
  return (req, res, next) => {
    if (!router) {
      console.log(`[Lazy] 첫 요청 — ${modulePath} 로딩`);
      router = require(modulePath)(...args);
    }
    router(req, res, next);
  };
}
```

> **Express prefix strip 동작 보장**: `app.use('/api/settings', makeLazy(...))` 형태로 등록하면,  
> Express는 미들웨어 호출 전에 `req.url`에서 `/api/settings` prefix를 자동으로 제거합니다.  
> 따라서 `makeLazy` 내부에서 `router(req, res, next)`를 직접 호출해도 `req.url`은 이미 정상적으로 잘린 상태입니다.  
> `next('router')` 방식은 `app` 클로저 캡처와 첫 요청 재탐색 문제가 있어 사용하지 않습니다.

---

## 예상 효과

| 단계 | 현재 | 최적화 후 |
|------|------|----------|
| 앱 실행 → 서버 준비 | 5~10초 | 1~2초 |
| 로그인 화면 표시 | 5~10초 | 1~2초 |
| 유량관리 첫 클릭 | 즉시 (이미 로드됨) | 즉시 (백그라운드 프리로드 완료) |
| 일지 첫 클릭 | 즉시 (이미 로드됨) | ~1초 (첫 로딩, 이후 캐시) |
| 한글 첫 클릭 | 즉시 (이미 로드됨) | ~2초 (첫 로딩, 이후 캐시) |

---

## 고려사항

1. **BigQuery 감시 미들웨어** — Tier 0 직후, Tier 1/2 등록 전에 먼저 등록해야 모든 라우트의 저장 요청을 감지할 수 있음
2. **BigQuery 동기화 스케줄러** — 로그인 성공 후 Tier 1 프리로드가 완료된 시점에 시작 (`preloadTier1Routes` 완료 콜백에서 `syncScheduler.start()`)
3. **Excel/PDF 워밍업** — `warmUpExcelPdfConverter`는 `excelRoutes`가 처음 로드될 때 함께 초기화
4. **에러 처리** — Tier 2 라우트 로딩 실패 시 `next(err)` 전달 → 전역 에러 핸들러가 `500` 응답 반환
5. **메모리** — 모든 라우트가 결국 로드되면 현재와 동일한 메모리 사용량 (캐시되므로 중복 로드 없음)
6. **`makeLazy` 캐싱** — 라우터 인스턴스를 변수에 저장해 `require()`를 매 요청마다 호출하지 않도록 구현

---

## 결정사항 (피드백 반영 후 확정)

| 항목 | 결정 |
|------|------|
| Tier 2 lazyRouter 방식 | `makeLazy` + `app.use(prefix, router)` 캐싱 방식 |
| 각 라우트 인수 | 실제 시그니처대로 개별 지정 |
| Tier 1 트리거 | 프론트엔드 로그인 성공 후 `/api/preload-trigger` POST 호출 |
| Tier 1 로드 간격 | 200ms |
| BigQuery 미들웨어 위치 | Tier 0 직후 등록 |
| BigQuery 스케줄러 시작 | Tier 1 프리로드 완료 후 |
| 프론트엔드 React.lazy() | 별도 작업으로 분리 (서버 Lazy Loading 안정화 후 진행) |
