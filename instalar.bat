@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" echo A instalacao falhou. Leia a mensagem acima e tente novamente.
pause
exit /b %RESULT%
