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

## 변경 시 주의

구조적 변경이 필요하면 사용자에게 먼저 확인을 받으세요:
- 디렉토리 구조, core/ 파일, database 스키마, electron/ 파일, package.json scripts
