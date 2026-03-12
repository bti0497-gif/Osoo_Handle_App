# 인쇄/PDF 내보내기 개선(Excel HTML 캐시 + HWPX PDF)

이 문서는 **수질분석일지 인쇄/PDF 내보내기 성능/정확도 개선**을 위해 추가된 변경사항을 다른 에이전트/개발자가 빠르게 이해할 수 있도록 정리한 것입니다.

## 배경
- 기존: `ExcelJS`로 템플릿에 데이터/사진 바인딩 → `Excel COM`으로 PDF Export
  - 병합셀 이미지 앵커가 미세하게 틀어지는 문제
  - Excel COM 구동/Export로 속도가 느리고 간헐적 오류

## 목표
1) **Excel 템플릿을 업로드 시 1회 HTML로 변환하여 캐시**
2) 프론트에서 HTML에 데이터 바인딩 후 **즉시 인쇄/PDF 저장(window.print)**
3) **HWPX 템플릿은 한글 COM 자동화로 북마크 채우고 PDF 미리보기**

---

## 1) Excel 템플릿 → HTML 변환/캐시

### 추가된 파일
- `server/services/excelTemplateHtmlService.cjs`
  - ExcelJS로 템플릿을 읽어서 **HTML table로 렌더링**
  - 지원: col/row 크기(근사치), 병합셀(rowspan/colspan), 폰트/굵기/정렬/배경/테두리
  - Named Range(Defined Name)를 발견하면 해당 셀의 텍스트를 `{{이름}}` placeholder로 저장하고,
    HTML에 `data-named-cell="이름"` 속성을 부여
  - 성능/안정성 위해 기본 maxRows/maxCols 제한 추가
    - 기본값: rows 300 / cols 60

### 업로드 시 자동 변환
- 수정 파일: `server/routes/settingsRoutes.cjs`
  - `/api/settings/upload`에서 `report_templates` 업로드 중
  - 확장자가 `.xlsx/.xlsm/.xls` 인 파일은 업로드 직후 `convertExcelTemplateToHtml()` 실행
  - 캐시 위치: `appdata/templates/reports-html/{템플릿명}.html`
  - 현재 기본 옵션: `{ maxRows: 150, maxCols: 40 }`

### HTML 템플릿 제공 API
- 수정 파일: `server/routes/excelRoutes.cjs`
  - `GET /api/logs/preview-template-html?templateName=...`
  - 존재하지 않을 경우 `REPORT_TEMPLATE_HTML_MISSING` 반환

---

## 2) 프론트 HTML 미리보기/인쇄 연결

### 추가된 파일
- `src/features/dailylog/ExcelHtmlPrintView.jsx`
  - 서버에서 HTML 템플릿을 받아오고
  - `data-named-cell`을 기준으로 텍스트 바인딩 후 `dangerouslySetInnerHTML`로 렌더
  - 상단 버튼: `window.print()`
  - 추가 버튼(Electron 전용): `PDF로 저장(대화창)`
    - `window.electronAPI.savePdf()` 호출 → 저장 위치 선택 후 `webContents.printToPDF()`로 저장
  - 현재는 샘플 바인딩 규칙만 포함(날짜, 암모니아1..5 등)

### 기존 View 수정
- 수정 파일: `src/features/dailylog/DailyLogView.jsx`
  - 상단에 토글 버튼 추가: `HTML 출력` ↔ `기본 미리보기`
  - `previewMode === 'excelHtml'`이면 `ExcelHtmlPrintView` 렌더

> 주의: MVVM 규칙상 향후에는 ExcelHtmlPrintView도 ViewModel로 분리하는 것이 좋습니다.

---

## 3) HWPX 자동 채우기 + PDF 미리보기(서버)

### 추가된 파일
- `server/services/hwpPdfService.cjs`
  - PowerShell + COM(`HWPFrame.HwpObject`)로 HWPX 템플릿을 열고
  - 북마크 이름 기준 텍스트/이미지 삽입 후 PDF로 저장
  - 현재 `SaveAs(outputPath, 'PDF')` 사용 (환경에 따라 액션/메서드 차이 가능)

- `server/routes/hwpRoutes.cjs`
  - `GET /api/hwp/preview-pdf?templateName=...`
  - 현재 bindings/imageBindings는 TODO(추후 mapping.json 기반으로 연결)

### 서버 라우트 등록
- 수정 파일: `server/index.cjs`
  - `app.use(require('./routes/hwpRoutes.cjs')(db, BASE_DIR, appDataPath));`

---

## 개발/테스트 스크립트
- `server/scripts/uploadTemplateForTest.cjs`
  - 테스트용으로 템플릿 업로드(멀티파트) 호출
  - 예: `node server/scripts/uploadTemplateForTest.cjs 8901 "templates/reports/청주운영일지(2025년도-) -신규.xlsm"`

---

## 다음 단계(권장)
1) **ExcelHtmlPrintView 바인딩 규칙을 mapping.json 또는 named cell 기반으로 일반화**
2) 이미지 바인딩(예: `암모니아사진`)을 `img` 태그로 치환하는 규칙 추가
3) Excel → HTML 변환에서 “출력용 실제 사용 범위”를 더 정확히 계산(UsedRange)
4) HWPX는 mapping.json의 `hwp` 섹션과 연결하여 북마크 자동 채움 완료

---

## (추가) PDF 저장 대화창이 안 뜨는 문제 대응(Electron)

### 배경
- 기존 `handleDownloadCurrent()`는 `<a download>`로 다운로드를 트리거함
- Electron/Chrome 정책에 따라 저장 대화창이 뜨지 않거나, 다운로드가 묵살될 수 있음

### 대응
- `electron/preload.cjs`에 `savePdf()` API 노출
- `electron/main.cjs`에서 `ipcMain.handle('pdf:save')` 구현
  - `dialog.showSaveDialog()`로 저장 경로 선택
  - `webContents.printToPDF()`로 PDF buffer 생성 후 파일 저장
- `ExcelHtmlPrintView.jsx`에 `PDF로 저장(대화창)` 버튼 추가
