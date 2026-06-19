@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-with-provisioning.ps1" %*
if errorlevel 1 (
    echo.
    echo Installation stopped because provisioning or setup failed.
    pause
    exit /b 1
)
endlocal
