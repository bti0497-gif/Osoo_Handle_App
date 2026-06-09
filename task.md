# 작업 체크리스트 (task.md)

다른 에이전트가 VS Code에서 작업하면서 진행 상황을 보고할 수 있도록 상세 태스크 목록을 정리합니다.

우선 순위: 높 → 낮

- [ ] 1. `routeRegistry.cjs` 경로 정합성 확인
  - 파일: `server/routeRegistry.cjs`
  - 내용: Tier1/Tier2 엔트리들의 `path`가 `/`로 돼 있는 항목을 실제 API 접두사로 수정
  - 검증: 서버 시작 시 해당 라우트가 중복 없이 마운트되는지 확인 (`server/index.cjs` 로그)

- [ ] 2. 서버 `.cjs` 파일 인코딩 검사 및 변환
  - 대상: 모든 `server/**/*.cjs`
  - 목표: CP949(EUC-KR)로 인코딩된 파일이 있으면 UTF-8로 변환
  - 권장 명령(Windows PowerShell):

```powershell
Get-ChildItem -Path "server" -Recurse -Filter "*.cjs" | ForEach-Object {
  $p = $_.FullName
  $content = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::GetEncoding(949))
  [System.IO.File]::WriteAllText($p, $content, [System.Text.Encoding]::UTF8)
}
```

- [ ] 3. 네이티브 모듈 재빌드/검증
  - 대상: `better-sqlite3`, `sharp` 등 네이티브 모듈
  - 방법 A (권장): CI에서 `electron-rebuild` 실행

```bash
npx electron-rebuild -v 40.6.0
```

  - 방법 B: `npm rebuild --runtime=electron --target=40.6.0 --update-binary`
  - 검증: 앱 시작 시 `Module version mismatch` 또는 `ERR_DLOPEN_FAILED`가 없어야 함

- [ ] 4. `electron-builder` 설정 적용
  - 파일: `electron-builder.config.cjs`, `electron-builder.config.js`
  - 작업: `npmRebuild: false`로 설정 후, 위 재빌드 스텝을 CI에 명시적으로 추가

- [ ] 5. 파일 기반 서버 로그 확인 및 수집
  - 로그 위치(배포): `%APPDATA%\Osoo_Handle_App\logs\electron-server.log`
  - 수집 방법: 사용자 환경에서 로그 파일을 받아 재현 및 분석

- [ ] 6. 프론트엔드 API 호출 점검
  - 파일: `src/features/**/` 내 Model 파일
  - 작업: `fetch` 직접 호출이 남아있는지 검색/교체 (`apiClient` 사용)

- [ ] 7. 릴리즈 검증
  - 명령: `npm run validate`, `npm run validate:api`
  - 목표: 모든 검증 통과(경고 허용 범위는 운영팀과 조율)

- [ ] 8. 변경 커밋 및 푸시
  - 커밋 메시지 포맷 예: `fix(release): apply A-1..A-4 server logging, lazy-load hardening`
  - 푸시 대상 브랜치: `origin/main` 또는 운영 지침에 따름

- [ ] 9. 후속 작업(옵션)
  - `buildDependenciesFromSource` 사용 여부 결정 및 문서화
  - Windows 빌드 머신에 필요한 빌드 툴 설치 안내(Visual Studio C++ 툴킷, Python 등)

- [x] 10. 도로공사 입력 도우미 웹뷰 전환 및 계정 정보 이중 감지/주입 기능 구현
  - 내용: 수동 도우미 UI를 모달로 격리 숨김 처리하고 웹뷰를 꽉 차게 변경. 윈도우 공백 경로 주입 보안 정책 우회를 위해 `url.pathToFileURL` 적용 및 `executeJavaScript` 이중화 감지 구현.
  - 현황: 커밋 완료 (다만 React 비동기 credentials 로딩 시점과 webview dom-ready 이벤트 시점 조율 등 다음 차수 연동 보완 대기)

---

각 항목을 작업할 때마다, VS Code 변경점과 함께 간단한 상태 업데이트(예: `완료`, `문제: <요약>`)를 남겨 주세요.