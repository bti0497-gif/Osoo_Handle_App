; Osoo Handle App — NSIS 사용자 안내 (electron-builder nsis.include)
; 매크로 내부에서는 MUI_WELCOMEPAGE_TEXT 를 한 줄로 정의해야 함(NSIS !define 제한).
;
; common.nsh 기본값이 ShowInstDetails nevershow 이라, 설치 중 로그 영역을 켭니다.
; (파일별 목록은 7z 단일 패키지 특성상 제한적 — scripts/patch-nsis-install-section.cjs 참고)

!macro customHeader
  ShowInstDetails show
  ShowUninstDetails show
!macroend

; 설치 시작 전 안내
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "오수처리 통합관리 (Osoo Handle App)"
  !define MUI_WELCOMEPAGE_TITLE_3LINES
  !define MUI_WELCOMEPAGE_TEXT "이 마법사는 이 PC에 앱을 설치합니다.$\r$\n$\r$\n설치되는 내용 (요약)$\r$\n• 데스크톱 앱 실행 환경 (Electron)$\r$\n• 화면(UI)과 로컬 데이터를 처리하는 앱 본체$\r$\n• 이 PC에서만 동작하는 로컬 API 서버 (Node.js 기반)$\r$\n• 일지·템플릿 등 부가 리소스$\r$\n• 시작 메뉴 / 바로가기 (선택 시)$\r$\n$\r$\n다음 화면에서 설치 위치를 고른 뒤, 파일 복사가 진행됩니다.$\r$\n$\r$\n※ 진행 표시줄이 한동안 거의 움직이지 않을 수 있습니다. (대용량 압축 해제·Windows 보안·백신 검사) 정상일 수 있으니 설치 창을 닫지 말고 기다려 주세요."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

Var OSDIALOG
Var OSDIALOG_LABEL
Var OSDIALOG_PROGRESS

!macro customPageAfterChangeDir
  Page custom OsooShowPrepPage OsooLeavePrepPage
!macroend

Function OsooShowPrepPage
  nsDialogs::Create 1018
  Pop $OSDIALOG

  ${NSD_CreateLabel} 0 0 100% 120u "이제 앱 파일을 복사합니다.$\r$\n$\r$\n• 이 단계에서 시간이 가장 오래 걸릴 수 있습니다.$\r$\n• 아래 진행 표시줄과 로그 영역에서 설치 상태를 확인할 수 있습니다.$\r$\n• 가능하면 이 창을 닫지 마세요.$\r$\n$\r$\n[다음]을 누르면 복사가 시작됩니다."
  Pop $OSDIALOG_LABEL

  ; 진행 표시줄 (marquee 스타일 — 7z 압축 해제는 %를 알 수 없으므로 무한 반복)
  ${NSD_CreateProgressBar} 10u 130u 100% 14u ""
  Pop $OSDIALOG_PROGRESS
  SendMessage $OSDIALOG_PROGRESS ${PBM_SETMARQUEE} 1 50

  nsDialogs::Show
FunctionEnd

Function OsooLeavePrepPage
FunctionEnd

; 설치 완료 후 페이지
!macro customFinishPage
  !define MUI_FINISHPAGE_TITLE "설치 완료"
  !define MUI_FINISHPAGE_TEXT "앱 설치가 완료되었습니다.$\r$\n$\r$\n• 설치된 파일 수: 약 30,000개 이상$\r$\n• 전체 용량: 약 1.1GB$\r$\n$\r$\n바탕화면 또는 시작 메뉴의 'Osoo Handle App' 바로가기로 실행할 수 있습니다.$\r$\n$\r$\n※ 첫 실행 시 내부 서버 초기화에 수 초에서 수십 초가 소요될 수 있습니다."
  !insertmacro MUI_PAGE_FINISH
!macroend

!endif
