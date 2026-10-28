@echo off
setlocal
if /I "%~1"=="/remover" goto :remove
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startup.ps1"
if errorlevel 1 goto :error
call "%~dp0start-transcriber.bat"
set "RESULT=%errorlevel%"
pause
exit /b %RESULT%
:remove
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\startup.ps1" -Remove
set "RESULT=%errorlevel%"
pause
exit /b %RESULT%
:error
 echo Falha ao configurar a inicializacao automatica.
pause
exit /b 1
