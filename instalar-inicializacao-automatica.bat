@echo off
setlocal

set "TRANSCRIBER_START=%~dp0start-transcriber.bat"
set "TRANSCRIBER_LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WhatsApp Transcriber.lnk"

if /I "%~1"=="/remover" goto :remove

if not exist "%TRANSCRIBER_START%" (
    echo [TRANSCRIBER] Nao foi encontrado "%TRANSCRIBER_START%".
    pause
    exit /b 1
)

rem Cria um atalho minimizado na pasta Inicializar do usuario atual; nao exige administrador.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$link = (New-Object -ComObject WScript.Shell).CreateShortcut($env:TRANSCRIBER_LINK); $link.TargetPath = $env:TRANSCRIBER_START; $link.WorkingDirectory = Split-Path $env:TRANSCRIBER_START; $link.WindowStyle = 7; $link.Description = 'Inicia o servidor local do WhatsApp Transcriber'; $link.Save()"
if errorlevel 1 (
    echo [TRANSCRIBER] Nao foi possivel configurar a inicializacao automatica.
    pause
    exit /b 1
)

echo [TRANSCRIBER] Inicializacao automatica instalada para este usuario.
echo [TRANSCRIBER] O servidor sera iniciado agora e nos proximos logins do Windows.
call "%TRANSCRIBER_START%"
pause
exit /b %errorlevel%

:remove
if exist "%TRANSCRIBER_LINK%" del /q "%TRANSCRIBER_LINK%"
if exist "%TRANSCRIBER_LINK%" (
    echo [TRANSCRIBER] Nao foi possivel remover o atalho.
    pause
    exit /b 1
)

echo [TRANSCRIBER] Inicializacao automatica removida.
echo [TRANSCRIBER] O servidor que ja estiver aberto nao sera encerrado.
pause
exit /b 0
