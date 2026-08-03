!include "${__FILEDIR__}\installer-process-guard.nsh"

!macro customInstall
  !insertmacro InstallOsooWatchdog
!macroend
