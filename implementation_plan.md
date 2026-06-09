# 구현 계획서

## 목적
패키징 시 발생한 문제(네이티브 모듈 ABI 불일치, CP949 인코딩, 라우트 로더 재시도 문제 등)를 해결하고, 재현 가능한 빌드/검증 절차를 문서화해 다른 에이전트가 안전하게 수정 및 재패키징을 진행하도록 안내합니다.

---

## 핵심 변경 사항
- `server` 프로세스 로그를 파일 기반으로 전환하여 배포 환경에서도 진단 로그를 확보합니다.
- Electron 패키지 환경에서 `cwd`를 `process.resourcesPath + '/app.asar.unpacked'`로 고정합니다.
- 무한 재시도하는 lazy loader를 실패한 경우 500 응답으로 고정하여 서버 루프를 방지합니다.
- 프론트엔드 모델들의 `fetch` 직접 호출을 모두 `apiClient`로 교체합니다.
- 불필요한 UI 쉘 컴포넌트들을 정리했습니다.

---

## `package.json` 스크립트 변경(diff)
아래는 변경 전/후 스니펫입니다. 실제 저장소의 `scripts` 블록 내 해당 항목을 교체하세요.

- 변경 전:

```json
"electron:build": "npm run build && electron-builder --config electron-builder.config.cjs",
"electron:publish": "npm run build && electron-builder --config electron-builder.config.js --publish always",
"release:safe": "npm run clean:release && npm run build && npm run validate && npm run validate:api && npm run electron:build"
```

- 변경 후 (명시적으로 `npmRebuild=false`를 CLI로 오버라이드하여 `electron-builder` 내부의 자동 재빌드를 비활성화):

```json
"electron:build": "npm run build && electron-builder --config electron-builder.config.cjs --config.npmRebuild=false",
"electron:publish": "npm run build && electron-builder --config electron-builder.config.cjs --config.npmRebuild=false --publish always",
"release:safe": "npm run clean:release && npm run build && npm run validate && npm run validate:api && npm run electron:build"
```

> 주: CLI 오버라이드는 문서화용이며, 로컬 환경에서는 `electron-builder` 버전에 따라 지원되지 않을 수 있습니다. 실제 무시될 경우에는 아래 `electron-builder` 설정 파일에서 직접 `npmRebuild` 값을 `false`로 변경해야 합니다.

---

## electron-builder 설정 변경 제안
두 버전의 설정 파일이 존재합니다: `electron-builder.config.js` 와 `electron-builder.config.cjs`.
권장 변경:

- `npmRebuild: false`
  - 기술적 원인: `npmRebuild: true`는 빌드 과정에서 `node-gyp`/native 빌드를 자동으로 실행하여 설치된 네이티브 모듈을 현재 Electron ABI에 맞게 재빌드합니다. 하지만 이 과정은 빌드 환경에 따라 실패하거나, 빌드 입력(환경, 툴체인)과 일치하지 않으면 잘못된 바이너리가 생성될 수 있습니다.
  - 부작용 및 방지 대책:
    - 부작용: `npmRebuild: false`로 설정하면 native 모듈이 Electron ABI와 맞지 않을 수 있어 런타임에서 `ERR_DLOPEN_FAILED` / `Module version mismatch` 오류가 발생할 수 있습니다.
    - 방지책: `npmRebuild: false`를 선택할 경우 반드시 다음 중 하나를 수행하세요:
      1. CI/빌드 에이전트에서 `electron-rebuild` 또는 `npm rebuild --runtime=electron --target=<electron-ve# 도로공사 웹사이트 통합 및 플로팅 도우미 격리 구현 계획서

## 개요

본 계획서는 기존 앱의 **프로덕션 코드베이스를 안전하게 보존**하면서, 사용자의 피드백을 반영하여 **공사 입력 도우미 메뉴의 구조를 전면 혁신**하는 방안을 기술합니다.

### 아키텍처 혁신 방향
1. **워크스페이스의 웹뷰 가득 채우기**:
   - 메인 화면(`RoadworkHelperView.jsx`) 전체를 도로공사 포털을 렌더링하는 `<webview>` 컴포넌트로 가득 채워, 온전하고 넓은 작업 시야를 확보합니다.
2. **입력 도우미의 플로팅 패널화**:
   - 기존의 복사 표 그리드 및 날짜 선택 UI는 웹뷰 위에 둥둥 떠 있는 **"드래그 가능 플로팅 패널"**(`RoadworkHelperFloatingPanel.jsx`)로 완전히 재설계합니다.
   - 사용자는 드래그 핸들을 통해 패널의 위치를 화면 구석으로 밀어놓을 수 있고, **"접기/최소화"** 토글을 제공하여 입력 도우미가 웹뷰 화면을 가리지 않도록 제어할 수 있습니다.
3. **디버그/구조 수집 기능 격리 통합**:
   - 개발 환경(`isDev === true`)에서는 단축키(`Ctrl+Shift+S`)로 웹뷰 내의 HTML DOM 구조를 퍼오는 임시 Dumper 기능을 백그라운드로 안전하게 동작시켜 격리된 `scratch/roadwork_dom_dump.html` 파일로 내보냅니다.

---

## 1. 구성 요소별 격리 설계

### 물리적 격리 및 통합 자동화 아키텍처

```
프로젝트 루트/
├── run-all.cjs                 ← [MODIFY] (완료) Node + Vite 서버 외 Electron 자동 구동/연쇄 종료 기능 보강
├── electron/
│   ├── main.cjs                ← [MODIFY] (완료) webviewTag 활성화 및 개발자용 IPC 헬퍼 조건부 로드
│   ├── preload.cjs             ← [MODIFY] (완료) invokeRoadwork 채널 바인딩 노출
│   │
│   ├── roadworkDumpHelper.cjs  ← [NEW] (완료) 개발자용 IPC 및 덤프 핸들러 (Dev 환경에서만 로드)
│   │
│   └── preload-roadwork.cjs     ← [NEW] (완료) 웹뷰 전용 격리 프리로드
│
├── src/
│   └── features/
│     └── roadwork-helper/
│         ├── RoadworkHelperView.jsx  ← [MODIFY] 전체 화면을 웹뷰로 전환 & 모달 격리(숨김 마운트)
│         │
│         └── components/
│             ├── RoadworkCopyGrid.jsx ← (기존 파일 유지)
│             ├── RoadworkHelperModal.jsx  ← [NEW] 기존 입력도우미 UI를 이식한 불투명 모달 컴포넌트
│             └── RoadworkHelperModal.css  ← [NEW] 모달창 전용 스타일 (불투명 배경, 확실한 시인성)
│
└── scratch/                     ← 덤프 파일 저장소
    └── roadwork_dom_dump.html  ← 분석용 HTML 덤프 (개발 시에만 생성)
```

---

## 2. 변경 사항 상세 설명

### A. 메인 뷰 컴포넌트 수정 ([MODIFY] `src/features/roadwork-helper/RoadworkHelperView.jsx`)

- 기존의 테이블 그리드 기반 레이아웃을 모두 걷어내고, 전체 공간을 꽉 채우는 `<webview>`를 배치합니다.
- 웹뷰가 로딩될 때 개발 환경일 경우 프리로드 스크립트(`preload-roadwork.cjs`) 경로를 `window.electronAPI.invokeRoadwork('roadwork:getPreloadPath')`를 통해 받아와 바인딩하고, DevTools를 분리 창으로 함께 기동합니다.
- 분리된 `<RoadworkHelperModal>` 컴포넌트를 마운트하되, `isOpen` 상태값을 `false`로 강제 지정하여 화면에는 렌더링되거나 보이지 않도록 숨김 처리합니다. 모달을 켜기 위한 토글 UI도 현재는 배치하지 않습니다.

### B. 입력도우미 모달 추가 ([NEW] `src/features/roadwork-helper/components/RoadworkHelperModal.jsx`)

- **컴포넌트 분리**:
  - 기존에 `RoadworkHelperView.jsx`에 직접 탑재되어 있던 날짜 선택 피커, 데이터 새로고침, 복사 그리드(`RoadworkCopyGrid`)를 이 모달 내부로 완전히 격리 이식합니다.
- **불투명 배경**:
  - 텍스트와 표의 높은 가독성과 수동 입력을 보조하기 위해 글래스모피즘(흐릿하게 비치기)을 제외하고, 뚜렷하고 불투명한 레이아웃 스타일을 적용합니다.
- **데이터 흐름 연동**:
  - `useRoadworkHelperViewModel`을 그대로 재활용하여 기준일 변경, 새로고침, 클립보드 복사 등 기존에 구현 완료된 동작을 완벽하게 계승합니다.

### C. 모달 스타일 정의 ([NEW] `src/features/roadwork-helper/components/RoadworkHelperModal.css`)

- **Aesthetics & Readability**:
  - 높은 가독성을 확보하기 위해 배경색을 불투명하게(`background-color: #ffffff`) 뚜렷이 지정하고, 보더 및 그림자(`box-shadow`) 효과를 활용해 웹뷰 화면과의 경계를 명확하게 구분합니다.

---

## 3. 검증 계획

### 자동화 테스트 및 실행 검증
- `npm run dev:all` 실행 후 튕김 없이 일렉트론 윈도우와 Vite HMR이 켜지는지 검증.
- `src/core/constants/index.js`에 명시된 "공사 입력 도우미" 메뉴를 클릭해 해당 뷰로 정상 이동하는지 확인.

### 수동 기능 검증
1. **워크스페이스 웹뷰 로딩 확인**:
   - 워크스페이스 영역 전체에 도로공사 웹페이지가 공백 없이 꽉 찬 비율로 정상 로드되는지 확인.
2. **입력도우미 모달 숨김 검증**:
   - 이전에 존재하던 날짜 피커 및 그리드 테이블 등의 UI가 기본 화면에 전혀 노출되지 않고 감춰져 있는지 검증.
3. **디버깅 DOM 덤프 검증**:
   - `Ctrl+Shift+S` 단축키를 웹뷰 내에서 입력했을 때 `scratch/roadwork_dom_dump.html` 파일이 깨짐 없이 디스크에 적재되는지 검증.

---

## 4. 정리 및 복구 절차

분석 및 현장 입력 보조 기능에 대한 1차 개발자 도구 덤프 단계가 완료된 이후에는 다음 파일들만 정리하면 프로덕션 복귀가 완료됩니다:
```bash
# 신규 모달 컴포넌트 및 덤프 부산물 삭제
rm -rf src/features/roadwork-helper/components/RoadworkHelperModal.jsx
rm -rf src/features/roadwork-helper/components/RoadworkHelperModal.css
rm -rf scratch/

# main.cjs와 RoadworkHelperView.jsx의 수정내역 롤백 (또는 커밋 분리)
git checkout src/features/roadwork-helper/RoadworkHelperView.jsx
```