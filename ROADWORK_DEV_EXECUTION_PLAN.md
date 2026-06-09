# 도로공사 입력도우미 개발 실행 계획

## 1. 목표

도로공사 입력도우미 개발을 위해 본 앱의 MVVM 구조와 로컬 DB 기준을 유지하면서, 개발용 실행 환경에서 다음 흐름까지 확인한다.

1. 개발용 UI와 서버 실행
2. 앱 로그인
3. `일지 > 공사 입력 도우미` 진입
4. 도로공사 통합사이트 로딩
5. 설정 메뉴에 저장된 도로공사 계정 자동 입력
6. 사용자가 로그인/SMS 인증을 수동 진행
7. 로그인 이후 실제 사이트 DOM 구조 덤프
8. 덤프 결과를 기준으로 다음 자동입력/입력도우미 매핑 설계 자료 작성

## 2. 절대 기준

정본 로컬 DB는 반드시 하나만 사용한다.

```text
%APPDATA%\Osoo_Handle_App\osoo.db
```

이 DB에 저장되는 데이터는 다음과 같다.

```text
유량
약품
키트
수질/분석치
설정 메뉴 매핑값
웹/앱 계정 정보
도로공사 로그인 정보
```

Electron `app.getPath('userData')`는 브라우저 세션, 캐시, Preferences 같은 런타임 저장소로만 본다. 업무 데이터 조회에는 사용하지 않는다.

## 3. 작업 전 확인 문서

작업 전 아래 문서를 먼저 확인한다.

```text
AGENTS.md
LAYOUT_CONTRACT.md
POST_RELEASE_MAINTENANCE_GUIDE.md
ROADWORK_INPUT_HELPER_PLAN.md
ROADWORK_WEBVIEW_INTEGRATION_PLAN.md
ROADWORK_CONTINUATION_PLAN.md
```

주의: `ROADWORK_CONTINUATION_PLAN.md`는 현재 한글 깨짐이 있으므로 내용은 참고만 하고, 새 작업 결과물은 반드시 UTF-8 정상 한글로 작성한다.

## 4. 현재 구현 상태

이미 구현된 주요 파일은 다음과 같다.

```text
src/features/roadwork-helper/
  RoadworkHelperModel.js
  useRoadworkHelperViewModel.js
  RoadworkHelperView.jsx
  components/RoadworkHelperModal.jsx
  components/RoadworkCopyGrid.jsx
  components/RoadworkHelperModal.css

electron/
  preload-roadwork.cjs
  roadworkDumpHelper.cjs
```

메뉴 진입점은 이미 있다.

```text
일지 > 공사 입력 도우미
```

`electron/roadworkDumpHelper.cjs`의 도로공사 URL/계정 조회는 다음 DB를 기준으로 해야 한다.

```text
%APPDATA%\Osoo_Handle_App\osoo.db
```

## 5. 1단계: 개발 실행 환경 준비

권장 실행 명령:

```bash
npm run dev:all
```

확인할 항목:

```text
Vite dev server: http://localhost:18735
Local Bridge Server: http://localhost:18731 또는 자동 탐색 포트
Electron 앱 실행 여부
```

서버 로그에서 다음 경로가 나오는지 확인한다.

```text
Using database at: C:\Users\...\AppData\Roaming\Osoo_Handle_App\osoo.db
```

만약 `better-sqlite3` Node/Electron ABI 오류가 나오면 먼저 재빌드한다.

```bash
npx @electron/rebuild --force --arch=x64 --electron-version=40.6.0
```

필요 시 다음도 실행한다.

```bash
npm rebuild
```

## 6. 2단계: 설정 데이터 확인

설정 메뉴에서 확인한다.

```text
설정 > 웹/앱설정 탭 > 도로공사 웹페이지 설정
```

필수 값:

```text
service_url = https://nwpo.ex.co.kr:5002/security/login.do
user_id = 저장되어 있어야 함
password = 저장되어 있어야 함
```

직접 값은 로그에 노출하지 않는다. 확인은 다음 수준까지만 허용한다.

```text
hasUserId: true
hasPassword: true
password_len: 숫자
```

## 7. 3단계: 공사 입력 도우미 진입 확인

앱 로그인 후 다음 메뉴로 진입한다.

```text
일지 > 공사 입력 도우미
```

확인할 항목:

```text
우측 workspace 전체에 webview가 표시되는가
도로공사 로그인 페이지가 로딩되는가
Header / Sidebar / StatusBar가 유지되는가
workspace 밖으로 레이아웃이 침범하지 않는가
```

레이아웃 기준:

```text
roadwork-page:
  width: 100%
  height: 100%
  min-width: 0
  min-height: 0

roadwork-webview:
  내부 스크롤/전체 영역 사용
```

## 8. 4단계: 자동 계정 입력 검증

관련 파일:

```text
electron/preload-roadwork.cjs
electron/roadworkDumpHelper.cjs
src/features/roadwork-helper/RoadworkHelperView.jsx
```

검증 순서:

1. webview `preload` 경로가 주입되는지 확인
2. `roadwork:getCredentials` 호출이 성공하는지 확인
3. `input[type="password"]`를 찾는지 확인
4. 아이디 필드를 찾는지 확인
5. 값 주입 후 `input`, `change`, `blur` 이벤트가 발생하는지 확인
6. 화면에 실제 아이디/비밀번호가 채워지는지 확인
7. 로그인 버튼은 자동 클릭하지 않고 사용자가 누르게 둔다

계정 값은 콘솔에 직접 출력하지 않는다.

허용 로그 예시:

```js
console.log('[Roadwork Autofill] credentials loaded', {
  hasUserId: true,
  hasPassword: true,
});
```

금지 로그:

```js
console.log(userId, password);
```

## 9. 5단계: DOM 덤프 기능 정리

현재 단축키:

```text
Ctrl + Shift + S
```

저장 위치 기준:

```text
%APPDATA%\Osoo_Handle_App\roadwork-debug\roadwork_dom_dump.html
```

오늘 작업 목표:

1. 로그인 전 DOM 덤프
2. 로그인 후 SMS 인증 화면 DOM 덤프
3. SMS 인증 완료 후 메인/입력 화면 DOM 덤프
4. 실제 일일운영일지 또는 입력 화면 DOM 덤프

파일명을 단계별로 나누는 개선을 권장한다.

```text
roadwork_dom_login.html
roadwork_dom_sms.html
roadwork_dom_home.html
roadwork_dom_dailylog.html
```

가능하면 덤프 저장 IPC에 optional label을 추가한다.

예시 설계:

```js
ipcRenderer.invoke('roadwork:dumpHtml', {
  label: 'login',
  html: document.documentElement.outerHTML,
  url: location.href,
  title: document.title,
});
```

저장 파일 예시:

```text
%APPDATA%\Osoo_Handle_App\roadwork-debug\YYYYMMDD-HHmmss-login.html
%APPDATA%\Osoo_Handle_App\roadwork-debug\YYYYMMDD-HHmmss-login.meta.json
```

단, 이 작업은 `electron/` 변경이므로 변경 범위를 작게 유지한다.

## 10. 6단계: 개발용 UI 보강

현재 floating 버튼:

```text
입력 도우미
```

오늘은 자동입력/DOM 수집 중심이므로, 개발 중에만 보이는 작은 디버그 패널을 추가하는 방안을 권장한다.

위치:

```text
src/features/roadwork-helper/RoadworkHelperView.jsx
```

표시 조건:

```js
import.meta.env.DEV
```

패널 기능:

```text
현재 webview URL 표시
새로고침
DevTools 열기
DOM 덤프 요청 안내
계정 조회 상태 확인 버튼
```

주의:

```text
운영 빌드에서는 보이지 않게 한다.
계정 원문은 절대 표시하지 않는다.
```

가능하면 버튼은 다음 정도만 둔다.

```text
새로고침
DevTools
DOM 저장
계정 상태
```

## 11. 7단계: 사이트 구조 수집 항목

### 로그인 화면

```text
아이디 input selector
비밀번호 input selector
로그인 버튼 selector
form 존재 여부
필수 이벤트: input/change/keyup/blur 등
자동입력 후 사이트 JS가 값을 인식하는지
```

### SMS 인증 화면

```text
인증번호 input selector
확인 버튼 selector
타이머/재전송 영역
인증 성공 후 이동 URL
```

### 메인 화면

```text
메뉴 구조
일일운영일지 메뉴 진입 selector
iframe 사용 여부
frame/window 전환 필요 여부
```

### 입력 화면

```text
유량 입력 필드 순서
전력량 입력 필드 순서
약품 사용량 입력 필드 순서
키트/분석치 입력 위치
저장 버튼 selector
필수 hidden field 여부
테이블 row/column 구조
붙여넣기 가능 여부
```

## 12. 산출물

작업 완료 후 다음 문서를 새로 만들거나 갱신한다.

```text
ROADWORK_SITE_STRUCTURE_REPORT.md
```

포함할 내용:

```text
1. 실행 환경
2. 사용한 로컬 DB 경로
3. 로그인 화면 selector
4. SMS 인증 화면 selector
5. 메인 메뉴 구조
6. 일일운영일지/입력 화면 구조
7. 자동입력 가능/불가능 판단
8. 다음 구현 계획
9. 수집된 덤프 파일 경로
```

`ROADWORK_CONTINUATION_PLAN.md`는 한글 깨짐이 있으므로, 가능하면 정상 UTF-8 문서로 새로 작성하거나 교체 계획을 제안한다.

## 13. 검증

마지막에 반드시 실행한다.

```bash
npm run validate
```

확인 기준:

```text
FAIL: 0
Mojibake 미검출
/api/ping 유지
roadworkHelperRoutes 유지
```

릴리즈 전이 아니므로 오늘 작업에서는 `npm run build`는 선택 사항이다. 다만 Electron/main/preload 수정이 들어갔으므로 시간이 허락하면 다음도 권장한다.

```bash
npm run build
```

## 14. 작업 우선순위

1. 개발 서버/Electron 실행 안정화
2. DB 경로 통일 재확인
3. 도로공사 계정 자동입력 성공 확인
4. 사용자가 수동 로그인/SMS 인증
5. 화면별 DOM 덤프 저장
6. selector/구조 보고서 작성
7. `npm run validate`

## 15. 오늘의 성공 기준

오늘의 성공 기준은 자동입력 완성이 아니라, 자동입력의 첫 관문인 로그인 계정 주입을 성공시키고 이후 화면 구조를 다음 자동화 단계가 가능할 정도로 수집하는 것이다.

