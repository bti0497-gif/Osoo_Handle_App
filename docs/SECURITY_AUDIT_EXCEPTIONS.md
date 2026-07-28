# 운영 의존성 보안 감사 예외

CI는 `npm run audit:prod`에서 운영 의존성의 새로운 `high` 및 `critical` 취약점을 차단한다.
예외는 아래의 정확한 GitHub Advisory ID에만 적용하며, 패치가 제공되면 제거한다.

## GHSA-mh99-v99m-4gvg — brace-expansion

- 경로: ExcelJS의 압축 모듈과 Google API 라이브러리 내부 의존성
- 현재 npm의 자동 수정은 ExcelJS를 호환되지 않는 구버전으로 변경한다.
- 앱은 해당 경로에 사용자 입력 glob 패턴을 전달하지 않고, 코드에 고정된 파일 패턴만 사용한다.
- ExcelJS 또는 Google API 상위 패키지가 호환 패치를 제공하면 즉시 갱신한다.

## GHSA-v3m3-f69x-jf25 — Quill 2.0.3

- 현재 Quill에 패치된 배포 버전이 없다.
- 게시글 HTML은 서버 저장 시와 화면 표시 시 모두 정화하며 CSP 검증도 릴리즈 검사에 포함한다.
- 패치된 Quill/react-quill-new 버전이 나오면 즉시 갱신한다.

## 금지 사항

- `npm audit fix --force`를 사용하지 않는다.
- 패키지명이나 심각도 전체를 포괄적으로 무시하지 않는다.
- 예외 ID를 추가할 때는 위험 경로, 앱의 완화책, 제거 조건을 이 문서에 기록한다.
