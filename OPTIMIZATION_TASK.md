# 앱 최적화 작업 지시서

> **목표**: 설치 시간 단축 + 서버 시작 시간 단축
> **주의**: AGENTS.md 규칙을 반드시 준수할 것

---

## 작업 1: 설치 속도 개선 — `asarUnpack` 최적화

### 문제
`electron-builder.config.cjs`의 `asarUnpack`에 `node_modules/**/*`가 있어서, **모든 node_modules(276개 패키지, 수만 개 파일)**이 asar 바깥에 개별 파일로 풀림.
설치 시 수만 개의 작은 파일을 하나하나 디스크에 쓰면서 Windows Defender 실시간 검사가 각 파일마다 발동 → 설치 지연.

### 수정 파일
- `electron-builder.config.cjs` (실제 빌드에 사용하는 파일)
- `electron-builder.config.js` (동기화 유지)

### 수정 내용

`asarUnpack` 섹션을 아래와 같이 변경 — **네이티브 바이너리(.node)가 있는 패키지만** unpack:

```javascript
asarUnpack: [
  'node_modules/better-sqlite3/**/*',
  'node_modules/sharp/**/*',
  'node_modules/@img/**/*',
  'node_modules/@napi-rs/**/*',
  'node_modules/bindings/**/*',
  'node_modules/prebuild-install/**/*',
  'node_modules/node-abi/**/*',
  'node_modules/detect-libc/**/*',
  'node_modules/napi-build-utils/**/*',
  'node_modules/node-addon-api/**/*',
],
```

> **중요**: `server.cjs`, `server/**/*`, `.env.local`은 asarUnpack에서 **제거**한다.
> 이들은 asar 안에 있어도 Node.js가 정상적으로 읽을 수 있다.
> 단, 만약 서버가 asar 안에서 실행 시 문제가 생기면 `server.cjs`와 `server/**/*`를 다시 추가할 것.

### 검증
- `npm run build && npx electron-builder --config electron-builder.config.cjs` 실행
- 생성된 `release/win-unpacked/resources/app.asar.unpacked/node_modules/` 안에 위 패키지들만 있는지 확인
- 앱 실행 후 서버가 정상 동작하는지 확인 (특히 better-sqlite3, sharp 사용 기능)

---

## 작업 2: 서버 시작 시간 단축 — 무거운 모듈 Lazy Loading

### 문제
서버 시작 시 모든 라우트 파일을 `require`하면서, 각 라우트가 의존하는 무거운 모듈이 **즉시** 로드됨:

| 모듈 | 로딩 시간 | 로드 위치 |
|---|---|---|
| `googleapis` | ~8,500ms | driveService, sitesSheetsService, membersSheetsService |
| `exceljs` | ~2,500ms | excelService, excelPdfService, dailyWorkLogService 등 |
| `pdf-lib` | ~1,000ms | 해당 서비스들 |
| `sharp` | ~500ms | localPhotoNormalizationService, uploadRoutes 등 |

### 수정 원칙
파일 최상단의 `require`를 **함수 내부** 또는 **싱글톤 getter**로 변경하여, 실제 사용 시점에만 로드되도록 한다.

### 수정 대상 파일 및 방법

#### 2-1. `googleapis` Lazy Loading (가장 효과 큼, ~8초 단축)

**파일: `server/services/driveService.cjs`** (Line 1)
```javascript
// 변경 전
const { google } = require('googleapis');

// 변경 후
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}
// 이후 코드에서 google → getGoogle() 으로 교체
```

**파일: `server/services/sitesSheetsService.cjs`** (Line 23)
```javascript
// 동일한 패턴 적용
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}
```

**파일: `server/services/membersSheetsService.cjs`** (Line 25)
```javascript
// 동일한 패턴 적용
let _google = null;
function getGoogle() {
  if (!_google) _google = require('googleapis').google;
  return _google;
}
```

#### 2-2. `exceljs` Lazy Loading (~2.5초 단축)

아래 파일들에서 최상단 `const ExcelJS = require('exceljs');`를 함수 내부로 이동:

- **`server/services/excelService.cjs`** (Line 1)
- **`server/services/excelPdfService.cjs`** (Line 1)
- **`server/services/dailyWorkLogService.cjs`** (Line 2)
- **`server/services/dailyLogPreviewService.cjs`** (Line 2)
- **`server/services/excelTemplateHtmlService.cjs`** (Line 1)
- **`server/routes/excelRoutes.cjs`** (Line 2)

```javascript
// 변경 전
const ExcelJS = require('exceljs');

// 변경 후: 싱글톤 패턴
let _ExcelJS = null;
function getExcelJS() {
  if (!_ExcelJS) _ExcelJS = require('exceljs');
  return _ExcelJS;
}
// 이후 코드에서 ExcelJS → getExcelJS() 또는 new (getExcelJS()).Workbook() 등으로 교체
// 또는 함수 안에서 const ExcelJS = require('exceljs'); 로 지역 변수 사용
```

> **주의**: `new ExcelJS.Workbook()` 같은 호출 패턴이 많으므로, 각 함수 내부에서 `const ExcelJS = require('exceljs');`를 하는 방식이 더 간단할 수 있음. require는 한번 로드 후 캐시되므로 두 번째 호출부터는 0ms.

#### 2-3. `sharp` Lazy Loading (~500ms 단축)

최상단에서 `require('sharp')`하는 파일만 수정:

- **`server/services/localPhotoNormalizationService.cjs`** (Line 3)
- **`server/routes/uploadRoutes.cjs`** (Line 3)
- **`server/services/dailyLogPreviewService.cjs`** (Line 8)

```javascript
// 변경 전
const sharp = require('sharp');

// 변경 후: 사용하는 함수 내부로 이동
// async function normalizeImageToJpg(sourcePath, targetPath) {
//   const sharp = require('sharp');  // ← 여기로 이동
//   ...
// }
```

> **참고**: `server/routes/sludgePhotoRoutes.cjs`와 `server/routes/medicineInRoutes.cjs`는 **이미 함수 내부에서** require하고 있으므로 수정 불필요.

#### 2-4. `@google-cloud/bigquery` Lazy Loading (~300ms 단축)

**파일: `server/services/bigQueryClientService.cjs`** (Line 10)
```javascript
// 변경 전
const { BigQuery } = require('@google-cloud/bigquery');

// 변경 후: getBigQueryClient() 함수 안에서 로드
function getBigQueryClient() {
  if (_client) return _client;
  // ... 기존 키 파일 확인 로직 ...
  const { BigQuery } = require('@google-cloud/bigquery');  // ← 여기로 이동
  _client = new BigQuery({ keyFilename: KEY_FILE_PATH });
  return _client;
}
```

### 검증
수정 후 아래 명령으로 시작 시간 측정:

```bash
node -e "console.time('total');require('./server/index.cjs');setTimeout(()=>console.timeEnd('total'),500)"
```

- 목표: 6.6초 → 2초 이내
- 앱 실행 후 모든 기능 정상 동작 확인 (유량, 수질, 약품, 설정, 엑셀 내보내기, 슬러지 사진 등)

---

## 작업 순서 권장

1. **작업 2** (Lazy Loading) 먼저 → 테스트 → 커밋
2. **작업 1** (asarUnpack) → 빌드 테스트 → 커밋

Lazy Loading은 코드 변경이 안전하고 롤백이 쉬우므로 먼저 진행하는 것이 좋다.

---

## 절대 하지 말 것

- `server.cjs` (루트)에 로직 추가 금지
- `start.cjs` 수정 금지
- `electron/` 내 파일 수정 금지
- `src/core/api/` 수정 금지
- 새 패키지 설치 금지 (기존 패키지만 사용)
- `/api/ping` 엔드포인트 변경/제거 금지
