# 백엔드 라우트 생성 지침

## 원칙

- Route는 요청 해석, service 호출과 응답 반환만 담당합니다.
- SQL, 외부 API, 파일 처리, 데이터 변환과 복잡한 권한 판단은 `server/services/`로 분리합니다.
- 프런트엔드는 해당 feature의 Model에서만 API를 호출합니다.

## 새 API 추가 절차

1. `server/routes/{name}Routes.cjs` 생성
2. `server/services/{name}Service.cjs` 또는 하위 디렉터리 생성
3. `server/routeRegistry.cjs`에 등록
4. `server/api-spec.cjs`에 엔드포인트 등록
5. 프런트 Model에 API 호출 추가
6. ViewModel에 상태와 업무 규칙 추가
7. View에서 렌더링
8. `npm run validate`

## 라우트 예시

```js
const express = require('express');
const featureService = require('../services/featureService.cjs');

module.exports = function (db) {
  const router = express.Router();

  router.get('/api/feature/items', async (req, res) => {
    try {
      const data = await featureService.listItems(db, req.query);
      res.json({ success: true, data });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        message: error.message,
      });
    }
  });

  return router;
};
```

## 금지 사항

- 루트 `server.cjs`에 업무 로직 추가
- Route 안에서 긴 SQL 또는 외부 서비스 직접 호출
- View/ViewModel에서 직접 `fetch`
- Registry와 API 스펙 중 하나만 수정
- UTF-8이 아닌 인코딩으로 저장

릴리스 전에는 `npm run build`까지 실행합니다.
