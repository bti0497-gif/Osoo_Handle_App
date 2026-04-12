# 내일 재개용 TODO (배포 전 마무리)

## 현재 완료 상태
- 코드 정리/리팩토링: 완료
- lint: 통과
- vite build: 통과
- 번들 분리(lazy loading): 적용 완료

## 내일 시작 시 바로 할 일 (순서 고정)
1. 개발 프로세스 정리
- 목적: Electron 패키징 중 `better-sqlite3` 파일 잠금 방지
- 확인/정리:
  - `npm run dev:all`, `node server.cjs`, `vite` 등 실행 중이면 종료
  - 특히 node 프로세스가 워크스페이스를 점유하지 않게 정리

2. 패키징 산출물 잠금 회피
- 목적: `release/win-unpacked/resources/templates/... Access denied` 재발 방지
- 방법:
  - 임시 출력 경로를 사용해서 패키징 검증
  - 권장 명령:
    - `npx electron-builder --config electron-builder.config.cjs --config.npmRebuild=false --config.directories.output=release-temp`
- 기대결과: `release-temp` 하위에 `Osoo Handle App Setup 1.0.0.exe` 생성

3. 패키징 정상화(운영 경로)
- 목적: 임시 출력 검증 후 기본 `release` 경로로 복귀
- 방법:
  - 필요 시 `release` 폴더 사용 중인 프로세스 해제 후 재실행
  - 권장 명령:
    - `npx electron-builder --config electron-builder.config.cjs --config.npmRebuild=false`

4. 배포 설정 확정
- 목적: auto update 실제 동작 준비
- 파일: `electron-builder.config.js` 또는 `electron-builder.config.cjs`
- 작업:
  - `publish.owner`, `publish.repo` 값 채우기
  - 릴리스 저장소 정책(비공개/공개) 확인

5. 메타데이터 정리(경고 제거)
- 파일: `package.json`
- 작업:
  - `description`, `author` 추가

6. 산출물/변경분 점검 후 커밋 분리
- 권장 커밋 단위:
  - A: lint/refactor + lazy loading
  - B: packaging 보조 설정(`electron-builder.config.cjs`) 및 배포 설정
  - C: 빌드 산출물 취급(저장소 정책에 따라 제외/별도)

7. 접속자정보창/회원관리 다현장(2개 현장) 지원
- 목적: 한 명의 현장관리자가 2개 현장을 관리할 때, 한 곳에서 두 현장 데이터 작성/일지 출력 가능하게 개선
- 요구사항:
  - 회원(현장관리자) 정보에 관리 현장 2개를 저장/조회할 수 있어야 함
  - 접속자정보창에서 다현장 관리자에게는 "현장 선택 콤보박스" 노출
  - 선택한 현장을 기준으로 데이터 작성/조회/일지 출력이 동작
  - 로그아웃 버튼 위치를 "접속자 이름 오른쪽"으로 이동
  - 정보수정 진입은 "접속자 이름 또는 사용자 아이콘 클릭"으로 통일
- 구현 체크리스트:
  - 회원관리 화면/모델에 2개 현장 입력 및 저장 로직 추가
  - 로그인 후 사용자 세션에 "현재 선택 현장(active site)" 상태 추가
  - 현장 선택 변경 시, 각 feature ViewModel의 조회/저장 파라미터(site) 반영 확인
  - 일지 생성(일일업무일지/수질분석일지/약품/슬러지 포함)에서 선택 현장 기준으로 출력되는지 검증
  - UI 회귀 테스트: 관리자(단일 현장), 관리자(다현장), 일반 사용자 각각 확인
- 완료 기준(DoD):
  - 다현장 계정으로 현장 A/B 전환 시 데이터와 출력 결과가 정확히 분리됨
  - 접속자정보창 레이아웃(로그아웃 위치/정보수정 진입 방식)이 요구사항대로 변경됨
  - 기존 단일 현장 사용자 동작에 회귀 없음

8. 일지양식 파일 기본 동봉(패키지 포함) 확정
- 목적: 설치 직후 별도 업로드 없이 각종 일지양식을 기본 사용 가능하게 보장
- 현재 설정 상태:
  - `electron-builder.config.js`에 `templates/**/*` 포함됨
  - `extraResources`에 `{ from: 'templates', to: 'templates' }` 포함됨
- 내일 확인/보강 작업:
  - `templates/reports` 하위 필수 양식 목록 확정
  - 패키징 결과물(`win-unpacked/resources/templates`)에 양식이 실제 포함되는지 확인
  - 앱 실행 후 "양식 선택/일지 출력"이 기본 동봉 양식으로 바로 동작하는지 점검
  - 누락 양식이 있으면 `templates/`에 추가 후 재패키징
- 완료 기준(DoD):
  - 설치본만으로 일지 생성/출력이 동작하고, 양식 누락 오류가 발생하지 않음

9. GitHub 릴리즈 + 배포파일 생성(최종)
- 목적: 실제 배포 버전 생성 및 릴리즈 공개
- 순서:
  - 패키징 성공 (`Setup .exe` 생성 확인)
  - 버전 태그/릴리즈 노트 작성
  - GitHub Release에 설치 파일 업로드
  - auto-update 대상 리포(`publish.owner/repo`)와 릴리즈 채널 일치 여부 확인
- 검증:
  - 새 설치(클린 PC 기준) 정상 실행
  - 기존 설치에서 업데이트 감지/다운로드 이벤트 확인
- 완료 기준(DoD):
  - GitHub Release에 설치 파일이 게시되고, 설치/업데이트 시나리오가 모두 통과

## 주의사항
- `release/`의 대용량 바이너리(`.exe`, `.7z`, `__uninstaller.exe`)가 현재 변경으로 잡혀 있음.
- 저장소 정책상 산출물을 커밋하지 않으면, 커밋 전 정리 필요.
- `electron-builder.config.js`와 `electron-builder.config.cjs`를 함께 쓰는 동안 설정 불일치가 나지 않게 동일 값 유지 필요.

## 내일 Copilot 호출 문구 (복붙)
- `TOMORROW_TODO.md 1번부터 순서대로 실행해줘. 중간에 멈추지 말고 각 단계 끝날 때 결과만 짧게 보고해줘.`

## 왜 "허용 버튼만 보였는가"
- VS Code의 보안 실행 정책 때문에, 일부 긴 명령/고권한 파일 작업은 터미널 출력보다 "승인/허용" UI가 먼저 뜰 수 있음.
- 이 경우 명령은 대기 상태가 되고, 승인을 누르기 전까지 진행되지 않음.
- 내일부터는 긴 작업을 짧은 명령으로 쪼개서 승인 팝업 빈도를 줄여서 진행한다.
