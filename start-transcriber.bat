@echo off
setlocal EnableDelayedExpansion

set "PROJECT_DIR=%~dp0"
set "SERVER_DIR=%PROJECT_DIR%server"
set "RUNTIME_DIR=%LOCALAPPDATA%\WhatsAppTranscriber"
set "STDOUT_LOG=%RUNTIME_DIR%\server.log"
set "STDERR_LOG=%RUNTIME_DIR%\server-error.log"

if not exist "%SERVER_DIR%\package.json" (
    echo [TRANSCRIBER] A pasta do servidor nao foi encontrada em "%SERVER_DIR%".
    exit /b 1
)

if not exist "%RUNTIME_DIR%" mkdir "%RUNTIME_DIR%" >nul 2>&1

call :check_health
if /I "%HEALTH_STATUS%"=="online" (
    echo [TRANSCRIBER] O servidor ja esta ativo em http://127.0.0.1:3210
    exit /b 0
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo [TRANSCRIBER] Node.js nao encontrado. Instale o Node.js e reinicie o Windows.
    exit /b 1
)

cd /d "%SERVER_DIR%"

rem Cria o ambiente virtual apenas na primeira execucao.
if not exist ".venv\Scripts\python.exe" (
    set "PYTHON_CMD=python"
    where python.exe >nul 2>&1
    if errorlevel 1 (
        where py.exe >nul 2>&1
        if errorlevel 1 (
            echo [TRANSCRIBER] Python nao encontrado. Instale o Python e reinicie o Windows.
            exit /b 1
        )
        set "PYTHON_CMD=py -3"
    )

    echo [TRANSCRIBER] Criando ambiente virtual Python...
    !PYTHON_CMD! -m venv .venv
    if errorlevel 1 (
        echo [TRANSCRIBER] Falha ao criar o ambiente virtual do Python.
        exit /b 1
    )
)

rem Instala as dependencias do Python se o faster-whisper ainda nao estiver presente.
.venv\Scripts\python.exe -m pip show faster-whisper >nul 2>&1
if errorlevel 1 (
    echo [TRANSCRIBER] Instalando dependencias do Python. Isto pode demorar...
    .venv\Scripts\python.exe -m pip install -r python\requirements.txt
    if errorlevel 1 (
        echo [TRANSCRIBER] Falha ao instalar dependencias do Python.
        exit /b 1
    )
)

rem Instala as dependencias do Node apenas na primeira execucao.
if not exist "node_modules" (
    where npm.cmd >nul 2>&1
    if errorlevel 1 (
        echo [TRANSCRIBER] npm nao encontrado. Reinstale o Node.js e reinicie o Windows.
        exit /b 1
    )

    echo [TRANSCRIBER] Instalando dependencias do Node...
    call npm.cmd ci
    if errorlevel 1 (
        echo [TRANSCRIBER] Falha ao instalar dependencias do Node.
        exit /b 1
    )
)

echo [%date% %time%] Iniciando o servidor...>> "%STDOUT_LOG%"

rem Executa o Node oculto e grava a saida em LocalAppData para facilitar diagnosticos.
set "TRANSCRIBER_SERVER_DIR=%SERVER_DIR%"
set "TRANSCRIBER_STDOUT_LOG=%STDOUT_LOG%"
set "TRANSCRIBER_STDERR_LOG=%STDERR_LOG%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node.exe' -ArgumentList 'src/index.js' -WorkingDirectory $env:TRANSCRIBER_SERVER_DIR -WindowStyle Hidden -RedirectStandardOutput $env:TRANSCRIBER_STDOUT_LOG -RedirectStandardError $env:TRANSCRIBER_STDERR_LOG"
if errorlevel 1 (
    echo [TRANSCRIBER] Nao foi possivel iniciar o processo Node.
    exit /b 1
)

rem Tenta por ate 30 segundos, pois notebooks mais lentos podem demorar no login.
for /L %%I in (1,1,30) do (
    call :check_health
    if /I "!HEALTH_STATUS!"=="online" goto :started
    >nul 2>&1 ping.exe -n 2 127.0.0.1
)

echo [TRANSCRIBER] O processo iniciou, mas o servidor nao respondeu em 30 segundos.
echo [TRANSCRIBER] Consulte "%STDERR_LOG%".
exit /b 1

:started
echo [TRANSCRIBER] Servidor iniciado em http://127.0.0.1:3210
exit /b 0

:check_health
set "HEALTH_STATUS=offline"
for /f "usebackq delims=" %%S in (`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:3210/health' -TimeoutSec 2; if ($r.status -eq 'ok') { 'online' } else { 'offline' } } catch { 'offline' }"`) do set "HEALTH_STATUS=%%S"
exit /b 0
