$ErrorActionPreference = 'Stop'

try {
    $projectDirectory = Split-Path $PSScriptRoot -Parent
    $entryPoint = Join-Path $projectDirectory 'server\src\index.js'
    $entryPattern = '(?i)(?:^|\s)"?' + [regex]::Escape($entryPoint) + '"?(?:\s|$)'
    $servers = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match $entryPattern })

    if ($servers.Count -eq 0) {
        Write-Host '[TRANSCRIBER] Nenhum servidor iniciado pelo start-transcriber.bat atualizado esta ativo.'
        Write-Host '[TRANSCRIBER] Execucao manual: use Ctrl+C no terminal. BAT antigo: consulte a orientacao no README.'
        exit 0
    }

    foreach ($server in $servers) {
        # /T inclui o worker Python e /PID evita encerrar outros aplicativos Node.
        & taskkill.exe /PID $server.ProcessId /T /F
        if ($LASTEXITCODE -ne 0) {
            throw "Nao foi possivel encerrar o servidor PID $($server.ProcessId)."
        }
    }
    Write-Host '[TRANSCRIBER] Servidor e processos de transcricao encerrados.'
    Write-Host '[TRANSCRIBER] Para iniciar novamente, execute start-transcriber.bat.'
} catch {
    Write-Error "[TRANSCRIBER] $($_.Exception.Message)"
    exit 1
}
