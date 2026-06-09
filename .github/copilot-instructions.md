# GitHub Copilot 지침

이 프로젝트는 엄격한 MVVM 아키텍처를 따릅니다. 코드 생성 시 반드시 아래 규칙을 준수하세요.

## 프로젝트 구조

- **프론트엔드 기능**: `src/features/{name}/` (Model + ViewModel + View)
- **공통 인프라**: `src/core/api/` (apiClient, serverConfig)
- **상수**: `src/core/constants/index.js`
- **백엔드 라우트**: `server/routes/{name}Routes.cjs`
- **Electron**: `electron/` (main, preload, updater)

## 코드 작성 규칙

### API 호출
```javascript
// 로컬 서버 API — 반드시 apiClient 사용
import { apiClient } from '../../core/api';
const data = await apiClient.get('/api/endpoint', { param: value });
```

### 금지 패턴
```javascript
// ❌ fetch 직접 호출
const res = await fetch('http://localhost:8901/api/...');

// ❌ View에서 직접 API 호출
const MyView = () => {
  useEffect(() => { fetch('/api/data').then(...) }, []); // 금지
};

// ❌ flat 구조로 파일 생성
// src/models/NewModel.js  ← 이 경로 사용 금지
// src/viewmodels/useNew.js  ← 이 경로 사용 금지
```

### 올바른 패턴
```javascript
// ✅ Feature 디렉토리 내에서 Model → ViewModel → View 분리
// src/features/newFeature/NewModel.js
// src/features/newFeature/useNewViewModel.js
// src/features/newFeature/NewView.jsx
// src/features/newFeature/index.js
```

## 새 백엔드 라우트 추가
```javascript
// server/routes/newRoutes.cjs
const express = require('express');
const router = express.Router();
module.exports = function(db) {
  router.get('/api/new', (req, res) => { /* ... */ });
  return router;
};

// server/index.cjs에 등록
app.use(require('./routes/newRoutes.cjs')(db));
```

## 파일 인코딩 (필수 ⚠️)

**모든 코드 파일은 반드시 UTF-8 BOM 없음으로 인코딩되어야 합니다.**

### 작성 규칙
```javascript
// ✅ 올바른 패턴: UTF-8 인코딩, 한글 문자 직접 기입
const ERROR_MSG = '약품 이름이 비어있습니다.'; // ✅
const label = '슬러지 관리';  // ✅

// ❌ 금지: EUC-KR이나 다른 인코딩
// ❌ 금지: 이스케이프 문자열로 한글 표현
// const msg = '\xb1\xd7\xc6'; // ❌ 금지
```

### 파일 생성 시 검사
1. **VS Code 설정**: 우측 하단 "인코딩" → UTF-8 확인
2. **저장**: `Ctrl+S` 전에 인코딩 선택
3. **커밋 전**: 다음 명령 실행
   ```bash
   node scripts/utf8-validate.cjs  # 모든 파일 UTF-8 검증
   npm run validate                 # 배포 전 최종 검증
   ```

### 문제 발생 시
```bash
node scripts/fix-encoding.cjs  # 모든 파일 자동 UTF-8 재인코딩
```

---

## 라우트 경로 규칙 (필수 ⚠️)

**라우트 내 API 경로 중복 금지**

### 올바른 패턴
```javascript
// server/routes/certificateRoutes.cjs
const router = express.Router();
router.get('/list', (req, res) => { /* ... */ });      // ✅ 상대 경로
router.post('/upload', (req, res) => { /* ... */ });   // ✅ 상대 경로
module.exports = (db) => router;

// server/routeRegistry.cjs에서 마운트
{ path: '/api/certificates', module: './routes/certificateRoutes.cjs' }
// 결과: GET /api/certificates/list
```

### 금지된 패턴
```javascript
// ❌ 라우트 내에 전체 경로 포함
router.get('/api/certificates/list', ...);   // ❌ double-prefix 발생
router.post('/api/certificates/upload', ...); // ❌ 404 에러
```

---

## 변경 시 주의

구조적 변경이 필요하면 사용자에게 먼저 확인을 받으세요:
- 디렉토리 구조, core/ 파일, database 스키마, electron/ 파일, package.json scripts
