# AI Agent 지침서 (모든 AI 에이전트 필독)

> **이 문서는 프로젝트의 아키텍처를 보호하기 위한 필수 지침입니다.**
> **구조 변경이 불가피한 경우, 반드시 사용자에게 먼저 확인을 받으세요.**

---

## 프로젝트 개요

- **앱**: 오수처리장 관리 앱 (Osoo Handle App)
- **프론트엔드**: React 19 + Vite (MVVM 아키텍처)
- **백엔드**: Express + better-sqlite3 (로컬 서버)
- **패키징**: Electron + electron-builder (Windows 설치파일)
- **자동 업데이트**: electron-updater + GitHub Releases
- **서버 안정성**: start.cjs 워치독 (자동 재시작)

---

## 절대 변경 금지 구조

```
프로젝트 루트/
├── server.cjs              ← 4줄 엔트리포인트 (로직 추가 금지)
├── start.cjs               ← 워치독 (수정 금지)
├── electron-builder.config.js
│
├── electron/               ← Electron 메인/프리로드/업데이터
│   ├── main.cjs
│   ├── preload.cjs
│   └── updater.cjs
│
├── server/                 ← 모듈화된 백엔드
│   ├── index.cjs           ← Express 앱 + 포트 탐색
│   ├── database.cjs        ← DB 연결/스키마
│   ├── routes/             ← 기능별 라우트 모듈
│   └── services/           ← excelService, driveService
│
├── src/
│   ├── core/               ← 공통 인프라 (절대 구조 변경 금지)
│   │   ├── api/            ← apiClient.js, serverConfig.js
│   │   └── constants/      ← index.js (메뉴, 탭, 역할 상수)
│   │
│   ├── features/           ← 기능 모듈 (아래 패턴 준수)
│   │   ├── auth/           ← AuthModel + useAuthViewModel + LoginView
│   │   ├── flow/           ← FlowModel + useFlowViewModel + FlowManagementView
│   │   ├── medicine/
│   │   ├── water/
│   │   ├── facility/
│   │   ├── dailylog/
│   │   ├── attendance/
│   │   ├── members/
│   │   ├── board/
│   │   └── settings/       ← SettingsModel + useSettingsViewModel + SettingsView
│   │
│   ├── components/         ← 공유 컴포넌트 (Sidebar, Header, StatusBar)
│   ├── styles/             ← 분리된 CSS (4개 파일)
│   └── App.jsx             ← 메인 앱 (feature barrel import 사용)
│
└── .github/workflows/      ← CI/CD
```

---

## MVVM 패턴 (반드시 준수)

### Model (데이터 레이어)
- 파일명: `{Name}Model.js`
- 역할: API 호출만 담당
- API 클라이언트: `import { apiClient } from '../../core/api'` (로컬 Express)
- **금지**: fetch() 직접 호출, 비즈니스 로직

### ViewModel (비즈니스 로직)
- 파일명: `use{Name}ViewModel.js`
- 역할: React Hook으로 상태 관리 + 비즈니스 로직
- Model을 import하여 데이터 접근
- **금지**: JSX 렌더링, 직접 API 호출

### View (UI 렌더링)
- 파일명: `{Name}View.jsx`
- 역할: ViewModel에서 받은 state/handler로 UI만 렌더링
- **금지**: 직접 API 호출, 복잡한 비즈니스 로직

---

## 새 기능 추가 시 절차

### 프론트엔드 새 기능
1. `src/features/{name}/` 디렉토리 생성
2. `{Name}Model.js` 생성 (apiClient 사용)
3. `use{Name}ViewModel.js` 생성 (Model import)
4. `{Name}View.jsx` 생성 (ViewModel import)
5. `index.js` barrel export 생성
6. `src/App.jsx`에 import 및 라우팅 추가
7. 필요 시 `src/core/constants/index.js`에 메뉴 항목 추가

### 백엔드 새 API
1. `server/routes/{name}Routes.cjs` 생성
2. `server/index.cjs`에 `app.use(require('./routes/{name}Routes.cjs')(db))` 등록
3. 필요 시 `server/database.cjs`에 테이블 추가

### 절대 하지 말 것
- `server.cjs` (루트)에 로직 추가
- `src/models/`, `src/viewmodels/` 같은 flat 구조로 파일 생성
- View 안에서 직접 fetch() 호출
- `index.css`에 직접 스타일 작성
- `start.cjs` 수정
- `/api/ping` 엔드포인트 제거 또는 변경

---

## 변경이 필요할 때

다음 항목을 변경해야 하는 경우 **반드시 사용자에게 먼저 물어보세요**:

1. 디렉토리 구조 변경
2. `core/api/` 내 파일 수정
3. `server/database.cjs` 스키마 변경
4. `electron/` 내 파일 수정
5. `package.json`의 scripts 또는 main 필드 변경
6. `electron-builder.config.js` 수정
7. `.github/workflows/` 수정

---

## 기술 스택 요약

| 영역 | 기술 | 비고 |
|------|------|------|
| 프론트엔드 | React 19 + Vite 7 | SWC 플러그인 |
| 상태관리 | React Hooks (useState/useEffect) | 외부 라이브러리 없음 |
| HTTP 클라이언트 | `src/core/api/apiClient.js` | 자동 재연결, 에러 핸들링 |
| 로컬 DB | better-sqlite3 | `server/database.cjs` |
| 서버 | Express 5 | `server/index.cjs` |
| 포트 탐색 | 8901~8950 자동 | serverConfig.js ↔ server/index.cjs |
| 데스크톱 | Electron | `electron/main.cjs` |
| 빌드 | electron-builder | NSIS 설치파일 |
| 자동 업데이트 | electron-updater | GitHub Releases |
| CI/CD | GitHub Actions | `.github/workflows/release.yml` |
