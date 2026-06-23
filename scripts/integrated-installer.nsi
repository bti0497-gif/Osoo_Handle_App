Unicode true
RequestExecutionLevel user

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "Osoo Handle App Integrated Setup ${APP_VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Osoo_Handle_App_Installer"
Icon "${INSTALLER_ICON}"
BrandingText "Osoo Handle App"
SetCompressor /SOLID lzma
ShowInstDetails show
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "Osoo Handle App Integrated Setup"
VIAddVersionKey /LANG=1042 "FileDescription" "Osoo Handle App Initial Deployment Installer"
VIAddVersionKey /LANG=1042 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "Copyright (c) 2026 Osoo Handle App"

!define MUI_ABORTWARNING
!define MUI_ICON "${INSTALLER_ICON}"
!define MUI_WELCOMEPAGE_TITLE "Osoo Handle App Integrated Setup"
!define MUI_WELCOMEPAGE_TEXT "This installer registers the shared service configuration and installs Osoo Handle App ${APP_VERSION}.$\r$\n$\r$\nAfter installation, sign in as admin and assign the site and site manager."
!define MUI_FINISHPAGE_TITLE "Integrated Setup Complete"
!define MUI_FINISHPAGE_TEXT "Osoo Handle App has been installed.$\r$\nOpen the app and configure the site from the admin settings menu."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "Korean"

Section "Osoo Handle App" SecMain
  SetShellVarContext current

  DetailPrint "Registering shared service configuration."
  CreateDirectory "$APPDATA\Osoo_Handle_App\config"
  SetOutPath "$APPDATA\Osoo_Handle_App\config"
  File /oname=.env.local "${ENV_FILE}"
  File /oname=google-key.json "${GOOGLE_KEY_FILE}"
  File /oname=bigquery-service-account.json "${BIGQUERY_KEY_FILE}"
  File /oname=firebase-service-account.json "${FIREBASE_KEY_FILE}"
  File /oname=${OAUTH_TARGET_NAME} "${OAUTH_FILE}"

  IfFileExists "$APPDATA\Osoo_Handle_App\config\.env.local" +2 0
    Abort "Failed to register the environment configuration."
  IfFileExists "$APPDATA\Osoo_Handle_App\config\google-key.json" +2 0
    Abort "Failed to register the Google service account."
  IfFileExists "$APPDATA\Osoo_Handle_App\config\bigquery-service-account.json" +2 0
    Abort "Failed to register the BigQuery service account."
  IfFileExists "$APPDATA\Osoo_Handle_App\config\firebase-service-account.json" +2 0
    Abort "Failed to register the Firebase service account."

  DetailPrint "Starting the Osoo Handle App installer."
  SetOutPath "$PLUGINSDIR"
  File /oname=OsooHandleAppSetup.exe "${APP_INSTALLER}"
  ExecWait '"$PLUGINSDIR\OsooHandleAppSetup.exe"' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "The app installer did not complete successfully. Exit code: $0"
    SetErrorLevel $0
    Abort
  ${EndIf}

  DetailPrint "Integrated setup completed."
SectionEnd
