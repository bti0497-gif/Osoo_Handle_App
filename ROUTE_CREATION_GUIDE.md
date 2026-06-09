# 백엔드 라우트 생성 지침

이 문서는 새 API를 추가할 때 `server/routes/*.cjs`가 다시 비대해지는 것을 막기 위한 기준입니다.

## 핵심 원칙

- 라우트 파일은 요청 파싱, 서비스 호출, 응답 반환만 담당합니다.
- DB 조회/수정, 파일 처리, 외부 API 호출, 데이터 변환, 동기화 판단은 `server/services/`로 분리합니다.
- 한 라우트 파일이 300줄을 넘기기 시작하면 서비스 분리를 먼저 검토합니다.
- 같은 도메인 안에 CRUD가 늘어날 가능성이 있으면 처음부터 `server/services/{domain}/` 하위 폴더를 사용합니다.
- API 경로와 응답 형태는 프론트 `Model` 계층과 맞춰 변경하고, View나 ViewModel에서 직접 API 경로를 만들지 않습니다.

## 새 라우트 추가 절차

1. `server/routes/{name}Routes.cjs`를 만듭니다.
2. 실제 업무 로직은 `server/services/{name}Service.cjs` 또는 `server/services/{name}/`에 만듭니다.
3. `server/routeRegistry.cjs`에 라우트를 등록합니다.
4. `server/api-spec.cjs`에 엔드포인트를 등록합니다.
5. 프론트에서는 해당 feature의 `{Name}Model.js`에만 API 호출을 추가합니다.
6. 작업 후 `npm run validate`를 실행합니다.

## 라우트 파일 권장 형태

```js
const express = require('express');
const featureService = require('../services/featureService.cjs');

const router = express.Router();

module.exports = function (db) {
  router.get('/api/feature/items', async (req, res) => {
    try {
      const result = await featureService.listItems(db, req.query || {});
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(err.statusCode || 500).json({ success: false, message: err.message });
    }
  });

  return router;
};
```

## 서비스 파일 권장 형태

```js
function createHttpError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function listItems(db, query) {
  const rows = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all();
  return { items: rows };
}

module.exports = {
  listItems,
};
```

## 라우트에 두지 말아야 할 것

- SQL이 여러 줄로 반복되는 비즈니스 처리
- Google BigQuery, Google Drive, Firebase, Google Sheets 직접 호출
- 파일 업로드 이후의 검증/치환/정리 로직
- 엑셀 파싱, 셀 매핑, 템플릿 처리
- 로컬 DB와 서버 데이터 복구/동기화 판단
- 복잡한 권한 판단
- 화면에 맞춘 데이터 재구성

## 예외적으로 라우트에 남겨도 되는 것

- `req.body`, `req.query`, `req.params` 전달
- multer 같은 미들웨어 연결
- `success: true/false` 응답 포맷
- `err.statusCode || 500` 오류 응답
- 라우트별 아주 짧은 입력 누락 검사

## 설정 메뉴 라우트 기준

설정 메뉴는 기능이 계속 늘어나는 admin 콘솔이므로 `server/routes/settingsRoutes.cjs`에 새 로직을 직접 추가하지 않습니다.

- 기본 설정/항목/엑셀 상태: `server/services/settings/appSettingsService.cjs`
- 사이트/현장관리자 설정: `server/services/settings/siteSettingsService.cjs`
- 엑셀 매핑/임포트: `server/services/settings/mappingSettingsService.cjs`
- 양식 업로드/치환: `server/services/settings/templateSettingsService.cjs`
- 웹앱/QnTECH/Gemini 설정: `server/services/settings/externalCredentialService.cjs`
- 초기 Google Sheets 동기화: `server/services/settings/initialSyncService.cjs`

새 설정 기능은 위 서비스 중 성격이 맞는 곳에 추가하거나, 독립 기능이면 `server/services/settings/{newService}.cjs`를 새로 만듭니다.

## 검증 규칙

- 모든 라우트 변경 후 `npm run validate`를 실행합니다.
- API 추가/삭제 시 `server/api-spec.cjs`와 `server/routeRegistry.cjs`를 함께 확인합니다.
- 한글 문자열을 추가한 파일은 UTF-8로 저장하고, 검증 결과의 Mojibake 항목을 확인합니다.
- 릴리즈 직전에는 `npm run build`까지 실행합니다.
