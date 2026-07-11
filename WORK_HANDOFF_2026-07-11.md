# 작업 인계 — 2026-07-11

## 현재 작업 위치

- 원본 프로젝트: `E:\Wastewater Treatment Plant`
- 오늘 작업이 수행된 별도 worktree: `E:\Wastewater Treatment Plant.worktrees\agents-commit-message-update`
- 원본 프로젝트 `main`에는 기존 변경을 보존한 안전 커밋이 먼저 생성되었습니다.
  - `e3e2f3b fix: preserve unified record modal safeguards`
- 오늘 작업 커밋:
  - `9880af3 feat: stabilize board and workspace interactions`
  - `e387984 chore: release v1.0.22`

## 중요한 현재 상태: 병합 충돌 해결 대기

원본 프로젝트에서 `9880af3`을 cherry-pick 하는 중입니다. 다음 파일이 충돌 상태입니다.

- `scripts/validate-release.cjs`
- `src/features/flow/FlowManagementView.jsx`
- `src/features/kit/KitManagementView.jsx`
- `src/features/medicine/MedicineManagementView.jsx`
- `src/features/water/WaterQualityView.jsx`

### 병합 원칙

원본 프로젝트의 통합 입력 모달 안정화 변경과 오늘 작업의 메뉴 복귀 상태 유지 변경을 **함께 보존**해야 합니다. 어느 한쪽을 통째로 선택하면 안 됩니다.

원본 변경에서 보존할 내용:

- `pendingParentRefreshRef`
- `handleSaveComplete({ date, savedTabs })`
- 모달을 닫을 때 필요한 화면만 새로고침하는 `handleModalClose`
- `scripts/validate-release.cjs`의 기존 회귀 방지 계약

오늘 작업에서 보존할 내용:

- `workspaceSession`, `onWorkspaceSessionChange`
- 메뉴별 `selectedKey`, `scrollTop` 복원
- `defaultSelectedRowKey`, `initialScrollTop`, `onScrollPositionChange`
- 공사입력 도우미 계약 및 검증 4개

충돌 해결 후 실행:

```powershell
git add scripts/validate-release.cjs src/features/flow/FlowManagementView.jsx src/features/kit/KitManagementView.jsx src/features/medicine/MedicineManagementView.jsx src/features/water/WaterQualityView.jsx
git cherry-pick --continue
git cherry-pick e387984
npm run build
npm run validate
```

## 오늘 작업 내용

### 소통게시판

- 첨부파일 클릭 시 새 창 대신 즉시 다운로드
- 게시판 폭을 최대 1000px, 좌측 정렬, 좁은 화면에서는 반응형 축소
- Quill 2 표 붙여넣기 및 본문 이미지 업로드/붙여넣기/드래그앤드롭
- 새 본문 이미지는 에디터 폭의 50%로 삽입되고 이후 크기 조절 가능
- `quill-resize-module` 의존성 추가

### 앱 동작 안정화

- 비밀번호 변경 입력 시 `setErrorMsg` 오류 수정
- 유량/약품/키트/수질의 선택 행 및 스크롤을 메뉴 이동 후 복원
- 창 닫기→트레이 이동 또는 로그아웃 시 해당 세션 상태 초기화
- 일회성 `server/scripts/normalizeMemberIds.cjs` 제거

### 공사입력 도우미 보호

- `ROADWORK_HELPER_CONTRACT.md` 추가
- `npm run validate`에 공사입력 도우미 회귀 검증 추가

## 릴리즈 상태

- GitHub Release `v1.0.22`는 이미 공개 업로드되었습니다.
- 주소: https://github.com/bti0497-gif/Osoo_Handle_App/releases/tag/v1.0.22
- 자동업데이트 자산:
  - `Osoo-Handle-App-Setup-1.0.22.exe`
  - `Osoo-Handle-App-Setup-1.0.22.exe.blockmap`
  - `latest.yml`
- ASAR 검증 결과: `121 PASS / 0 FAIL`

## 현장 통합 설치파일

자동업데이트용 설치파일과 현장용 통합 설치파일은 다릅니다. 현장용은 아래 스크립트로 생성합니다.

```powershell
.\scripts\build-integrated-installer.ps1 -AppVersion 1.0.22
```

필수 자격증명 파일은 패키지 본문에 넣지 않고, 설치 시 AppData 설정 경로에 배치됩니다. 이 worktree에는 자격증명 파일이 없어 통합 설치파일은 아직 생성하지 못했습니다.
