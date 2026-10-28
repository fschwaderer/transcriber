$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$server = Join-Path $project 'server'
$logs = Join-Path $env:LOCALAPPDATA 'WhatsAppTranscriber'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$mutex = New-Object Threading.Mutex($false, 'Local\WhatsAppTranscriberStart')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { exit 0 }
    $settings = @{ HOST = '127.0.0.1'; PORT = '3210' }
    $config = Join-Path $server '.env'
    if (-not (Test-Path -LiteralPath $config)) { throw 'Execute instalar.bat primeiro.' }
    foreach ($line in Get-Content -LiteralPath $config) {
        if ($line -match '^\s*(HOST|PORT)\s*=\s*([^#]+)') { $settings[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'") }
    }
    $url = "http://$($settings.HOST):$($settings.PORT)/health"
    function Test-Health {
        try { $health = Invoke-RestMethod -Uri $url -TimeoutSec 2; return ($health.status -eq 'ok' -and $null -ne $health.provider) } catch { return $false }
    }
    if (Test-Health) { Write-Host "Servidor ja esta ativo: $url"; exit 0 }
    $node = Join-Path $project '.runtime\node\node.exe'
    if (-not (Test-Path -LiteralPath $node)) {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw 'Execute instalar.bat para instalar o Node.js.' }
        $node = $command.Source
    }
    if (-not (Test-Path (Join-Path $server 'node_modules\express\package.json'))) { throw 'Execute instalar.bat para preparar as dependencias.' }
    $process = Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $server 'src\index.js') + '"') -WorkingDirectory $server -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log') -PassThru
    for ($i = 0; $i -lt 30; $i++) {
        if ($process.HasExited) { throw 'O servidor encerrou. Consulte server-error.log.' }
        if (Test-Health) { Write-Host "Servidor iniciado: $url"; exit 0 }
        Start-Sleep -Seconds 1
    }
    throw 'O servidor nao respondeu em 30 segundos. Consulte os logs.'
} catch {
    $message = "$(Get-Date -Format s) ERRO: $($_.Exception.Message)"
    Add-Content -LiteralPath (Join-Path $logs 'startup-error.log') -Value $message
    Write-Host $message
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
