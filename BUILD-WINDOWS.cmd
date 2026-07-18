@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1"
if errorlevel 1 (
  echo.
  echo BUILD FAILED. Review the error above.
  pause
  exit /b 1
)
echo.
echo BUILD COMPLETED. Installers are in installers\windows.
pause
