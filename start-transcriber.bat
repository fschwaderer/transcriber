@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-transcriber.ps1"
if errorlevel 1 (
    echo Nao foi possivel iniciar. Execute instalar.bat ou consulte os logs.
    pause
    exit /b 1
)
exit /b 0
