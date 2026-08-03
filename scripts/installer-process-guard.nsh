!macro customInit
  DetailPrint "Stopping Osoo watchdog during installation."
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
  IfFileExists "$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe" +2 0
    Abort "Failed to install Osoo Handle App watchdog."
  nsExec::ExecToStack 'schtasks /Create /F /SC ONLOGON /TN "Osoo Handle App Watchdog" /TR "$\"$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe$\" --app $\"$INSTDIR\Osoo Handle App.exe$\"" /RL LIMITED'
  Pop $0
  Pop $1
  StrCmp $0 "0" +2 0
    Abort "Failed to register Osoo Handle App watchdog task."
  ExecShell "open" "$APPDATA\OsooHandleApp\watchdog\OsooWatchdog.exe" '--app "$INSTDIR\Osoo Handle App.exe"'
  SetShellVarContext current
!macroend

!macro customUnInstall
  SetShellVarContext all
  nsExec::ExecToStack 'schtasks /Delete /F /TN "Osoo Handle App Watchdog"'
  Pop $0
  Pop $1
  nsExec::ExecToStack 'taskkill /F /T /IM "OsooWatchdog.exe"'
  Pop $0
  Pop $1
  RMDir /r "$APPDATA\OsooHandleApp\watchdog"
  SetShellVarContext current
!macroend
