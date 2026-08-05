!include "LogicLib.nsh"

!macro customInit
  DetailPrint "Stopping Osoo watchdog during installation."
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Osoo Handle App Watchdog"
  nsExec::ExecToStack 'schtasks /Delete /F /TN "Osoo Handle App Watchdog"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /T /IM "OsooWatchdog.exe"'
  Pop $0
  Pop $1
  DetailPrint "Stopping existing Osoo Handle App processes before installation."
  nsExec::ExecToStack 'taskkill /F /T /IM "Osoo Handle App.exe"'
  Pop $0
  Pop $1
  Sleep 1500
!macroend

!macro InstallOsooWatchdog
  SetShellVarContext all
  DetailPrint "Installing Osoo Handle App watchdog."
  CreateDirectory "$APPDATA\OsooHandleApp\watchdog"
  CopyFiles /SILENT "$INSTDIR\resources\watchdog\OsooWatchdog.exe" "$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe"
  ${If} ${FileExists} "$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe"
    nsExec::ExecToStack 'schtasks /Create /F /SC ONLOGON /TN "Osoo Handle App Watchdog" /TR "$\"$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe$\" --app $\"$INSTDIR\Osoo Handle App.exe$\"" /RL LIMITED'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      DetailPrint "Watchdog scheduled task registration failed; using Windows Run fallback."
      WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Osoo Handle App Watchdog" '$\"$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe$\" --app $\"$INSTDIR\Osoo Handle App.exe$\"'
    ${Else}
      DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Osoo Handle App Watchdog"
    ${EndIf}
    ExecShell "open" "$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe" '--app "$INSTDIR\Osoo Handle App.exe"'
  ${Else}
    DetailPrint "Watchdog copy failed; application installation will continue without watchdog."
  ${EndIf}
  SetShellVarContext current
!macroend

!macro customUnInstall
  SetShellVarContext all
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Osoo Handle App Watchdog"
  nsExec::ExecToStack 'schtasks /Delete /F /TN "Osoo Handle App Watchdog"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /T /IM "OsooWatchdog.exe"'
  Pop $0
  Pop $1
  RMDir /r "$APPDATA\OsooHandleApp\watchdog"
  SetShellVarContext current
!macroend
