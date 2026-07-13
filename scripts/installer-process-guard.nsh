!macro customInit
  DetailPrint "Stopping existing Osoo Handle App processes before installation."
  nsExec::ExecToStack 'taskkill /F /T /IM "Osoo Handle App.exe"'
  Pop $0
  Pop $1
  Sleep 1500
!macroend
